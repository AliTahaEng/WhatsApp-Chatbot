/**
 * Database Interface
 * Abstract interface for database operations
 * Enables switching between SQLite, PostgreSQL, MongoDB, etc.
 */

class IDatabase {
    // Connection Management
    async connect() {
        throw new Error('connect() must be implemented');
    }

    async disconnect() {
        throw new Error('disconnect() must be implemented');
    }

    async isConnected() {
        throw new Error('isConnected() must be implemented');
    }

    // Schema Management
    async initializeSchema() {
        throw new Error('initializeSchema() must be implemented');
    }

    async executeScript(script) {
        throw new Error('executeScript() must be implemented');
    }

    // Query Operations
    async executeQuery(sql, params = []) {
        throw new Error('executeQuery() must be implemented');
    }

    async executeQuerySingle(sql, params = []) {
        throw new Error('executeQuerySingle() must be implemented');
    }

    async executeRun(sql, params = []) {
        throw new Error('executeRun() must be implemented');
    }

    // User Operations
    async getOrCreateUser(contactId, name = null, phoneNumber = null) {
        throw new Error('getOrCreateUser() must be implemented');
    }

    async updateUserProfile(contactId, updates) {
        throw new Error('updateUserProfile() must be implemented');
    }

    async getUserById(id) {
        throw new Error('getUserById() must be implemented');
    }

    // Conversation Operations
    async saveMessage(contactId, role, message, agentName = null, tokensUsed = 0, messageType = 'text', mediaUrl = null, metadata = null) {
        throw new Error('saveMessage() must be implemented');
    }

    async getConversationHistory(contactId, limit = 10) {
        throw new Error('getConversationHistory() must be implemented');
    }

    async deleteConversationHistory(contactId) {
        throw new Error('deleteConversationHistory() must be implemented');
    }

    // Access Control Operations
    async isBlacklisted(contactId) {
        throw new Error('isBlacklisted() must be implemented');
    }

    async isWhitelisted(contactId) {
        throw new Error('isWhitelisted() must be implemented');
    }

    async addToBlacklist(contactId, reason, adminId) {
        throw new Error('addToBlacklist() must be implemented');
    }

    async removeFromBlacklist(contactId, adminId) {
        throw new Error('removeFromBlacklist() must be implemented');
    }

    async addToWhitelist(contactId, reason, adminId) {
        throw new Error('addToWhitelist() must be implemented');
    }

    async removeFromWhitelist(contactId, adminId) {
        throw new Error('removeFromWhitelist() must be implemented');
    }

    // Rate Limiting Operations
    async getRateLimitData(contactId, windowMinutes) {
        throw new Error('getRateLimitData() must be implemented');
    }

    async updateRateLimit(contactId, windowStart, messageCount) {
        throw new Error('updateRateLimit() must be implemented');
    }

    async cleanupOldRateLimits() {
        throw new Error('cleanupOldRateLimits() must be implemented');
    }

    // Usage Statistics
    async updateUsageStats(contactId, tokensUsed, messageCount) {
        throw new Error('updateUsageStats() must be implemented');
    }

    async getUsageStats(contactId, days = 7) {
        throw new Error('getUsageStats() must be implemented');
    }

    // Agent Performance
    async logAgentPerformance(agentName, responseTime, success, tokensUsed, confidence) {
        throw new Error('logAgentPerformance() must be implemented');
    }

    async getAgentPerformanceStats(agentName, days = 7) {
        throw new Error('getAgentPerformanceStats() must be implemented');
    }

    // Configuration
    async getConfig(key) {
        throw new Error('getConfig() must be implemented');
    }

    async setConfig(key, value, type = 'string') {
        throw new Error('setConfig() must be implemented');
    }

    // Admin Operations
    async getAdminUser(username) {
        throw new Error('getAdminUser() must be implemented');
    }

    async createAdminUser(userData) {
        throw new Error('createAdminUser() must be implemented');
    }

    async logAdminAction(adminId, actionType, details, target) {
        throw new Error('logAdminAction() must be implemented');
    }

    // System Logs
    async logSystem(level, component, message, metadata = null) {
        throw new Error('logSystem() must be implemented');
    }

    async getSystemLogs(component = null, level = null, limit = 100) {
        throw new Error('getSystemLogs() must be implemented');
    }
}

module.exports = IDatabase;
