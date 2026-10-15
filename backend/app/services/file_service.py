import os
import io
from typing import List

# For OCR on images
try:
    from PIL import Image
except ImportError:
    Image = None

try:
    import pytesseract
except ImportError:
    pytesseract = None

# PDF parsing
try:
    import pdfplumber
except ImportError:
    pdfplumber = None

# DOCX parsing
try:
    import docx
except ImportError:
    docx = None


ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp", "pdf", "docx", "txt"}


def allowed_file(filename: str) -> bool:
    """Return True if the file has an allowed extension."""
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    return ext in ALLOWED_EXTENSIONS


def extract_file_content(file_path: str) -> str:
    """Extract textual content from supported file types.

    Supported types:
    - Images (PNG, JPG, JPEG, GIF, BMP) → OCR via pytesseract.
    - PDF → pdfplumber text extraction.
    - DOCX → python-docx.
    - TXT → plain text read.

    Returns the extracted text or an empty string if extraction fails.
    """
    ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    try:
        if ext in {"png", "jpg", "jpeg", "gif", "bmp"}:
            if Image is None or pytesseract is None:
                raise RuntimeError("Pillow and pytesseract are required for image OCR")
            image = Image.open(file_path)
            return pytesseract.image_to_string(image)
        elif ext == "pdf":
            if pdfplumber is None:
                raise RuntimeError("pdfplumber is required for PDF extraction")
            text_pages: List[str] = []
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    text_pages.append(page.extract_text() or "")
            return "\n".join(text_pages)
        elif ext == "docx":
            if docx is None:
                raise RuntimeError("python-docx is required for DOCX extraction")
            doc = docx.Document(file_path)
            return "\n".join([para.text for para in doc.paragraphs])
        elif ext == "txt":
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        else:
            return ""
    except Exception as e:
        # Log could be added here; for now we silently return empty string.
        return ""
