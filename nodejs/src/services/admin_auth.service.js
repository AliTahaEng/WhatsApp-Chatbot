/**
 * Admin Authentication Service
 * Enterprise-grade authentication with 2FA, session management, and security
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const logger = require('../utils/logger');

class AdminAuthService {
    constructor(database) {
        this.db = database;
        this.activeSessions = new Map(); // sessionId -> session data
        this.loginAttempts = new Map(); // adminId -> attempt data
        this.maxLoginAttempts = parseInt(process.env.ACCOUNT_LOCKOUT_ATTEMPTS) || 5;
        this.lockoutDurationMs = (parseInt(process.env.ACCOUNT_LOCKOUT_DURATION) || 15) * 60 * 1000;
        this.sessionDuration = (parseInt(process.env.ADMIN_SESSION_DURATION) || 24) * 60 * 60 * 1000;
        
        this.startSessionCleanup();
        logger.info('🔐 Admin Authentication Service initialized');
    }

    // Setup 2FA for admin user
    async setup2FA(adminId) {
        try {
            const secret = speakeasy.generateSecret({
                name: `WhatsApp Bot (${adminId})`,
                issuer: process.env.TWO_FACTOR_ISSUER || 'WhatsApp AutoGen Bot'
            });

            // Store encrypted secret in database
            const encryptedSecret = await this.encryptSecret(secret.base32);
            await this.db.executeRun(
                'UPDATE admin_users SET two_factor_secret = ? WHERE id = ?',
                [JSON.stringify(encryptedSecret), adminId]
            );

            // Generate QR code
            const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

            logger.info(`🔑 2FA setup initiated for admin: ${adminId}`);

            return {
                secret: secret.base32,
                qrCode: qrCodeUrl,
                manualEntry: secret.base32
            };

        } catch (error) {
            logger.error('❌ Error setting up 2FA:', error);
            throw error;
        }
    }

    // Verify 2FA token
    async verify2FA(adminId, token) {
        try {
            const admin = await this.db.executeQuerySingle(
                'SELECT two_factor_secret FROM admin_users WHERE id = ?',
                [adminId]
            );

            if (!admin || !admin.two_factor_secret) {
                throw new Error('2FA not set up for this admin');
            }

            const encryptedSecret = JSON.parse(admin.two_factor_secret);
            const secret = await this.decryptSecret(encryptedSecret);
            
            const verified = speakeasy.totp.verify({
                secret: secret,
                encoding: 'base32',
                token: token,
                window: parseInt(process.env.TWO_FACTOR_WINDOW) || 2
            });

            logger.info(`🔐 2FA verification for ${adminId}: ${verified ? 'SUCCESS' : 'FAILED'}`);
            return verified;

        } catch (error) {
            logger.error('❌ 2FA verification error:', error);
            throw error;
        }
    }

    // Admin login with password + 2FA
    async login(username, password, twoFactorToken = null, ipAddress = null) {
        const adminId = this.normalizeAdminId(username);

        try {
            // Check if account is locked
            if (this.isAccountLocked(adminId)) {
                const lockInfo = this.loginAttempts.get(adminId);
                const remainingTime = Math.ceil((lockInfo.lockedUntil - Date.now()) / 60000);
                await this.logLoginAttempt(adminId, 'failed', ipAddress, `Account locked - ${remainingTime}m remaining`);
                throw new Error(`Account locked. Try again in ${remainingTime} minutes.`);
            }

            // Get admin user
            const admin = await this.db.executeQuerySingle(
                'SELECT * FROM admin_users WHERE username = ? OR email = ?',
                [adminId, adminId]
            );

            if (!admin) {
                await this.recordFailedLogin(adminId, 'User not found', ipAddress);
                throw new Error('Invalid credentials');
            }

            // Verify password
            const passwordValid = await bcrypt.compare(password, admin.password_hash);
            if (!passwordValid) {
                await this.recordFailedLogin(adminId, 'Invalid password', ipAddress);
                throw new Error('Invalid credentials');
            }

            // Check if admin account is active
            if (admin.status !== 'active') {
                await this.recordFailedLogin(adminId, 'Account disabled', ipAddress);
                throw new Error('Account is disabled');
            }

            // Verify 2FA if enabled
            if (admin.two_factor_enabled) {
                if (!twoFactorToken) {
                    // Need 2FA token
                    return {
                        success: false,
                        require2FA: true,
                        message: '2FA token required',
                        adminId: admin.id
                    };
                }

                const is2FAValid = await this.verify2FA(admin.id, twoFactorToken);
                if (!is2FAValid) {
                    await this.recordFailedLogin(adminId, 'Invalid 2FA token', ipAddress);
                    throw new Error('Invalid 2FA token');
                }
            }

            // Create session
            const session = await this.createSession(admin.id, ipAddress);
            
            // Clear failed login attempts
            this.loginAttempts.delete(adminId);

            // Update last login
            await this.db.executeRun(
                'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [admin.id]
            );

            // Log successful login
            await this.logLoginAttempt(admin.id, 'success', ipAddress, 'Login successful', session.sessionId);

            logger.info(`✅ Admin login successful: ${adminId} from ${ipAddress}`);

            return {
                success: true,
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
                adminId: admin.id,
                username: admin.username,
                requires2FA: admin.two_factor_enabled
            };

        } catch (error) {
            logger.error(`❌ Login failed for ${adminId}:`, error.message);
            throw error;
        }
    }

    // Create authenticated session
    async createSession(adminId, ipAddress = null) {
        try {
            const sessionId = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + this.sessionDuration);

            const session = {
                sessionId,
                adminId,
                createdAt: new Date(),
                expiresAt,
                lastActivity: new Date(),
                ipAddress,
                status: 'active'
            };

            // Store in memory
            this.activeSessions.set(sessionId, session);

            // Store in database
            await this.db.executeRun(
                `INSERT INTO admin_sessions (session_id, admin_id, created_at, expires_at, last_activity, ip_address, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [sessionId, adminId, session.createdAt.toISOString(), session.expiresAt.toISOString(), 
                 session.lastActivity.toISOString(), ipAddress, 'active']
            );

            logger.info(`🎫 Session created for admin ${adminId}: ${sessionId.substring(0, 8)}...`);
            return session;

        } catch (error) {
            logger.error('❌ Error creating session:', error);
            throw error;
        }
    }

    // Validate session
    async validateSession(sessionId, ipAddress = null) {
        try {
            let session = this.activeSessions.get(sessionId);

            // If not in memory, try to load from database
            if (!session) {
                const dbSession = await this.db.executeQuerySingle(
                    'SELECT * FROM admin_sessions WHERE session_id = ? AND status = "active"',
                    [sessionId]
                );

                if (!dbSession) {
                    return null;
                }

                session = {
                    sessionId: dbSession.session_id,
                    adminId: dbSession.admin_id,
                    createdAt: new Date(dbSession.created_at),
                    expiresAt: new Date(dbSession.expires_at),
                    lastActivity: new Date(dbSession.last_activity),
                    ipAddress: dbSession.ip_address,
                    status: dbSession.status
                };

                this.activeSessions.set(sessionId, session);
            }

            // Check expiration
            if (new Date() > session.expiresAt) {
                await this.destroySession(sessionId);
                return null;
            }

            // Update last activity
            session.lastActivity = new Date();
            if (ipAddress) {
                session.ipAddress = ipAddress;
            }

            await this.db.executeRun(
                'UPDATE admin_sessions SET last_activity = ?, ip_address = ? WHERE session_id = ?',
                [session.lastActivity.toISOString(), ipAddress, sessionId]
            );

            return session;

        } catch (error) {
            logger.error('❌ Session validation error:', error);
            return null;
        }
    }

    // Destroy session (logout)
    async destroySession(sessionId) {
        try {
            this.activeSessions.delete(sessionId);
            
            await this.db.executeRun(
                'UPDATE admin_sessions SET status = "expired" WHERE session_id = ?',
                [sessionId]
            );

            logger.info(`🗑️ Session destroyed: ${sessionId.substring(0, 8)}...`);

        } catch (error) {
            logger.error('❌ Error destroying session:', error);
        }
    }

    // Record failed login attempt
    async recordFailedLogin(adminId, reason, ipAddress = null) {
        const now = Date.now();
        let attempts = this.loginAttempts.get(adminId) || {
            count: 0,
            firstAttempt: now,
            lastAttempt: now,
            lockedUntil: null
        };

        attempts.count++;
        attempts.lastAttempt = now;

        // Lock account if too many attempts
        if (attempts.count >= this.maxLoginAttempts) {
            attempts.lockedUntil = now + this.lockoutDurationMs;
            logger.warn(`🔒 Admin account locked: ${adminId} (${attempts.count} failed attempts)`);
        }

        this.loginAttempts.set(adminId, attempts);

        // Log the failed attempt
        await this.logLoginAttempt(adminId, 'failed', ipAddress, reason);
    }

    // Log login attempt
    async logLoginAttempt(adminId, success, ipAddress, reason, sessionId = null) {
        try {
            await this.db.executeRun(
                `INSERT INTO admin_login_attempts (admin_id, ip_address, success, reason, session_id, timestamp)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [adminId, ipAddress, success === 'success', reason, sessionId]
            );
        } catch (error) {
            logger.error('❌ Error logging login attempt:', error);
        }
    }

    // Check if account is locked
    isAccountLocked(adminId) {
        const attempts = this.loginAttempts.get(adminId);
        if (!attempts || !attempts.lockedUntil) {
            return false;
        }

        if (Date.now() > attempts.lockedUntil) {
            // Lock expired, clear attempts
            this.loginAttempts.delete(adminId);
            return false;
        }

        return true;
    }

    // Normalize admin identifier
    normalizeAdminId(identifier) {
        return identifier.toLowerCase().trim();
    }

    // Encrypt 2FA secret
    async encryptSecret(secret) {
        const algorithm = 'aes-256-gcm';
        const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-this-in-production';
        
        return new Promise((resolve, reject) => {
            crypto.scrypt(encryptionKey, 'salt', 32, (err, derivedKey) => {
                if (err) return reject(err);
                
                const iv = crypto.randomBytes(16);
                const cipher = crypto.createCipher(algorithm, derivedKey);
                
                let encrypted = cipher.update(secret, 'utf8', 'hex');
                encrypted += cipher.final('hex');
                
                resolve({
                    encrypted,
                    iv: iv.toString('hex')
                });
            });
        });
    }

    // Decrypt 2FA secret
    async decryptSecret(encryptedData) {
        const algorithm = 'aes-256-gcm';
        const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-this-in-production';
        
        return new Promise((resolve, reject) => {
            crypto.scrypt(encryptionKey, 'salt', 32, (err, derivedKey) => {
                if (err) return reject(err);
                
                const decipher = crypto.createDecipher(algorithm, derivedKey);
                
                let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                
                resolve(decrypted);
            });
        });
    }

    // Get active sessions for admin
    async getActiveSessions(adminId) {
        const sessions = [];
        this.activeSessions.forEach((session, sessionId) => {
            if (session.adminId === adminId) {
                sessions.push({
                    sessionId,
                    createdAt: session.createdAt,
                    lastActivity: session.lastActivity,
                    ipAddress: session.ipAddress,
                    expiresAt: session.expiresAt
                });
            }
        });
        return sessions;
    }

    // Revoke all sessions for admin
    async revokeAllSessions(adminId) {
        const sessionsToRemove = [];
        this.activeSessions.forEach((session, sessionId) => {
            if (session.adminId === adminId) {
                sessionsToRemove.push(sessionId);
            }
        });

        for (const sessionId of sessionsToRemove) {
            await this.destroySession(sessionId);
        }

        // Also update database
        await this.db.executeRun(
            'UPDATE admin_sessions SET status = "revoked" WHERE admin_id = ? AND status = "active"',
            [adminId]
        );

        logger.info(`🗑️ Revoked ${sessionsToRemove.length} sessions for admin: ${adminId}`);
        return sessionsToRemove.length;
    }

    // Clean up expired sessions
    async cleanupExpiredSessions() {
        try {
            const now = new Date();
            const expiredSessions = [];

            this.activeSessions.forEach((session, sessionId) => {
                if (now > session.expiresAt) {
                    expiredSessions.push(sessionId);
                }
            });

            for (const sessionId of expiredSessions) {
                await this.destroySession(sessionId);
            }

            // Also cleanup database
            await this.db.executeRun(
                'UPDATE admin_sessions SET status = "expired" WHERE expires_at < CURRENT_TIMESTAMP AND status = "active"'
            );

            if (expiredSessions.length > 0) {
                logger.info(`🧹 Cleaned up ${expiredSessions.length} expired sessions`);
            }

            return expiredSessions.length;

        } catch (error) {
            logger.error('❌ Session cleanup error:', error);
            return 0;
        }
    }

    // Start session cleanup timer
    startSessionCleanup() {
        const cleanupInterval = (parseInt(process.env.SESSION_CLEANUP_INTERVAL) || 60) * 60 * 1000;
        
        setInterval(async () => {
            await this.cleanupExpiredSessions();
        }, cleanupInterval);

        logger.info(`⏰ Session cleanup timer started (${cleanupInterval / 60000} min intervals)`);
    }

    // Create admin user
    async createAdminUser(userData) {
        try {
            const { username, email, password, twoFactorEnabled = false } = userData;
            
            // Hash password
            const passwordHash = await bcrypt.hash(password, 12);
            
            const adminId = crypto.randomUUID();
            
            await this.db.executeRun(
                `INSERT INTO admin_users (id, username, email, password_hash, two_factor_enabled, created_at, status)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')`,
                [adminId, username, email, passwordHash, twoFactorEnabled]
            );

            logger.info(`👤 Admin user created: ${username} (${adminId})`);
            return adminId;

        } catch (error) {
            logger.error('❌ Error creating admin user:', error);
            throw error;
        }
    }

    // Enable 2FA for user
    async enable2FA(adminId, verificationCode) {
        try {
            // Verify the setup code first
            const isValid = await this.verify2FA(adminId, verificationCode);
            if (!isValid) {
                throw new Error('Invalid verification code');
            }

            // Enable 2FA
            await this.db.executeRun(
                'UPDATE admin_users SET two_factor_enabled = true WHERE id = ?',
                [adminId]
            );

            logger.info(`🔐 2FA enabled for admin: ${adminId}`);
            return true;

        } catch (error) {
            logger.error('❌ Error enabling 2FA:', error);
            throw error;
        }
    }

    // Get login statistics
    async getLoginStats(adminId = null, days = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            let sql = `
                SELECT 
                    admin_id,
                    success,
                    COUNT(*) as count,
                    DATE(timestamp) as date
                FROM admin_login_attempts 
                WHERE timestamp >= ?
            `;
            const params = [startDate.toISOString()];

            if (adminId) {
                sql += ' AND admin_id = ?';
                params.push(adminId);
            }

            sql += ' GROUP BY admin_id, success, DATE(timestamp) ORDER BY timestamp DESC';

            const attempts = await this.db.executeQuery(sql, params);

            // Aggregate statistics
            const stats = {
                totalAttempts: 0,
                successfulLogins: 0,
                failedAttempts: 0,
                uniqueAdmins: new Set(),
                dailyBreakdown: {}
            };

            attempts.forEach(attempt => {
                stats.totalAttempts += attempt.count;
                stats.uniqueAdmins.add(attempt.admin_id);
                
                if (attempt.success) {
                    stats.successfulLogins += attempt.count;
                } else {
                    stats.failedAttempts += attempt.count;
                }

                if (!stats.dailyBreakdown[attempt.date]) {
                    stats.dailyBreakdown[attempt.date] = { success: 0, failed: 0 };
                }
                
                if (attempt.success) {
                    stats.dailyBreakdown[attempt.date].success += attempt.count;
                } else {
                    stats.dailyBreakdown[attempt.date].failed += attempt.count;
                }
            });

            stats.uniqueAdmins = stats.uniqueAdmins.size;
            stats.successRate = stats.totalAttempts > 0 ? 
                ((stats.successfulLogins / stats.totalAttempts) * 100).toFixed(1) + '%' : '0%';

            return stats;

        } catch (error) {
            logger.error('❌ Error getting login stats:', error);
            return null;
        }
    }

    // Health check
    async healthCheck() {
        try {
            return {
                healthy: true,
                activeSessions: this.activeSessions.size,
                lockedAccounts: this.loginAttempts.size,
                lastCleanup: new Date().toISOString()
            };
        } catch (error) {
            logger.error('❌ Auth health check failed:', error);
            return { healthy: false, error: error.message };
        }
    }
}

module.exports = AdminAuthService;
