#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v pnpm &>/dev/null; then
  echo "pnpm not found on PATH. Install pnpm and try again." >&2
  exit 1
fi

echo "[1/2] Installing app dependencies..."
pnpm --dir "$ROOT/app" install

echo "[2/2] Running Jina model setup..."
"$ROOT/setup-jina.sh" "$@"

echo "Setup complete."
