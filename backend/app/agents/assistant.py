import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ..tools.calculator import calculate
from ..tools.web_search import web_search

logger = logging.getLogger("nexusai.agent")

# Locate backend/.env reliably, regardless of the CMD working directory.
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"

load_dotenv(ENV_FILE)

base_url = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
api_key = os.getenv("LLM_API_KEY", "")
default_model_name = os.getenv("LLM_MODEL", "x-ai/grok-4.3")

if not api_key:
    logger.warning(f"LLM_API_KEY is not set in {ENV_FILE}. Agent queries may fail.")

# Shared provider instance connected to the configured upstream
provider = OpenAIProvider(
    base_url=base_url,
    api_key=api_key,
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


def get_agent(model_override: Optional[str] = None) -> Agent:
    """
    Returns an Agent configured with the specified model, or the default model.
    Caches agent instances by model name to prevent redundant allocations.
    """
    target_model = (model_override or default_model_name).strip()
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
