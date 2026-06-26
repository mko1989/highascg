#!/usr/bin/env bash
# Copy local server tree into launcher bundle for embedded simulation (not USB stick).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../../.." && pwd)"
SRC="${ROOT}/not-needed"
DST="${HERE}/sim-server"

if [[ ! -f "${SRC}/index.js" ]]; then
	echo "Skip sim-server sync — missing ${SRC}/index.js (server tree for dev/ISO; gitignored)." >&2
	exit 0
fi

if [[ ! -f "${SRC}/index.js" ]]; then
	echo "Cannot sync sim-server — missing ${SRC}/index.js (server sources for dev)." >&2
	exit 1
fi

STUB="${HERE}/sim-server-package.stub.json"
mkdir -p "${DST}"
rsync -a --delete \
	--exclude node_modules \
	--exclude '.git' \
	--exclude 'dist-web' \
	"${SRC}/" "${DST}/"

if [[ -f "${SRC}/package.json" ]]; then
	cp -f "${SRC}/package.json" "${DST}/package.json"
	[[ -f "${SRC}/package-lock.json" ]] && cp -f "${SRC}/package-lock.json" "${DST}/package-lock.json"
elif [[ -f "${STUB}" ]]; then
	cp -f "${STUB}" "${DST}/package.json"
	echo "Note: ${SRC}/package.json missing — using launcher sim-server-package.stub.json"
else
	echo "Missing ${STUB} and ${SRC}/package.json" >&2
	exit 1
fi

echo "Synced sim-server → ${DST}"
echo "  From repo root, install deps once: npm run launcher:sim-install"
echo "  Then start the app: npm run launcher"
