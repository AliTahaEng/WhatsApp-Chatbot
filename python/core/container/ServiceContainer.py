"""
Python Dependency Injection Container
Implements IoC pattern for Python services
"""

from typing import Dict, Any, Callable, TypeVar, Type
import logging

T = TypeVar('T')

class ServiceContainer:
    """Dependency injection container for Python services"""
    
    def __init__(self):
        self._services: Dict[str, Any] = {}
        self._factories: Dict[str, Callable] = {}
        self._singletons: Dict[str, bool] = {}
        self._bindings: Dict[str, Type] = {}
        self._instances: Dict[str, Any] = {}
        self.logger = logging.getLogger(__name__)

    def bind(self, interface: str, implementation: Type) -> 'ServiceContainer':
        """Bind an interface to an implementation"""
        self._bindings[interface] = implementation
        return self

    def singleton(self, interface: str, implementation: Type) -> 'ServiceContainer':
        """Register as singleton"""
        self._bindings[interface] = implementation
        self._singletons[interface] = True
        return self

    def factory(self, interface: str, factory_func: Callable) -> 'ServiceContainer':
        """Register a factory function"""
        self._factories[interface] = factory_func
        return self

    def instance(self, interface: str, instance: Any) -> 'ServiceContainer':
        """Register a specific instance"""
        self._instances[interface] = instance
        return self

    def resolve(self, interface: str) -> Any:
        """Resolve a service by interface name"""
        # Check if instance already exists
        if interface in self._instances:
            return self._instances[interface]
        
        # Check if factory exists
        if interface in self._factories:
            factory = self._factories[interface]
            instance = factory(self)
            
            if self._singletons.get(interface, False):
                self._instances[interface] = instance
            
            return instance
        
        # Check if binding exists
        if interface in self._bindings:
            implementation_class = self._bindings[interface]
            instance = implementation_class(self)
            
            if self._singletons.get(interface, False):
                self._instances[interface] = instance
            
            return instance
        
        raise ValueError(f"Service {interface} not found in container")

    def has(self, interface: str) -> bool:
        """Check if service is registered"""
        return (interface in self._instances or 
                interface in self._factories or 
                interface in self._bindings)

    def get_registered_services(self) -> list:
        """Get all registered service names"""
        services = set()
        services.update(self._instances.keys())
        services.update(self._factories.keys())
        services.update(self._bindings.keys())
        return list(services)

    def clear(self):
        """Clear all registrations"""
        self._services.clear()
        self._factories.clear()
        self._singletons.clear()
        self._bindings.clear()
        self._instances.clear()
