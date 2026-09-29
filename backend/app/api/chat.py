from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..database.db import (
    add_message,
    conversation_exists,
    create_conversation,
    delete_conversation,
    get_conversations,
    get_messages,
    update_conversation_title,
)
from ..models.chat import (
    ChatRequest,
    ConversationTitleRequest,
)
from ..services.chat_service import stream_chat


router = APIRouter(
    prefix="/api/chat",
    tags=["Chat"],
)


def build_conversation_context(conversation_id: int):
    messages = get_messages(conversation_id)

    if not messages:
        return ""

    context = []

    for message in messages:
        role = (
            "User"
            if message["role"] == "user"
            else "NexusAI"
        )

        context.append(
            f"{role}: {message['content']}"
        )

    return "\n\n".join(context)


# ==========================================
# CREATE NEW CONVERSATION
# ==========================================

@router.post("/conversations")
async def new_conversation():
    conversation_id = create_conversation()

    return {
        "id": conversation_id,
        "title": "New Chat",
    }


# ==========================================
# GET ALL CONVERSATIONS
# ==========================================

@router.get("/conversations")
async def conversations():
    return get_conversations()


# ==========================================
# GET ONE CONVERSATION
# ==========================================

@router.get("/conversations/{conversation_id}")
async def conversation(conversation_id: int):
    if not conversation_exists(conversation_id):
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    return {
        "id": conversation_id,
        "messages": get_messages(conversation_id),
    }


# ==========================================
# EDIT CONVERSATION TITLE
# ==========================================

@router.patch("/conversations/{conversation_id}")
async def edit_conversation(
    conversation_id: int,
    request: ConversationTitleRequest,
):
    if not conversation_exists(conversation_id):
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    cleaned_title = request.title.strip()

    if not cleaned_title:
        raise HTTPException(
            status_code=400,
            detail="Conversation title cannot be empty",
        )

    update_conversation_title(
        conversation_id,
        cleaned_title,
    )

    return {
        "id": conversation_id,
        "title": cleaned_title,
    }


# ==========================================
# CHAT
# ==========================================

@router.post("")
async def chat(request: ChatRequest):
    if request.conversation_id is None:
        conversation_id = create_conversation()
    else:
        conversation_id = request.conversation_id

        if not conversation_exists(conversation_id):
            raise HTTPException(
                status_code=404,
                detail="Conversation not found",
            )

    previous_messages = get_messages(
        conversation_id
    )

    conversation_context = (
        build_conversation_context(
            conversation_id
        )
    )

    add_message(
        conversation_id,
        "user",
        request.message,
    )

    async def generate():
        full_response = ""

        async for chunk in stream_chat(
            request.message,
            conversation_context,
        ):
            full_response += chunk
            yield chunk

        add_message(
            conversation_id,
            "assistant",
            full_response,
        )

        if not previous_messages and full_response:
            title = request.message[:40]

            if len(request.message) > 40:
                title += "..."

            update_conversation_title(
                conversation_id,
                title,
            )

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Conversation-ID": str(
                conversation_id
            ),
        },
    )


# ==========================================
# DELETE CONVERSATION
# ==========================================

@router.delete("/conversations/{conversation_id}")
async def delete_chat(conversation_id: int):
    if not conversation_exists(conversation_id):
        raise HTTPException(
            status_code=404,
            detail="Conversation not found",
        )

    delete_conversation(
        conversation_id
    )

    return {
        "message": "Conversation deleted",
        "id": conversation_id,
    }