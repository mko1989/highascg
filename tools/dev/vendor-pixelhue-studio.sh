#!/usr/bin/env bash
# WO-1039 — refresh the vendored copy of pixelhue-studio (src/pixelhue/vendor/pixelhue-studio) from a checkout.
# Usage: tools/dev/vendor-pixelhue-studio.sh /path/to/pixelhue-studio
set -euo pipefail
SRC="${1:?path to a pixelhue-studio checkout}"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
DST="$HERE/src/pixelhue/vendor/pixelhue-studio"
test -f "$SRC/server.js" && test -d "$SRC/lib" || { echo "not a pixelhue-studio checkout: $SRC" >&2; exit 1; }
KEEP="$(mktemp)"; cp "$DST/VENDORED.md" "$KEEP"
rm -rf "$DST"; mkdir -p "$DST"
cp -r "$SRC/lib" "$SRC/public" "$SRC/server.js" "$SRC/package.json" "$SRC/README.md" "$DST/"
rm -rf "$DST/public/fonts"
cp "$KEEP" "$DST/VENDORED.md"; rm -f "$KEEP"
(cd "$SRC" && git rev-parse HEAD) > "$DST/VENDORED_COMMIT"
echo "vendored $(cat "$DST/VENDORED_COMMIT") into $DST"
