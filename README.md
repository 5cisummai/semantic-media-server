# Media server

Monorepo-style media library with a **SvelteKit** web app, **semantic search** (PostgreSQL + Qdrant), optional **LLM** features, and **local multimodal embeddings** via [jina-embeddings-v4](https://huggingface.co/jinaai/jina-embeddings-v4) running on Jina's custom [llama.cpp fork](https://github.com/jina-ai/llama.cpp).

## What's in the repo

| Path | Role |
|------|------|
| `app/` | SvelteKit + Vite UI and API (`pnpm`) |
| `docker-compose.yml` | PostgreSQL 16 and Qdrant for local dev |

Helper scripts at the **repository root**:

| Script | Purpose |
|--------|---------|
| `setup-jina.sh` | Build the Jina llama.cpp fork and download model GGUF files |
| `startup.sh` / `startup.ps1` | Start Docker services, llama-server, and the SvelteKit app |

---

## First-time setup

### 1. Install JS dependencies

```bash
cd app && pnpm install && cd ..
```

### 2. Build the Jina llama.cpp fork and download models

```bash
./setup-jina.sh
```

This will:

- Clone `https://github.com/jina-ai/llama.cpp` into `jina-llama.cpp/`
- Build `llama-server` (Release, CPU by default — see [GPU builds](#gpu-acceleration))
- Download **retrieval** GGUF + vision mmproj from **[jinaai/jina-embeddings-v4-text-retrieval-GGUF](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF)** into `models/` (defaults: `jina-embeddings-v4-text-retrieval-Q4_K_M.gguf` and `mmproj-jina-embeddings-v4-retrieval-BF16.gguf`)

**Why not the main model repo?** The canonical model card and Python API live at **[jinaai/jina-embeddings-v4](https://huggingface.co/jinaai/jina-embeddings-v4)** (Safetensors / transformers). **GGUF builds for llama.cpp** are published in separate `-GGUF` repos; for retrieval + multimodal (image) embeddings, Jina documents **[jinaai/jina-embeddings-v4-text-retrieval-GGUF](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF)** — see the README there and the [multimodal llama.cpp walkthrough](https://jina.ai/news/multimodal-embeddings-in-llama-cpp-and-gguf/).

Requirements:

- `git`, `cmake`, `make` (or `ninja`), a C++17 compiler (`gcc`/`clang`/MSVC)
- **`hf`** (recommended) — install via [https://hf.co/cli](https://hf.co/cli) (`curl -LsSf https://hf.co/cli/install.sh | bash`), or legacy **`huggingface-cli`** with `pip install 'huggingface_hub[cli]'` — `setup-jina.sh` accepts either
- ~3.5 GB free disk for the default Q4_K_M + mmproj pair

> **Other quantizations / filenames**: See the [Files](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF/tree/main) tab on the GGUF repo. Override before `./setup-jina.sh`:
>
> ```bash
> EMBEDDING_GGUF_FILENAME=jina-embeddings-v4-text-retrieval-Q4_K_M.gguf \
> EMBEDDING_MMPROJ_FILENAME=mmproj-jina-embeddings-v4-retrieval-BF16.gguf \
> ./setup-jina.sh
> ```
>
> Other task-specific GGUF collections (text-only, no images): [text-code-GGUF](https://huggingface.co/jinaai/jina-embeddings-v4-text-code-GGUF), [text-matching-GGUF](https://huggingface.co/jinaai/jina-embeddings-v4-text-matching-GGUF) — see the [base model card](https://huggingface.co/jinaai/jina-embeddings-v4).

### 3. Configure the app

```bash
cp app/.env.example app/.env
```

Edit `app/.env` — set at minimum `MEDIA_ROOTS`, `JWT_SECRET`, and `DATABASE_URL`. The embedding section defaults are already configured for Jina:

```env
EMBEDDING_PROVIDER=multimodal
MULTIMODAL_EMBEDDING_URL=http://127.0.0.1:8080/embeddings
MULTIMODAL_EMBEDDING_MODEL=jina-embeddings-v4
SEMANTIC_IMAGE_EMBEDDING=true
```

### 4. Run database migrations

After Postgres is running (e.g. via `./startup.sh` or `docker compose up -d`):

```bash
cd app && pnpm db:migrate
```

---

## Run everything

From the **repository root**:

```bash
./startup.sh          # dev:     pnpm dev --host
./startup.sh preview  # preview: pnpm build && pnpm preview --host
```

Windows:

```powershell
.\startup.ps1
.\startup.ps1 preview
```

`startup.sh` will:

1. `docker compose up -d` — **Postgres** on `5432`, **Qdrant** on `6333`/`6334`
2. **llama-server** — Jina fork, retrieval Q4_K_M + mmproj, `--pooling none` (required by the fork; the app mean-pools token embeddings), `-ub 8192`, port `8080`
3. **SvelteKit** dev/preview app with `--host`

---

## Embedding: jina-embeddings-v4 via llama-server

Official documentation: **[jinaai/jina-embeddings-v4](https://huggingface.co/jinaai/jina-embeddings-v4)** (model card, tasks, dimensions, Matryoshka truncation). This app uses Jina’s **custom llama.cpp fork** for **local** inference; multimodal image embeddings are not in upstream llama.cpp — see [Multimodal embeddings in llama.cpp and GGUF](https://jina.ai/news/multimodal-embeddings-in-llama-cpp-and-gguf/).

The app calls **`POST /embeddings`** (legacy handler) with JSON `content` plus optional `image`, then **mean-pools** token vectors client-side. The Jina fork does not allow `--pooling mean` on the server for embedding tasks; use `--pooling none` and pool in the client (see [GGUF README](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF) for `curl` examples that assume a different server build).

### Text inputs

For the **retrieval** task, inputs must use the `Query:` / `Passage:` prefixes — see the [consistency table](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF#remarks) in the GGUF repo README. This app applies them automatically:

- **Search queries** → `"Query: <text>"`
- **Indexed documents/chunks** → `"Passage: <text>"`

Dense single-vector size is **2048** by default ([model card](https://huggingface.co/jinaai/jina-embeddings-v4)); Matryoshka truncation (128–2048) is optional if you extend the pipeline later.

### Image inputs

Jina’s **non-OAI** `/embeddings` handler expects **`content`** (text) plus optional **`image`** as a data URI.

```json
{
  "model": "jina-embeddings-v4",
  "content": "Describe the image.",
  "image": "data:image/jpeg;base64,..."
}
```

Override the default image-only prompt with `MULTIMODAL_IMAGE_PROMPT` in `app/.env` if needed.

Enable image embedding:

```env
SEMANTIC_IMAGE_EMBEDDING=true
```

### Starting llama-server manually

Filenames match the [text-retrieval-GGUF file list](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF/tree/main):

```bash
./jina-llama.cpp/build/bin/llama-server \
  -m models/jina-embeddings-v4-text-retrieval-Q4_K_M.gguf \
  --mmproj models/mmproj-jina-embeddings-v4-retrieval-BF16.gguf \
  --embedding \
  --pooling none \
  -c 8192 \
  -ub 8192 \
  -np 1 \
  --port 8080
```

You can also pull models with the Hub shorthand (upstream build only if it supports `-hf`): `llama-server -hf jinaai/jina-embeddings-v4-text-retrieval-GGUF:Q4_K_M ...` — see the [GGUF README](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF).

### GPU acceleration

`setup-jina.sh` builds CPU-only by default. Pass CMake flags via `CMAKE_EXTRA_ARGS` for GPU:

```bash
# CUDA (NVIDIA)
CMAKE_EXTRA_ARGS="-DGGML_CUDA=ON" ./setup-jina.sh --skip-download

# Metal (Apple Silicon)
CMAKE_EXTRA_ARGS="-DGGML_METAL=ON" ./setup-jina.sh --skip-download
```

Then run `llama-server` with `-ngl` (number of layers on GPU) as appropriate for your machine — see [llama.cpp install](https://github.com/ggml-org/llama.cpp/blob/master/docs/install.md).

---

## Docker services

Defined in `docker-compose.yml`:

- **postgres** — `postgres:16-alpine`, port `5432`
- **qdrant** — `qdrant/qdrant`, ports `6333` and `6334`

Stop: `docker compose down`

---

## Web app (`app`)

SvelteKit + Vite + Tailwind + Prisma. Common commands (run inside `app/`):

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm preview` | Production build and preview |
| `pnpm db:migrate` | Prisma migrations |
| `pnpm check` / `pnpm lint` | Typecheck and lint |

### App environment

Copy `app/.env.example` to `app/.env`. Key groups:

- **Media:** `MEDIA_ROOTS`, upload/body limits, `PORT`
- **Database:** `DATABASE_URL` (PostgreSQL)
- **Embeddings:** `EMBEDDING_PROVIDER`, `MULTIMODAL_EMBEDDING_URL`, `MULTIMODAL_EMBEDDING_MODEL`, `SEMANTIC_IMAGE_EMBEDDING`
- **Alternative providers:** `OLLAMA_BASE_URL` / `OLLAMA_EMBED_MODEL` (Ollama), `OPENAI_BASE_URL` / `OPENAI_EMBED_MODEL` (OpenAI-compatible)
- **LLM (optional):** `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, etc.
- **Auth:** `JWT_SECRET`

### Search API

- `POST /api/search/reindex` — full reindex of configured media roots
- `GET /api/search?q=...` — semantic search with optional `mediaType`, `root`, `limit`, `minScore`

---

## Why the Jina fork?

Upstream `ggml-org/llama.cpp` does not support image embeddings via the `/v1/embeddings` endpoint. The Jina fork patches in multimodal embedding support using `--mmproj`, allowing text and images to be embedded into a **unified vector space**. Quantized GGUF (e.g. Q4_K_M) keeps weights small; peak RAM depends on context and batch — see the [quantization tables](https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF) on the GGUF repo.

Do **not** use:

- `ggml-org/llama.cpp` — will throw "image embeddings not supported"
- `llama-cpp-python` — wraps upstream, same limitation
- HuggingFace Transformers bf16 path — ~8+ GB VRAM
- Any cloud API — this setup is fully local
