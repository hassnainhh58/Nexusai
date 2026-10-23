import logging
import re
from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolReturnPart,
    UserPromptPart,
)

from ..agents.assistant import default_model_name, fallback_model_names, get_agent
from ..core.config import get_settings

logger = logging.getLogger("nexusai.services.chat")

_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`([^`]*)`")
_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_HEADING_RE = re.compile(r"^[#>\-*\s]+", re.MULTILINE)
_WHITESPACE_RE = re.compile(r"\s+")

MAX_TITLE_LENGTH = 60


class _IncompleteTurn(Exception):
    """Raised when a model retrieved tool results but never produced an answer."""


@dataclass(slots=True)
class ChatStreamEvent:
    """A structured event emitted while a chat turn is streamed."""

    type: Literal["meta", "token"]
    text: str = ""
    model: str = ""


def derive_title(message: str) -> str:
    """Builds a readable conversation title from the first user message.

    Code fences and markdown noise are stripped first, which avoids sidebar
    entries such as ``def get_coordinates(city: str) -> tuple[...]``.
    """
    text = _FENCE_RE.sub(" ", message or "")
    text = _INLINE_CODE_RE.sub(r"\1", text)
    text = _LINK_RE.sub(r"\1", text)
    text = _HEADING_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()

    if not text:
        return "New Chat"

    words = text.split(" ")
    title = " ".join(words[:6]).strip()
    if len(words) > 6 or len(title) > MAX_TITLE_LENGTH:
        title = title[:MAX_TITLE_LENGTH].rstrip(" ,.;:-") + "…"
    return title or "New Chat"


def _merge_consecutive_user_turns(history: list[ModelMessage]) -> list[ModelMessage]:
    """
    Merges consecutive user requests into a single request.

    A failed stream can leave a user message without any assistant reply, which
    would otherwise produce two consecutive user turns in the model history.
    """
    merged: list[ModelMessage] = []
    for message in history:
        if merged and isinstance(message, ModelRequest) and isinstance(merged[-1], ModelRequest):
            previous = merged[-1]
            previous_text = "\n\n".join(
                part.content for part in previous.parts if isinstance(part, UserPromptPart)
            )
            current_text = "\n\n".join(
                part.content for part in message.parts if isinstance(part, UserPromptPart)
            )
            previous.parts = [UserPromptPart(content=f"{previous_text}\n\n{current_text}")]
            continue
        merged.append(message)
    return merged


def build_message_history(rows: Sequence[dict[str, Any]]) -> list[ModelMessage]:
    """
    Converts persisted chat rows into a pydantic-ai message history.

    Each row becomes a real request/response message instead of being flattened
    into a prompt blob, so the model receives the conversation with its original
    role semantics.
    """
    history: list[ModelMessage] = []
    for row in rows:
        content = (row.get("content") or "").strip()
        if not content:
            continue
        if row.get("role") == "user":
            history.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        else:
            history.append(ModelResponse(parts=[TextPart(content=content)]))

    history = _merge_consecutive_user_turns(history)

    # Keep only the most recent complete turn pairs and never start the history
    # with an assistant reply (its question would be missing).
    max_messages = get_settings().max_history_turns * 2
    if len(history) > max_messages:
        history = history[-max_messages:]
    while history and not isinstance(history[0], ModelRequest):
        history = history[1:]

    return history


def _run_messages(result: Any) -> list[ModelMessage]:
    """Returns the messages of a finished run (empty when unavailable)."""
    getter = getattr(result, "all_messages", None)
    if getter is None:
        return []
    try:
        return list(getter())
    except Exception:  # pragma: no cover - defensive
        return []


def _ended_on_tool_return(messages: Sequence[ModelMessage]) -> bool:
    """
    Detects a run that stopped right after a tool result.

    Some models announce the tool call ("I'll search for that.") and then end
    the turn without turning the tool output into an answer. The user would only
    see the announcement, so the turn is treated as incomplete.
    """
    if not messages:
        return False
    last = messages[-1]
    if not isinstance(last, ModelRequest):
        return False
    return any(isinstance(part, ToolReturnPart) for part in last.parts)


async def stream_chat(
    message: str,
    message_history: list[ModelMessage] | None = None,
    model_override: str | None = None,
) -> AsyncGenerator[ChatStreamEvent, None]:
    """Streams structured events from the NexusAI assistant agent.

    The primary model is tried first. When it fails (out of credits, provider
    error, ...) or returns an unfinished turn, the configured fallback models
    are tried in order. The fallback is only used when the answer can still be
    completed, so it is never duplicated.

    A ``meta`` event is emitted as soon as a model starts producing output, so
    the client can show which model answered (important when falling back to a
    free model).
    """
    primary = (model_override or default_model_name).strip()
    candidates = [primary]
    for name in fallback_model_names:
        if name and name not in candidates:
            candidates.append(name)

    last_error: Exception | None = None

    for index, model in enumerate(candidates):
        agent_instance = get_agent(model)
        streamed_any = False
        try:
            async with agent_instance.run_stream(
                message, message_history=message_history
            ) as result:
                announced = False
                async for chunk in result.stream_text(delta=True):
                    if not announced:
                        announced = True
                        yield ChatStreamEvent(type="meta", model=model)
                    streamed_any = True
                    yield ChatStreamEvent(type="token", text=chunk, model=model)

                if _ended_on_tool_return(_run_messages(result)):
                    raise _IncompleteTurn("the model returned tool results without answering")
            return
        except _IncompleteTurn as incomplete:
            last_error = incomplete
            logger.warning("Model %s left the turn unfinished (%s).", model, incomplete)
        except Exception as exc:
            last_error = exc
            if streamed_any:
                # Part of the answer was already delivered: do not restart it.
                raise
            logger.warning(
                "Model %s failed (%s: %s)",
                model,
                type(exc).__name__,
                exc,
            )

        if index == len(candidates) - 1:
            break

    if isinstance(last_error, _IncompleteTurn):
        # The tools ran and returned data, but no model turned it into an
        # answer. Say so instead of failing with a cryptic error.
        logger.error("Every model left the turn unfinished after a tool call.")
        yield ChatStreamEvent(
            type="token",
            text=(
                "\n\n⚠️ The search results were retrieved but the model did not turn "
                "them into an answer. Please ask again."
            ),
        )
        return

    if last_error is not None:
        raise last_error
