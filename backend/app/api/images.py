"""Image editing endpoint: upload a picture, describe the change, get it back."""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from ..core.auth import CurrentUser, get_current_user
from ..core.config import get_settings
from ..core.rate_limit import rate_limit
from ..database.db import (
    add_message,
    conversation_exists,
    create_conversation,
)
from ..services.chat_service import derive_title
from ..services.image_service import ImageEditError, detect_media_type, edit_image

logger = logging.getLogger("nexusai.api.images")

router = APIRouter(prefix="/api/images", tags=["Images"])

CHUNK_SIZE = 1024 * 1024
MAX_PROMPT_LENGTH = 2000


@router.post(
    "/edit",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit)],
)
async def edit_uploaded_image(
    image: UploadFile = File(...),
    prompt: str = Form(...),
    conversation_id: int | None = Form(None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Edits an uploaded image according to a text prompt.

    The result is stored in the conversation (as markdown with an embedded data
    URL) so it survives a reload, and returned to the caller as a data URL.
    """
    settings = get_settings()

    cleaned_prompt = prompt.strip()
    if not cleaned_prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Describe how you want the image edited.",
        )
    if len(cleaned_prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"The edit prompt must be at most {MAX_PROMPT_LENGTH} characters.",
        )

    # The client supplied name is only used for display: never for a path.
    filename = Path(image.filename or "image").name

    data = bytearray()
    while chunk := await image.read(CHUNK_SIZE):
        if len(data) + len(chunk) > settings.max_upload_size_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    "Image size exceeds the maximum allowed limit of "
                    f"{settings.max_upload_size_mb} MB."
                ),
            )
        data.extend(chunk)

    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded image is empty.",
        )

    if detect_media_type(bytes(data)) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported image type. Supported types: PNG, JPEG, WEBP.",
        )

    if conversation_id is not None and not await run_in_threadpool(
        conversation_exists, conversation_id, current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    try:
        edited = await edit_image(bytes(data), cleaned_prompt)
    except ImageEditError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    if conversation_id is None:
        conversation_id = await run_in_threadpool(
            create_conversation, derive_title(cleaned_prompt), current_user.id
        )

    await run_in_threadpool(
        add_message,
        conversation_id,
        "user",
        f"Edit image: {filename}\n{cleaned_prompt}",
    )
    await run_in_threadpool(
        add_message,
        conversation_id,
        "assistant",
        f"![Edited image]({edited.data_url})",
    )

    return {
        "conversation_id": conversation_id,
        "image": edited.data_url,
        "media_type": edited.media_type,
        "model": edited.model,
        "filename": filename,
    }
