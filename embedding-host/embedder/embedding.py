"""Embedding pipeline (GGUF / llama-cpp-python only)."""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from PIL import Image

from embedder import gguf_backend
from embedder import model as model_mod


def embed_text(text: str, instruction: Optional[str] = None) -> list[float]:
    assert model_mod._gguf_llm is not None
    if instruction:
        combined = f"{instruction.strip()}\n\n{text.strip()}"
    else:
        combined = text.strip()
    return gguf_backend.embed_text(model_mod._gguf_llm, combined)


def embed_image(_image: Image.Image) -> list[float]:
    raise HTTPException(
        status_code=400,
        detail="Image embedding is not supported with the GGUF backend (text-only).",
    )
