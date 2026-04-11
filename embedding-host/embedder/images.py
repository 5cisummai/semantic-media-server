"""Image decode and resize for vision inputs."""

import base64
import io
import logging
from typing import Optional

from fastapi import HTTPException
from PIL import Image

from embedder.config import IMAGE_MAX_SIDE, IMAGE_PATCH_MULTIPLE

logger = logging.getLogger("embedder")


def safe_resize_image(image: Image.Image) -> Image.Image:
    """Resize so neither side exceeds IMAGE_MAX_SIDE, snapping to IMAGE_PATCH_MULTIPLE."""
    w, h = image.size
    scale = min(IMAGE_MAX_SIDE / w, IMAGE_MAX_SIDE / h, 1.0)
    if scale < 1.0:
        new_w = max(IMAGE_PATCH_MULTIPLE, round(w * scale / IMAGE_PATCH_MULTIPLE) * IMAGE_PATCH_MULTIPLE)
        new_h = max(IMAGE_PATCH_MULTIPLE, round(h * scale / IMAGE_PATCH_MULTIPLE) * IMAGE_PATCH_MULTIPLE)
        image = image.resize((new_w, new_h), Image.LANCZOS)
    return image


def decode_image_base64(base64_value: str, filename: Optional[str] = None) -> Image.Image:
    fn = filename or "(unknown)"
    raw: Optional[bytes] = None
    try:
        raw = base64.b64decode(base64_value)
        img = Image.open(io.BytesIO(raw))
        return safe_resize_image(img.convert("RGB"))
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "image_decode_failed filename=%s raw_bytes=%s b64_len=%s err=%s",
            fn,
            len(raw) if raw is not None else None,
            len(base64_value),
            exc,
            exc_info=logger.isEnabledFor(logging.DEBUG),
        )
        raise HTTPException(status_code=400, detail=f"Invalid imageBase64: {exc}") from exc
