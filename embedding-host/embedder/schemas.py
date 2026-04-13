"""Pydantic request/response models."""

from typing import Optional

from pydantic import BaseModel, Field


class EmbedRequest(BaseModel):
    model: str = Field(
        default="DevQuasar/Qwen.Qwen3-VL-Embedding-2B-GGUF",
        description="Local path to a .gguf file, or HF repo id (Llama.from_pretrained + GGUF_FILENAME).",
    )
    backend: str = Field(
        default="gguf",
        pattern="^(gguf|auto)$",
        description="Ignored; this service only loads GGUF via llama-cpp-python. 'auto' is accepted as an alias for gguf.",
    )
    type: str = Field(pattern="^(text|image)$")
    text: Optional[str] = None
    imageBase64: Optional[str] = None
    filename: Optional[str] = None
    instruction: Optional[str] = None


class EmbedResponse(BaseModel):
    embedding: list[float]


class HealthResponse(BaseModel):
    status: str
    device: str
    model: Optional[str]
    backend: Optional[str] = None


class ExtractRequest(BaseModel):
    type: str = Field(pattern="^(text|pdf)$")
    text: Optional[str] = None
    fileBase64: Optional[str] = None
    filename: Optional[str] = None


class ExtractResponse(BaseModel):
    text: Optional[str] = None
    error: Optional[str] = None
