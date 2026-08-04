#!/bin/sh
set -eu

mkdir -p "${DATA_DIR:-/data}"
chown -R node:node "${DATA_DIR:-/data}"

exec gosu node "$@"
