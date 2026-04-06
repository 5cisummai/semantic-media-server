#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/app"
EMBED_DIR="$ROOT_DIR/embedding-host"
EMBED_VENV_DIR="$EMBED_DIR/.venv"

need_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Error: required command '$1' not found in PATH."
		exit 1
	fi
}

need_cmd pnpm
need_cmd python3

if [[ ! -d "$EMBED_VENV_DIR" ]]; then
	echo "Error: embedding venv not found at $EMBED_VENV_DIR"
	echo "Run ./setup.sh first."
	exit 1
fi

cleanup() {
	echo ""
	echo "[run] Shutting down services..."
	if [[ -n "${EMBED_PID:-}" ]] && kill -0 "$EMBED_PID" 2>/dev/null; then
		kill "$EMBED_PID" 2>/dev/null || true
	fi
}

trap cleanup EXIT INT TERM

echo "[run] Starting embedding host on http://127.0.0.1:8000 ..."
cd "$EMBED_DIR"
# shellcheck disable=SC1091
source "$EMBED_VENV_DIR/bin/activate"
python -m uvicorn app:app --host 127.0.0.1 --port 8000 &
EMBED_PID=$!

# Let the embedding service fail fast if startup is broken.
sleep 1
if ! kill -0 "$EMBED_PID" 2>/dev/null; then
	echo "Error: embedding host failed to start."
	exit 1
fi

echo "[run] Starting app dev server..."
cd "$APP_DIR"
pnpm run preview --host
