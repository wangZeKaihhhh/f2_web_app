#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CTX_DIR="$ROOT_DIR/app/docker/context"

if [ ! -d "$ROOT_DIR/frontend/dist" ]; then
  echo "frontend dist not found, please run scripts/build_frontend.sh first"
  exit 1
fi

rm -rf "$CTX_DIR/backend" "$CTX_DIR/frontend_dist"
mkdir -p "$CTX_DIR/backend" "$CTX_DIR/frontend_dist"

cp -R "$ROOT_DIR/backend/app" "$CTX_DIR/backend/"
cp "$ROOT_DIR/backend/requirements.txt" "$CTX_DIR/backend/requirements.txt"
cp -R "$ROOT_DIR/frontend/dist/." "$CTX_DIR/frontend_dist/"

find "$CTX_DIR/backend" -type d -name '__pycache__' -prune -exec rm -rf {} +
