/**
 * Python Bridge
 * Inter-Process Communication between Node.js and Python
 * 
 * Handles communication with Python AI agents via STDIO
 * Manages request/response matching, timeouts, and error handling
 */

const { spawn } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');

class PythonBridge {
    constructor() {
        this.pythonProcess = null;
        this.messageQueue = new Map(); // messageId -> { resolve, reject, timeout }
        this.messageId = 0;
        this.isReady = false;
        this.restartCount = 0;
        this.maxRestarts = 5;
        this.restartDelay = 5000; // 5 seconds
        
        // Performance metrics
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            totalResponseTime: 0
        };
    }

    async initialize() {
        try {
            logger.info('🐍 Initializing Python bridge...');
            await this.startPythonProcess();
            this.setupHealthCheck();
            logger.info('✅ Python bridge initialized successfully');
        } catch (error) {
            logger.error('❌ Failed to initialize Python bridge:', error);
            throw error;
        }
    }

    async startPythonProcess() {
        return new Promise((resolve, reject) => {
            const pythonPath = path.join(__dirname, '../../python/main.py');
            
            logger.info(`🚀 Starting Python process: ${pythonPath}`);
            
            // Spawn Python process
            this.pythonProcess = spawn('python', [pythonPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: path.join(__dirname, '../../'),
                env: { ...process.env }
            });

            // Set up data handlers
            this.pythonProcess.stdout.on('data', (data) => {
                this.handleResponse(data);
            });

            this.pythonProcess.stderr.on('data', (data) => {
                const errorMessage = data.toString();
                logger.error('🐍 Python stderr:', errorMessage);
                
                // Don't reject on stderr unless it's a startup error
                if (errorMessage.includes('ModuleNotFoundError') || errorMessage.includes('ImportError')) {
                    reject(new Error(`Python module error: ${errorMessage}`));
                }
            });

            this.pythonProcess.on('spawn', () => {
                logger.info('🐍 Python process spawned successfully');
                this.isReady = true;
                resolve();
            });

            this.pythonProcess.on('error', (error) => {
                logger.error('🐍 Python process error:', error);
                this.isReady = false;
                if (!this.isReady) {
                    reject(error);
                } else {
                    this.handleProcessCrash(error);
                }
            });

            this.pythonProcess.on('exit', (code, signal) => {
                logger.warn(`🐍 Python process exited with code ${code}, signal ${signal}`);
                this.isReady = false;
                this.handleProcessExit(code, signal);
            });

            // Set timeout for initialization
            setTimeout(() => {
                if (!this.isReady) {
                    reject(new Error('Python process initialization timeout'));
                }
            }, 30000); // 30 second timeout
        });
    }

    async sendMessage(message, context = {}) {
        if (!this.isReady || !this.pythonProcess) {
            throw new Error('Python bridge not ready');
        }

        const startTime = Date.now();
        const msgId = ++this.messageId;
        
        return new Promise((resolve, reject) => {
            const request = {
                id: msgId,
                type: 'process_message',
                data: {
                    message: message,
                    context: context,
                    timestamp: Date.now(),
                }
            };

            // Store resolver with timeout
            const timeout = setTimeout(() => {
                if (this.messageQueue.has(msgId)) {
                    this.messageQueue.delete(msgId);
                    this.updateMetrics(startTime, false);
                    reject(new Error('Request timeout (30s)'));
                }
            }, 30000); // 30 second timeout

            this.messageQueue.set(msgId, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    this.updateMetrics(startTime, true);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    this.updateMetrics(startTime, false);
                    reject(error);
                },
                timeout,
                startTime
            });

            // Send to Python process
            try {
                const requestJson = JSON.stringify(request) + '\n';
                this.pythonProcess.stdin.write(requestJson);
                
                logger.debug(`📤 Sent message to Python (ID: ${msgId}): ${message.substring(0, 100)}...`);
                
            } catch (error) {
                this.messageQueue.delete(msgId);
                clearTimeout(timeout);
                this.updateMetrics(startTime, false);
                reject(new Error(`Failed to send message to Python: ${error.message}`));
            }
        });
    }

    handleResponse(data) {
        const lines = data.toString().split('\n').filter(l => l.trim());
        
        for (const line of lines) {
            try {
                const response = JSON.parse(line);
                
                if (!response.id) {
                    logger.warn('🐍 Received response without ID:', line.substring(0, 200));
                    continue;
                }
                
                if (this.messageQueue.has(response.id)) {
                    const { resolve, reject } = this.messageQueue.get(response.id);
                    this.messageQueue.delete(response.id);
                    
                    if (response.error) {
                        logger.error(`🐍 Python error (ID: ${response.id}):`, response.error);
                        reject(new Error(response.error));
                    } else {
                        logger.debug(`📥 Received response from Python (ID: ${response.id})`);
                        resolve(response.result);
                    }
                } else {
                    logger.warn(`🐍 Received response for unknown ID: ${response.id}`);
                }
                
            } catch (error) {
                logger.error('🐍 Failed to parse Python response:', error);
                logger.debug('Raw response:', line);
            }
        }
    }

    handleProcessCrash(error) {
        logger.error(`💥 Python process crashed: ${error.message}`);
        
        // Reject all pending requests
        this.rejectPendingRequests(new Error('Python process crashed'));
        
        // Attempt restart
        this.scheduleRestart();
    }

    handleProcessExit(code, signal) {
        logger.warn(`🐍 Python process exited (code: ${code}, signal: ${signal})`);
        
        // Reject all pending requests
        this.rejectPendingRequests(new Error(`Python process exited with code ${code}`));
        
        // Attempt restart if not a clean shutdown
        if (code !== 0 && !signal) {
            this.scheduleRestart();
        }
    }

    rejectPendingRequests(error) {
        for (const [msgId, { reject, timeout }] of this.messageQueue.entries()) {
            clearTimeout(timeout);
            reject(error);
        }
        this.messageQueue.clear();
    }

    async scheduleRestart() {
        if (this.restartCount >= this.maxRestarts) {
            logger.error(`💥 Max restart attempts (${this.maxRestarts}) exceeded. Python bridge disabled.`);
            return;
        }

        this.restartCount++;
        logger.info(`🔄 Scheduling Python process restart #${this.restartCount} in ${this.restartDelay}ms`);
        
        setTimeout(async () => {
            try {
                await this.startPythonProcess();
                logger.info('✅ Python process restarted successfully');
                this.restartCount = 0; // Reset counter on successful restart
            } catch (error) {
                logger.error('❌ Failed to restart Python process:', error);
                this.scheduleRestart(); // Try again
            }
        }, this.restartDelay);
        
        // Increase delay for next restart (exponential backoff)
        this.restartDelay = Math.min(this.restartDelay * 2, 60000); // Max 1 minute
    }

    updateMetrics(startTime, success) {
        const responseTime = Date.now() - startTime;
        
        this.metrics.totalRequests++;
        this.metrics.totalResponseTime += responseTime;
        this.metrics.averageResponseTime = this.metrics.totalResponseTime / this.metrics.totalRequests;
        
        if (success) {
            this.metrics.successfulRequests++;
        } else {
            this.metrics.failedRequests++;
        }
    }

    setupHealthCheck() {
        // Send ping every 30 seconds to check if Python is responsive
        setInterval(async () => {
            if (this.isReady && this.messageQueue.size === 0) {
                try {
                    await this.sendHealthCheck();
                } catch (error) {
                    logger.warn('🏥 Python health check failed:', error.message);
                    // Health check failure will be handled by the normal error handling
                }
            }
        }, 30000);
    }

    async sendHealthCheck() {
        const msgId = ++this.messageId;
        
        return new Promise((resolve, reject) => {
            const request = {
                id: msgId,
                type: 'health_check',
                data: { timestamp: Date.now() }
            };

            const timeout = setTimeout(() => {
                if (this.messageQueue.has(msgId)) {
                    this.messageQueue.delete(msgId);
                    reject(new Error('Health check timeout'));
                }
            }, 5000); // 5 second timeout for health checks

            this.messageQueue.set(msgId, {
                resolve: () => {
                    clearTimeout(timeout);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
                timeout
            });

            try {
                this.pythonProcess.stdin.write(JSON.stringify(request) + '\n');
            } catch (error) {
                this.messageQueue.delete(msgId);
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    // Batch processing support
    async sendBatch(messages) {
        const batchId = ++this.messageId;
        const requests = messages.map((msg, idx) => ({
            id: `${batchId}-${idx}`,
            type: 'process_message',
            data: {
                message: msg.message,
                context: msg.context,
                timestamp: Date.now(),
            }
        }));

        const promises = requests.map(request => 
            new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    if (this.messageQueue.has(request.id)) {
                        this.messageQueue.delete(request.id);
                        reject(new Error('Batch request timeout'));
                    }
                }, 45000); // 45 second timeout for batch

                this.messageQueue.set(request.id, { resolve, reject, timeout });
            })
        );

        // Send all requests
        try {
            for (const request of requests) {
                this.pythonProcess.stdin.write(JSON.stringify(request) + '\n');
            }
        } catch (error) {
            // Clean up on send failure
            requests.forEach(req => {
                if (this.messageQueue.has(req.id)) {
                    const { timeout } = this.messageQueue.get(req.id);
                    clearTimeout(timeout);
                    this.messageQueue.delete(req.id);
                }
            });
            throw new Error(`Failed to send batch: ${error.message}`);
        }

        return Promise.all(promises);
    }

    // Get bridge statistics
    getStats() {
        return {
            isReady: this.isReady,
            pendingRequests: this.messageQueue.size,
            restartCount: this.restartCount,
            processId: this.pythonProcess?.pid || null,
            metrics: { ...this.metrics },
            successRate: this.metrics.totalRequests > 0 ? 
                (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(2) + '%' : 
                '0%'
        };
    }

    // Check if bridge is ready
    isReady() {
        return this.isReady && this.pythonProcess && !this.pythonProcess.killed;
    }

    // Graceful shutdown
    async cleanup() {
        logger.info('🧹 Cleaning up Python bridge...');
        
        try {
            // Reject pending requests
            this.rejectPendingRequests(new Error('Bridge shutdown'));
            
            // Send shutdown signal to Python
            if (this.pythonProcess && !this.pythonProcess.killed) {
                const shutdownRequest = {
                    id: 'shutdown',
                    type: 'shutdown',
                    data: {}
                };
                
                this.pythonProcess.stdin.write(JSON.stringify(shutdownRequest) + '\n');
                
                // Wait for graceful shutdown
                await new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        if (this.pythonProcess && !this.pythonProcess.killed) {
                            logger.warn('🐍 Force killing Python process');
                            this.pythonProcess.kill('SIGKILL');
                        }
                        resolve();
                    }, 5000);
                    
                    if (this.pythonProcess) {
                        this.pythonProcess.on('exit', () => {
                            clearTimeout(timeout);
                            resolve();
                        });
                    } else {
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            }
            
            this.isReady = false;
            logger.info('✅ Python bridge cleaned up');
            
        } catch (error) {
            logger.error('❌ Error during Python bridge cleanup:', error);
        }
    }

    // Force restart (for admin commands)
    async forceRestart() {
        logger.info('🔄 Force restarting Python bridge...');
        
        try {
            await this.cleanup();
            this.restartCount = 0;
            this.restartDelay = 5000;
            await this.startPythonProcess();
            logger.info('✅ Python bridge force restart completed');
        } catch (error) {
            logger.error('❌ Failed to force restart Python bridge:', error);
            throw error;
        }
    }
}

module.exports = PythonBridge;
