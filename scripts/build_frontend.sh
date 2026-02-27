#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/frontend"

if command -v pnpm >/dev/null 2>&1; then
  pnpm install
  pnpm run build
else
  npm install
  npm run build
fi
