"""Image editing through the provider's dedicated Image API.

The upload is sent as an input reference next to the user's prompt, so an
image-to-image capable model (Nano Banana / Gemini image) modifies the supplied
picture instead of generating an unrelated one.
"""

import base64
import logging
from dataclasses import dataclass

import httpx2

from ..core.config import get_settings

logger = logging.getLogger("nexusai.services.images")

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
WEBP_RIFF = b"RIFF"

SUPPORTED_MEDIA_TYPES = ("image/png", "image/jpeg", "image/webp")


class ImageEditError(Exception):
    """Raised when an image cannot be edited, with a suggested HTTP status."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(slots=True)
class EditedImage:
    """A generated image returned as a self-contained data URL."""

    data_url: str
    media_type: str
    model: str


def detect_media_type(data: bytes) -> str | None:
    """Identifies the image format from its magic bytes (never the filename)."""
    if data.startswith(PNG_SIGNATURE):
        return "image/png"
    if data.startswith(JPEG_SIGNATURE):
        return "image/jpeg"
    if len(data) >= 12 and data.startswith(WEBP_RIFF) and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _images_endpoint() -> str:
    return get_settings().llm_base_url.rstrip("/") + "/images"


async def edit_image(image_bytes: bytes, prompt: str) -> EditedImage:
    """Applies ``prompt`` to ``image_bytes`` and returns the edited image."""
    settings = get_settings()

    if not settings.llm_api_key:
        raise ImageEditError(
            "Image editing is not configured: LLM_API_KEY is missing.", status_code=503
        )

    media_type = detect_media_type(image_bytes)
    if media_type is None:
        raise ImageEditError(
            "Unsupported image type. Supported types: PNG, JPEG, WEBP.", status_code=400
        )

    data_url = f"data:{media_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    payload = {
        "model": settings.image_model,
        "prompt": prompt,
        "input_references": [
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx2.AsyncClient(
            timeout=httpx2.Timeout(settings.image_timeout_seconds, connect=15.0)
        ) as client:
            response = await client.post(_images_endpoint(), json=payload, headers=headers)
    except httpx2.TimeoutException as exc:
        logger.error("Image edit timed out: %s", exc)
        raise ImageEditError(
            "The image model took too long to respond. Please try again.", status_code=504
        ) from exc
    except httpx2.HTTPError as exc:
        logger.error("Image edit request failed: %s", exc)
        raise ImageEditError(f"Could not reach the image model: {exc}", status_code=502) from exc

    if response.status_code == 402:
        raise ImageEditError(
            "The image model requires credits on your OpenRouter account. "
            "Add credits at https://openrouter.ai/settings/credits and try again.",
            status_code=402,
        )

    if response.status_code == 401:
        raise ImageEditError("The image provider rejected the configured API key.", status_code=502)

    if response.status_code == 429:
        raise ImageEditError(
            "The image model is rate limited right now. Please try again shortly.",
            status_code=429,
        )

    if response.status_code >= 400:
        detail = ""
        try:
            body = response.json()
            detail = body.get("error", {}).get("message") or body.get("detail") or ""
        except ValueError:
            detail = response.text[:200]
        logger.error("Image provider error %s: %s", response.status_code, detail)
        raise ImageEditError(
            f"The image model could not process this request. {detail}".strip(),
            status_code=502,
        )

    try:
        body = response.json()
        item = (body.get("data") or [{}])[0]
        encoded = item.get("b64_json")
    except (ValueError, AttributeError, IndexError) as exc:
        logger.error("Unexpected image response: %s", response.text[:300])
        raise ImageEditError("The image model returned an unreadable response.") from exc

    if not encoded:
        raise ImageEditError("The image model did not return an image.")

    result_type = item.get("media_type") or "image/png"
    return EditedImage(
        data_url=f"data:{result_type};base64,{encoded}",
        media_type=result_type,
        model=settings.image_model,
    )
