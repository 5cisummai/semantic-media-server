from __future__ import annotations

import base64
import io
import logging
import os
import threading
from typing import Any, Optional

logger = logging.getLogger("embedding_host")

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image

try:
    from qwen_vl_utils.vision_process import process_vision_info
except Exception:  # pragma: no cover - optional dependency fallback
    process_vision_info = None

try:
    from transformers.models.qwen3_vl.modeling_qwen3_vl import Qwen3VLForEmbedding
except Exception:  # pragma: no cover - not in upstream transformers yet; use trust_remote_code path
    Qwen3VLForEmbedding = None

try:
    from transformers.models.qwen3_vl.processing_qwen3_vl import Qwen3VLProcessor
except Exception:  # pragma: no cover
    Qwen3VLProcessor = None

from transformers import AutoModel


class EmbedRequest(BaseModel):
    model: str = Field(default="Qwen/Qwen3-VL-Embedding-2B")
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


# Both limits are tunable at launch time via environment variables.
# IMAGE_MAX_SIDE caps the longest image dimension; width and height are snapped
# to multiples of _IMAGE_PATCH_MULTIPLE so Qwen3-VL's patchifier divides cleanly.
# A 448-pixel side → at most 28×28 = 784 visual tokens; 16 384 → OOM on 32 GB RAM.
_IMAGE_MAX_SIDE: int = int(os.getenv("IMAGE_MAX_SIDE", "448"))
_IMAGE_PATCH_MULTIPLE: int = 16
_MAX_SEQ_LEN: int = int(os.getenv("MAX_SEQ_LEN", "4096"))

app = FastAPI(title="Multimodal Embedding Host", version="1.0.0")

_model_lock = threading.Lock()
_current_model_name: Optional[str] = None
_processor: Any = None
_model: Any = None
_device: Optional[torch.device] = None


def _pick_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _l2_normalize(vec: torch.Tensor) -> torch.Tensor:
    vec = vec.float().flatten()
    denom = torch.linalg.norm(vec)
    if denom.item() == 0:
        return vec
    return vec / denom


def _extract_vector(outputs: Any) -> torch.Tensor:
    if hasattr(outputs, "pooler_output") and outputs.pooler_output is not None:
        return outputs.pooler_output[0]
    if hasattr(outputs, "last_hidden_state") and outputs.last_hidden_state is not None:
        return outputs.last_hidden_state[0].mean(dim=0)
    if torch.is_tensor(outputs):
        if outputs.dim() > 1:
            return outputs[0]
        return outputs
    raise RuntimeError("Unable to extract embedding vector from model output")


def _pool_last_hidden_state(hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    flipped_tensor = attention_mask.flip(dims=[1])
    last_one_positions = flipped_tensor.argmax(dim=1)
    col = attention_mask.shape[1] - last_one_positions - 1
    row = torch.arange(hidden_state.shape[0], device=hidden_state.device)
    return hidden_state[row, col]


def _maybe_to_device(kwargs: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in kwargs.items():
        if torch.is_tensor(value):
            out[key] = value.to(_device)
        else:
            out[key] = value
    return out


def _torch_dtype_for_device(device: torch.device) -> torch.dtype:
    if device.type == "cuda":
        return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    if device.type == "mps":
        return torch.float16
    return torch.float32


def _load_model_if_needed(model_name: str) -> None:
    global _current_model_name, _processor, _model, _device

    if _model is not None and _current_model_name == model_name:
        return

    with _model_lock:
        if _model is not None and _current_model_name == model_name:
            return

        hf_token = os.getenv("HF_TOKEN")
        load_kwargs = {"trust_remote_code": True}
        if hf_token:
            load_kwargs["token"] = hf_token

        _device = _pick_device()

        model_kwargs = dict(load_kwargs)
        model_kwargs["torch_dtype"] = _torch_dtype_for_device(_device)
        # This reduces peak memory pressure during model loading.
        model_kwargs["low_cpu_mem_usage"] = True

        if Qwen3VLProcessor is not None:
            _processor = Qwen3VLProcessor.from_pretrained(model_name, padding_side="right", **load_kwargs)
        else:
            raise RuntimeError("Qwen3VLProcessor is not available; ensure transformers>=4.57.0 is installed")

        model_kwargs.pop("trust_remote_code", None)
        if Qwen3VLForEmbedding is not None:
            _model = Qwen3VLForEmbedding.from_pretrained(model_name, **model_kwargs)
        else:
            _model = AutoModel.from_pretrained(model_name, trust_remote_code=True, **model_kwargs)

        _model.to(_device)
        _model.eval()

        _current_model_name = model_name


def _safe_resize_image(image: Image.Image) -> Image.Image:
    """Resize so neither side exceeds IMAGE_MAX_SIDE, snapping to _IMAGE_PATCH_MULTIPLE."""
    w, h = image.size
    scale = min(_IMAGE_MAX_SIDE / w, _IMAGE_MAX_SIDE / h, 1.0)
    if scale < 1.0:
        new_w = max(_IMAGE_PATCH_MULTIPLE, round(w * scale / _IMAGE_PATCH_MULTIPLE) * _IMAGE_PATCH_MULTIPLE)
        new_h = max(_IMAGE_PATCH_MULTIPLE, round(h * scale / _IMAGE_PATCH_MULTIPLE) * _IMAGE_PATCH_MULTIPLE)
        image = image.resize((new_w, new_h), Image.LANCZOS)
    return image


def _decode_image(base64_value: str, filename: Optional[str] = None) -> Image.Image:
    fn = filename or "(unknown)"
    raw: Optional[bytes] = None
    try:
        raw = base64.b64decode(base64_value)
        img = Image.open(io.BytesIO(raw))
        return _safe_resize_image(img.convert("RGB"))
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


def _build_conversation(
    text: Optional[str] = None,
    image: Optional[Image.Image] = None,
    instruction: Optional[str] = None,
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    if image is not None:
        content.append({"type": "image", "image": image})
    if text is not None and text.strip():
        content.append({"type": "text", "text": text.strip()})
    if not content:
        content.append({"type": "text", "text": "NULL"})

    return [
        {
            "role": "system",
            "content": [{"type": "text", "text": (instruction or "Represent the user's input.").strip()}],
        },
        {"role": "user", "content": content},
    ]


def _prepare_inputs(conversation: list[dict[str, Any]]) -> dict[str, Any]:
    assert _processor is not None

    prompt = _processor.apply_chat_template(conversation, add_generation_prompt=True, tokenize=False)

    images = None
    videos = None
    video_metadata = None
    video_kwargs: dict[str, Any] = {"do_sample_frames": False}

    if process_vision_info is not None:
        try:
            images, video_inputs, video_kwargs = process_vision_info(
                conversation,
                image_patch_size=16,
                return_video_metadata=True,
                return_video_kwargs=True,
            )
            if video_inputs is not None:
                videos, video_metadata = zip(*video_inputs)
                videos = list(videos)
                video_metadata = list(video_metadata)
        except Exception:
            images = None
            videos = None
            video_metadata = None
            video_kwargs = {"do_sample_frames": False}

    inputs = _processor(
        text=prompt,
        images=images,
        videos=videos,
        video_metadata=video_metadata,
        truncation=True,
        max_length=_MAX_SEQ_LEN,
        padding=True,
        do_resize=False,
        return_tensors="pt",
        **video_kwargs,
    )
    return _maybe_to_device(inputs)


def _embed_from_conversation(conversation: list[dict[str, Any]]) -> list[float]:
    assert _model is not None

    with torch.inference_mode():
        inputs = _prepare_inputs(conversation)
        outputs = _model(**inputs)
        hidden_state = outputs.last_hidden_state
        attention_mask = inputs["attention_mask"]
        vec = _pool_last_hidden_state(hidden_state, attention_mask)
        return _l2_normalize(vec).detach().cpu().tolist()


def _embed_text(text: str, instruction: Optional[str] = None) -> list[float]:
    return _embed_from_conversation(_build_conversation(text=text, instruction=instruction))


def _embed_image(image: Image.Image) -> list[float]:
    return _embed_from_conversation(_build_conversation(image=image))


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    device = _device.type if _device is not None else _pick_device().type
    return HealthResponse(status="ok", device=device, model=_current_model_name)


@app.post("/embed", response_model=EmbedResponse)
def embed(payload: EmbedRequest) -> EmbedResponse:
    _load_model_if_needed(payload.model)

    if payload.type == "text":
        if not payload.text or not payload.text.strip():
            logger.warning("embed_reject_empty_text model=%s", payload.model)
            raise HTTPException(status_code=400, detail="text is required when type=text")
        embedding = _embed_text(payload.text.strip(), payload.instruction)
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
        image = _decode_image(payload.imageBase64, payload.filename)
        embedding = _embed_image(image)
        return EmbedResponse(embedding=embedding)

    raise HTTPException(status_code=400, detail="type must be text or image")


class ExtractRequest(BaseModel):
    type: str = Field(pattern="^(text|pdf)$")
    text: Optional[str] = None
    fileBase64: Optional[str] = None
    filename: Optional[str] = None


class ExtractResponse(BaseModel):
    text: Optional[str] = None
    error: Optional[str] = None


def _extract_text_from_pdf(base64_value: str) -> str:
    try:
        import PyPDF2
        raw = base64.b64decode(base64_value)
        pdf_file = io.BytesIO(raw)
        reader = PyPDF2.PdfReader(pdf_file)
        text = ''.join(page.extract_text() or '' for page in reader.pages)
        return text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF extraction failed: {e}")


@app.post("/extract", response_model=ExtractResponse)
def extract(payload: ExtractRequest) -> ExtractResponse:
    if payload.type == "text":
        if not payload.text:
            raise HTTPException(status_code=400, detail="text is required when type=text")
        return ExtractResponse(text=payload.text[:50000])

    if payload.type == "pdf":
        if not payload.fileBase64:
            raise HTTPException(status_code=400, detail="fileBase64 is required when type=pdf")
        text = _extract_text_from_pdf(payload.fileBase64)
        return ExtractResponse(text=text[:50000])

    raise HTTPException(status_code=400, detail="type must be text or pdf")
