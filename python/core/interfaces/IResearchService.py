"""
IResearchService Interface
Following Dependency Injection and Interface Abstraction principles from DEVELOPMENT_PRINCIPLES.md

Defines the contract for research services that perform iterative web research.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional


class IResearchService(ABC):
    """
    Interface for research services.
    
    A research service performs iterative web research:
    1. Search for relevant sources
    2. Fetch full content from promising URLs
    3. Refine queries if needed
    4. Return comprehensive information with source URLs
    """

    @abstractmethod
    async def research(self, query: str, options: Dict = None) -> Dict:
        """
        Perform iterative research on a topic.
        
        Args:
            query: The research query/topic
            options: Optional configuration (max_sources, max_iterations, language, etc.)
            
        Returns:
            Dict with keys:
                - query: original query
                - summary: compiled research findings
                - sources: list of {url, title, content, timestamp}
                - queries_used: list of search queries attempted
                - total_sources_reviewed: count
                - provider: name of the research provider
        """
        pass

    @abstractmethod
    async def search_web(self, query: str, num_results: int = 5) -> List[Dict]:
        """
        Search the web and return results.
        
        Args:
            query: Search query
            num_results: Max results to return
            
        Returns:
            List of {title, url, snippet}
        """
        pass

    @abstractmethod
    async def fetch_content(self, url: str) -> Dict:
        """
        Fetch and extract readable content from a URL.
        
        Args:
            url: URL to fetch
            
        Returns:
            Dict with {url, title, content, length}
        """
        pass
