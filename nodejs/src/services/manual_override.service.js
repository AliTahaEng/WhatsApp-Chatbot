/**
 * Manual Override Manager
 * Manages manual control of conversations
 * 
 * Allows seamless switching between automated and manual conversation handling
 * Supports per-contact and global override modes with automatic expiration
 */

const logger = require('../utils/logger');

class ManualOverrideManager {
    constructor(database) {
        this.db = database;
        this.activeOverrides = new Map(); // contactId -> override data
        this.globalOverride = false;
    }

    async loadActiveOverrides() {
        try {
            const overrides = await this.db.getActiveOverrides();
            this.activeOverrides.clear();
            
            overrides.forEach(override => {
                this.activeOverrides.set(override.contact_id, {
                    type: override.override_type,
                    reason: override.reason,
                    startTime: new Date(override.created_at),
                    adminId: override.admin_id,
                    expiresAt: override.expires_at ? new Date(override.expires_at) : null,
                    notified: false // Reset notification flag on startup
                });
            });
            
            logger.info(`📋 Loaded ${overrides.length} active manual overrides`);
        } catch (error) {
            logger.error('❌ Failed to load active overrides:', error);
        }
    }

    // Check if a contact is under manual override
    isOverridden(contactId) {
        // Check global override first
        if (this.globalOverride) {
            return { 
                type: 'global', 
                reason: 'Global manual mode active',
                notified: false // Always allow notification for global mode
            };
        }

        // Check specific contact override
        const override = this.activeOverrides.get(contactId);
        if (!override) {
            return null;
        }

        // Check if override has expired
        if (override.expiresAt && new Date() > override.expiresAt) {
            this.removeOverride(contactId);
            return null;
        }

        return override;
    }

    // Add manual override for specific contact
    async addOverride(contactId, type, reason, adminId, expirationHours = null) {
        try {
            const expiresAt = expirationHours ? 
                new Date(Date.now() + expirationHours * 60 * 60 * 1000) : null;

            const override = {
                type,
                reason,
                startTime: new Date(),
                adminId,
                expiresAt,
                notified: false
            };

            this.activeOverrides.set(contactId, override);

            // Save to database
            await this.db.addManualOverride(contactId, type, reason, adminId, expiresAt);

            logger.info(`🔧 Manual override added for ${contactId}: ${type} - ${reason}`);
            
            // Log admin action
            await this.db.logAdminAction(
                adminId, 
                'manual_override_add', 
                contactId, 
                { type, reason, expirationHours }
            );

            return override;

        } catch (error) {
            logger.error('❌ Error adding manual override:', error);
            throw error;
        }
    }

    // Remove manual override
    async removeOverride(contactId) {
        try {
            if (this.activeOverrides.has(contactId)) {
                const override = this.activeOverrides.get(contactId);
                this.activeOverrides.delete(contactId);
                
                await this.db.removeManualOverride(contactId);
                
                logger.info(`✅ Manual override removed for ${contactId}`);
                
                // Log admin action if manually removed
                if (override.adminId) {
                    await this.db.logAdminAction(
                        override.adminId, 
                        'manual_override_remove', 
                        contactId, 
                        { previousType: override.type }
                    );
                }
                
                return true;
            }
            return false;
        } catch (error) {
            logger.error('❌ Error removing manual override:', error);
            throw error;
        }
    }

    // Enable global override (all conversations become manual)
    async enableGlobalOverride(adminId, reason) {
        try {
            this.globalOverride = true;
            
            await this.db.logAdminAction(adminId, 'global_override_enable', null, { reason });
            
            logger.info(`🌐 Global override enabled by ${adminId}: ${reason}`);
            
            return true;
        } catch (error) {
            logger.error('❌ Error enabling global override:', error);
            throw error;
        }
    }

    // Disable global override
    async disableGlobalOverride(adminId) {
        try {
            this.globalOverride = false;
            
            await this.db.logAdminAction(adminId, 'global_override_disable', null, { reason: 'Returned to auto mode' });
            
            logger.info(`✅ Global override disabled by ${adminId}`);
            
            return true;
        } catch (error) {
            logger.error('❌ Error disabling global override:', error);
            throw error;
        }
    }

    // Get all active overrides
    getActiveOverrides() {
        const overrides = {};
        this.activeOverrides.forEach((override, contactId) => {
            overrides[contactId] = {
                ...override,
                // Convert dates to strings for JSON serialization
                startTime: override.startTime.toISOString(),
                expiresAt: override.expiresAt ? override.expiresAt.toISOString() : null
            };
        });
        
        return {
            global: this.globalOverride,
            specific: overrides,
            count: this.activeOverrides.size
        };
    }

    // Cleanup expired overrides (run periodically)
    async cleanupExpiredOverrides() {
        const now = new Date();
        const expiredContacts = [];

        this.activeOverrides.forEach((override, contactId) => {
            if (override.expiresAt && now > override.expiresAt) {
                expiredContacts.push(contactId);
            }
        });

        for (const contactId of expiredContacts) {
            await this.removeOverride(contactId);
        }

        if (expiredContacts.length > 0) {
            logger.info(`🧹 Cleaned up ${expiredContacts.length} expired manual overrides`);
        }

        return expiredContacts.length;
    }

    // Start periodic cleanup
    startCleanupTimer() {
        // Clean up expired overrides every 5 minutes
        setInterval(async () => {
            try {
                await this.cleanupExpiredOverrides();
            } catch (error) {
                logger.error('❌ Error during override cleanup:', error);
            }
        }, 5 * 60 * 1000);

        logger.info('⏰ Manual override cleanup timer started (5 min intervals)');
    }

    // Set VIP contact (high priority override)
    async setVIPContact(contactId, adminId, reason = 'VIP contact') {
        return await this.addOverride(contactId, 'priority', reason, adminId, null);
    }

    // Temporarily pause contact (different from blacklist)
    async pauseContact(contactId, adminId, hours = 24, reason = 'Temporary pause') {
        return await this.addOverride(contactId, 'pause', reason, adminId, hours);
    }

    // Training mode - log but don't send responses
    async enableTrainingMode(contactId, adminId, reason = 'Training mode') {
        return await this.addOverride(contactId, 'training', reason, adminId, null);
    }

    // Check if contact is in specific override type
    isInOverrideType(contactId, type) {
        const override = this.isOverridden(contactId);
        return override && override.type === type;
    }

    // Get override statistics
    getOverrideStats() {
        const stats = {
            total: this.activeOverrides.size,
            global: this.globalOverride,
            byType: {},
            expiringSoon: 0, // expires in next hour
            permanent: 0
        };

        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

        this.activeOverrides.forEach(override => {
            // Count by type
            stats.byType[override.type] = (stats.byType[override.type] || 0) + 1;

            // Count expiring soon
            if (override.expiresAt) {
                if (override.expiresAt <= oneHourFromNow) {
                    stats.expiringSoon++;
                }
            } else {
                stats.permanent++;
            }
        });

        return stats;
    }

    // Extend override expiration
    async extendOverride(contactId, additionalHours, adminId) {
        try {
            const override = this.activeOverrides.get(contactId);
            if (!override) {
                throw new Error('No active override found for contact');
            }

            const newExpiry = override.expiresAt ? 
                new Date(override.expiresAt.getTime() + additionalHours * 60 * 60 * 1000) :
                new Date(Date.now() + additionalHours * 60 * 60 * 1000);

            override.expiresAt = newExpiry;

            // Update database
            await this.db.executeRun(
                'UPDATE manual_overrides SET expires_at = ? WHERE contact_id = ? AND status = "active"',
                [newExpiry.toISOString(), contactId]
            );

            logger.info(`⏰ Override extended for ${contactId} by ${additionalHours} hours`);
            
            await this.db.logAdminAction(
                adminId, 
                'manual_override_extend', 
                contactId, 
                { additionalHours, newExpiry: newExpiry.toISOString() }
            );

            return true;

        } catch (error) {
            logger.error('❌ Error extending override:', error);
            throw error;
        }
    }

    // Bulk operations
    async addBulkOverrides(contactIds, type, reason, adminId, expirationHours = null) {
        const results = { success: [], failed: [] };

        for (const contactId of contactIds) {
            try {
                await this.addOverride(contactId, type, reason, adminId, expirationHours);
                results.success.push(contactId);
            } catch (error) {
                results.failed.push({ contactId, error: error.message });
            }
        }

        logger.info(`📦 Bulk override operation: ${results.success.length} succeeded, ${results.failed.length} failed`);
        return results;
    }

    async removeBulkOverrides(contactIds, adminId) {
        const results = { success: [], failed: [] };

        for (const contactId of contactIds) {
            try {
                await this.removeOverride(contactId);
                results.success.push(contactId);
            } catch (error) {
                results.failed.push({ contactId, error: error.message });
            }
        }

        logger.info(`📦 Bulk override removal: ${results.success.length} succeeded, ${results.failed.length} failed`);
        return results;
    }

    // Export/Import overrides (for backup/restore)
    exportOverrides() {
        const overrides = this.getActiveOverrides();
        return {
            timestamp: new Date().toISOString(),
            global: overrides.global,
            specific: overrides.specific,
            count: overrides.count
        };
    }

    async importOverrides(exportData, adminId) {
        try {
            let imported = 0;
            
            // Import global override
            if (exportData.global) {
                await this.enableGlobalOverride(adminId, 'Imported from backup');
            }

            // Import specific overrides
            for (const [contactId, override] of Object.entries(exportData.specific || {})) {
                const expiresAt = override.expiresAt ? new Date(override.expiresAt) : null;
                const hoursUntilExpiry = expiresAt ? 
                    Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))) : 
                    null;

                if (!expiresAt || expiresAt > new Date()) {
                    await this.addOverride(
                        contactId, 
                        override.type, 
                        `${override.reason} (imported)`, 
                        adminId, 
                        hoursUntilExpiry
                    );
                    imported++;
                }
            }

            logger.info(`📥 Imported ${imported} manual overrides from backup`);
            return { imported, total: Object.keys(exportData.specific || {}).length };

        } catch (error) {
            logger.error('❌ Error importing overrides:', error);
            throw error;
        }
    }

    // Health check
    async healthCheck() {
        try {
            const dbOverrides = await this.db.getActiveOverrides();
            const memoryCount = this.activeOverrides.size;
            const dbCount = dbOverrides.length;

            const healthy = Math.abs(memoryCount - dbCount) <= 1; // Allow small discrepancy

            return {
                healthy,
                memoryOverrides: memoryCount,
                databaseOverrides: dbCount,
                globalOverride: this.globalOverride,
                lastCleanup: this.lastCleanup || null
            };
        } catch (error) {
            logger.error('❌ Override health check failed:', error);
            return { healthy: false, error: error.message };
        }
    }
}

module.exports = ManualOverrideManager;
