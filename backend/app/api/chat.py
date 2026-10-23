import json
import logging
import threading

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import PlainTextResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..agents.assistant import allowed_model_names
from ..core.auth import CurrentUser, get_current_user
from ..core.config import get_settings
from ..core.rate_limit import rate_limit
from ..database.db import (
    add_message,
    conversation_exists,
    create_conversation,
    delete_all_conversations,
    delete_conversation,
    delete_message,
    delete_messages_from,
    export_conversation_markdown,
    get_conversation_meta,
    get_conversation_title,
    get_conversations,
    get_messages,
    get_recent_messages,
    set_message_feedback,
    update_conversation_pinned,
    update_conversation_title,
)
from ..models.chat import (
    ChatRequest,
    ConversationDetailResponse,
    ConversationSummary,
    ConversationUpdateRequest,
    FeedbackRequest,
    MessageItem,
)
from ..services.chat_service import build_message_history, derive_title, stream_chat
from ..services.context_budget import fit_history_to_context, fit_message_to_context

logger = logging.getLogger("nexusai.api.chat")

router = APIRouter(
    prefix="/api/chat",
    tags=["Chat"],
)


def _persist_assistant_message(conversation_id: int, text: str) -> None:
    """Stores a partially streamed answer (used when a client disconnects)."""
    try:
        add_message(conversation_id, "assistant", text)
    except Exception:  # pragma: no cover - defensive
        logger.exception("Failed to persist the partial assistant message")


def _sse(event: str, data: dict) -> str:
    """Formats one Server-Sent Event.

    JSON encoding escapes newlines, so multi-line tokens stay on a single
    ``data:`` line and cannot break the framing.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ==========================================
# CREATE NEW CONVERSATION
# ==========================================
@router.post("/conversations", status_code=status.HTTP_201_CREATED)
async def new_conversation(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Creates a new empty conversation for the user."""
    conversation_id = await run_in_threadpool(create_conversation, "New Chat", current_user.id)
    return {"id": conversation_id, "title": "New Chat"}


# ==========================================
# GET ALL CONVERSATIONS
# ==========================================
@router.get("/conversations", response_model=list[ConversationSummary])
async def conversations(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(
        default=None,
        max_length=200,
        description="Search conversation titles and message contents.",
    ),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Returns a page of the user's conversations, pinned first.

    ``q`` searches titles and every message, so a chat can be found by what was
    discussed even when its generated title is unrelated.
    """
    return await run_in_threadpool(get_conversations, current_user.id, limit, offset, q)


# ==========================================
# GET ONE CONVERSATION
# ==========================================
@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def conversation(
    conversation_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Returns details and message history for a specific conversation."""
    if not await run_in_threadpool(conversation_exists, conversation_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    title = await run_in_threadpool(get_conversation_title, conversation_id, current_user.id)
    messages = await run_in_threadpool(get_messages, conversation_id, current_user.id)
    return {
        "id": conversation_id,
        "title": title or "Conversation",
        "messages": [MessageItem.model_validate(message) for message in messages],
    }


# ==========================================
# EDIT CONVERSATION TITLE
# ==========================================
@router.patch("/conversations/{conversation_id}")
async def edit_conversation(
    conversation_id: int,
    request: ConversationUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Renames and/or pins an existing conversation."""
    meta = await run_in_threadpool(get_conversation_meta, conversation_id, current_user.id)
    if meta is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    title = meta["title"]
    if request.title is not None:
        cleaned_title = request.title.strip()
        if not cleaned_title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Conversation title cannot be empty",
            )
        updated = await run_in_threadpool(
            update_conversation_title, conversation_id, cleaned_title, current_user.id
        )
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Could not update conversation title",
            )
        title = cleaned_title

    pinned = bool(meta["pinned"])
    if request.pinned is not None:
        updated = await run_in_threadpool(
            update_conversation_pinned, conversation_id, request.pinned, current_user.id
        )
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Could not update the conversation",
            )
        pinned = request.pinned

    return {"id": conversation_id, "title": title, "pinned": pinned}


# ==========================================
# MESSAGE FEEDBACK
# ==========================================
@router.patch("/conversations/{conversation_id}/messages/{message_id}/feedback")
async def rate_message(
    conversation_id: int,
    message_id: int,
    request: FeedbackRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Stores the user's thumbs up/down rating for an assistant reply."""
    if not await run_in_threadpool(conversation_exists, conversation_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    updated = await run_in_threadpool(
        set_message_feedback,
        conversation_id,
        message_id,
        current_user.id,
        request.feedback,
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found or is not an assistant reply",
        )

    return {"id": message_id, "feedback": request.feedback}


# ==========================================
# EXPORT CONVERSATION
# ==========================================
@router.get("/conversations/{conversation_id}/export")
async def export_conversation(
    conversation_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Exports conversation transcript as Markdown (owner only)."""
    markdown_content = await run_in_threadpool(
        export_conversation_markdown, conversation_id, current_user.id
    )
    if markdown_content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    return PlainTextResponse(
        markdown_content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=conversation_{conversation_id}.md"},
    )


# ==========================================
# DELETE ONE CONVERSATION
# ==========================================
@router.delete("/conversations/{conversation_id}")
async def delete_chat(
    conversation_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Deletes a conversation and its messages."""
    deleted = await run_in_threadpool(delete_conversation, conversation_id, current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    return {"message": "Conversation deleted", "id": conversation_id}


# ==========================================
# CLEAR ALL CONVERSATIONS
# ==========================================
@router.delete("/conversations")
async def clear_all_chats(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Clears all conversations owned by the current user."""
    count = await run_in_threadpool(delete_all_conversations, current_user.id)
    return {
        "message": f"Deleted {count} conversations",
        "count": count,
    }


# ==========================================
# CHAT (STREAMING SSE)
# ==========================================
@router.post("", dependencies=[Depends(rate_limit)])
async def chat(
    request: Request,
    payload: ChatRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Processes chat requests and streams Server-Sent Events.

    Events: ``meta`` (model used), ``token`` (text delta), ``error`` and
    ``done`` (conversation id + model). The assistant reply is persisted only
    when it was actually produced, so upstream failures never pollute history.
    """
    settings = get_settings()

    clean_message = payload.message.strip()
    if not payload.regenerate and not clean_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty",
        )

    if payload.model and payload.model not in allowed_model_names():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=("Unsupported model. Allowed models: " + ", ".join(allowed_model_names())),
        )

    # Editing re-opens an earlier turn: the old question, its answer and every
    # later turn are removed before the edited question is answered again.
    if payload.edit_message_id is not None:
        if payload.conversation_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="conversation_id is required to edit a message",
            )
        if not await run_in_threadpool(
            conversation_exists, payload.conversation_id, current_user.id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found",
            )
        edited = await run_in_threadpool(
            delete_messages_from,
            payload.conversation_id,
            payload.edit_message_id,
            current_user.id,
        )
        if not edited:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found or is not editable",
            )

    user_message_id: int | None = None

    if payload.regenerate:
        # Answer the last user message again. The trailing assistant reply is
        # removed first, so the stored transcript never contains duplicates.
        if payload.conversation_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="conversation_id is required to regenerate a response",
            )
        conversation_id = payload.conversation_id
        if not await run_in_threadpool(conversation_exists, conversation_id, current_user.id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found",
            )

        recent_rows = await run_in_threadpool(
            get_recent_messages, conversation_id, current_user.id, 5
        )
        while recent_rows and recent_rows[-1]["role"] == "assistant":
            await run_in_threadpool(
                delete_message,
                recent_rows[-1]["id"],
                conversation_id,
                current_user.id,
            )
            recent_rows.pop()

        if not recent_rows or recent_rows[-1]["role"] != "user":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="There is no user message to regenerate",
            )

        clean_message = recent_rows[-1]["content"]
        clean_message, _ = fit_message_to_context(clean_message, settings.context_char_budget)
        user_message_id = recent_rows[-1]["id"]
        message_history = build_message_history(
            fit_history_to_context(recent_rows[:-1], settings.context_char_budget)
        )
    else:
        if payload.conversation_id is None:
            conversation_id = await run_in_threadpool(
                create_conversation, derive_title(clean_message), current_user.id
            )
        else:
            conversation_id = payload.conversation_id
            if not await run_in_threadpool(conversation_exists, conversation_id, current_user.id):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found",
                )

        # Only the most recent turns that fit the context window are used.
        recent_rows = await run_in_threadpool(
            get_recent_messages,
            conversation_id,
            current_user.id,
            settings.max_history_turns * 2,
        )
        message_history = build_message_history(
            fit_history_to_context(recent_rows, settings.context_char_budget)
        )

        # Editing the first question renames the conversation, so the sidebar
        # does not keep a title derived from text that no longer exists.
        if payload.edit_message_id is not None and not recent_rows:
            await run_in_threadpool(
                update_conversation_title,
                conversation_id,
                derive_title(clean_message),
                current_user.id,
            )

        # Messages are not rejected for being long: when the composed prompt
        # exceeds the model context, the excerpts most relevant to the question
        # are kept so the reply is still grounded in the attachment.
        clean_message, trimmed = fit_message_to_context(clean_message, settings.context_char_budget)
        if trimmed:
            logger.warning(
                "Message reduced to fit the model context (%d -> %d characters)",
                len(payload.message),
                len(clean_message),
            )

        user_message_id = await run_in_threadpool(
            add_message, conversation_id, "user", clean_message
        )

    async def generate():
        collected: list[str] = []
        model_used: str | None = None
        assistant_message_id: int | None = None
        chunk_count = 0
        persisted = False

        try:
            async for event in stream_chat(
                clean_message,
                message_history=message_history,
                model_override=payload.model,
            ):
                if event.type == "meta":
                    model_used = event.model
                    yield _sse(
                        "meta",
                        {"model": event.model, "user_message_id": user_message_id},
                    )
                    continue

                collected.append(event.text)
                yield _sse("token", {"text": event.text})

                # Detect a client that went away and stop paying for tokens.
                chunk_count += 1
                if chunk_count % 25 == 0 and await request.is_disconnected():
                    logger.info(
                        "Client disconnected while streaming conversation %s", conversation_id
                    )
                    break

            assistant_text = "".join(collected).strip()
            if assistant_text:
                assistant_message_id = await run_in_threadpool(
                    add_message, conversation_id, "assistant", assistant_text
                )
                persisted = True
        except Exception as exc:
            # Headers are already flushed, so the failure is reported as an
            # SSE event instead of an HTTP status. The error is deliberately
            # NOT stored as an assistant message: it is not part of the
            # conversation and would pollute the history of every later turn.
            logger.exception("Chat streaming failed for conversation %s", conversation_id)
            yield _sse("error", {"message": f"Upstream model error: {exc}"})
            return
        finally:
            # Reached when the user pressed "Stop", closed the tab, or the
            # generator was cancelled. Persisting happens on a plain thread
            # because a generator being closed cannot await.
            if not persisted:
                partial = "".join(collected).strip()
                if partial:
                    threading.Thread(
                        target=_persist_assistant_message,
                        args=(conversation_id, partial),
                        daemon=True,
                    ).start()

        yield _sse(
            "done",
            {
                "conversation_id": conversation_id,
                "model": model_used or "",
                "message_id": assistant_message_id,
            },
        )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Conversation-ID": str(conversation_id),
        },
    )
