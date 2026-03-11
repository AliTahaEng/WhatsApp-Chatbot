#!/usr/bin/env node

/**
 * WhatsApp AutoGen Bot - Modern Architecture Entry Point
 * 
 * This replaces the old index.js with a clean, extensible architecture
 * implementing all 6 architectural principles:
 * 1. Separation of Concerns
 * 2. Single Responsibility Principle  
 * 3. Build for Change
 * 4. Loose Coupling & High Cohesion
 * 5. Clean & Readable Code
 * 6. API Versioning
 */

require('dotenv').config();
const Application = require('./nodejs/src/core/application/Application');
const logger = require('./nodejs/src/utils/logger');

async function main() {
    // Create application instance
    const app = new Application();

    try {
        // Initialize with flexible, extensible architecture
        await app.initialize();

        // Start all services
        await app.start();

        // Log successful startup
        const status = app.getStatus();
        logger.info(`🎉 WhatsApp AutoGen Bot ready!`);
        logger.info(`📊 Services: ${status.services.length}`);
        logger.info(`🔌 Plugins: ${status.plugins?.totalPlugins || 0}`);
        logger.info(`⏱️ Startup time: ${status.uptime}ms`);

    } catch (error) {
        logger.error('💥 Failed to start application:', error);
        process.exit(1);
    }
}

// Run the application
if (require.main === module) {
    main().catch(error => {
        logger.error('💥 Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = { main };
