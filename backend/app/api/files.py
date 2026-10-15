import os
import shutil
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse

from ..core.auth import CurrentUser, get_current_user
from ..services.file_service import extract_file_content, allowed_file

router = APIRouter(prefix="/api/files", tags=["Files"])

# Configurable max upload size (MB) via environment variable, default 10 MB
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "10"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload a single image or document, validate size/type, extract text.

    Supported extensions: .png, .jpg, .jpeg, .gif, .bmp, .pdf, .docx, .txt
    The extracted textual content is returned in the response. In a real
    application the file would be stored and linked to a conversation, but
    for this minimal feature we simply process and return the content.
    """
    # Validate file size
    if file.size is None:
        # FastAPI's UploadFile may not provide size; read into memory to check.
        contents = await file.read()
        size = len(contents)
        # Reset the stream for later processing
        file.file.seek(0)
    else:
        size = file.size
    if size > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds the maximum allowed limit of {MAX_UPLOAD_SIZE_MB} MB.",
        )

    # Validate file type based on extension
    filename = file.filename
    if not allowed_file(filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Supported types: png, jpg, jpeg, gif, bmp, pdf, docx, txt.",
        )

    # Save to a temporary location for processing
    temp_dir = "./tmp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, filename)
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        # Extract textual content using the service layer
        extracted_text = extract_file_content(temp_path)
    finally:
        # Clean up the temporary file
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content={
            "filename": filename,
            "size_bytes": size,
            "extracted_text": extracted_text,
        },
    )
