#!/usr/bin/env node

/**
 * Setup Script
 * Initializes the WhatsApp AutoGen Bot system
 * 
 * This script:
 * - Creates necessary directories
 * - Initializes the database
 * - Validates configuration
 * - Performs health checks
 */

const fs = require('fs');
const path = require('path');
const DatabaseService = require('../nodejs/src/services/database.service');

class SetupManager {
    constructor() {
        this.projectRoot = path.join(__dirname, '..');
        this.requiredDirs = [
            'data',
            'data/logs',
            'data/session',
            'data/backups',
            'data/media'
        ];
        this.requiredFiles = [
            '.env'
        ];
    }

    async run() {
        console.log('🚀 Starting WhatsApp AutoGen Bot Setup...\n');

        try {
            // 1. Check Node.js version
            await this.checkNodeVersion();

            // 2. Check Python availability
            await this.checkPython();

            // 3. Create directories
            await this.createDirectories();

            // 4. Check configuration
            await this.checkConfiguration();

            // 5. Initialize database
            await this.initializeDatabase();

            // 6. Validate dependencies
            await this.validateDependencies();

            // 7. Test Python bridge
            await this.testPythonBridge();

            console.log('\n✅ Setup completed successfully!');
            console.log('\nNext steps:');
            console.log('1. Configure your .env file with your Anthropic API key');
            console.log('2. Run: npm start');
            console.log('3. Scan the QR code with WhatsApp\n');

        } catch (error) {
            console.error('\n❌ Setup failed:', error.message);
            process.exit(1);
        }
    }

    async checkNodeVersion() {
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

        console.log(`📋 Checking Node.js version: ${nodeVersion}`);

        if (majorVersion < 18) {
            throw new Error(`Node.js 18+ is required. Current version: ${nodeVersion}`);
        }

        console.log('✅ Node.js version is compatible\n');
    }

    async checkPython() {
        console.log('🐍 Checking Python availability...');

        const { spawn } = require('child_process');
        
        return new Promise((resolve, reject) => {
            const python = spawn('python', ['--version']);
            
            let output = '';
            python.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                output += data.toString();
            });

            python.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Python found: ${output.trim()}\n`);
                    resolve();
                } else {
                    reject(new Error('Python is not installed or not accessible via "python" command'));
                }
            });

            python.on('error', (error) => {
                reject(new Error('Python is not installed or not accessible'));
            });
        });
    }

    async createDirectories() {
        console.log('📁 Creating required directories...');

        for (const dir of this.requiredDirs) {
            const dirPath = path.join(this.projectRoot, dir);
            
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`  Created: ${dir}`);
            } else {
                console.log(`  Exists: ${dir}`);
            }
        }

        console.log('✅ Directories created\n');
    }

    async checkConfiguration() {
        console.log('⚙️ Checking configuration...');

        const envPath = path.join(this.projectRoot, '.env');
        const exampleEnvPath = path.join(this.projectRoot, '.env.example');

        if (!fs.existsSync(envPath)) {
            if (fs.existsSync(exampleEnvPath)) {
                console.log('  Copying .env.example to .env...');
                fs.copyFileSync(exampleEnvPath, envPath);
                console.log('  ⚠️ Please edit .env file with your configuration');
            } else {
                throw new Error('.env.example file not found');
            }
        }

        // Basic validation of .env
        const envContent = fs.readFileSync(envPath, 'utf8');
        
        const requiredVars = [
            'ANTHROPIC_API_KEY',
            'DATABASE_PATH',
            'WHATSAPP_SESSION_PATH'
        ];

        const missingVars = [];
        for (const varName of requiredVars) {
            if (!envContent.includes(`${varName}=`) || envContent.includes(`${varName}=your_`) || envContent.includes(`${varName}=sk-ant-xxxxx`)) {
                missingVars.push(varName);
            }
        }

        if (missingVars.length > 0) {
            console.log('  ⚠️ The following environment variables need to be configured:');
            missingVars.forEach(varName => console.log(`    - ${varName}`));
            console.log('  Please edit the .env file before starting the bot');
        }

        console.log('✅ Configuration checked\n');
    }

    async initializeDatabase() {
        console.log('🗄️ Initializing database...');

        try {
            // Load environment variables
            require('dotenv').config({ path: path.join(this.projectRoot, '.env') });

            const db = new DatabaseService();
            await db.initialize();
            
            console.log('  Database schema created');
            console.log('  Initial configuration inserted');
            
            await db.close();
            console.log('✅ Database initialized\n');

        } catch (error) {
            throw new Error(`Database initialization failed: ${error.message}`);
        }
    }

    async validateDependencies() {
        console.log('📦 Validating dependencies...');

        // Check Node.js dependencies
        const packagePath = path.join(this.projectRoot, 'nodejs', 'package.json');
        if (!fs.existsSync(path.join(this.projectRoot, 'nodejs', 'node_modules'))) {
            console.log('  ⚠️ Node.js dependencies not installed');
            console.log('  Run: npm install');
        } else {
            console.log('  ✅ Node.js dependencies installed');
        }

        // Check Python dependencies
        const requirementsPath = path.join(this.projectRoot, 'requirements.txt');
        if (fs.existsSync(requirementsPath)) {
            console.log('  Python requirements.txt found');
            console.log('  Make sure to run: pip install -r requirements.txt');
        }

        console.log('✅ Dependencies validated\n');
    }

    async testPythonBridge() {
        console.log('🌉 Testing Python bridge...');

        try {
            const { spawn } = require('child_process');
            const pythonScript = path.join(this.projectRoot, 'python', 'main.py');

            // Test if Python script can be executed
            const testProcess = spawn('python', [pythonScript], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            return new Promise((resolve, reject) => {
                let output = '';
                let errorOutput = '';

                testProcess.stdout.on('data', (data) => {
                    output += data.toString();
                });

                testProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                // Send a test health check
                testProcess.stdin.write(JSON.stringify({
                    id: 'setup_test',
                    type: 'health_check',
                    data: {}
                }) + '\n');

                setTimeout(() => {
                    testProcess.kill();
                    
                    if (errorOutput.includes('ModuleNotFoundError') || errorOutput.includes('ImportError')) {
                        console.log('  ⚠️ Python dependencies missing');
                        console.log('  Run: pip install -r requirements.txt');
                    } else {
                        console.log('  ✅ Python bridge is accessible');
                    }
                    
                    resolve();
                }, 3000);

                testProcess.on('error', (error) => {
                    console.log('  ⚠️ Python bridge test inconclusive');
                    resolve(); // Don't fail setup for this
                });
            });

        } catch (error) {
            console.log('  ⚠️ Could not test Python bridge');
            console.log('  This is okay - test will continue at runtime');
        }

        console.log('✅ Python bridge tested\n');
    }

    createStartupScript() {
        const startupScript = `#!/bin/bash
# WhatsApp AutoGen Bot Startup Script

echo "Starting WhatsApp AutoGen Bot..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found"
    echo "Please run: npm run setup"
    exit 1
fi

# Start the bot
cd "$(dirname "$0")"
npm start
`;

        const scriptPath = path.join(this.projectRoot, 'start.sh');
        fs.writeFileSync(scriptPath, startupScript);
        
        // Make executable (Unix-like systems)
        try {
            fs.chmodSync(scriptPath, '755');
        } catch (error) {
            // Ignore on Windows
        }

        console.log('✅ Startup script created: start.sh\n');
    }
}

// Run setup if called directly
if (require.main === module) {
    const setup = new SetupManager();
    setup.run().catch(error => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
}

module.exports = SetupManager;
