#!/usr/bin/env bash
set -euo pipefail

# Repo root (where this script lives)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Load env file if exists
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi

usage() {
  echo "Usage: $0 {dev|preview}" >&2
  echo "  dev     — pnpm dev --host" >&2
  echo "  preview — pnpm build && pnpm preview --host" >&2
}

MODE="${1:-dev}"
case "$MODE" in
  dev | preview) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 1
    ;;
esac

# Postgres + Qdrant — start first so services are up before the apps connect
docker compose up -d

cleanup() {
  kill $(jobs -p) 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Find llama-server — prefer the Jina fork build, then generic llama.cpp, then PATH
find_llama_server() {
  local candidates=(
    "$ROOT/jina-llama.cpp/build/bin/llama-server"
    "$ROOT/llama.cpp/build/bin/llama-server"
    "$HOME/code/jina-llama.cpp/build/bin/llama-server"
    "$HOME/code/llama.cpp/build/bin/llama-server"
    "$(which llama-server 2>/dev/null || true)"
  )
  for cmd in "${candidates[@]}"; do
    if [[ -x "$cmd" ]]; then
      echo "$cmd"
      return 0
    fi
  done
  echo "llama-server"  # fallback to PATH
}

LLAMA_SERVER=$(find_llama_server)

# Model configuration (from env or defaults)
MODEL_DIR="${EMBEDDING_MODEL_DIR:-$ROOT/models}"
# Defaults match https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF/tree/main
MODEL_GGUF="${MODEL_DIR}/${EMBEDDING_GGUF_FILENAME:-jina-embeddings-v4-text-retrieval-Q4_K_M.gguf}"
MMPROJ_GGUF="${MODEL_DIR}/${EMBEDDING_MMPROJ_FILENAME:-mmproj-jina-embeddings-v4-retrieval-BF16.gguf}"

echo "llama-server: $LLAMA_SERVER"
echo "Model:  $MODEL_GGUF"
echo "Mmproj: $MMPROJ_GGUF"

# Start llama-server for multimodal embeddings (requires Jina fork + model files)
if [[ -f "$MODEL_GGUF" && -f "$MMPROJ_GGUF" ]]; then
  echo "Starting llama-server with jina-embeddings-v4 multimodal embeddings..."
  # --pooling none: Jina fork rejects mean pooling for embedding tasks; app mean-pools token vectors
  "$LLAMA_SERVER" \
    -m "$MODEL_GGUF" \
    --mmproj "$MMPROJ_GGUF" \
    --embedding \
    --pooling none \
    -c 8192 \
    -ub 8192 \
    -np 1 \
    --port 8080 &
  export MULTIMODAL_EMBEDDING_URL="http://127.0.0.1:8080/embeddings"
else
  echo ""
  echo "ERROR: Jina model files not found."
  echo "  Expected: $MODEL_GGUF"
  echo "  Expected: $MMPROJ_GGUF"
  echo ""
  echo "Run ./setup-jina.sh to build the Jina llama.cpp fork and download model files."
  echo "Then re-run this script."
  echo ""
  echo "Continuing without embedding server — search will be unavailable."
fi

echo "Embedding URL: ${MULTIMODAL_EMBEDDING_URL:-not started}"

(
  cd "$ROOT/app"
  if [[ "$MODE" == "dev" ]]; then
    pnpm dev --host
  else
    pnpm build && pnpm preview --host
  fi
) &

wait
