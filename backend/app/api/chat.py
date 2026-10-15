import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import PlainTextResponse, StreamingResponse

from ..core.auth import CurrentUser, get_current_user
from ..database.db import (
    add_message,
    conversation_exists,
    create_conversation,
    delete_all_conversations,
    delete_conversation,
    export_conversation_markdown,
    get_conversations,
    get_messages,
    update_conversation_title,
    get_db,
)
from ..models.chat import (
    ChatRequest,
    ConversationDetailResponse,
    ConversationTitleRequest,
)
from ..services.chat_service import stream_chat

logger = logging.getLogger("nexusai.api.chat")

router = APIRouter(
    prefix="/api/chat",
    tags=["Chat"],
)


def build_conversation_context(conversation_id: int, user_id: str = "default") -> str:
    """Builds conversational history context for the LLM prompt."""
    messages = get_messages(conversation_id, user_id)
    if not messages:
        return ""

    context = []
    # Limit context to last 20 messages to prevent token overflow
    recent_messages = messages[-20:]
    for message in recent_messages:
        role = "User" if message["role"] == "user" else "NexusAI"
        context.append(f"{role}: {message['content']}")

    return "\n\n".join(context)


# ==========================================
# CREATE NEW CONVERSATION
# ==========================================
@router.post("/conversations", status_code=status.HTTP_201_CREATED)
async def new_conversation(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Creates a new empty conversation for the user."""
    conversation_id = create_conversation(title="New Chat", user_id=current_user.id)
    return {
        "id": conversation_id,
        "title": "New Chat",
    }


# ==========================================
# GET ALL CONVERSATIONS
# ==========================================
@router.get("/conversations")
async def conversations(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Returns all conversations belonging to the user."""
    return get_conversations(user_id=current_user.id)


# ==========================================
# GET ONE CONVERSATION
# ==========================================
@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def conversation(
    conversation_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Returns details and message history for a specific conversation."""
    if not conversation_exists(conversation_id, user_id=current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    # Retrieve conversation title
    with get_db() as conn:
        conv_row = conn.execute(
            "SELECT title FROM conversations WHERE id = ?",
            (conversation_id,)
        ).fetchone()
        conv_title = conv_row["title"] if conv_row else "Conversation"

    return {
        "id": conversation_id,
        "title": conv_title,
        "messages": get_messages(conversation_id, user_id=current_user.id),
    }


# ==========================================
# EDIT CONVERSATION TITLE
# ==========================================
@router.patch("/conversations/{conversation_id}")
async def edit_conversation(
    conversation_id: int,
    request: ConversationTitleRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Renames an existing conversation."""
    if not conversation_exists(conversation_id, user_id=current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    cleaned_title = request.title.strip()
    if not cleaned_title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Conversation title cannot be empty",
        )

    updated = update_conversation_title(
        conversation_id,
        cleaned_title,
        user_id=current_user.id,
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not update conversation title",
        )

    return {
        "id": conversation_id,
        "title": cleaned_title,
    }


# ==========================================
# EXPORT CONVERSATION
# ==========================================
@router.get("/conversations/{conversation_id}/export")
async def export_conversation(
    conversation_id: int,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Exports conversation transcript as Markdown."""
    markdown_content = export_conversation_markdown(conversation_id, user_id=current_user.id)
    if markdown_content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    return PlainTextResponse(
        markdown_content,
        headers={
            "Content-Disposition": f"attachment; filename=conversation_{conversation_id}.md"
        },
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
    if not conversation_exists(conversation_id, user_id=current_user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    deleted = delete_conversation(conversation_id, user_id=current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not delete conversation",
        )

    return {
        "message": "Conversation deleted",
        "id": conversation_id,
    }


# ==========================================
# CLEAR ALL CONVERSATIONS
# ==========================================
@router.delete("/conversations")
async def clear_all_chats(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Clears all conversations for the current user."""
    count = delete_all_conversations(user_id=current_user.id)
    return {
        "message": f"Deleted {count} conversations",
        "count": count,
    }


# ==========================================
# CHAT (STREAMING)
# ==========================================
@router.post("")
async def chat(
    request: ChatRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Processes chat requests with streaming responses.
    Saves user message, streams assistant response chunks, and updates chat title.
    """
    # Directly use the message field from the request
    clean_message = request.message.strip()
    if not clean_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty",
        )

    if request.conversation_id is None:
        # Create a new conversation with a title derived from the first user message
        # Use the first up to 5 meaningful words for the title
        title_words = clean_message.split()
        generated_title = " ".join(title_words[:5]) if title_words else "New Chat"
        conversation_id = create_conversation(title=generated_title, user_id=current_user.id)
    else:
        conversation_id = request.conversation_id
        if not conversation_exists(conversation_id, user_id=current_user.id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found",
            )

    previous_messages = get_messages(conversation_id, user_id=current_user.id)
    conversation_context = build_conversation_context(conversation_id, user_id=current_user.id)

    # Save user message
    add_message(conversation_id, "user", clean_message)

    async def generate():
        full_response = ""
        async for chunk in stream_chat(
            clean_message,
            conversation_context,
            model_override=request.model,
        ):
            full_response += chunk
            yield chunk
        # After streaming is complete, save assistant response to DB
        add_message(conversation_id, "assistant", full_response)
        return

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Conversation-ID": str(conversation_id),
        },
    )