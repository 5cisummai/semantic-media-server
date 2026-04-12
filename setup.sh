#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

REQ="${ROOT}/embedding-host/requirements.txt"
if [[ ! -f "$REQ" ]]; then
  echo "Missing requirements file: $REQ" >&2
  exit 1
fi

if ! command -v python3.11 &>/dev/null; then
  echo "python3.11 not found on PATH. Install Python 3.11 and try again." >&2
  exit 1
fi

VENV="${ROOT}/.venv"
if [[ ! -x "${VENV}/bin/python" ]]; then
  python3.11 -m venv "${VENV}"
fi

# shellcheck source=/dev/null
source "${VENV}/bin/activate"
python -m pip install --upgrade pip
pip install -r "${REQ}"

echo "Done. Virtual environment: ${VENV}"
