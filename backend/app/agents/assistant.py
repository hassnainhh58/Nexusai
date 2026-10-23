import logging
from datetime import date

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
    "You are NexusAI, a professional, knowledgeable and dependable AI assistant. "
    "You help with any topic the user brings: everyday questions, research, "
    "writing and editing, translation, coding and debugging, mathematics, "
    "data analysis, planning, brainstorming, learning, and general advice. "
    "Never refuse a harmless request or claim that a topic is outside your "
    "scope; if a task is ambiguous, state your interpretation and answer. "
    "Match the user's language and tone. "
    "\n\n"
    "Answer with substance: give the direct answer first, then the reasoning or "
    "details that matter, and finish with a concrete next step when useful. "
    "Use clean Markdown: short paragraphs, headings only when they help, bullet "
    "lists for enumerations, and fenced code blocks with a language tag for code. "
    "For code, provide complete, runnable examples and point out assumptions. "
    "\n\n"
    "Be accurate and honest. Do not invent facts, dates, statistics, URLs, "
    "quotations, or sources. If you are unsure, say what you know, what you do "
    "not know, and how the user can verify it. Never present a guess as a fact. "
    "\n\n"
    "Tools: use the calculator for arithmetic, unit conversions, percentages and "
    "anything where an exact number matters. Use web_search whenever the user "
    "asks about current, latest, recent, today's, live, changing or time-sensitive "
    "information, and for news use topic='news'. Search before answering when "
    "your knowledge may be outdated instead of saying you cannot access the "
    "internet. Base such answers primarily on the returned results, pay attention "
    "to publication dates, and include a short Sources section with the relevant "
    "URLs. If a tool is unavailable, say so briefly and continue with what you "
    "can do. "
    "\n\n"
    "Formatting rules: keep answers readable on a screen; avoid huge walls of "
    "text; use tables for comparisons; use headings sparingly. When the user asks "
    "for a specific length or format, follow it exactly. "
    "\n\n"
    "Safety: do not help with clearly illegal, hateful, or harmful requests, and "
    "briefly explain why. Otherwise, be maximally helpful."
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

    @created_agent.system_prompt
    def _current_date() -> str:
        """Gives every turn the real date and a policy for relative dates."""
        today = date.today()
        return (
            f"The current date is {today:%A, %d %B %Y}. "
            "Resolve relative expressions such as 'today', 'yesterday', 'this week' "
            "or 'the latest' against it. Your training data may be older, so use "
            "the web_search tool for anything that could have changed since then."
        )

    _agent_cache[target_model] = created_agent
    return created_agent


# Default agent export for backward compatibility
agent = get_agent(default_model_name)
