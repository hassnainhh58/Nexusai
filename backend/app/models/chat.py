from typing import Any, Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(
        ..., min_length=1, max_length=15000, description="The user's query or prompt message."
    )
    conversation_id: Optional[int] = Field(
        None, ge=1, description="Optional ID of an existing conversation to continue."
    )
    model: Optional[str] = Field(
        None, max_length=100, description="Optional model identifier override (e.g. 'x-ai/grok-4.3')."
    )


class ChatResponse(BaseModel):
    response: str
    conversation_id: int


class ConversationTitleRequest(BaseModel):
    title: str = Field(
        ...,
        min_length=1,
        max_length=150,
        description="New title for the conversation.",
    )


class MessageItem(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    created_at: Optional[Any] = None


class ConversationDetailResponse(BaseModel):
    id: int
    title: str
    messages: list[dict[str, Any]]


class HealthResponse(BaseModel):
    status: str
    database: str
    model: str
    version: str