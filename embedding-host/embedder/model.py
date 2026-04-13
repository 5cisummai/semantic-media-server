"""GGUF inference via llama-cpp-python."""

from __future__ import annotations

import threading
from typing import Any, Optional

_model_lock = threading.Lock()

_active_backend: str = "gguf"
_current_model_name: Optional[str] = None
_gguf_llm: Any = None


def _unload_all() -> None:
    global _gguf_llm, _current_model_name
    if _gguf_llm is not None:
        del _gguf_llm
    _gguf_llm = None
    _current_model_name = None
    import gc

    gc.collect()


def load_model_if_needed(model_name: str, backend: str = "gguf") -> None:
    """Load the requested GGUF model if not already active (thread-safe). ``backend`` is accepted for API compatibility and ignored."""
    global _current_model_name, _gguf_llm

    _ = backend  # only gguf is supported

    if _current_model_name == model_name and _gguf_llm is not None:
        return

    with _model_lock:
        if _current_model_name == model_name and _gguf_llm is not None:
            return

        _unload_all()

        from embedder import gguf_backend

        _gguf_llm = gguf_backend.load_gguf(model_name)
        _current_model_name = model_name


def health_device_string() -> str:
    return "gguf"
