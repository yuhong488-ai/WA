#!/bin/sh
set -eu

mkdir -p "${DATA_DIR:-/data}"
chown -R node:node "${DATA_DIR:-/data}"

# Railway can move a persistent volume between containers during a deploy.
# Chromium's singleton files contain the previous container's host/process IDs
# and must not prevent the new container from opening the preserved WA profile.
find "${DATA_DIR:-/data}/wwebjs_auth" \
    \( -name SingletonLock -o -name SingletonSocket -o -name SingletonCookie \) \
    -delete 2>/dev/null || true

exec gosu node "$@"
