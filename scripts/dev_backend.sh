#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

cd "$BACKEND_DIR"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python -m pip install -r requirements.txt

export APP_ENV=development
export SETTINGS_FILE="$BACKEND_DIR/.runtime/config/settings.development.json"
export STATE_DIR="$BACKEND_DIR/.runtime/state"
export DOWNLOAD_PATH="$BACKEND_DIR/.runtime/downloads"

mkdir -p "$BACKEND_DIR/.runtime/config" "$BACKEND_DIR/.runtime/state" "$BACKEND_DIR/.runtime/downloads"

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
