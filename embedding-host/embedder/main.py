"""FastAPI application entry."""

from pathlib import Path

from fastapi import FastAPI

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from embedder.routes import router

app = FastAPI(title="GGUF Embedding Host", version="1.0.0")
app.include_router(router)
