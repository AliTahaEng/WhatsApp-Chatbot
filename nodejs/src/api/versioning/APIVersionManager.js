/**
 * API Version Manager
 * Handles API versioning and backward compatibility
 * Supports multiple versions simultaneously
 */

const logger = require('../../utils/logger');

class APIVersionManager {
    constructor() {
        this.versions = new Map();
        this.defaultVersion = 'v1';
        this.supportedVersions = ['v1', 'v2'];
        this.deprecatedVersions = new Map(); // version -> deprecation date
        this.versionRoutes = new Map();
    }

    // Register a version with its handlers
    registerVersion(version, config = {}) {
        if (!this.isValidVersion(version)) {
            throw new Error(`Invalid API version format: ${version}`);
        }

        this.versions.set(version, {
            version,
            released: config.released || new Date(),
            deprecated: config.deprecated || null,
            endOfLife: config.endOfLife || null,
            changes: config.changes || [],
            handlers: new Map(),
            middleware: config.middleware || [],
            transformers: {
                request: config.requestTransformer || null,
                response: config.responseTransformer || null
            }
        });

        logger.info(`✅ API version ${version} registered`);
        return this;
    }

    // Register route handler for a specific version
    registerRoute(version, path, method, handler, options = {}) {
        if (!this.versions.has(version)) {
            throw new Error(`Version ${version} not registered`);
        }

        const versionConfig = this.versions.get(version);
        const routeKey = `${method.toUpperCase()}:${path}`;
        
        versionConfig.handlers.set(routeKey, {
            handler,
            options,
            path,
            method: method.toUpperCase(),
            addedIn: version,
            deprecated: options.deprecated || false,
            replacedBy: options.replacedBy || null
        });

        logger.debug(`📍 Route ${routeKey} registered for ${version}`);
        return this;
    }

    // Get route handler for specific version
    getHandler(version, path, method) {
        const resolvedVersion = this.resolveVersion(version);
        const routeKey = `${method.toUpperCase()}:${path}`;

        // Try exact version first
        if (this.versions.has(resolvedVersion)) {
            const versionConfig = this.versions.get(resolvedVersion);
            if (versionConfig.handlers.has(routeKey)) {
                return {
                    handler: versionConfig.handlers.get(routeKey),
                    version: resolvedVersion,
                    config: versionConfig
                };
            }
        }

        // Fall back to previous versions (backward compatibility)
        return this.findBackwardCompatibleHandler(resolvedVersion, routeKey);
    }

    // Middleware to handle version resolution
    versionMiddleware() {
        return (req, res, next) => {
            // Extract version from URL, header, or query param
            const version = this.extractVersion(req);
            const resolvedVersion = this.resolveVersion(version);

            // Check if version is supported
            if (!this.isVersionSupported(resolvedVersion)) {
                return res.status(400).json({
                    error: 'Unsupported API version',
                    version: version,
                    supported: this.supportedVersions,
                    current: this.defaultVersion
                });
            }

            // Check if version is deprecated
            const deprecationInfo = this.getDeprecationInfo(resolvedVersion);
            if (deprecationInfo.deprecated) {
                res.set({
                    'X-API-Deprecated': 'true',
                    'X-API-Deprecation-Date': deprecationInfo.date,
                    'X-API-End-Of-Life': deprecationInfo.endOfLife,
                    'X-API-Recommended-Version': this.defaultVersion
                });

                logger.warn(`⚠️ Deprecated API version ${resolvedVersion} used by ${req.ip}`);
            }

            // Add version info to request
            req.apiVersion = resolvedVersion;
            req.apiVersionConfig = this.versions.get(resolvedVersion);
            
            // Add version to response headers
            res.set('X-API-Version', resolvedVersion);

            next();
        };
    }

    // Transform request based on version
    transformRequest(req, targetVersion) {
        const sourceVersion = req.apiVersion;
        
        if (sourceVersion === targetVersion) {
            return req.body;
        }

        const transformations = this.getTransformations(sourceVersion, targetVersion);
        return this.applyRequestTransformations(req.body, transformations);
    }

    // Transform response based on version
    transformResponse(data, targetVersion, sourceVersion) {
        if (sourceVersion === targetVersion) {
            return data;
        }

        const transformations = this.getTransformations(sourceVersion, targetVersion);
        return this.applyResponseTransformations(data, transformations);
    }

    // Route wrapper that handles versioning automatically
    createVersionedRoute(basePath, handlers) {
        return (req, res, next) => {
            const version = req.apiVersion;
            const method = req.method;
            
            // Find appropriate handler
            const handlerInfo = this.getHandler(version, basePath, method);
            
            if (!handlerInfo) {
                return res.status(404).json({
                    error: 'Endpoint not found',
                    version: version,
                    path: basePath,
                    method: method
                });
            }

            // Apply version-specific transformations
            if (handlerInfo.config.transformers.request) {
                req.body = handlerInfo.config.transformers.request(req.body, version);
            }

            // Execute handler with response transformation
            const originalJson = res.json;
            res.json = function(data) {
                if (handlerInfo.config.transformers.response) {
                    data = handlerInfo.config.transformers.response(data, version);
                }
                
                // Add metadata
                if (typeof data === 'object' && data !== null) {
                    data._meta = {
                        version: version,
                        timestamp: new Date().toISOString(),
                        ...(data._meta || {})
                    };
                }
                
                return originalJson.call(this, data);
            };

            // Execute the actual handler
            handlerInfo.handler.handler(req, res, next);
        };
    }

    // Version resolution logic
    resolveVersion(requestedVersion) {
        if (!requestedVersion) {
            return this.defaultVersion;
        }

        // Normalize version format
        const normalized = this.normalizeVersion(requestedVersion);
        
        if (this.supportedVersions.includes(normalized)) {
            return normalized;
        }

        // Try to find closest supported version
        return this.findClosestVersion(normalized) || this.defaultVersion;
    }

    // Extract version from request
    extractVersion(req) {
        // Priority: URL path > Accept header > Query param > Default
        
        // From URL path: /api/v1/users
        const urlMatch = req.path.match(/^\/api\/(v\d+)/);
        if (urlMatch) {
            return urlMatch[1];
        }

        // From Accept header: Accept: application/vnd.api+json; version=1
        const acceptHeader = req.get('Accept');
        if (acceptHeader) {
            const versionMatch = acceptHeader.match(/version=(\d+)/);
            if (versionMatch) {
                return `v${versionMatch[1]}`;
            }
        }

        // From X-API-Version header
        const versionHeader = req.get('X-API-Version');
        if (versionHeader) {
            return this.normalizeVersion(versionHeader);
        }

        // From query parameter: ?version=1
        if (req.query.version) {
            return this.normalizeVersion(req.query.version);
        }

        return null;
    }

    // Utility methods
    isValidVersion(version) {
        return /^v\d+(\.\d+)*$/.test(version);
    }

    normalizeVersion(version) {
        if (typeof version === 'number') {
            return `v${version}`;
        }
        
        if (typeof version === 'string') {
            if (version.startsWith('v')) {
                return version;
            }
            return `v${version}`;
        }
        
        return version;
    }

    isVersionSupported(version) {
        return this.supportedVersions.includes(version);
    }

    getDeprecationInfo(version) {
        const versionConfig = this.versions.get(version);
        if (!versionConfig) {
            return { deprecated: false };
        }

        return {
            deprecated: !!versionConfig.deprecated,
            date: versionConfig.deprecated,
            endOfLife: versionConfig.endOfLife
        };
    }

    findBackwardCompatibleHandler(version, routeKey) {
        // Look for handler in previous versions
        const versionNumber = parseInt(version.replace('v', ''));
        
        for (let i = versionNumber - 1; i >= 1; i--) {
            const prevVersion = `v${i}`;
            if (this.versions.has(prevVersion)) {
                const versionConfig = this.versions.get(prevVersion);
                if (versionConfig.handlers.has(routeKey)) {
                    const handler = versionConfig.handlers.get(routeKey);
                    
                    // Check if this handler is still compatible
                    if (!handler.deprecated || handler.replacedBy !== version) {
                        return {
                            handler,
                            version: prevVersion,
                            config: versionConfig,
                            isBackwardCompatible: true
                        };
                    }
                }
            }
        }

        return null;
    }

    findClosestVersion(requestedVersion) {
        const requested = parseInt(requestedVersion.replace('v', ''));
        let closest = null;
        let minDiff = Infinity;

        for (const version of this.supportedVersions) {
            const current = parseInt(version.replace('v', ''));
            const diff = Math.abs(current - requested);
            
            if (diff < minDiff) {
                minDiff = diff;
                closest = version;
            }
        }

        return closest;
    }

    getTransformations(fromVersion, toVersion) {
        // Define version transformation rules
        const transformations = [];
        
        const fromNum = parseInt(fromVersion.replace('v', ''));
        const toNum = parseInt(toVersion.replace('v', ''));
        
        // Add specific transformation rules here
        if (fromNum < toNum) {
            // Upgrading - add new fields, change formats
            transformations.push({
                type: 'upgrade',
                from: fromVersion,
                to: toVersion,
                rules: this.getUpgradeRules(fromVersion, toVersion)
            });
        } else if (fromNum > toNum) {
            // Downgrading - remove fields, maintain compatibility
            transformations.push({
                type: 'downgrade',
                from: fromVersion,
                to: toVersion,
                rules: this.getDowngradeRules(fromVersion, toVersion)
            });
        }

        return transformations;
    }

    applyRequestTransformations(data, transformations) {
        let transformed = { ...data };
        
        for (const transformation of transformations) {
            transformed = this.applyTransformationRules(transformed, transformation.rules);
        }
        
        return transformed;
    }

    applyResponseTransformations(data, transformations) {
        let transformed = { ...data };
        
        for (const transformation of transformations) {
            transformed = this.applyTransformationRules(transformed, transformation.rules);
        }
        
        return transformed;
    }

    applyTransformationRules(data, rules) {
        let transformed = { ...data };
        
        for (const rule of rules) {
            switch (rule.type) {
                case 'rename_field':
                    if (transformed[rule.from]) {
                        transformed[rule.to] = transformed[rule.from];
                        delete transformed[rule.from];
                    }
                    break;
                    
                case 'add_field':
                    transformed[rule.field] = rule.value;
                    break;
                    
                case 'remove_field':
                    delete transformed[rule.field];
                    break;
                    
                case 'transform_field':
                    if (transformed[rule.field]) {
                        transformed[rule.field] = rule.transform(transformed[rule.field]);
                    }
                    break;
            }
        }
        
        return transformed;
    }

    getUpgradeRules(fromVersion, toVersion) {
        // Define specific upgrade rules between versions
        const rules = [];
        
        if (fromVersion === 'v1' && toVersion === 'v2') {
            rules.push(
                { type: 'add_field', field: 'apiVersion', value: 'v2' },
                { type: 'rename_field', from: 'userId', to: 'user_id' },
                { type: 'transform_field', field: 'timestamp', transform: (val) => new Date(val).toISOString() }
            );
        }
        
        return rules;
    }

    getDowngradeRules(fromVersion, toVersion) {
        // Define specific downgrade rules between versions
        const rules = [];
        
        if (fromVersion === 'v2' && toVersion === 'v1') {
            rules.push(
                { type: 'remove_field', field: 'apiVersion' },
                { type: 'rename_field', from: 'user_id', to: 'userId' },
                { type: 'transform_field', field: 'timestamp', transform: (val) => Date.parse(val) }
            );
        }
        
        return rules;
    }

    // Get API documentation for all versions
    getVersions() {
        return Array.from(this.versions.entries()).map(([version, config]) => ({
            version,
            released: config.released,
            deprecated: config.deprecated,
            endOfLife: config.endOfLife,
            isDefault: version === this.defaultVersion,
            isSupported: this.supportedVersions.includes(version),
            changes: config.changes,
            routes: Array.from(config.handlers.keys())
        }));
    }

    // Deprecate a version
    deprecateVersion(version, endOfLifeDate) {
        if (this.versions.has(version)) {
            const config = this.versions.get(version);
            config.deprecated = new Date();
            config.endOfLife = endOfLifeDate;
            
            logger.warn(`⚠️ API version ${version} deprecated. End of life: ${endOfLifeDate}`);
        }
    }

    // Remove support for a version
    removeVersion(version) {
        if (this.versions.has(version)) {
            this.versions.delete(version);
            this.supportedVersions = this.supportedVersions.filter(v => v !== version);
            
            logger.info(`❌ API version ${version} removed from support`);
        }
    }
}

module.exports = APIVersionManager;
