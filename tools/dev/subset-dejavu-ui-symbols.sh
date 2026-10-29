#!/usr/bin/env bash
# WO-826 — the Godot client's symbol fallback font. Rewir (the UI font) has no arrows, triangles, check marks, ⚠, ⚙ …
# Desktop Godot falls back to system fonts for those; the Web export has none, so they rendered as boxes. This cuts
# DejaVu Sans down to the symbol blocks the UI draws from (whole blocks, so a new glyph from the same block is covered).
# Needs python3-fonttools + fonts-dejavu-core. DejaVu's license (Bitstream Vera + public domain changes) allows this.
#   usage: tools/dev/subset-dejavu-ui-symbols.sh [OUT.ttf]
set -euo pipefail
SRC=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
OUT=${1:-"$(dirname "$0")/../../godot/client/assets/fonts/DejaVuSans-ui-symbols.ttf"}
# Latin-1, Greek, ᵀ, super/subscripts, letterlike, arrows, math, misc technical, box drawing, geometric shapes,
# misc symbols, dingbats, supplemental arrows-A
python3 -m fontTools.subset "$SRC" \
	--unicodes="U+00A0-00FF,U+0370-03FF,U+1D40,U+2070-209F,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2500-257F,U+25A0-25FF,U+2600-26FF,U+2700-27BF,U+27F0-27FF" \
	--layout-features='' --no-hinting --desubroutinize --output-file="$OUT"
ls -l "$OUT"
