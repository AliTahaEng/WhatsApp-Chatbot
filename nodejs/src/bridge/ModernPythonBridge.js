/**
 * Modern Python Bridge
 * Integrates with new Python architecture using DI
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const logger = require('../utils/logger');

class ModernPythonBridge extends EventEmitter {
    constructor(container) {
        super();
        this.container = container;
        this.config = container.resolve('ConfigurationManager');

        this.pythonProcess = null;
        this.isConnected = false;
        this.requestQueue = new Map();
        this.requestCounter = 0;

        this.connectionStatus = {
            connected: false,
            startTime: null,
            uptime: 0,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            totalResponseTime: 0
        };
    }

    async start() {
        try {
            logger.info('🐍 Starting Modern Python Bridge...');

            // Determine which Python entry point to use
            const pythonScript = this.config.get('python.useModernArchitecture', true)
                ? 'main_modern.py'
                : 'main.py';

            const pythonPath = path.join(process.cwd(), 'python', pythonScript);

            const pythonExecutableRaw = process.env.PYTHON_EXECUTABLE;
            let pythonExecutable = pythonExecutableRaw ? pythonExecutableRaw.trim() : 'python';
            pythonExecutable = pythonExecutable.replace(/^"|"$/g, '');
            if (pythonExecutable !== 'python' && pythonExecutable !== 'python3') {
                pythonExecutable = path.isAbsolute(pythonExecutable)
                    ? pythonExecutable
                    : path.resolve(process.cwd(), pythonExecutable);
            }

            // Start Python process with modern architecture
            this.pythonProcess = spawn(pythonExecutable, [pythonPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: path.join(process.cwd(), 'python'),
                env: {
                    ...process.env,
                    PYTHONPATH: path.join(process.cwd(), 'python'),
                    NODE_ENV: process.env.NODE_ENV || 'development',
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONUNBUFFERED: '1'
                }
            });

            this.setupEventHandlers();

            // Wait for initialization
            await this.waitForConnection();

            this.isConnected = true;
            this.connectionStatus.connected = true;
            this.connectionStatus.startTime = Date.now();

            logger.info('✅ Modern Python Bridge connected');

        } catch (error) {
            logger.error('❌ Failed to start Modern Python Bridge:', error);
            throw error;
        }
    }

    setupEventHandlers() {
        // Handle Python process output
        this.pythonProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => line.trim());

            for (const line of lines) {
                try {
                    const response = JSON.parse(line);
                    this.handlePythonResponse(response);
                } catch (error) {
                    // Non-JSON output (logs, etc.)
                    logger.debug('🐍 Python output:', line);
                }
            }
        });

        // Handle Python process errors
        this.pythonProcess.stderr.on('data', (data) => {
            logger.error('🐍 Python error:', data.toString());
        });

        // Handle process exit
        this.pythonProcess.on('close', (code) => {
            this.isConnected = false;
            this.connectionStatus.connected = false;

            if (code !== 0) {
                logger.error(`🐍 Python process exited with code ${code}`);
                // Don't emit 'error' - it causes uncaught exception and crashes Node
                // Instead, reject any pending requests
                for (const [id, req] of this.requestQueue.entries()) {
                    req.reject(new Error(`Python process exited with code ${code}`));
                    this.requestQueue.delete(id);
                }
            } else {
                logger.info('🐍 Python process closed normally');
            }
        });

        this.pythonProcess.on('error', (error) => {
            logger.error('🐍 Python process error:', error);
            // Don't emit 'error' - handle gracefully
            this.isConnected = false;
            this.connectionStatus.connected = false;
            for (const [id, req] of this.requestQueue.entries()) {
                req.reject(error);
                this.requestQueue.delete(id);
            }
        });
    }

    async waitForConnection(timeout = 20000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const checkConnection = () => {
                if (Date.now() - startTime > timeout) {
                    reject(new Error('Python connection timeout'));
                    return;
                }

                // Send health check bypassing isConnected guard
                this._sendRawRequest('health_check', {})
                    .then(() => resolve())
                    .catch(() => {
                        setTimeout(checkConnection, 1000);
                    });
            };

            setTimeout(checkConnection, 2000); // Wait 2s for Python to start
        });
    }

    _sendRawRequest(type, data = {}, timeout = 5000) {
        // Internal method that bypasses the isConnected check (used during init)
        if (!this.pythonProcess || this.pythonProcess.killed) {
            return Promise.reject(new Error('Python process not running'));
        }

        const requestId = `req_${++this.requestCounter}`;

        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.requestQueue.delete(requestId);
                reject(new Error('Health check timeout'));
            }, timeout);

            this.requestQueue.set(requestId, {
                resolve: (result) => {
                    clearTimeout(timeoutHandle);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutHandle);
                    reject(error);
                },
                startTime: Date.now()
            });

            const request = {
                id: requestId,
                type: type,
                data: data,
                timestamp: Date.now()
            };

            this.pythonProcess.stdin.write(JSON.stringify(request) + '\n');
        });
    }

    async sendRequest(type, data = {}, timeout = 30000) {
        if (!this.isConnected) {
            throw new Error('Python bridge not connected');
        }

        const requestId = `req_${++this.requestCounter}`;
        const startTime = Date.now();

        this.connectionStatus.totalRequests++;

        return new Promise((resolve, reject) => {
            // Setup timeout
            const timeoutHandle = setTimeout(() => {
                this.requestQueue.delete(requestId);
                this.connectionStatus.failedRequests++;
                reject(new Error(`Request ${requestId} timed out after ${timeout}ms`));
            }, timeout);

            // Store request in queue
            this.requestQueue.set(requestId, {
                resolve: (result) => {
                    clearTimeout(timeoutHandle);
                    const responseTime = Date.now() - startTime;
                    this.updateMetrics(responseTime, true);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutHandle);
                    const responseTime = Date.now() - startTime;
                    this.updateMetrics(responseTime, false);
                    reject(error);
                },
                startTime
            });

            // Send request to Python
            const request = {
                id: requestId,
                type: type,
                data: data,
                timestamp: Date.now()
            };

            this.pythonProcess.stdin.write(JSON.stringify(request) + '\n');
        });
    }

    handlePythonResponse(response) {
        const requestId = response.id;

        if (!this.requestQueue.has(requestId)) {
            logger.warn(`🐍 Received response for unknown request: ${requestId}`);
            return;
        }

        const request = this.requestQueue.get(requestId);
        this.requestQueue.delete(requestId);

        if (response.status === 'success') {
            request.resolve(response.result);
        } else {
            request.reject(new Error(response.error || 'Unknown Python error'));
        }
    }

    updateMetrics(responseTime, success) {
        this.connectionStatus.totalResponseTime += responseTime;
        this.connectionStatus.uptime = Date.now() - this.connectionStatus.startTime;

        if (success) {
            this.connectionStatus.successfulRequests++;
        } else {
            this.connectionStatus.failedRequests++;
        }

        const totalRequests = this.connectionStatus.successfulRequests + this.connectionStatus.failedRequests;
        if (totalRequests > 0) {
            this.connectionStatus.averageResponseTime = this.connectionStatus.totalResponseTime / totalRequests;
        }
    }

    // High-level methods for common operations
    async processMessage(message, context = {}) {
        logger.debug(`🔄 Processing message via Modern Python Bridge: ${message.substring(0, 100)}...`);

        try {
            const result = await this.sendRequest('process_message', {
                message,
                context
            });

            logger.debug(`✅ Message processed successfully`);
            return result;

        } catch (error) {
            logger.error('❌ Error processing message:', error);
            throw error;
        }
    }

    async healthCheck() {
        try {
            const result = await this.sendRequest('health_check', {});
            return {
                status: 'healthy',
                python: result,
                bridge: this.getConnectionStatus()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                bridge: this.getConnectionStatus()
            };
        }
    }

    async getStats() {
        try {
            const pythonStats = await this.sendRequest('get_stats', {});
            return {
                python: pythonStats,
                bridge: this.getConnectionStatus()
            };
        } catch (error) {
            return {
                error: error.message,
                bridge: this.getConnectionStatus()
            };
        }
    }

    getConnectionStatus() {
        return {
            ...this.connectionStatus,
            successRate: this.connectionStatus.totalRequests > 0
                ? (this.connectionStatus.successfulRequests / this.connectionStatus.totalRequests) * 100
                : 0,
            pendingRequests: this.requestQueue.size
        };
    }

    async stop() {
        if (this.pythonProcess && this.isConnected) {
            logger.info('🛑 Stopping Modern Python Bridge...');

            try {
                // Send shutdown signal
                await this.sendRequest('shutdown', {}, 5000);
            } catch (error) {
                logger.warn('⚠️ Error during graceful shutdown, forcing exit');
            }

            // Force kill if still running
            if (!this.pythonProcess.killed) {
                this.pythonProcess.kill('SIGTERM');

                setTimeout(() => {
                    if (!this.pythonProcess.killed) {
                        this.pythonProcess.kill('SIGKILL');
                    }
                }, 5000);
            }

            this.isConnected = false;
            this.connectionStatus.connected = false;

            logger.info('✅ Modern Python Bridge stopped');
        }
    }

    isReady() {
        return this.isConnected && this.pythonProcess && !this.pythonProcess.killed;
    }
}

module.exports = ModernPythonBridge;
