"""
ResearchService
Performs iterative web research using DuckDuckGo search + BeautifulSoup content extraction.

Follows DEVELOPMENT_PRINCIPLES.md:
- Dependency Injection (receives container)
- Interface Abstraction (implements IResearchService)
- Graceful Degradation (handles failures per-source)
- Single Responsibility (only handles research)
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional
from urllib.parse import urlparse

from core.interfaces.IResearchService import IResearchService


class ResearchSession:
    """Maintains state for a single research session"""

    def __init__(self):
        self.searched_queries: List[str] = []
        self.visited_urls: List[str] = []
        self.collected_sources: List[Dict] = []

    def add_source(self, url: str, title: str, content: str):
        """Add a source to the collection"""
        self.collected_sources.append({
            'url': url,
            'title': title,
            'content': content,
            'timestamp': datetime.now().isoformat()
        })

    def get_all_sources(self) -> List[Dict]:
        return self.collected_sources

    def get_source_urls(self) -> List[str]:
        return [s['url'] for s in self.collected_sources]


class ResearchService(IResearchService):
    """
    Iterative web research service.
    
    Flow:
    1. Search DuckDuckGo for the query
    2. Fetch full content from top results
    3. If not enough quality info, refine query and search again
    4. Return all collected information + source URLs
    """

    def __init__(self, container):
        self.container = container
        self.config = container.resolve('ConfigurationManager')
        self.logger = logging.getLogger(__name__)

        # Configuration with defaults
        self.max_sources = int(self.config.get('research.maxSources', 3))
        self.max_iterations = int(self.config.get('research.maxIterations', 2))
        self.fetch_timeout = int(self.config.get('research.fetchTimeout', 15))
        self.max_content_length = int(self.config.get('research.maxContentLength', 8000))

        self.user_agent = (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/120.0.0.0 Safari/537.36'
        )

    async def research(self, query: str, options: Dict = None) -> Dict:
        """
        Perform iterative research on a topic.
        Searches, fetches content, refines if needed, returns comprehensive results.
        """
        options = options or {}
        max_sources = options.get('max_sources', self.max_sources)
        max_iterations = options.get('max_iterations', self.max_iterations)
        language = options.get('language', 'en')

        session = ResearchSession()

        self.logger.info(f"🔬 Starting research: \"{query}\" (max_sources={max_sources}, max_iter={max_iterations})")

        # Determine search queries to try
        # If Arabic, translate to English and search ONLY in English
        # (DuckDuckGo returns poor results for Arabic queries)
        is_arabic = self._contains_arabic(query)
        search_queries = []

        if is_arabic:
            english_query = await self._translate_query(query)
            if english_query and english_query != query:
                search_queries.append(english_query)
                self.logger.info(f"🔬 Arabic query translated: \"{query}\" → \"{english_query}\"")
            else:
                # Fallback: use original if translation failed
                search_queries.append(query)
                self.logger.warning(f"🔬 Arabic translation failed, using original: \"{query}\"")
        else:
            search_queries.append(query)

        # Iterative research loop
        for iteration in range(max_iterations):
            self.logger.debug(f"🔬 Research iteration {iteration + 1}/{max_iterations}")

            for search_query in search_queries:
                if len(session.collected_sources) >= max_sources:
                    break

                # Skip queries we already searched
                if search_query in session.searched_queries:
                    continue

                # Step 1: Search
                try:
                    search_results = await self.search_web(search_query, num_results=5)
                    session.searched_queries.append(search_query)
                    self.logger.debug(f"🔬 Search \"{search_query}\" returned {len(search_results)} results")
                except Exception as e:
                    self.logger.warning(f"⚠️ Search failed for \"{search_query}\": {e}")
                    continue

                # Step 2: Fetch content from top results
                for result in search_results:
                    if len(session.collected_sources) >= max_sources:
                        break

                    url = result.get('href') or result.get('url', '')
                    if not url or url in session.visited_urls:
                        continue

                    try:
                        content_data = await self.fetch_content(url)
                        session.visited_urls.append(url)

                        if content_data and content_data.get('content') and len(content_data['content']) > 100:
                            session.add_source(
                                url=url,
                                title=content_data.get('title', result.get('title', 'Untitled')),
                                content=content_data['content']
                            )
                            self.logger.debug(
                                f"🔬 ✅ Collected source: {content_data.get('title', 'Untitled')[:60]} "
                                f"({len(content_data['content'])} chars)"
                            )
                    except Exception as e:
                        self.logger.debug(f"🔬 ⚠️ Failed to fetch {url}: {e}")
                        session.visited_urls.append(url)
                        continue

            # Check if we have enough sources
            if len(session.collected_sources) >= max_sources:
                self.logger.info(f"🔬 Collected {len(session.collected_sources)} sources, stopping")
                break

        # Build final result
        sources_for_response = []
        combined_content = ""

        for i, source in enumerate(session.collected_sources, 1):
            # Truncate individual source content
            content = source['content'][:self.max_content_length]
            sources_for_response.append({
                'index': i,
                'url': source['url'],
                'title': source['title'],
                'content': content,
                'timestamp': source['timestamp']
            })
            combined_content += f"\n\n--- Source [{i}]: {source['title']} ---\n"
            combined_content += f"URL: {source['url']}\n"
            combined_content += content

        result = {
            'query': query,
            'summary': combined_content.strip() if combined_content else 'No information found.',
            'sources': sources_for_response,
            'source_count': len(sources_for_response),
            'queries_used': session.searched_queries,
            'total_urls_visited': len(session.visited_urls),
            'provider': 'ResearchService (DuckDuckGo + BeautifulSoup)'
        }

        self.logger.info(
            f"🔬 Research complete: {len(sources_for_response)} sources, "
            f"{len(session.searched_queries)} queries, "
            f"{len(session.visited_urls)} URLs visited"
        )

        return result

    async def search_web(self, query: str, num_results: int = 5) -> List[Dict]:
        """Search using DuckDuckGo python library (ddgs)"""
        try:
            from ddgs import DDGS

            # Run in executor since DDGS is synchronous
            def _search():
                ddgs = DDGS()
                results = list(ddgs.text(query, max_results=min(num_results, 10)))
                return results

            results = await asyncio.get_event_loop().run_in_executor(None, _search)
            return results or []

        except Exception as e:
            self.logger.error(f"❌ DuckDuckGo search error: {e}")
            raise

    async def fetch_content(self, url: str) -> Dict:
        """Fetch and extract readable content from a URL using BeautifulSoup"""
        import requests
        from bs4 import BeautifulSoup

        def _fetch():
            headers = {'User-Agent': self.user_agent}
            response = requests.get(url, timeout=self.fetch_timeout, headers=headers)
            response.raise_for_status()

            soup = BeautifulSoup(response.content, 'lxml')

            # Extract title
            title_tag = soup.find('title')
            title = title_tag.get_text().strip() if title_tag else urlparse(url).netloc

            # Remove unwanted elements
            for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'form']):
                element.decompose()

            # Extract main content
            main_content = soup.find('main') or soup.find('article') or soup.find('body')

            if main_content:
                text = main_content.get_text(separator=' ', strip=True)
            else:
                text = soup.get_text(separator=' ', strip=True)

            # Clean up text
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            clean_text = ' '.join(chunk for chunk in chunks if chunk)

            # Truncate
            if len(clean_text) > self.max_content_length:
                clean_text = clean_text[:self.max_content_length] + "\n[Content truncated]"

            return {
                'url': url,
                'title': title,
                'content': clean_text,
                'length': len(clean_text)
            }

        try:
            return await asyncio.get_event_loop().run_in_executor(None, _fetch)
        except requests.exceptions.Timeout:
            raise Exception(f"Timeout fetching {url}")
        except requests.exceptions.RequestException as e:
            raise Exception(f"Request error for {url}: {e}")

    def _contains_arabic(self, text: str) -> bool:
        """Check if text contains Arabic characters"""
        import re
        return bool(re.search(r'[\u0600-\u06FF]', text))

    async def _translate_query(self, arabic_query: str) -> Optional[str]:
        """Translate Arabic query to English using LLM"""
        try:
            llm_provider = self.container.resolve('ILLMProvider')
            from core.interfaces.ILLMProvider import LLMMessage

            prompt = (
                "Convert this Arabic search query to the proper English search term. "
                "If it's a person's name, place, or well-known term, provide the correct English spelling. "
                "Return ONLY the English search term, nothing else.\n\n"
                "Examples:\n"
                '- "جيفري ابستين" → "Jeffrey Epstein"\n'
                '- "ابستين" → "Epstein"\n'
                '- "دونالد ترامب" → "Donald Trump"\n'
                '- "الذكاء الاصطناعي" → "artificial intelligence"\n\n'
                f"Arabic query: {arabic_query}\n\n"
                "English search term:"
            )

            response = await llm_provider.generate_response(
                [LLMMessage(role='user', content=prompt)],
                max_tokens=50,
                temperature=0.1
            )

            translation = response.content.strip().strip('"\'').strip()
            if translation and translation != arabic_query and 0 < len(translation) < 200:
                return translation

            return None

        except Exception as e:
            self.logger.warning(f"⚠️ Translation failed: {e}")
            return None
