#!/bin/sh
set -eu

mkdir -p /data/config /data/state /data/downloads

exec "$@"
