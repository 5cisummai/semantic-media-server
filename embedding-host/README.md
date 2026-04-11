# Embedding Host (GGUF)

Local text embedding endpoint (`llama-cpp-python`). Image requests return 400 (text-only GGUF).

## API Contract

- `POST /embed`
- Request JSON:
  - Text: `{ "model": "<HF repo or local .gguf path>", "type": "text", "text": "..." }`
  - Image: not supported with this backend (400).
- Response JSON:
  - `{ "embedding": [0.1, 0.2, ...] }`

## Setup

1. Create and activate virtual environment:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Configure `.env` (see `.env.example`): set `GGUF_FILENAME` to the quantized file in the repo.

4. Optional Hugging Face auth token (if needed for download):

```bash
export HF_TOKEN=your_hf_token
```

5. Run server:

```bash
uvicorn app:app --host 127.0.0.1 --port 8000
```

6. Health check:

```bash
curl http://127.0.0.1:8000/health
```

## Test Requests

Text embedding:

```bash
curl -X POST http://127.0.0.1:8000/embed \
  -H "Content-Type: application/json" \
  -d '{"model":"DevQuasar/Qwen.Qwen3-VL-Embedding-2B-GGUF","type":"text","text":"sunset over ocean"}'
```

## App Integration

In your main app `.env`:

```env
EMBEDDING_PROVIDER=multimodal
MULTIMODAL_EMBEDDING_URL=http://127.0.0.1:8000/embed
MULTIMODAL_EMBEDDING_MODEL=DevQuasar/Qwen.Qwen3-VL-Embedding-2B-GGUF
```
