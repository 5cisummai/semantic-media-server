# Media server

Monorepo-style media library with a **SvelteKit** web app, **semantic search** (PostgreSQL + Qdrant), optional **LLM** features, and a local **Python embedding service** for GGUF-based text embeddings.

## What’s in the repo

| Path | Role |
|------|------|
| `app/` | SvelteKit + Vite UI and API (`pnpm`) |
| `embedding-host/` | FastAPI + `llama-cpp-python` embedding server (`uvicorn`) |
| `docker-compose.yml` | PostgreSQL 16 and Qdrant for local dev |

Helper scripts live at the **repository root**:

| Script | Purpose |
|--------|---------|
| `setup.sh` / `setup.ps1` | Create a **Python 3.11** virtualenv at `.venv/` and `pip install -r embedding-host/requirements.txt` |
| `startup.sh` / `startup.ps1` | Start Docker services, the SvelteKit app, and the embedding server |

## Prerequisites

- **Node.js** and **pnpm** (for `app/`)
- **Python 3.11** on `PATH` (`python3.11`, or on Windows the `py` launcher with `py -3.11`)
- **Docker** with Compose (for Postgres and Qdrant)

## First-time setup

1. **Install JS dependencies** (from `app/`):

   ```bash
   cd app && pnpm install && cd ..
   ```

2. **Python environment** (from repo root — creates `.venv` at the root, not under `embedding-host/`):

   ```bash
   ./setup.sh
   ```

   Windows (PowerShell):

   ```powershell
   .\setup.ps1
   ```

3. **Environment files**

   - **App:** copy `app/.env.example` to `app/.env` and set at least `MEDIA_ROOTS`, `DATABASE_URL`, and the Qdrant / embedding variables you need. See [App environment](#app-environment) below.
   - **Embedding host:** copy `embedding-host/.env.example` to `embedding-host/.env` and set `GGUF_FILENAME` (and any optional GPU/thread settings).

4. **Database** (after Postgres is running, e.g. via `startup` or `docker compose up -d`):

   ```bash
   cd app && pnpm db:migrate
   ```

## Run everything

From the **repository root**:

```bash
./startup.sh          # dev: pnpm dev --host
./startup.sh preview  # pnpm build && pnpm preview --host
```

Windows:

```powershell
.\startup.ps1
.\startup.ps1 preview
```

This will:

1. Run `docker compose up -d` (**Postgres** on `5432`, **Qdrant** on `6333` / `6334`).
2. Start the **SvelteKit** app in `app/` (dev or preview, with `--host`).
3. Start the **embedding** API from `embedding-host/` using the root `.venv` (default: `http://127.0.0.1:8000`).

Default Postgres (from Compose): user `mediaserver`, password `mediaserver`, database `mediaserver` — matches `app/.env.example`.

## Docker services

Defined in `docker-compose.yml`:

- **postgres** — `postgres:16-alpine`, port `5432`
- **qdrant** — `qdrant/qdrant`, ports `6333` and `6334`

Stop containers: `docker compose down` from the repo root.

## Embedding service (`embedding-host`)

Local **text** embedding over GGUF (`llama-cpp-python`). Image requests are not supported by this backend (expect 400 for image-only flows).

### HTTP API

- **`POST /embed`** — body JSON:
  - Text: `{ "model": "<HF repo or local .gguf path>", "type": "text", "text": "..." }`
  - Response: `{ "embedding": [ ... ] }`
- **`GET /health`** — health check

Example:

```bash
curl http://127.0.0.1:8000/health
```

```bash
curl -X POST http://127.0.0.1:8000/embed \
  -H "Content-Type: application/json" \
  -d '{"model":"DevQuasar/Qwen.Qwen3-VL-Embedding-2B-GGUF","type":"text","text":"sunset over ocean"}'
```

If models are downloaded from Hugging Face, you may need:

```bash
export HF_TOKEN=your_hf_token
```

### Config

See `embedding-host/.env` (from `.env.example`): `GGUF_FILENAME`, optional `GGUF_REPO_ID`, `GGUF_N_CTX`, `GGUF_N_GPU_LAYERS`, `GGUF_N_THREADS`.

Run manually (after activating `.venv` or using root `.venv`):

```bash
cd embedding-host
source ../.venv/bin/activate   # Unix
uvicorn app:app --host 127.0.0.1 --port 8000
```

## Web app (`app`)

SvelteKit + Vite + Tailwind + Prisma. Common commands (run inside `app/`):

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm preview` | Production build and preview |
| `pnpm db:migrate` | Prisma migrations |
| `pnpm check` / `pnpm lint` | Typecheck and lint |

### App environment

Copy `app/.env.example` to `app/.env`. Important groups:

- **Media:** `MEDIA_ROOTS`, upload/body limits, `PORT`
- **Database:** `DATABASE_URL` (PostgreSQL)
- **Semantic search:** `QDRANT_URL`, `QDRANT_API_KEY` or `QDRANT_BEARER_TOKEN`, collections, `EMBEDDING_PROVIDER`, `MULTIMODAL_EMBEDDING_URL`, `MULTIMODAL_EMBEDDING_MODEL`
- **LLM (optional):** `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, etc.
- **Auth:** `JWT_SECRET`

Example alignment with the local embedding server:

```env
EMBEDDING_PROVIDER=multimodal
MULTIMODAL_EMBEDDING_URL=http://127.0.0.1:8000/embed
MULTIMODAL_EMBEDDING_MODEL=DevQuasar/Qwen.Qwen3-VL-Embedding-2B-GGUF
```

(Adjust model string to match what your embedding host and app expect.)

### Search API (high level)

- `POST /api/search/reindex` — full reindex of configured media roots
- `GET /api/search?q=...` — semantic search with optional `mediaType`, `root`, `limit`

Incremental indexing also runs after successful uploads where applicable.

Optional providers for embeddings or LLM are documented in `app/.env.example` (e.g. Ollama, OpenAI-compatible).
