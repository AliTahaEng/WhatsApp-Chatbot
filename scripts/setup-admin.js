#!/usr/bin/env node

/**
 * Admin User Setup Script
 * Creates the initial admin user for the WhatsApp AutoGen Bot system
 * 
 * Usage:
 * node scripts/setup-admin.js <username> <email> <password>
 * 
 * Example:
 * node scripts/setup-admin.js admin admin@company.com mySecurePassword123
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const readline = require('readline');
const DatabaseService = require('../nodejs/src/services/database.service');
const AdminAuthService = require('../nodejs/src/services/admin_auth.service');
const fs = require('fs');

class AdminSetup {
    constructor() {
        this.db = null;
        this.adminAuth = null;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async run() {
        try {
            console.log('🔐 WhatsApp AutoGen Bot - Admin User Setup');
            console.log('=' .repeat(50));
            console.log('');

            // Initialize database
            await this.initializeDatabase();

            // Get admin details
            const adminDetails = await this.getAdminDetails();

            // Validate details
            this.validateAdminDetails(adminDetails);

            // Create admin user
            const adminId = await this.createAdminUser(adminDetails);

            // Setup 2FA (optional)
            await this.setup2FA(adminId, adminDetails.username);

            // Display success message
            this.displaySuccess(adminDetails);

        } catch (error) {
            console.error('\n❌ Setup failed:', error.message);
            process.exit(1);
        } finally {
            this.rl.close();
            if (this.db) {
                await this.db.close();
            }
        }
    }

    async initializeDatabase() {
        console.log('📦 Initializing database...');
        
        this.db = new DatabaseService();
        await this.db.initialize();

        // Load admin schema if it exists
        const adminSchemaPath = './nodejs/src/database/admin_schema.sql';
        if (fs.existsSync(adminSchemaPath)) {
            const adminSchema = fs.readFileSync(adminSchemaPath, 'utf8');
            await this.db.executeScript(adminSchema);
            console.log('✅ Admin database schema loaded');
        }

        this.adminAuth = new AdminAuthService(this.db);
        console.log('✅ Database initialized\n');
    }

    async getAdminDetails() {
        const args = process.argv.slice(2);
        
        if (args.length >= 3) {
            // Command line arguments provided
            return {
                username: args[0],
                email: args[1],
                password: args[2]
            };
        } else {
            // Interactive mode
            return await this.getInteractiveInput();
        }
    }

    async getInteractiveInput() {
        console.log('📝 Please provide admin user details:\n');

        const username = await this.question('👤 Username: ');
        const email = await this.question('📧 Email: ');
        
        // Get password securely
        const password = await this.getPassword('🔒 Password: ');
        const confirmPassword = await this.getPassword('🔒 Confirm Password: ');

        if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
        }

        return { username, email, password };
    }

    validateAdminDetails(details) {
        console.log('🔍 Validating admin details...');

        // Username validation
        if (!details.username || details.username.length < 3) {
            throw new Error('Username must be at least 3 characters long');
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(details.username)) {
            throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!details.email || !emailRegex.test(details.email)) {
            throw new Error('Please provide a valid email address');
        }

        // Password validation
        if (!details.password || details.password.length < 8) {
            throw new Error('Password must be at least 8 characters long');
        }

        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(details.password)) {
            console.log('⚠️ Warning: Password should contain at least one uppercase letter, one lowercase letter, and one number');
        }

        console.log('✅ Validation passed\n');
    }

    async createAdminUser(details) {
        console.log('👤 Creating admin user...');

        try {
            // Check if username already exists
            const existingUser = await this.db.executeQuerySingle(
                'SELECT id FROM admin_users WHERE username = ? OR email = ?',
                [details.username, details.email]
            );

            if (existingUser) {
                throw new Error('Username or email already exists');
            }

            // Hash password
            const passwordHash = await bcrypt.hash(details.password, 12);
            const adminId = crypto.randomUUID();

            // Insert admin user
            await this.db.executeRun(
                `INSERT INTO admin_users (id, username, email, password_hash, two_factor_enabled, created_at, status)
                 VALUES (?, ?, ?, ?, false, CURRENT_TIMESTAMP, 'active')`,
                [adminId, details.username, details.email, passwordHash]
            );

            console.log(`✅ Admin user created successfully with ID: ${adminId}`);
            return adminId;

        } catch (error) {
            throw new Error(`Failed to create admin user: ${error.message}`);
        }
    }

    async setup2FA(adminId, username) {
        console.log('\n🔐 Two-Factor Authentication Setup (Optional)');
        
        const setup2FA = await this.question('Would you like to setup 2FA now? (y/N): ');
        
        if (setup2FA.toLowerCase() === 'y' || setup2FA.toLowerCase() === 'yes') {
            try {
                console.log('🔑 Generating 2FA setup...');
                
                const setup = await this.adminAuth.setup2FA(adminId);
                
                console.log('\n📱 Two-Factor Authentication Setup:');
                console.log('=' .repeat(40));
                console.log('');
                console.log('1. Install an authenticator app (Google Authenticator, Authy, etc.)');
                console.log('2. Scan the QR code below OR manually enter the key');
                console.log('');
                console.log('Manual Entry Key:');
                console.log(setup.secret);
                console.log('');
                console.log('QR Code (if supported by your terminal):');
                
                // Display QR code in terminal (basic version)
                try {
                    const qrcode = require('qrcode-terminal');
                    qrcode.generate(setup.qrCode, { small: true });
                } catch (qrError) {
                    console.log('QR code display not available in this terminal');
                    console.log('Use the manual entry key above');
                }
                
                console.log('');
                const verificationCode = await this.question('Enter verification code to confirm setup: ');
                
                const isValid = await this.adminAuth.verify2FA(adminId, verificationCode);
                if (isValid) {
                    await this.adminAuth.enable2FA(adminId, verificationCode);
                    console.log('✅ 2FA setup completed successfully!');
                } else {
                    console.log('❌ Invalid verification code. 2FA setup skipped.');
                    console.log('You can set up 2FA later from the web dashboard.');
                }
                
            } catch (error) {
                console.log('❌ 2FA setup failed:', error.message);
                console.log('You can set up 2FA later from the web dashboard.');
            }
        } else {
            console.log('⏩ 2FA setup skipped. You can set it up later from the web dashboard.');
        }
    }

    displaySuccess(details) {
        console.log('\n🎉 Admin User Setup Complete!');
        console.log('=' .repeat(50));
        console.log('');
        console.log('✅ Admin user created successfully');
        console.log(`👤 Username: ${details.username}`);
        console.log(`📧 Email: ${details.email}`);
        console.log('');
        console.log('🌐 Next Steps:');
        console.log('1. Start the bot: npm start');
        console.log('2. Access the web dashboard: http://localhost:3000');
        console.log('3. Login with your credentials');
        console.log('');
        console.log('🔒 Security Recommendations:');
        console.log('• Enable 2FA for additional security');
        console.log('• Use a strong, unique password');
        console.log('• Keep your admin credentials secure');
        console.log('• Monitor admin action logs regularly');
        console.log('');
        console.log('📚 For more information, check the README.md file');
        console.log('');
    }

    async question(prompt) {
        return new Promise(resolve => {
            this.rl.question(prompt, resolve);
        });
    }

    async getPassword(prompt) {
        return new Promise(resolve => {
            process.stdout.write(prompt);
            
            const stdin = process.stdin;
            stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding('utf8');
            
            let password = '';
            
            const onData = (char) => {
                switch (char) {
                    case '\n':
                    case '\r':
                    case '\u0004':
                        stdin.setRawMode(false);
                        stdin.pause();
                        stdin.removeListener('data', onData);
                        console.log('');
                        resolve(password);
                        break;
                    case '\u0003':
                        process.exit();
                        break;
                    case '\u007f': // backspace
                        if (password.length > 0) {
                            password = password.slice(0, -1);
                            process.stdout.write('\b \b');
                        }
                        break;
                    default:
                        password += char;
                        process.stdout.write('*');
                        break;
                }
            };
            
            stdin.on('data', onData);
        });
    }

    // Static method for command line usage
    static async createUser(username, email, password) {
        const setup = new AdminSetup();
        
        try {
            await setup.initializeDatabase();
            
            const adminDetails = { username, email, password };
            setup.validateAdminDetails(adminDetails);
            
            const adminId = await setup.createAdminUser(adminDetails);
            console.log(`✅ Admin user '${username}' created with ID: ${adminId}`);
            
            return adminId;
        } catch (error) {
            console.error('❌ Failed to create admin user:', error.message);
            throw error;
        } finally {
            if (setup.db) {
                await setup.db.close();
            }
        }
    }

    // Check if any admin users exist
    static async hasAdminUsers() {
        const setup = new AdminSetup();
        
        try {
            await setup.initializeDatabase();
            
            const count = await setup.db.executeQuerySingle(
                'SELECT COUNT(*) as count FROM admin_users WHERE status = "active"'
            );
            
            return count.count > 0;
        } catch (error) {
            return false;
        } finally {
            if (setup.db) {
                await setup.db.close();
            }
        }
    }

    // List existing admin users
    static async listAdminUsers() {
        const setup = new AdminSetup();
        
        try {
            await setup.initializeDatabase();
            
            const users = await setup.db.executeQuery(
                'SELECT id, username, email, created_at, last_login, two_factor_enabled, status FROM admin_users'
            );
            
            if (users.length === 0) {
                console.log('No admin users found.');
                return;
            }
            
            console.log('\n👥 Admin Users:');
            console.log('=' .repeat(80));
            console.log('ID\t\tUsername\tEmail\t\t2FA\tStatus\tLast Login');
            console.log('-' .repeat(80));
            
            users.forEach(user => {
                const lastLogin = user.last_login ? 
                    new Date(user.last_login).toLocaleDateString() : 'Never';
                const id = user.id.substring(0, 8) + '...';
                
                console.log(`${id}\t${user.username}\t\t${user.email}\t${user.two_factor_enabled ? '✅' : '❌'}\t${user.status}\t${lastLogin}`);
            });
            
            console.log('');
            return users;
        } catch (error) {
            console.error('❌ Failed to list admin users:', error.message);
            return [];
        } finally {
            if (setup.db) {
                await setup.db.close();
            }
        }
    }
}

// Command line interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'list':
            await AdminSetup.listAdminUsers();
            break;
            
        case 'check':
            const hasUsers = await AdminSetup.hasAdminUsers();
            console.log(hasUsers ? 'Admin users exist' : 'No admin users found');
            process.exit(hasUsers ? 0 : 1);
            break;
            
        case 'create':
            if (args.length >= 4) {
                await AdminSetup.createUser(args[1], args[2], args[3]);
            } else {
                console.log('Usage: node setup-admin.js create <username> <email> <password>');
                process.exit(1);
            }
            break;
            
        case 'help':
        case '--help':
        case '-h':
            console.log('WhatsApp AutoGen Bot - Admin Setup');
            console.log('');
            console.log('Usage:');
            console.log('  node setup-admin.js                    # Interactive setup');
            console.log('  node setup-admin.js <username> <email> <password>  # Direct setup');
            console.log('  node setup-admin.js create <username> <email> <password>');
            console.log('  node setup-admin.js list               # List existing users');
            console.log('  node setup-admin.js check              # Check if admin users exist');
            console.log('  node setup-admin.js help               # Show this help');
            console.log('');
            break;
            
        default:
            // Run interactive setup
            const setup = new AdminSetup();
            await setup.run();
            break;
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
}

module.exports = AdminSetup;
