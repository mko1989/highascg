#!/usr/bin/env bash
# Regenerate small logo / metal / favicon assets from Inkscape SVG sources (if present).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ASSETS="${ROOT}/assets"
SOURCE="${ROOT}/assets-source"
SRC_LOGO="${SOURCE}/logo.svg"
SRC_METAL="${SOURCE}/metal.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

need() { command -v "$1" >/dev/null || { echo "Missing $1" >&2; exit 1; }; }
need rsvg-convert
need cwebp

if [[ -f "$SRC_LOGO" ]]; then
	rsvg-convert -w 400 "$SRC_LOGO" -o "$TMP/logo.png"
	cwebp -q 82 -resize 192 0 "$TMP/logo.png" -o "$ASSETS/logo.webp"
	cwebp -q 80 -resize 64 64 "$TMP/logo.png" -o "$ASSETS/favicon.png"
	cp "$ASSETS/logo.webp" "${ROOT}/tools/electron-launcher/logo.webp"
	echo "logo.webp + favicon.png"
fi

if [[ -f "$SRC_METAL" ]]; then
	rsvg-convert -w 128 -h 128 "$SRC_METAL" -o "$TMP/metal.png"
	cwebp -q 75 -resize 128 128 "$TMP/metal.png" -o "$ASSETS/metal.webp"
	echo "metal.webp"
fi

ls -lh "$ASSETS/logo.webp" "$ASSETS/metal.webp" "$ASSETS/favicon.png" 2>/dev/null || true
