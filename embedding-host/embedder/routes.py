"""HTTP routes."""

import logging

from fastapi import APIRouter, HTTPException

from embedder import embedding as embed_mod
from embedder import model as model_mod
from embedder.extract import extract_text_from_pdf_base64
from embedder.images import decode_image_base64
from embedder.schemas import EmbedRequest, EmbedResponse, ExtractRequest, ExtractResponse, HealthResponse

logger = logging.getLogger("embedder")

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        device=model_mod.health_device_string(),
        model=model_mod._current_model_name,
        backend=model_mod._active_backend,
    )


@router.post("/embed", response_model=EmbedResponse)
def embed(payload: EmbedRequest) -> EmbedResponse:
    model_mod.load_model_if_needed(payload.model, payload.backend)

    if payload.type == "text":
        if not payload.text or not payload.text.strip():
            logger.warning("embed_reject_empty_text model=%s", payload.model)
            raise HTTPException(status_code=400, detail="text is required when type=text")
        embedding = embed_mod.embed_text(payload.text.strip(), payload.instruction)
        return EmbedResponse(embedding=embedding)

    if payload.type == "image":
        if not payload.imageBase64:
            logger.warning(
                "embed_reject_missing_imageBase64 filename=%s", payload.filename or "(unknown)"
            )
            raise HTTPException(status_code=400, detail="imageBase64 is required when type=image")
        logger.debug(
            "embed_image filename=%s b64_len=%s model=%s",
            payload.filename or "(unknown)",
            len(payload.imageBase64),
            payload.model,
        )
        image = decode_image_base64(payload.imageBase64, payload.filename)
        embedding = embed_mod.embed_image(image)
        return EmbedResponse(embedding=embedding)

    raise HTTPException(status_code=400, detail="type must be text or image")


@router.post("/extract", response_model=ExtractResponse)
def extract(payload: ExtractRequest) -> ExtractResponse:
    if payload.type == "text":
        if not payload.text:
            raise HTTPException(status_code=400, detail="text is required when type=text")
        return ExtractResponse(text=payload.text[:50000])

    if payload.type == "pdf":
        if not payload.fileBase64:
            raise HTTPException(status_code=400, detail="fileBase64 is required when type=pdf")
        text = extract_text_from_pdf_base64(payload.fileBase64)
        return ExtractResponse(text=text[:50000])

    raise HTTPException(status_code=400, detail="type must be text or pdf")
