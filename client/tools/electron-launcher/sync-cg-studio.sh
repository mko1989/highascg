#!/usr/bin/env bash
# Copy CG Studio server package into launcher bundle (operator-machine module).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DST="${HERE}/cg-studio"

SRC=""
for candidate in \
	"${HIGHASCG_SERVER_ROOT:-}" \
	"${HIGHASCG_SIM_APP_ROOT:-}" \
	"${HERE}/sim-server" \
	"$(cd "${HERE}/../../.." && pwd)/not-needed" \
	"/Users/marcin/highascg"; do
	[[ -n "$candidate" ]] || continue
	root="$(cd "$candidate" 2>/dev/null && pwd)" || continue
	if [[ -f "${root}/src/cg-studio/studio-server.js" ]]; then
		SRC="${root}/src/cg-studio"
		break
	fi
done

if [[ -z "$SRC" ]]; then
	echo "Skip cg-studio sync — no highascg checkout with src/cg-studio (set HIGHASCG_SERVER_ROOT)." >&2
	exit 0
fi

mkdir -p "${DST}"
rsync -a --delete \
	--exclude '.DS_Store' \
	"${SRC}/" "${DST}/"

echo "Synced cg-studio → ${DST} (from ${SRC})"
