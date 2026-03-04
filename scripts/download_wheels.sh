#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WHEELS_DIR="$ROOT_DIR/app/server/wheels"
REQ_FILE="$ROOT_DIR/backend/requirements.txt"

if [ ! -f "$REQ_FILE" ]; then
  echo "requirements.txt not found: $REQ_FILE"
  exit 1
fi

rm -rf "$WHEELS_DIR"
mkdir -p "$WHEELS_DIR"

# 从文件名提取 name==version
get_pkg_spec() {
  local fname="$1"
  if [[ "$fname" == *.whl ]]; then
    local name version
    name=$(echo "$fname" | cut -d'-' -f1)
    version=$(echo "$fname" | cut -d'-' -f2)
    echo "${name}==${version}"
  elif [[ "$fname" == *.tar.gz ]]; then
    local base name version
    base="${fname%.tar.gz}"
    name=$(echo "$base" | sed 's/\(.*\)-[0-9].*/\1/')
    version="${base#"${name}"-}"
    echo "${name}==${version}"
  fi
}

PLATFORMS=("manylinux2014_x86_64" "manylinux2014_aarch64")

# 阶段 1：完整下载到临时目录（当前平台），解析完整依赖树
TMP_DIR=$(mktemp -d)
echo "Resolving full dependency tree ..."
pip download -r "$REQ_FILE" --dest "$TMP_DIR"

# 阶段 2：逐包为目标平台下载 wheel，失败则回退复制
for PLATFORM in "${PLATFORMS[@]}"; do
  echo ""
  echo "Downloading wheels for $PLATFORM ..."
  for f in "$TMP_DIR"/*; do
    fname=$(basename "$f")
    pkg_spec=$(get_pkg_spec "$fname")
    [ -z "$pkg_spec" ] && continue

    pip download "$pkg_spec" \
      --dest "$WHEELS_DIR" \
      --platform "$PLATFORM" \
      --python-version 312 \
      --abi cp312 \
      --only-binary=:all: \
      --no-deps 2>/dev/null \
    || {
      # 回退：复制纯 Python wheel 或 sdist（仅首次）
      if [ ! -f "$WHEELS_DIR/$fname" ]; then
        cp "$f" "$WHEELS_DIR/"
        echo "  Copied fallback: $fname"
      fi
    }
  done
done

rm -rf "$TMP_DIR"

echo ""
echo "Wheels downloaded to $WHEELS_DIR"
echo "Total files: $(ls "$WHEELS_DIR" | wc -l)"
ls -lh "$WHEELS_DIR"
