Rewir-Light.ttf — same bytes as client/fonts/Rewir-Light.ttf, MODIFIED (WO-620): Rewir's "·" (U+00B7) and "•" (U+2022) glyphs were empty, so
every " · " separator rendered as a blank gap. Both are now composites of Rewir's own period (tools/dev/patch-rewir-middot.py,
python3-fonttools; DSIG dropped, name ID 5 notes the patch). All other glyphs are unchanged. Family name kept — OFL
allows modified versions, and Rewir declares no Reserved Font Name.
Source: https://github.com/warszawskie-kroje/rewir (Rewir-Light). License: SIL Open Font License (OFL).
Copyright © 2016 Stowarzyszenie Kulturotwórcze Miastodwa. https://scripts.sil.org/OFL

DejaVuSans-ui-symbols.ttf — a subset of DejaVu Sans (fonts-dejavu-core) holding only symbol blocks (Latin-1, Greek, arrows,
math, misc technical, box drawing, geometric shapes, misc symbols, dingbats). WO-826: Rewir's fallback in
app/theme_builder.gd, because the Web export has no system fonts and drew ▾ ▸ ✓ ✕ ⚠ … as boxes. Rebuild with
tools/dev/subset-dejavu-ui-symbols.sh. License: Bitstream Vera Fonts license, DejaVu changes public domain (full text in
the repo's THIRD_PARTY_NOTICES). Glyphs unmodified.
