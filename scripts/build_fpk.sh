#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

"$ROOT_DIR/scripts/build_frontend.sh"
"$ROOT_DIR/scripts/prepare_context.sh"

if ! command -v fnpack >/dev/null 2>&1; then
  echo "fnpack not found. install first: appcenter-cli fnpack install"
  exit 1
fi

fnpack build
