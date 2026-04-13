"""Compatibility shim: `uvicorn app:app` from the embedding-host directory."""

from embedder.main import app

__all__ = ["app"]
