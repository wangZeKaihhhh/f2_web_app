#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
SERVER_DIR="$APP_DIR/server"
FRONTEND_DIST_DIR="$APP_DIR/frontend_dist"

if [ ! -d "$ROOT_DIR/frontend/dist" ]; then
  echo "frontend dist not found, please run scripts/build_frontend.sh first"
  exit 1
fi

rm -rf "$SERVER_DIR" "$FRONTEND_DIST_DIR"
mkdir -p "$SERVER_DIR" "$FRONTEND_DIST_DIR"

cp -R "$ROOT_DIR/backend/app" "$SERVER_DIR/"
cp "$ROOT_DIR/backend/requirements.txt" "$SERVER_DIR/requirements.txt"
cp -R "$ROOT_DIR/frontend/dist/." "$FRONTEND_DIST_DIR/"

find "$SERVER_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} +
