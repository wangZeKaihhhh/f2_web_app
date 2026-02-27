#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

cd "$FRONTEND_DIR"

if command -v pnpm >/dev/null 2>&1; then
  pnpm install
  pnpm run dev --host 0.0.0.0 --port 5173
else
  npm install
  npm run dev -- --host 0.0.0.0 --port 5173
fi
