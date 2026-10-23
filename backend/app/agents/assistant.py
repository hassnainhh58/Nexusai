import logging

import httpx2
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ..core.config import get_settings
from ..tools.calculator import calculate
from ..tools.web_search import web_search

logger = logging.getLogger("nexusai.agent")

_settings = get_settings()

default_model_name = _settings.llm_model
fallback_model_names = _settings.fallback_models


def allowed_model_names() -> list[str]:
    """Models a client may request (primary + configured fallbacks)."""
    return _settings.allowed_models


if not _settings.llm_api_key:
    logger.warning("LLM_API_KEY is not set: agent queries will fail.")

# Shared provider instance connected to the configured upstream. A bounded
# timeout prevents a hung upstream call from holding a request (and a worker)
# open indefinitely.
provider = OpenAIProvider(
    base_url=_settings.llm_base_url,
    api_key=_settings.llm_api_key,
    http_client=httpx2.AsyncClient(
        timeout=httpx2.Timeout(_settings.llm_timeout_seconds, connect=10.0)
    ),
)

INSTRUCTIONS = (
    "You are NexusAI, a professional helpful AI assistant. "
    "Answer clearly, accurately, and concisely. "
    "Use the calculator tool whenever mathematical "
    "calculation is required. "
    "Use the web_search tool whenever the user asks "
    "about current, latest, recent, today's, live, "
    "changing, or time-sensitive information. "
    "For news questions, use the web_search tool with "
    "topic='news'. "
    "For general current web information, use the "
    "web_search tool with topic='general'. "
    "Never claim that information is current based only "
    "on your internal knowledge when web search is "
    "appropriate. "
    "When web search is used, base the answer primarily "
    "on the returned search results. "
    "Pay attention to publication dates and distinguish "
    "old information from recent information. "
    "Do not invent dates, facts, URLs, or sources. "
    "When useful, include a Sources section containing "
    "the relevant URLs returned by the search tool."
)

_agent_cache: dict[str, Agent] = {}


def get_agent(model_override: str | None = None) -> Agent:
    """
    Returns an Agent for an allowed model, or for the default model.

    Unknown model names are rejected here as a second line of defence; the API
    layer validates the request before this is reached. Because only the
    configured allowlist can get through, the cache is bounded.
    """
    target_model = (model_override or default_model_name).strip()
    if target_model not in allowed_model_names():
        raise ValueError(f"Model '{target_model}' is not allowed")

    if target_model in _agent_cache:
        return _agent_cache[target_model]

    ai_model = OpenAIChatModel(
        target_model,
        provider=provider,
    )

    created_agent = Agent(
        ai_model,
        instructions=INSTRUCTIONS,
        tools=[
            calculate,
            web_search,
        ],
    )
    _agent_cache[target_model] = created_agent
    return created_agent


# Default agent export for backward compatibility
agent = get_agent(default_model_name)
