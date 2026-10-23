from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class ChatRequest(BaseModel):
    message: str = Field(
        default="",
        max_length=15000,
        description="The user's query or prompt message.",
    )
    conversation_id: int | None = Field(
        None, ge=1, description="Optional ID of an existing conversation to continue."
    )
    regenerate: bool = Field(
        default=False,
        description=(
            "Replace the trailing assistant reply: the previous user message is "
            "answered again instead of appending a new turn."
        ),
    )

    @model_validator(mode="after")
    def _message_is_required_unless_regenerating(self):
        if not self.regenerate and not self.message.strip():
            raise ValueError("message must not be empty")
        return self

    model: str | None = Field(
        None,
        max_length=100,
        description="Optional model identifier. Must be one of the configured models.",
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
    created_at: datetime | None = None


class ConversationSummary(BaseModel):
    id: int
    title: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ConversationDetailResponse(BaseModel):
    id: int
    title: str
    messages: list[MessageItem]


class HealthResponse(BaseModel):
    status: str
    database: str
    model: str
    version: str


class ModelListResponse(BaseModel):
    object: str = "list"
    data: list[dict[str, Any]] = Field(default_factory=list)
