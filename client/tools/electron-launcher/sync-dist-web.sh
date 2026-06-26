#!/usr/bin/env bash
# Copy Vite build output into the launcher folder for Electron packaging.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../../.." && pwd)"
SRC="${ROOT}/dist-web"
DST="${HERE}/dist-web"

if [[ ! -f "${SRC}/index.html" ]]; then
	echo "Missing ${SRC}/index.html — run: npm run build:client" >&2
	exit 1
fi

mkdir -p "${DST}"
rsync -a --delete "${SRC}/" "${DST}/"
echo "Synced dist-web → ${DST}"
