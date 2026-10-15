import logging
import os
from pydantic_ai import RunContext
from tavily import TavilyClient

logger = logging.getLogger("nexusai.tools.web_search")

# Cached client instance
_tavily_client: TavilyClient | None = None
_last_api_key: str | None = None


def _get_client() -> TavilyClient | None:
    global _tavily_client, _last_api_key
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        return None

    if _tavily_client is None or _last_api_key != api_key:
        _last_api_key = api_key
        _tavily_client = TavilyClient(api_key=api_key)

    return _tavily_client


def web_search(
    ctx: RunContext,
    query: str,
    topic: str = "general",
) -> str:
    """
    Search the web for current or factual information.

    Args:
        query: The search query string.
        topic: 'general' for standard web search, or 'news' for recent news.
    """
    clean_query = (query or "").strip()
    if not clean_query:
        return "Search query cannot be empty."

    # Prevent extremely long search queries
    if len(clean_query) > 400:
        clean_query = clean_query[:400]

    client = _get_client()
    if not client:
        logger.warning("Web search invoked but TAVILY_API_KEY is not configured.")
        return "Web search is currently not configured on this server."

    try:
        search_kwargs = {
            "query": clean_query,
            "search_depth": "advanced",
            "max_results": 5,
            "include_answer": True,
        }

        if topic == "news":
            search_kwargs["topic"] = "news"
            search_kwargs["days"] = 7

        response = client.search(**search_kwargs)

        results = []
        answer = response.get("answer")
        if answer:
            results.append(f"Search summary:\n{answer}")

        for result in response.get("results", []):
            title = result.get("title", "Untitled")
            url = result.get("url", "")
            content = result.get("content", "")
            published_date = result.get("published_date", "Recent")

            results.append(
                f"Title: {title}\n"
                f"URL: {url}\n"
                f"Published: {published_date}\n"
                f"Content: {content}"
            )

        if not results:
            return f"No useful web search results were found for query: '{clean_query}'."

        return "\n\n---\n\n".join(results)

    except Exception as error:
        logger.error(f"Tavily search failed for query '{clean_query}': {error}")
        return f"Web search could not retrieve results at this moment: {error}"