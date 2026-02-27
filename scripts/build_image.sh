#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT_DIR/scripts/build_frontend.sh"
"$ROOT_DIR/scripts/prepare_context.sh"

docker build -f "$ROOT_DIR/app/docker/Dockerfile" "$ROOT_DIR/app/docker" -t app-native-f2-downloader:0.1.0
