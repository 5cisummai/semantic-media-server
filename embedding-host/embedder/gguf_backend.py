"""GGUF embedding models via llama-cpp-python (text-only)."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("embedder")


def _llama_embedding_kwargs() -> dict[str, Any]:
    return {
        "embedding": True,
        "n_ctx": int(os.getenv("GGUF_N_CTX", "8192")),
        "n_gpu_layers": int(os.getenv("GGUF_N_GPU_LAYERS", "-1")),
        "n_threads": int(os.getenv("GGUF_N_THREADS", str(os.cpu_count() or 4))),
        "verbose": os.getenv("GGUF_VERBOSE", "").lower() in ("1", "true", "yes"),
    }


def load_gguf(model_ref: str) -> Any:
    """
    Load a GGUF embedding model.

    - Local file: path ending in ``.gguf`` → ``Llama(model_path=...)``.
    - Hugging Face repo id (e.g. ``.../Qwen...-GGUF``): ``Llama.from_pretrained(repo_id, filename=...)``
      when available; set ``GGUF_FILENAME`` to the quantized file (e.g. ``*.Q4_K_M.gguf``).
    """
    try:
        from llama_cpp import Llama
    except ImportError as e:
        raise RuntimeError(
            "llama-cpp-python is not installed. Install with: pip install llama-cpp-python"
        ) from e

    kw = _llama_embedding_kwargs()
    raw = model_ref.strip()
    path = os.path.expanduser(raw)

    # Local file only: ends with .gguf and/or path exists on disk (HF repo ids contain "/" too).
    if raw.lower().endswith(".gguf") or os.path.isfile(path):
        if not os.path.isfile(path):
            raise FileNotFoundError(f"GGUF model not found: {path}")
        logger.info(
            "loading_gguf path=%s n_ctx=%s n_gpu_layers=%s threads=%s",
            path,
            kw["n_ctx"],
            kw["n_gpu_layers"],
            kw["n_threads"],
        )
        return Llama(model_path=path, **kw)

    repo_id = os.getenv("GGUF_REPO_ID", "").strip() or raw
    filename = os.getenv("GGUF_FILENAME", "").strip()
    if not filename:
        filename = "Qwen.Qwen3-VL-Embedding-2B.Q4_K_M.gguf"

    from_pretrained = getattr(Llama, "from_pretrained", None)
    if from_pretrained is None:
        raise RuntimeError(
            "This llama-cpp-python build has no Llama.from_pretrained; "
            "upgrade llama-cpp-python, or download a .gguf file locally and pass its path as model."
        )

    logger.info(
        "loading_gguf from_pretrained repo_id=%s filename=%s n_ctx=%s n_gpu_layers=%s threads=%s",
        repo_id,
        filename,
        kw["n_ctx"],
        kw["n_gpu_layers"],
        kw["n_threads"],
    )
    return from_pretrained(repo_id=repo_id, filename=filename, **kw)


def embed_text(llm: Any, text: str) -> list[float]:
    """Return L2-normalized embedding vector."""
    # llama-cpp-python: prefer embed(); fall back to create_embedding (OpenAI-style).
    if hasattr(llm, "embed"):
        raw = llm.embed(text)
        vec = _flatten_embedding(raw)
    elif hasattr(llm, "create_embedding"):
        out = llm.create_embedding(text)
        vec = _from_openai_style_embedding(out)
    else:
        raise RuntimeError("llama-cpp-python Llama instance has neither embed() nor create_embedding()")

    return _l2_normalize_list(vec)


def _from_openai_style_embedding(out: Any) -> list[float]:
    if isinstance(out, dict) and "data" in out:
        return list(out["data"][0]["embedding"])
    raise RuntimeError(f"Unexpected create_embedding() return type: {type(out)}")


def _flatten_embedding(raw: Any) -> list[float]:
    if isinstance(raw, list):
        if not raw:
            return []
        if isinstance(raw[0], (int, float)):
            return [float(x) for x in raw]
        if isinstance(raw[0], list):
            return [float(x) for x in raw[0]]
    raise RuntimeError(f"Unexpected embed() return type: {type(raw)}")


def _l2_normalize_list(vec: list[float]) -> list[float]:
    import math

    if not vec:
        return vec
    s = math.sqrt(sum(x * x for x in vec))
    if s == 0:
        return vec
    return [x / s for x in vec]
