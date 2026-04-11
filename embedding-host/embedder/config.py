"""Runtime configuration from environment."""

import os

# GGUF (llama-cpp-python), see embedder/gguf_backend.py:
#   GGUF_FILENAME, GGUF_REPO_ID, GGUF_N_CTX, GGUF_N_GPU_LAYERS, GGUF_N_THREADS, GGUF_VERBOSE

# Used when decoding image payloads (image embedding returns 400; ingest may still send images).
IMAGE_MAX_SIDE: int = int(os.getenv("IMAGE_MAX_SIDE", "448"))
IMAGE_PATCH_MULTIPLE: int = 16
