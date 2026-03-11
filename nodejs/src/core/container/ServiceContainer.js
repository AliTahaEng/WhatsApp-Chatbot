/**
 * Dependency Injection Container
 * Implements Inversion of Control pattern for loose coupling
 * Manages service lifecycles and dependencies
 */

class ServiceContainer {
    constructor() {
        this.services = new Map();
        this.singletons = new Map();
        this.bindings = new Map();
        this.factories = new Map();
    }

    isClass(func) {
        if (typeof func !== 'function') return false;
        const str = Function.prototype.toString.call(func);
        if (/^class\s/.test(str)) return true;

        // Heuristic: classes usually have prototype methods besides constructor
        if (!func.prototype) return false;
        const protoProps = Object.getOwnPropertyNames(func.prototype);
        return protoProps.length > 1;
    }

    // Register a service implementation
    bind(interfaceName, implementation) {
        this.bindings.set(interfaceName, implementation);
        return this;
    }

    // Register a singleton service
    singleton(interfaceName, implementation) {
        this.bindings.set(interfaceName, implementation);
        this.singletons.set(interfaceName, true);
        return this;
    }

    // Register a factory function
    factory(interfaceName, factoryFunction) {
        this.factories.set(interfaceName, factoryFunction);
        return this;
    }

    // Register an instance directly
    instance(interfaceName, instance) {
        this.services.set(interfaceName, instance);
        return this;
    }

    // Resolve a service by interface name
    resolve(interfaceName) {
        // Check if instance already exists
        if (this.services.has(interfaceName)) {
            return this.services.get(interfaceName);
        }

        // Check if factory exists
        if (this.factories.has(interfaceName)) {
            const factory = this.factories.get(interfaceName);
            const instance = factory(this);

            if (this.singletons.get(interfaceName)) {
                this.services.set(interfaceName, instance);
            }

            return instance;
        }

        // Check if binding exists
        if (this.bindings.has(interfaceName)) {
            const Implementation = this.bindings.get(interfaceName);
            let instance;

            if (typeof Implementation === 'function') {
                // Check if it's a class constructor or factory
                if (this.isClass(Implementation)) {
                    instance = new Implementation(this);
                } else {
                    instance = Implementation(this);
                }
            } else {
                throw new Error(`Invalid implementation for ${interfaceName}`);
            }

            // Store as singleton if configured
            if (this.singletons.get(interfaceName)) {
                this.services.set(interfaceName, instance);
            }

            return instance;
        }

        throw new Error(`Service ${interfaceName} not found in container`);
    }

    // Resolve with automatic dependency injection
    resolveWithDependencies(interfaceName, dependencies = []) {
        const resolvedDependencies = dependencies.map(dep => this.resolve(dep));

        if (this.bindings.has(interfaceName)) {
            const Implementation = this.bindings.get(interfaceName);
            const instance = new Implementation(...resolvedDependencies);

            if (this.singletons.get(interfaceName)) {
                this.services.set(interfaceName, instance);
            }

            return instance;
        }

        throw new Error(`Service ${interfaceName} not found`);
    }

    // Check if service is registered
    has(interfaceName) {
        return this.services.has(interfaceName) ||
            this.bindings.has(interfaceName) ||
            this.factories.has(interfaceName);
    }

    // Get all registered services
    getRegisteredServices() {
        const registered = new Set();

        for (const key of this.services.keys()) registered.add(key);
        for (const key of this.bindings.keys()) registered.add(key);
        for (const key of this.factories.keys()) registered.add(key);

        return Array.from(registered);
    }

    // Clear container
    clear() {
        this.services.clear();
        this.singletons.clear();
        this.bindings.clear();
        this.factories.clear();
    }

    // Remove specific service
    remove(interfaceName) {
        this.services.delete(interfaceName);
        this.singletons.delete(interfaceName);
        this.bindings.delete(interfaceName);
        this.factories.delete(interfaceName);
    }

    // Tag services for easy retrieval
    tag(serviceName, tag) {
        if (!this.tags) this.tags = new Map();
        if (!this.tags.has(tag)) this.tags.set(tag, new Set());
        this.tags.get(tag).add(serviceName);
        return this;
    }

    // Get services by tag
    tagged(tag) {
        if (!this.tags || !this.tags.has(tag)) return [];
        return Array.from(this.tags.get(tag)).map(name => this.resolve(name));
    }
}

module.exports = ServiceContainer;
