import os

from dotenv import load_dotenv
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ..tools.calculator import calculate
from ..tools.web_search import web_search


load_dotenv("backend/.env")


provider = OpenAIProvider(
    base_url=os.getenv("LLM_BASE_URL"),
    api_key=os.getenv("LLM_API_KEY"),
)


model = OpenAIChatModel(
    os.getenv("LLM_MODEL"),
    provider=provider,
)


agent = Agent(
    model,
instructions=(
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
),
    tools=[
        calculate,
        web_search,
    ],
)