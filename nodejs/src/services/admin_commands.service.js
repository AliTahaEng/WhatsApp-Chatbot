/**
 * Admin Commands Service
 * WhatsApp-based admin control system for the bot
 */

const logger = require('../utils/logger');

class AdminCommandHandler {
    constructor(client, database, overrideManager, metricsService, notificationService) {
        this.client = client;
        this.db = database;
        this.overrideManager = overrideManager;
        this.metricsService = metricsService;
        this.notificationService = notificationService;
        
        this.adminNumbers = (process.env.ADMIN_WHATSAPP_ID || '').split(',').filter(id => id.trim());
        this.adminPrefix = process.env.ADMIN_PREFIX || '/admin';
        this.commandsEnabled = process.env.ADMIN_COMMANDS_ENABLED !== 'false';
    }

    async handleMessage(message) {
        if (!this.commandsEnabled || !this.adminNumbers.includes(message.from)) {
            return false;
        }

        const text = message.body.trim();
        if (!text.startsWith(this.adminPrefix)) {
            return false;
        }

        const command = text.substring(this.adminPrefix.length + 1);
        await this.executeCommand(command, message);
        return true;
    }

    async executeCommand(command, message) {
        const parts = command.split(' ');
        const action = parts[0];

        try {
            switch (action) {
                case 'send': await this.handleSendCommand(parts, message); break;
                case 'stats': await this.handleStatsCommand(message); break;
                case 'pause': await this.handlePauseCommand(message); break;
                case 'resume': await this.handleResumeCommand(message); break;
                case 'blacklist': await this.handleBlacklistCommand(parts, message); break;
                case 'whitelist': await this.handleWhitelistCommand(parts, message); break;
                case 'agent': await this.handleAgentCommand(parts, message); break;
                case 'logs': await this.handleLogsCommand(parts, message); break;
                case 'override': await this.handleOverrideCommand(parts, message); break;
                case 'help': await this.handleHelpCommand(message); break;
                default:
                    await message.reply('❌ Unknown command. Use /admin help for available commands.');
            }
            
            await this.db.logAdminAction(message.from, action, parts[1], { command, timestamp: new Date() });
            
        } catch (error) {
            logger.error('Admin command error:', error);
            await message.reply(`❌ Error executing command: ${error.message}`);
        }
    }

    async handleSendCommand(parts, message) {
        if (parts.length < 3) {
            await message.reply('❌ Usage: /admin send <phone_number> <message>');
            return;
        }

        const phoneNumber = parts[1];
        const messageText = parts.slice(2).join(' ');
        const contactId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
        
        try {
            await this.client.sendMessage(contactId, messageText);
            await message.reply(`✅ Message sent to ${phoneNumber}`);
            await this.db.logManualMessage(message.from, contactId, messageText);
        } catch (error) {
            await message.reply(`❌ Failed to send message: ${error.message}`);
        }
    }

    async handleStatsCommand(message) {
        try {
            const stats = await this.db.getSystemStats();
            const uptime = process.uptime();
            const uptimeHours = Math.floor(uptime / 3600);
            const uptimeMinutes = Math.floor((uptime % 3600) / 60);

            const statsMessage = `📊 **Bot Statistics**

🔢 **Messages:**
- Today: ${stats.messages_today}
- This week: ${stats.messages_week}
- Total: ${stats.messages_total}

👥 **Users:**
- Active today: ${stats.active_users_today}
- Total users: ${stats.total_users}

⚡ **Performance:**
- Uptime: ${uptimeHours}h ${uptimeMinutes}m
- Error rate: ${stats.error_rate}%
- Avg response time: ${stats.avg_response_time}ms

🤖 **Agents:**
- Customer Support: ${global.agentStates?.CustomerSupport !== false ? '✅' : '❌'}
- Tech Support: ${global.agentStates?.TechSupport !== false ? '✅' : '❌'}
- Research: ${global.agentStates?.Research !== false ? '✅' : '❌'}
- Scheduler: ${global.agentStates?.Scheduler !== false ? '✅' : '❌'}

⏸️ **Status:** ${global.botPaused ? 'PAUSED' : 'ACTIVE'}`;

            await message.reply(statsMessage);
        } catch (error) {
            await message.reply(`❌ Failed to get stats: ${error.message}`);
        }
    }

    async handlePauseCommand(message) {
        global.botPaused = true;
        await message.reply('⏸️ **Bot Paused**\nAuto-responses are now disabled. Use /admin resume to re-enable.');
    }

    async handleResumeCommand(message) {
        global.botPaused = false;
        await message.reply('▶️ **Bot Resumed**\nAuto-responses are now enabled.');
    }

    async handleBlacklistCommand(parts, message) {
        if (parts.length < 2) {
            await message.reply('❌ Usage: /admin blacklist <phone_number> [reason]');
            return;
        }

        const phoneNumber = parts[1];
        const reason = parts.slice(2).join(' ') || 'Blacklisted by admin';
        const contactId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;

        try {
            await this.db.addToBlacklist(contactId, reason, message.from);
            await message.reply(`✅ ${phoneNumber} has been blacklisted.\nReason: ${reason}`);
        } catch (error) {
            await message.reply(`❌ Failed to blacklist: ${error.message}`);
        }
    }

    async handleWhitelistCommand(parts, message) {
        if (parts.length < 2) {
            await message.reply('❌ Usage: /admin whitelist <phone_number>');
            return;
        }

        const phoneNumber = parts[1];
        const contactId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;

        try {
            await this.db.addToWhitelist(contactId, 'Added by admin', message.from);
            await message.reply(`✅ ${phoneNumber} has been whitelisted.`);
        } catch (error) {
            await message.reply(`❌ Failed to whitelist: ${error.message}`);
        }
    }

    async handleAgentCommand(parts, message) {
        if (parts.length < 2) {
            await message.reply('❌ Usage: /admin agent <list|enable|disable> [agent_name]');
            return;
        }

        const action = parts[1];
        const validAgents = ['CustomerSupport', 'TechSupport', 'Research', 'Scheduler'];

        switch (action) {
            case 'list':
                const agentList = `🤖 **Available Agents:**
- CustomerSupport: ${global.agentStates?.CustomerSupport !== false ? '✅ Enabled' : '❌ Disabled'}
- TechSupport: ${global.agentStates?.TechSupport !== false ? '✅ Enabled' : '❌ Disabled'}
- Research: ${global.agentStates?.Research !== false ? '✅ Enabled' : '❌ Disabled'}
- Scheduler: ${global.agentStates?.Scheduler !== false ? '✅ Enabled' : '❌ Disabled'}

Use: /admin agent enable/disable <agent_name>`;
                await message.reply(agentList);
                break;

            case 'enable':
            case 'disable':
                if (parts.length < 3) {
                    await message.reply('❌ Usage: /admin agent enable/disable <agent_name>');
                    return;
                }

                const agentName = parts[2];
                if (!validAgents.includes(agentName)) {
                    await message.reply(`❌ Invalid agent. Valid agents: ${validAgents.join(', ')}`);
                    return;
                }

                const enable = action === 'enable';
                global.agentStates = global.agentStates || {};
                global.agentStates[agentName] = enable;

                await message.reply(`${enable ? '✅' : '❌'} Agent ${agentName} has been ${enable ? 'enabled' : 'disabled'}.`);
                break;

            default:
                await message.reply('❌ Usage: /admin agent <list|enable|disable> [agent_name]');
        }
    }

    async handleLogsCommand(parts, message) {
        const count = parts[1] ? parseInt(parts[1]) : 10;
        
        if (count > 50) {
            await message.reply('❌ Maximum 50 log entries allowed');
            return;
        }

        try {
            const logs = await this.db.getRecentLogs(count);
            
            if (logs.length === 0) {
                await message.reply('📋 No recent logs found.');
                return;
            }

            const logMessage = `📋 **Recent Logs (${logs.length}):**\n\n` +
                logs.map(log => `${log.timestamp} [${log.level.toUpperCase()}] ${log.message}`).join('\n');
            
            if (logMessage.length > 4000) {
                const chunks = logMessage.match(/.{1,4000}/g);
                for (const chunk of chunks) {
                    await message.reply(chunk);
                }
            } else {
                await message.reply(logMessage);
            }
        } catch (error) {
            await message.reply(`❌ Failed to get logs: ${error.message}`);
        }
    }

    async handleOverrideCommand(parts, message) {
        if (parts.length < 2) {
            await message.reply(`❌ Usage: 
/admin override list - List active overrides
/admin override add <phone> [hours] [reason] - Add override
/admin override remove <phone> - Remove override
/admin override global on/off - Global override mode`);
            return;
        }

        const action = parts[1];

        switch (action) {
            case 'list':
                await this.listOverrides(message);
                break;
            case 'add':
                await this.addOverrideCommand(parts, message);
                break;
            case 'remove':
                await this.removeOverrideCommand(parts, message);
                break;
            case 'global':
                await this.globalOverrideCommand(parts, message);
                break;
            default:
                await message.reply('❌ Invalid override action. Use list, add, remove, or global.');
        }
    }

    async listOverrides(message) {
        const overrides = this.overrideManager.getActiveOverrides();
        
        let response = `🔧 **Manual Overrides**\n\n`;
        
        if (overrides.global) {
            response += `🌐 **Global Override: ACTIVE**\nAll conversations are in manual mode\n\n`;
        }

        if (overrides.count === 0) {
            response += `📋 No specific overrides active`;
        } else {
            response += `📋 **Active Specific Overrides (${overrides.count}):**\n\n`;
            
            Object.entries(overrides.specific).forEach(([contactId, override]) => {
                const phone = contactId.replace('@c.us', '');
                const duration = override.expiresAt ? 
                    `Expires: ${override.expiresAt.toLocaleString()}` : 
                    'Permanent';
                
                response += `• ${phone}\n  Type: ${override.type}\n  Reason: ${override.reason}\n  ${duration}\n\n`;
            });
        }

        await message.reply(response.trim());
    }

    async addOverrideCommand(parts, message) {
        if (parts.length < 3) {
            await message.reply('❌ Usage: /admin override add <phone> [hours] [reason]');
            return;
        }

        const phoneNumber = parts[2];
        const hours = parts[3] ? parseInt(parts[3]) : null;
        const reason = parts.slice(4).join(' ') || 'Manual override by admin';
        const contactId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;

        try {
            await this.overrideManager.addOverride(contactId, 'manual', reason, message.from, hours);
            const durationText = hours ? `for ${hours} hours` : 'permanently';
            await message.reply(`✅ Manual override added for ${phoneNumber} ${durationText}\nReason: ${reason}`);
        } catch (error) {
            await message.reply(`❌ Failed to add override: ${error.message}`);
        }
    }

    async removeOverrideCommand(parts, message) {
        if (parts.length < 3) {
            await message.reply('❌ Usage: /admin override remove <phone>');
            return;
        }

        const phoneNumber = parts[2];
        const contactId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;

        try {
            const removed = await this.overrideManager.removeOverride(contactId);
            if (removed) {
                await message.reply(`✅ Manual override removed for ${phoneNumber}`);
            } else {
                await message.reply(`ℹ️ No override found for ${phoneNumber}`);
            }
        } catch (error) {
            await message.reply(`❌ Failed to remove override: ${error.message}`);
        }
    }

    async globalOverrideCommand(parts, message) {
        if (parts.length < 3) {
            await message.reply('❌ Usage: /admin override global <on|off>');
            return;
        }

        const action = parts[2].toLowerCase();

        try {
            if (action === 'on') {
                await this.overrideManager.enableGlobalOverride(message.from, 'Enabled via admin command');
                await message.reply('🌐 **Global Override ENABLED**\nAll conversations are now in manual mode. Auto-responses disabled.');
            } else if (action === 'off') {
                await this.overrideManager.disableGlobalOverride(message.from);
                await message.reply('🌐 **Global Override DISABLED**\nAuto-responses resumed for all conversations.');
            } else {
                await message.reply('❌ Use "on" or "off" with global override command');
            }
        } catch (error) {
            await message.reply(`❌ Failed to change global override: ${error.message}`);
        }
    }

    async handleHelpCommand(message) {
        const helpMessage = `🔧 **Admin Commands Help**

**Message Management:**
• \`/admin send <number> <message>\` - Send manual message
• \`/admin pause\` - Pause auto-responses
• \`/admin resume\` - Resume auto-responses

**User Management:**
• \`/admin blacklist <number> [reason]\` - Block contact
• \`/admin whitelist <number>\` - Allow contact

**Agent Management:**
• \`/admin agent list\` - List all agents
• \`/admin agent enable <name>\` - Enable agent
• \`/admin agent disable <name>\` - Disable agent

**Override Management:**
• \`/admin override list\` - List active overrides
• \`/admin override add <phone> [hours] [reason]\` - Add manual override
• \`/admin override remove <phone>\` - Remove override
• \`/admin override global on/off\` - Global override mode

**Monitoring:**
• \`/admin stats\` - View bot statistics
• \`/admin logs [count]\` - View recent logs (max 50)

**Other:**
• \`/admin help\` - Show this help

**Examples:**
• \`/admin send 1234567890 Hello from admin!\`
• \`/admin blacklist 9876543210 Spam user\`
• \`/admin agent disable CustomerSupport\``;

        await message.reply(helpMessage);
    }
}

module.exports = AdminCommandHandler;
