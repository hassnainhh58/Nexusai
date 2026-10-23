import contextlib
import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..core.auth import CurrentUser, get_current_user
from ..core.config import get_settings
from ..core.rate_limit import rate_limit
from ..services.file_service import (
    ALLOWED_EXTENSIONS,
    ExtractionError,
    allowed_file,
    extract_file_content,
    validate_signature,
)

logger = logging.getLogger("nexusai.api.files")

router = APIRouter(prefix="/api/files", tags=["Files"])

CHUNK_SIZE = 1024 * 1024


def _remove_file(path: str) -> None:
    """Deletes a temporary file, ignoring the case where it is already gone."""
    with contextlib.suppress(FileNotFoundError):
        os.remove(path)


@router.post(
    "/upload",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit)],
)
async def upload_file(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload a document, validate it, and return its extracted text.

    Supported types: .pdf, .docx, .txt. The file is streamed to a temporary
    location (never fully buffered in memory), checked against its magic bytes,
    parsed in a worker thread, and deleted afterwards.
    """
    settings = get_settings()

    # Only the base name is kept: a client supplied name such as
    # "../../etc/passwd" must never influence where the file is written.
    original_name = file.filename or "upload"
    filename = Path(original_name).name

    if not allowed_file(filename):
        supported = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Supported types: {supported}.",
        )

    suffix = Path(filename).suffix.lower()
    temp_path: str | None = None
    size = 0

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > settings.max_upload_size_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            "File size exceeds the maximum allowed limit of "
                            f"{settings.max_upload_size_mb} MB."
                        ),
                    )
                temp_file.write(chunk)

        if size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded file is empty.",
            )

        try:
            await run_in_threadpool(validate_signature, temp_path)
            extracted_text = await run_in_threadpool(extract_file_content, temp_path)
        except ExtractionError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
    finally:
        if temp_path:
            await run_in_threadpool(_remove_file, temp_path)

    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content={
            "filename": filename,
            "size_bytes": size,
            "extracted_text": extracted_text,
        },
    )
