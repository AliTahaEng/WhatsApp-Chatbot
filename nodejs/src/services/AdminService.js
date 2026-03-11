/**
 * Admin Service - Modern Architecture
 * Handles admin authentication, commands, and notifications using DI
 */

class AdminService {
    constructor(container) {
        this.container = container;
        this.config = container.resolve('ConfigurationManager');
        this.database = container.resolve('IDatabase');
        this.messageProvider = container.resolve('IMessageProvider');
        
        this.adminUsers = new Map();
        this.isEnabled = this.config.get('admin.enabled', false);
        this.adminWhatsAppId = this.config.get('admin.whatsappId');
        
        console.log(`🔐 Admin Service initialized (enabled: ${this.isEnabled})`);
    }

    async start() {
        if (!this.isEnabled) {
            console.log('⏭️ Admin Service disabled');
            return;
        }

        // Load admin users from database
        await this.loadAdminUsers();
        
        // Register message handlers for admin commands
        this.messageProvider.onMessage(this.handleAdminMessage.bind(this));
        
        console.log('✅ Admin Service started');
    }

    async stop() {
        console.log('✅ Admin Service stopped');
    }

    async loadAdminUsers() {
        try {
            // Get admin users from database
            const admins = await this.database.getAdminUsers();
            
            for (const admin of admins) {
                this.adminUsers.set(admin.whatsapp_id, {
                    id: admin.id,
                    name: admin.name,
                    role: admin.role,
                    permissions: admin.permissions ? JSON.parse(admin.permissions) : []
                });
            }
            
            console.log(`📋 Loaded ${this.adminUsers.size} admin users`);
            
        } catch (error) {
            console.error('❌ Error loading admin users:', error);
        }
    }

    async handleAdminMessage(message) {
        const contactId = message.from;
        const messageText = message.body;
        
        // Check if sender is admin
        if (!this.isAdmin(contactId)) {
            return; // Not an admin, ignore
        }
        
        // Check if message is an admin command
        if (!messageText.startsWith('/admin')) {
            return; // Not an admin command
        }
        
        console.log(`🔐 Admin command from ${contactId}: ${messageText}`);
        
        try {
            await this.processAdminCommand(contactId, messageText);
        } catch (error) {
            console.error('❌ Error processing admin command:', error);
            await this.sendAdminResponse(contactId, '❌ Error processing command');
        }
    }

    async processAdminCommand(contactId, command) {
        const parts = command.split(' ');
        const mainCommand = parts[1]; // /admin [command]
        
        switch (mainCommand) {
            case 'stats':
                await this.handleStatsCommand(contactId);
                break;
                
            case 'users':
                await this.handleUsersCommand(contactId, parts.slice(2));
                break;
                
            case 'broadcast':
                await this.handleBroadcastCommand(contactId, parts.slice(2));
                break;
                
            case 'blacklist':
                await this.handleBlacklistCommand(contactId, parts.slice(2));
                break;
                
            case 'whitelist':
                await this.handleWhitelistCommand(contactId, parts.slice(2));
                break;
                
            case 'restart':
                await this.handleRestartCommand(contactId);
                break;
                
            case 'help':
                await this.handleHelpCommand(contactId);
                break;
                
            default:
                await this.sendAdminResponse(contactId, 
                    '❓ Unknown command. Use `/admin help` for available commands.');
        }
    }

    async handleStatsCommand(contactId) {
        try {
            const stats = await this.getSystemStats();
            
            const response = `📊 *System Statistics*

👥 *Users:* ${stats.totalUsers}
💬 *Messages:* ${stats.totalMessages} 
📈 *Today:* ${stats.todayMessages}
⏱️ *Uptime:* ${stats.uptime}
🤖 *Agent:* ${stats.agentStatus}
💾 *Database:* ${stats.databaseStatus}

🔄 *Rate Limits:* ${stats.rateLimits}
🚫 *Blacklisted:* ${stats.blacklistedUsers}`;

            await this.sendAdminResponse(contactId, response);
            
        } catch (error) {
            await this.sendAdminResponse(contactId, '❌ Error fetching statistics');
        }
    }

    async handleUsersCommand(contactId, args) {
        if (args.length === 0) {
            // List recent users
            const users = await this.database.getRecentUsers(10);
            
            let response = '👥 *Recent Users:*\n\n';
            for (const user of users) {
                response += `• ${user.name || 'Unknown'}\n`;
                response += `  📱 ${user.whatsapp_id}\n`;
                response += `  💬 ${user.message_count} messages\n`;
                response += `  📅 ${new Date(user.created_at).toLocaleDateString()}\n\n`;
            }
            
            await this.sendAdminResponse(contactId, response);
        }
    }

    async handleBroadcastCommand(contactId, args) {
        if (args.length === 0) {
            await this.sendAdminResponse(contactId, 
                '📢 Usage: `/admin broadcast [message]`');
            return;
        }
        
        const message = args.join(' ');
        
        // Get all users
        const users = await this.database.getActiveUsers();
        
        let successCount = 0;
        let failCount = 0;
        
        for (const user of users) {
            try {
                await this.messageProvider.sendMessage(user.whatsapp_id, 
                    `📢 *Admin Broadcast:*\n\n${message}`);
                successCount++;
            } catch (error) {
                failCount++;
            }
        }
        
        await this.sendAdminResponse(contactId, 
            `📢 Broadcast sent to ${successCount} users (${failCount} failed)`);
    }

    async handleBlacklistCommand(contactId, args) {
        if (args.length === 0) {
            await this.sendAdminResponse(contactId, 
                '🚫 Usage: `/admin blacklist [add|remove|list] [phone]`');
            return;
        }
        
        const action = args[0];
        const phone = args[1];
        
        switch (action) {
            case 'add':
                if (phone) {
                    await this.database.addToBlacklist(phone, 'Admin action');
                    await this.sendAdminResponse(contactId, `🚫 Added ${phone} to blacklist`);
                }
                break;
                
            case 'remove':
                if (phone) {
                    await this.database.removeFromBlacklist(phone);
                    await this.sendAdminResponse(contactId, `✅ Removed ${phone} from blacklist`);
                }
                break;
                
            case 'list':
                const blacklisted = await this.database.getBlacklistedUsers();
                let response = '🚫 *Blacklisted Users:*\n\n';
                for (const user of blacklisted) {
                    response += `• ${user.whatsapp_id}\n`;
                    response += `  📅 ${new Date(user.created_at).toLocaleDateString()}\n\n`;
                }
                await this.sendAdminResponse(contactId, response);
                break;
        }
    }

    async handleHelpCommand(contactId) {
        const response = `🔐 *Admin Commands:*

📊 \`/admin stats\` - System statistics
👥 \`/admin users\` - List recent users  
📢 \`/admin broadcast [msg]\` - Send broadcast
🚫 \`/admin blacklist [add|remove|list] [phone]\`
✅ \`/admin whitelist [add|remove|list] [phone]\`
🔄 \`/admin restart\` - Restart system
❓ \`/admin help\` - This help message

*Example:*
\`/admin blacklist add 1234567890\``;

        await this.sendAdminResponse(contactId, response);
    }

    async sendAdminResponse(contactId, message) {
        try {
            await this.messageProvider.sendMessage(contactId, message);
        } catch (error) {
            console.error('❌ Error sending admin response:', error);
        }
    }

    async getSystemStats() {
        const stats = {
            totalUsers: 0,
            totalMessages: 0,
            todayMessages: 0,
            uptime: this.formatUptime(Date.now() - this.startTime),
            agentStatus: 'Active',
            databaseStatus: 'Connected',
            rateLimits: 0,
            blacklistedUsers: 0
        };

        try {
            // Get user count
            const users = await this.database.executeQuery('SELECT COUNT(*) as count FROM users');
            stats.totalUsers = users[0]?.count || 0;
            
            // Get message count
            const messages = await this.database.executeQuery('SELECT COUNT(*) as count FROM conversations');
            stats.totalMessages = messages[0]?.count || 0;
            
            // Get today's messages
            const today = new Date().toISOString().split('T')[0];
            const todayMessages = await this.database.executeQuery(
                'SELECT COUNT(*) as count FROM conversations WHERE date(timestamp) = ?', [today]
            );
            stats.todayMessages = todayMessages[0]?.count || 0;
            
            // Get blacklisted count
            const blacklisted = await this.database.executeQuery('SELECT COUNT(*) as count FROM blacklist');
            stats.blacklistedUsers = blacklisted[0]?.count || 0;
            
        } catch (error) {
            console.error('Error getting stats:', error);
        }

        return stats;
    }

    formatUptime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m ${seconds % 60}s`;
    }

    isAdmin(contactId) {
        return this.adminUsers.has(contactId) || contactId === this.adminWhatsAppId;
    }

    async addAdmin(whatsappId, name, role = 'admin', permissions = []) {
        try {
            await this.database.executeRun(
                'INSERT INTO admin_users (whatsapp_id, name, role, permissions) VALUES (?, ?, ?, ?)',
                [whatsappId, name, role, JSON.stringify(permissions)]
            );
            
            this.adminUsers.set(whatsappId, {
                whatsappId,
                name,
                role,
                permissions
            });
            
            console.log(`➕ Added admin user: ${name} (${whatsappId})`);
            
        } catch (error) {
            console.error('❌ Error adding admin user:', error);
            throw error;
        }
    }
}

module.exports = AdminService;
