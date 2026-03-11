#!/usr/bin/env node

/**
 * Health Check Script
 * Comprehensive system health monitoring for WhatsApp AutoGen Bot
 * 
 * This script checks:
 * - System components status
 * - Database connectivity
 * - Python bridge functionality
 * - API key validity
 * - Performance metrics
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class HealthChecker {
    constructor() {
        this.projectRoot = path.join(__dirname, '..');
        this.results = {
            overall: 'unknown',
            timestamp: new Date().toISOString(),
            components: {},
            performance: {},
            recommendations: []
        };
        
        // Load environment if .env exists
        const envPath = path.join(this.projectRoot, '.env');
        if (fs.existsSync(envPath)) {
            require('dotenv').config({ path: envPath });
        }
    }

    async run() {
        console.log('🏥 WhatsApp AutoGen Bot Health Check\n');
        console.log(`Timestamp: ${this.results.timestamp}`);
        console.log('=' .repeat(50) + '\n');

        try {
            // Run all health checks
            await this.checkEnvironment();
            await this.checkDirectories();
            await this.checkDependencies();
            await this.checkDatabase();
            await this.checkPythonBridge();
            await this.checkConfiguration();
            await this.checkLogs();
            await this.checkPerformance();

            // Calculate overall health
            this.calculateOverallHealth();

            // Display results
            this.displayResults();

            // Exit with appropriate code
            const exitCode = this.results.overall === 'healthy' ? 0 : 1;
            process.exit(exitCode);

        } catch (error) {
            console.error('❌ Health check failed:', error.message);
            process.exit(1);
        }
    }

    async checkEnvironment() {
        console.log('🌍 Checking Environment...');
        
        const checks = {
            node_version: this.checkNodeVersion(),
            python_available: await this.checkPythonAvailable(),
            env_file: this.checkEnvFile(),
            required_vars: this.checkRequiredEnvVars()
        };

        this.results.components.environment = {
            status: Object.values(checks).every(c => c.status === 'ok') ? 'healthy' : 'unhealthy',
            details: checks
        };

        this.logComponentResult('Environment', this.results.components.environment.status);
    }

    checkNodeVersion() {
        const version = process.version;
        const majorVersion = parseInt(version.slice(1).split('.')[0]);
        
        return {
            status: majorVersion >= 18 ? 'ok' : 'error',
            value: version,
            message: majorVersion >= 18 ? 'Compatible' : 'Requires Node.js 18+'
        };
    }

    async checkPythonAvailable() {
        try {
            const result = await this.runCommand('python', ['--version']);
            return {
                status: result.success ? 'ok' : 'error',
                value: result.output.trim(),
                message: result.success ? 'Available' : 'Not found'
            };
        } catch (error) {
            return {
                status: 'error',
                value: 'Not found',
                message: 'Python is not installed or not in PATH'
            };
        }
    }

    checkEnvFile() {
        const envPath = path.join(this.projectRoot, '.env');
        const exists = fs.existsSync(envPath);
        
        return {
            status: exists ? 'ok' : 'warning',
            value: exists ? 'Found' : 'Missing',
            message: exists ? 'Configuration file exists' : 'Create .env file from .env.example'
        };
    }

    checkRequiredEnvVars() {
        const required = [
            'ANTHROPIC_API_KEY',
            'DATABASE_PATH',
            'WHATSAPP_SESSION_PATH'
        ];

        const missing = required.filter(varName => 
            !process.env[varName] || 
            process.env[varName] === 'your_key_here' || 
            process.env[varName] === 'sk-ant-xxxxx'
        );

        return {
            status: missing.length === 0 ? 'ok' : 'warning',
            value: `${required.length - missing.length}/${required.length} configured`,
            message: missing.length === 0 ? 'All required variables set' : `Missing: ${missing.join(', ')}`
        };
    }

    async checkDirectories() {
        console.log('📁 Checking Directories...');

        const requiredDirs = [
            'data',
            'data/logs',
            'data/session',
            'data/backups'
        ];

        const dirChecks = {};
        let allExist = true;

        for (const dir of requiredDirs) {
            const fullPath = path.join(this.projectRoot, dir);
            const exists = fs.existsSync(fullPath);
            
            dirChecks[dir] = {
                status: exists ? 'ok' : 'error',
                path: fullPath,
                exists: exists
            };

            if (!exists) {
                allExist = false;
            }
        }

        this.results.components.directories = {
            status: allExist ? 'healthy' : 'unhealthy',
            details: dirChecks
        };

        this.logComponentResult('Directories', this.results.components.directories.status);
    }

    async checkDependencies() {
        console.log('📦 Checking Dependencies...');

        const nodeModulesPath = path.join(this.projectRoot, 'nodejs', 'node_modules');
        const nodeModulesExist = fs.existsSync(nodeModulesPath);

        // Check if Python packages are importable
        let pythonDepsOk = false;
        try {
            const result = await this.runCommand('python', ['-c', 'import autogen, anthropic; print("OK")']);
            pythonDepsOk = result.success && result.output.includes('OK');
        } catch (error) {
            pythonDepsOk = false;
        }

        this.results.components.dependencies = {
            status: (nodeModulesExist && pythonDepsOk) ? 'healthy' : 'unhealthy',
            details: {
                node_modules: {
                    status: nodeModulesExist ? 'ok' : 'error',
                    message: nodeModulesExist ? 'Installed' : 'Run: npm install'
                },
                python_packages: {
                    status: pythonDepsOk ? 'ok' : 'error',
                    message: pythonDepsOk ? 'Installed' : 'Run: pip install -r requirements.txt'
                }
            }
        };

        this.logComponentResult('Dependencies', this.results.components.dependencies.status);
    }

    async checkDatabase() {
        console.log('🗄️ Checking Database...');

        try {
            const DatabaseService = require('../nodejs/src/services/database.service');
            const db = new DatabaseService();
            
            await db.initialize();
            
            // Test basic operations
            const testResult = await db.executeQuerySingle('SELECT COUNT(*) as count FROM users');
            const userCount = testResult.count;
            
            await db.close();

            this.results.components.database = {
                status: 'healthy',
                details: {
                    connection: { status: 'ok', message: 'Connected successfully' },
                    schema: { status: 'ok', message: 'Schema initialized' },
                    user_count: { status: 'ok', value: userCount, message: `${userCount} users in database` }
                }
            };

        } catch (error) {
            this.results.components.database = {
                status: 'unhealthy',
                details: {
                    connection: { status: 'error', message: error.message }
                }
            };
        }

        this.logComponentResult('Database', this.results.components.database.status);
    }

    async checkPythonBridge() {
        console.log('🌉 Checking Python Bridge...');

        try {
            const pythonScript = path.join(this.projectRoot, 'python', 'main.py');
            
            if (!fs.existsSync(pythonScript)) {
                throw new Error('Python main.py not found');
            }

            // Test Python bridge communication
            const testProcess = spawn('python', [pythonScript], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            const bridgeTest = await this.testBridgeCommunication(testProcess);

            this.results.components.python_bridge = {
                status: bridgeTest.success ? 'healthy' : 'unhealthy',
                details: bridgeTest
            };

        } catch (error) {
            this.results.components.python_bridge = {
                status: 'unhealthy',
                details: {
                    startup: { status: 'error', message: error.message }
                }
            };
        }

        this.logComponentResult('Python Bridge', this.results.components.python_bridge.status);
    }

    async testBridgeCommunication(pythonProcess) {
        return new Promise((resolve) => {
            let output = '';
            let errorOutput = '';
            let healthResponse = null;

            const timeout = setTimeout(() => {
                pythonProcess.kill();
                resolve({
                    success: false,
                    startup: { status: 'error', message: 'Timeout during bridge test' }
                });
            }, 10000);

            pythonProcess.stdout.on('data', (data) => {
                output += data.toString();
                
                // Look for health check response
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const response = JSON.parse(line);
                            if (response.id === 'health_test') {
                                healthResponse = response;
                            }
                        } catch (e) {
                            // Not JSON, continue
                        }
                    }
                }
            });

            pythonProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            pythonProcess.on('error', (error) => {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    startup: { status: 'error', message: error.message }
                });
            });

            // Send health check request
            setTimeout(() => {
                try {
                    pythonProcess.stdin.write(JSON.stringify({
                        id: 'health_test',
                        type: 'health_check',
                        data: {}
                    }) + '\n');
                } catch (error) {
                    clearTimeout(timeout);
                    resolve({
                        success: false,
                        communication: { status: 'error', message: 'Failed to send test message' }
                    });
                }
            }, 2000);

            // Check results after delay
            setTimeout(() => {
                clearTimeout(timeout);
                pythonProcess.kill();

                if (healthResponse) {
                    resolve({
                        success: true,
                        startup: { status: 'ok', message: 'Started successfully' },
                        communication: { status: 'ok', message: 'Bidirectional communication working' },
                        health_response: { status: 'ok', data: healthResponse }
                    });
                } else if (errorOutput.includes('ModuleNotFoundError')) {
                    resolve({
                        success: false,
                        startup: { status: 'error', message: 'Missing Python dependencies' }
                    });
                } else {
                    resolve({
                        success: false,
                        communication: { status: 'error', message: 'No response to health check' }
                    });
                }
            }, 8000);
        });
    }

    async checkConfiguration() {
        console.log('⚙️ Checking Configuration...');

        const configChecks = {};

        // Check API key format
        const apiKey = process.env.ANTHROPIC_API_KEY;
        configChecks.api_key = {
            status: (apiKey && apiKey.startsWith('sk-ant-') && apiKey.length > 20) ? 'ok' : 'warning',
            message: (apiKey && apiKey.startsWith('sk-ant-')) ? 'Format appears valid' : 'Invalid or missing API key'
        };

        // Check admin configuration
        const adminId = process.env.ADMIN_WHATSAPP_ID;
        configChecks.admin_config = {
            status: (adminId && adminId !== '1234567890@c.us') ? 'ok' : 'warning',
            message: (adminId && adminId !== '1234567890@c.us') ? 'Admin ID configured' : 'Default admin ID detected'
        };

        // Check rate limits
        const rateLimit = parseInt(process.env.MAX_MESSAGES_PER_HOUR) || 0;
        configChecks.rate_limits = {
            status: rateLimit > 0 ? 'ok' : 'warning',
            value: rateLimit,
            message: rateLimit > 0 ? `${rateLimit} messages/hour limit` : 'No rate limiting configured'
        };

        this.results.components.configuration = {
            status: Object.values(configChecks).every(c => c.status !== 'error') ? 'healthy' : 'unhealthy',
            details: configChecks
        };

        this.logComponentResult('Configuration', this.results.components.configuration.status);
    }

    async checkLogs() {
        console.log('📋 Checking Logs...');

        const logDir = path.join(this.projectRoot, 'data', 'logs');
        const logChecks = {};

        if (fs.existsSync(logDir)) {
            const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
            
            logChecks.log_directory = {
                status: 'ok',
                value: `${logFiles.length} log files`,
                message: 'Log directory accessible'
            };

            // Check for recent activity
            let hasRecentLogs = false;
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            
            for (const file of logFiles) {
                const filePath = path.join(logDir, file);
                const stats = fs.statSync(filePath);
                if (stats.mtime.getTime() > oneDayAgo) {
                    hasRecentLogs = true;
                    break;
                }
            }

            logChecks.recent_activity = {
                status: hasRecentLogs ? 'ok' : 'warning',
                message: hasRecentLogs ? 'Recent log activity detected' : 'No recent log activity'
            };

        } else {
            logChecks.log_directory = {
                status: 'warning',
                message: 'Log directory not found'
            };
        }

        this.results.components.logs = {
            status: logChecks.log_directory.status === 'error' ? 'unhealthy' : 'healthy',
            details: logChecks
        };

        this.logComponentResult('Logs', this.results.components.logs.status);
    }

    async checkPerformance() {
        console.log('⚡ Checking Performance...');

        // Memory usage
        const memoryUsage = process.memoryUsage();
        this.results.performance.memory = {
            rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
            heap_used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
            heap_total: Math.round(memoryUsage.heapTotal / 1024 / 1024) // MB
        };

        // Disk space
        try {
            const stats = fs.statSync(this.projectRoot);
            this.results.performance.disk = {
                status: 'ok',
                message: 'Accessible'
            };
        } catch (error) {
            this.results.performance.disk = {
                status: 'error',
                message: 'Cannot access project directory'
            };
        }

        this.logComponentResult('Performance', 'checked');
    }

    calculateOverallHealth() {
        const components = Object.values(this.results.components);
        const healthyCount = components.filter(c => c.status === 'healthy').length;
        const totalCount = components.length;

        if (healthyCount === totalCount) {
            this.results.overall = 'healthy';
        } else if (healthyCount >= totalCount * 0.7) {
            this.results.overall = 'degraded';
        } else {
            this.results.overall = 'unhealthy';
        }

        // Generate recommendations
        this.generateRecommendations();
    }

    generateRecommendations() {
        const recommendations = [];

        for (const [componentName, component] of Object.entries(this.results.components)) {
            if (component.status === 'unhealthy' || component.status === 'degraded') {
                switch (componentName) {
                    case 'environment':
                        recommendations.push('Update Node.js to version 18+ and ensure Python is installed');
                        break;
                    case 'directories':
                        recommendations.push('Run: npm run setup to create required directories');
                        break;
                    case 'dependencies':
                        recommendations.push('Install dependencies: npm install && pip install -r requirements.txt');
                        break;
                    case 'database':
                        recommendations.push('Initialize database: npm run setup');
                        break;
                    case 'python_bridge':
                        recommendations.push('Check Python dependencies and main.py file');
                        break;
                    case 'configuration':
                        recommendations.push('Configure .env file with valid API key and settings');
                        break;
                }
            }
        }

        this.results.recommendations = recommendations;
    }

    displayResults() {
        console.log('\n📊 Health Check Results');
        console.log('=' .repeat(50));

        // Overall status
        const statusEmoji = {
            healthy: '✅',
            degraded: '⚠️',
            unhealthy: '❌'
        };

        console.log(`\nOverall Status: ${statusEmoji[this.results.overall]} ${this.results.overall.toUpperCase()}\n`);

        // Component details
        for (const [componentName, component] of Object.entries(this.results.components)) {
            const emoji = component.status === 'healthy' ? '✅' : '❌';
            console.log(`${emoji} ${componentName}: ${component.status}`);
        }

        // Performance
        if (this.results.performance.memory) {
            console.log(`\n📈 Performance:`);
            console.log(`   Memory: ${this.results.performance.memory.heap_used}MB used / ${this.results.performance.memory.heap_total}MB allocated`);
        }

        // Recommendations
        if (this.results.recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            this.results.recommendations.forEach((rec, index) => {
                console.log(`   ${index + 1}. ${rec}`);
            });
        }

        console.log('\n' + '=' .repeat(50));
    }

    logComponentResult(componentName, status) {
        const emoji = status === 'healthy' ? '✅' : status === 'checked' ? '📊' : '❌';
        console.log(`   ${emoji} ${componentName}: ${status}\n`);
    }

    async runCommand(command, args) {
        return new Promise((resolve) => {
            const process = spawn(command, args);
            let output = '';
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                resolve({
                    success: code === 0,
                    output: output,
                    error: errorOutput,
                    code: code
                });
            });

            process.on('error', (error) => {
                resolve({
                    success: false,
                    output: '',
                    error: error.message,
                    code: -1
                });
            });
        });
    }
}

// Run health check if called directly
if (require.main === module) {
    const healthChecker = new HealthChecker();
    healthChecker.run().catch(error => {
        console.error('Health check failed:', error);
        process.exit(1);
    });
}

module.exports = HealthChecker;
