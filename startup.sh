#!/usr/bin/env bash
set -euo pipefail

# Repo root (where this script lives)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

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

(
  cd "$ROOT/app"
  if [[ "$MODE" == "dev" ]]; then
    pnpm dev --host
  else
    pnpm build && pnpm preview --host
  fi
) &

(
  cd "$ROOT/embedding-host"
  if [[ -f "$ROOT/.venv/bin/activate" ]]; then
    # shellcheck source=/dev/null
    source "$ROOT/.venv/bin/activate"
  fi
  uvicorn app:app --host 127.0.0.1 --port 8000
) &

wait
