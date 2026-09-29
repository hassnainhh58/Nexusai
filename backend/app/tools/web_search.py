import os

from tavily import TavilyClient
from pydantic_ai import RunContext


def web_search(
    ctx: RunContext,
    query: str,
    topic: str = "general",
) -> str:
    """
    Search the web for current or factual information.

    topic:
    - general = normal web search
    - news = recent news search
    """

    api_key = os.getenv("TAVILY_API_KEY")

    if not api_key:
        return "Web search is not configured."

    try:
        client = TavilyClient(api_key=api_key)

        search_kwargs = {
            "query": query,
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
            results.append(
                f"Search summary:\n{answer}"
            )

        for result in response.get("results", []):
            title = result.get("title", "Untitled")
            url = result.get("url", "")
            content = result.get("content", "")
            published_date = result.get(
                "published_date",
                "Unknown",
            )

            results.append(
                f"Title: {title}\n"
                f"URL: {url}\n"
                f"Published: {published_date}\n"
                f"Content: {content}"
            )

        if not results:
            return "No useful search results were found."

        return "\n\n---\n\n".join(results)

    except Exception as error:
        return f"Web search failed: {error}"