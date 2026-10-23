import logging
import os

# PDF parsing
try:
    import pdfplumber
except ImportError:  # pragma: no cover - depends on the deployment
    pdfplumber = None

# DOCX parsing
try:
    import docx
except ImportError:  # pragma: no cover - depends on the deployment
    docx = None


logger = logging.getLogger("nexusai.services.files")


class ExtractionError(Exception):
    """Raised when a supported file cannot be read."""


# Images are intentionally not accepted: extracting their text requires the
# Tesseract OCR binary, which is a system dependency. Advertising a format the
# server cannot actually read is worse than not supporting it.
ALLOWED_EXTENSIONS = {"pdf", "docx", "txt"}

# A few bytes are enough to confirm the file really is what its extension says.
_SIGNATURES = {
    "pdf": (b"%PDF",),
    "docx": (b"PK\x03\x04",),
}


def allowed_file(filename: str) -> bool:
    """Return True if the file has an allowed extension."""
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    return ext in ALLOWED_EXTENSIONS


def validate_signature(file_path: str) -> None:
    """Rejects a file whose content does not match its extension."""
    ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    expected = _SIGNATURES.get(ext)
    if not expected:
        return
    with open(file_path, "rb") as handle:
        header = handle.read(8)
    if not any(header.startswith(signature) for signature in expected):
        raise ExtractionError(
            f"The uploaded .{ext} file does not look like a valid {ext.upper()} document."
        )


def extract_file_content(file_path: str) -> str:
    """Extract textual content from a supported file.

    Raises ``ExtractionError`` when the file cannot be parsed, so callers can
    return a real error instead of an empty document.
    """
    ext = os.path.splitext(file_path)[1].lower().lstrip(".")

    try:
        if ext == "pdf":
            if pdfplumber is None:
                raise ExtractionError(
                    "PDF support is not installed on this server (pdfplumber missing)."
                )
            pages: list[str] = []
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    pages.append(page.extract_text() or "")
            return "\n".join(pages)

        if ext == "docx":
            if docx is None:
                raise ExtractionError(
                    "DOCX support is not installed on this server (python-docx missing)."
                )
            document = docx.Document(file_path)
            return "\n".join(paragraph.text for paragraph in document.paragraphs)

        if ext == "txt":
            with open(file_path, encoding="utf-8", errors="ignore") as handle:
                return handle.read()

        raise ExtractionError(f"Unsupported file type: .{ext}")
    except ExtractionError:
        raise
    except Exception as exc:
        logger.error("Failed to extract content from a .%s file: %s", ext, exc)
        raise ExtractionError(f"Could not read the uploaded .{ext} file.") from exc
