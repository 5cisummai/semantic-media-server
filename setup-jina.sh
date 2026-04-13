#!/usr/bin/env bash
# setup-jina.sh — One-time setup for jina-embeddings-v4 local multimodal embeddings.
#
# Documentation (read this first):
#   • Base model (architecture, tasks, Python API): https://huggingface.co/jinaai/jina-embeddings-v4
#   • GGUF builds for llama.cpp (this script downloads from here):
#       https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF
#     The main jina-embeddings-v4 repo ships Safetensors only; GGUF + mmproj for llama-server
#     are published as separate “-GGUF” repos per Jina’s docs.
#
# What this does:
#   1. Clones and builds the Jina AI llama.cpp fork (multimodal embedding support)
#   2. Downloads retrieval Q4_K_M GGUF + vision mmproj from the text-retrieval-GGUF repo
#
# Requirements:
#   - git, cmake, make (or ninja), a C++17 compiler
#   - Hugging Face Hub CLI: `hf` (recommended — curl -LsSf https://hf.co/cli/install.sh | bash)
#     or legacy `huggingface-cli` (pip install 'huggingface_hub[cli]')
#   - ~3.5 GB free disk space for model files (Q4_K_M + mmproj)
#
# Usage:
#   ./setup-jina.sh [--models-dir /path/to/models] [--skip-build] [--skip-download]
#
# Env (optional):
#   JINA_HF_REPO — Hugging Face repo id for GGUF downloads (default: jinaai/jina-embeddings-v4-text-retrieval-GGUF)
#   EMBEDDING_MODEL_DIR, EMBEDDING_GGUF_FILENAME, EMBEDDING_MMPROJ_FILENAME, CMAKE_EXTRA_ARGS
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- configurable defaults ----------
JINA_REPO_URL="https://github.com/jina-ai/llama.cpp"
JINA_BUILD_DIR="$ROOT/jina-llama.cpp"

# GGUF weights: NOT the base Safetensors repo — use the retrieval + multimodal GGUF collection
# (see https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF )
JINA_HF_REPO="${JINA_HF_REPO:-jinaai/jina-embeddings-v4-text-retrieval-GGUF}"
MODEL_DIR="${EMBEDDING_MODEL_DIR:-$ROOT/models}"
# Exact names from the repo file list — see “Files” on:
#   https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF/tree/main
MODEL_GGUF="${EMBEDDING_GGUF_FILENAME:-jina-embeddings-v4-text-retrieval-Q4_K_M.gguf}"
MMPROJ_GGUF="${EMBEDDING_MMPROJ_FILENAME:-mmproj-jina-embeddings-v4-retrieval-BF16.gguf}"

SKIP_BUILD=false
SKIP_DOWNLOAD=false

# ---------- argument parsing ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --models-dir)   MODEL_DIR="$2"; shift 2 ;;
    --skip-build)   SKIP_BUILD=true; shift ;;
    --skip-download) SKIP_DOWNLOAD=true; shift ;;
    -h|--help)
      sed -n '/^# /p' "$0" | sed 's/^# //'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

echo "=================================================="
echo " jina-embeddings-v4 local setup (llama.cpp + GGUF)"
echo "=================================================="
echo " Base model card : https://huggingface.co/jinaai/jina-embeddings-v4"
echo " GGUF repo (HF)  : $JINA_HF_REPO"
echo " Build dir       : $JINA_BUILD_DIR"
echo " Models dir      : $MODEL_DIR"
echo " Model GGUF      : $MODEL_GGUF"
echo " MmProj          : $MMPROJ_GGUF"
echo "=================================================="

# ---------- 1. Clone & build Jina llama.cpp fork ----------
if [[ "$SKIP_BUILD" == "false" ]]; then
  if [[ -d "$JINA_BUILD_DIR/.git" ]]; then
    echo ""
    echo "[1/2] Updating existing Jina llama.cpp clone..."
    git -C "$JINA_BUILD_DIR" pull --ff-only
  else
    echo ""
    echo "[1/2] Cloning Jina llama.cpp fork..."
    git clone --depth 1 "$JINA_REPO_URL" "$JINA_BUILD_DIR"
  fi

  echo "Building llama-server (Release, no GPU layers by default)..."
  cmake \
    -S "$JINA_BUILD_DIR" \
    -B "$JINA_BUILD_DIR/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=ON \
    -DLLAMA_CURL=OFF \
    ${CMAKE_EXTRA_ARGS:-}

  cmake --build "$JINA_BUILD_DIR/build" --config Release -j "$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)" --target llama-server

  echo "Build complete: $JINA_BUILD_DIR/build/bin/llama-server"
else
  echo "[1/2] Skipping build (--skip-build)."
fi

# ---------- resolve Hugging Face CLI (hf replaces deprecated huggingface-cli) ----------
resolve_hf_cli() {
  if command -v hf &>/dev/null; then
    echo hf
  elif command -v huggingface-cli &>/dev/null; then
    echo huggingface-cli
  else
    return 1
  fi
}

hf_download() {
  # Args: repo_id filename
  local repo_id="$1"
  local filename="$2"
  if [[ "$HF_CLI" == "hf" ]]; then
    hf download "$repo_id" "$filename" --local-dir "$MODEL_DIR"
  else
    huggingface-cli download "$repo_id" "$filename" \
      --local-dir "$MODEL_DIR" \
      --local-dir-use-symlinks False
  fi
}

# ---------- 2. Download model files ----------
if [[ "$SKIP_DOWNLOAD" == "false" ]]; then
  echo ""
  echo "[2/2] Downloading GGUF files from Hugging Face ($JINA_HF_REPO)..."

  if ! HF_CLI="$(resolve_hf_cli)"; then
    echo "ERROR: Neither \`hf\` nor \`huggingface-cli\` found on PATH." >&2
    echo "Install the Hub CLI:  curl -LsSf https://hf.co/cli/install.sh | bash" >&2
    echo "Or (legacy):          pip install 'huggingface_hub[cli]'" >&2
    exit 1
  fi
  echo "Using: $HF_CLI"

  mkdir -p "$MODEL_DIR"

  hf_download "$JINA_HF_REPO" "$MODEL_GGUF"
  hf_download "$JINA_HF_REPO" "$MMPROJ_GGUF"

  echo "Model files downloaded to: $MODEL_DIR"
else
  echo "[2/2] Skipping download (--skip-download)."
fi

# ---------- done ----------
echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Copy app/.env.example to app/.env — defaults match the official model id"
echo "     https://huggingface.co/jinaai/jina-embeddings-v4"
echo "     Key variables:"
echo "       EMBEDDING_PROVIDER=multimodal"
echo "       MULTIMODAL_EMBEDDING_URL=http://127.0.0.1:8080/embeddings"
echo "       MULTIMODAL_EMBEDDING_MODEL=jina-embeddings-v4"
echo "       SEMANTIC_IMAGE_EMBEDDING=true"
echo ""
echo "  2. Start the server with:  ./startup.sh dev"
echo ""
echo "  Other GGUF variants (same repo): IQ3_S, Q5_K_M, F16, etc. — set"
echo "    EMBEDDING_GGUF_FILENAME / EMBEDDING_MMPROJ_FILENAME"
echo "  to match filenames listed on:"
echo "    https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF/tree/main"
