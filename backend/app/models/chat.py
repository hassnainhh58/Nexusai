from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_serializer, model_validator


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite stores naive UTC timestamps; serialise them with an offset."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class ChatRequest(BaseModel):
    message: str = Field(
        default="",
        description=(
            "The user's query or prompt message. There is no application-level "
            "length limit: content larger than the model context is reduced to "
            "the excerpts most relevant to the request."
        ),
    )
    conversation_id: int | None = Field(
        None, ge=1, description="Optional ID of an existing conversation to continue."
    )
    edit_message_id: int | None = Field(
        default=None,
        ge=1,
        description=(
            "Edit an existing user message: that message and every later turn are "
            "removed before the edited message is answered again."
        ),
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
        if self.edit_message_id is not None and self.regenerate:
            raise ValueError("edit_message_id cannot be combined with regenerate")
        return self

    model: str | None = Field(
        None,
        max_length=100,
        description="Optional model identifier. Must be one of the configured models.",
    )


class ChatResponse(BaseModel):
    response: str
    conversation_id: int


class ConversationUpdateRequest(BaseModel):
    title: str | None = Field(
        default=None,
        min_length=1,
        max_length=150,
        description="New title for the conversation.",
    )
    pinned: bool | None = Field(
        default=None,
        description="Pin the conversation to the top of the sidebar.",
    )

    @model_validator(mode="after")
    def _at_least_one_change(self):
        if self.title is None and self.pinned is None:
            raise ValueError("provide title and/or pinned")
        return self


class FeedbackRequest(BaseModel):
    feedback: Literal["up", "down"] | None = Field(
        default=None,
        description="Thumbs up/down rating, or null to clear it.",
    )


class MessageItem(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    feedback: str | None = None
    created_at: datetime | None = None

    @field_serializer("created_at")
    def _serialize_created_at(self, value: datetime | None) -> datetime | None:
        return _as_utc(value)


class ConversationSummary(BaseModel):
    id: int
    title: str
    pinned: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer("created_at", "updated_at")
    def _serialize_timestamps(self, value: datetime | None) -> datetime | None:
        return _as_utc(value)


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
