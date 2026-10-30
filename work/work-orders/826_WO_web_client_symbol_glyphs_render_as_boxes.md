# WO-826 — Web client (Pages demo): arrows, ▸ ▾, ✓ ✕, ⚠ … render as boxes

**Area:** web-client
**Status: DONE (29.10, Godot suite 22836/0 incl. a coverage guard; local Web export in Firefox ESR shows the glyphs; live
Pages after the next deploy) — 10 media/emoji glyphs still have no font (listed below)**

## Investigation

Found while checking the live GitHub Pages demo (WO-815) in Firefox ESR on a private Xvfb (session scratchpad
`pages/pages_resized.png`). "Server ▾", the Sources "↻", "▸ Playlists / Timers / Program audio" and the "×" on each
monitor showed as boxes. WO-815 had recorded this as cosmetic: "on Web some icon glyphs (▾ …) render as boxes".
- The client's only font is Rewir-Light (`app/theme_builder.gd` `FONT_PATH`). A fontTools scan of every non-test `.gd`
  file found 91 distinct non-ASCII characters, and Rewir has no glyph for **67** of them: arrows, triangles, check marks,
  ⚠, ⚙, ±, ≤, π, superscripts, and others.
- On desktop, Godot falls back to the OS fonts for a missing glyph, so the bug never showed on the box. A Web export has
  no system fonts.
- DejaVu Sans covers 57 of the 67. Not covered: ⏭ ⏮ ⏱ ⏸ ⛶ ⧉ ＋ 🎚 📁 🔊. No Noto symbol font is installed.
- The canvas filling only 1280×810 of a 1600×900 window in the same test was **not** a bug. Xvfb has no window manager,
  so Firefox's `--kiosk` never maximized the window. Resized, the canvas fills it (adaptive resize policy 2 works).

## What was done

- `godot/client/assets/fonts/DejaVuSans-ui-symbols.ttf`, 166 kB, with a `keep` import like Rewir so it ships raw. It is
  a DejaVu Sans subset of whole symbol blocks, so a new glyph from the same block is covered too. It is made by
  `tools/dev/subset-dejavu-ui-symbols.sh` (`python3 -m fontTools.subset`; reproducible).
- `app/theme_builder.gd` `load_font()`: Rewir gets the subset as its one fallback (`SYMBOL_FALLBACK_PATH`). Desktop now
  uses the same symbols as Web instead of whatever the OS picks.
- License: Bitstream Vera Fonts license, with DejaVu's changes in the public domain. The full text is in
  `THIRD_PARTY_NOTICES`, plus a note in `assets/fonts/README.txt`. The glyphs and the family name are unchanged.
- Why not draw icons instead: the glyphs are used as text in about 60 places (buttons, labels, tooltips). One fallback
  font fixes all of them, and the guard test keeps new ones covered.

## What was verified

- `tests/test_ui_glyph_coverage.gd`:
  - Rewir loads with exactly one fallback.
  - Rewir alone has no ▾, and the fallback does.
  - Every non-ASCII character in the client's scripts (`tests/` and `e2e/` excluded) is covered, apart from
    `KNOWN_GAPS`. Each known gap must still be a gap, so the list can only shrink.
  - Godot suite **22836 passed / 0 failed**. With the fallback assignment removed, both tests fail.
- Local Web export (`--export-release "Web"`, `index.pck` contains the font): Firefox ESR on a private Xvfb `:95`
  (scratchpad `pages/local_fallback.png`). "Server ▾", "↻", "▸ Playlists / Timers / Program audio" and "×" all render.
  Compare `pages/pages_resized.png`, the live site before the fix.

## Open

- The 10 glyphs no installed font has: ⏭ ⏮ ⏱ ⏸ ⛶ ⧉ ＋ 🎚 📁 🔊. A Noto Sans Symbols 2 subset (plus Noto Emoji for
  🎚 📁 🔊) would close the gap. Not installed on the box: `sudo apt install fonts-noto-core fonts-noto-color-emoji`.
