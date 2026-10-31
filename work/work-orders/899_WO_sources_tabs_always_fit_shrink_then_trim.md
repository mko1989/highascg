# WO-899 — Sources column: every sub-tab always fits (shrink the font, then trim the label)

**Area:** godot-client
**Status: DONE (31.10, Godot 24684/0 + --check OK; probe client on private Xvfb :96 at 280 / 230 / 170 px — screenshots in section 3; owner QA: the real column at 1920x1080)**

Owner, 31.10: *"we need to fit all the sources tab in its space always. shrink font then when a visibility threshold is
reached trim the label."*

## 1. Investigation

- The Sources column is `app/shell.gd:61-63` (`MediaPanel`, `custom_minimum_size.x = 280`, left child of an `HSplitContainer`).
  Its sub-tabs are a plain `TabContainer` (`features/live/media_panel.gd:73`): Media, CGs (the Templates node, renamed in
  WO-885), Placeholders (hidden unless offline / `--placeholders`), Live, Visuals, Timelines.
- Reproduced on the private Xvfb at 1920x1080 before touching anything: the strip showed `Media | CGs | Live | Visuals | ‹ ›`
  — **Timelines hidden behind the scroll arrows**. Cause: `theme_builder.gd:100-105` `tab_box` gives every tab 16 px of side
  padding (5 tabs = 160 px) plus the 15 px default font (`theme_builder.gd:32`) — about 350 px of tabs in a 270 px strip.
- Prior constraints (INDEX): WO-885 (the CGs / Visuals tabs; node names stay because ui.cfg keys use them — the fit therefore
  changes only the tab TITLE and keeps the full title in the tooltip), WO-608 R1-R5 (Sources stays full-height left).
- The other single-line rows of the column:
  - project bar (`project_media_bar.gd`): folder-name label used `clip_text` without an ellipsis ("mhp_harder/" lost its tail
    silently); the "project only" check box (120 px) + "Gather (n)" (85 px) have a fixed minimum and **pin the whole column
    wider than the split** when the column is narrower than ~210 px (seen: asking for 170 px gave 207).
  - Media tree names, Templates / Timelines tree, Visuals tree rows: `Tree` cells already trim with "…" — left alone (screenshots).
  - Live rows (`live_sources_panel.gd:169-170`): `clip_text` + `OVERRUN_TRIM_ELLIPSIS` already — left alone.
  - Media selection bar: `HFlowContainer`, wraps — left alone. Filter rows: `LineEdit`, no overflow.

## 2. What was done

Rule (one place, `core/ui_fit.gd`): natural size when everything fits; else the font steps **15 → 14 → 13 → 12 → 11 px**, the
side padding following it (`pad_for`: 15 → 8 px, 11 → 6 px; the natural step keeps the theme's 16); below the floor the
labels are **trimmed with "…", widest label first, one character at a time** (so "CGs" and "Live" stay whole, "Timelines"
and "Visuals" go first), the full name in the tooltip. 2 px slack so a fractional width never raises the ‹ › arrows.
**Floor = 11 px**: the theme default is 15, and the column's own secondary lines already run at 11-12 (media quick-look
`INFO_FONT = 11` in `media_panel.gd`, Visuals note 11, Live note 12), so 11 is the smallest size already accepted as readable
in this column; anything below is trimmed instead of shrunk.

- `core/ui_fit.gd` (new, 89 lines): pure planner `plan(texts, avail, measure, chrome)`, `trim_all`, `trim_to`, `pad_for`.
- `app/fit_tabs.gd` (new, 117 lines): `FitTabs.attach(tab_container)` — sets `clip_tabs`, listens to the tab bar's `resized`
  and the container's `child_order_changed`, re-learns every title on each refit (a title it did not write is a rename),
  applies font-size + tab stylebox overrides on the TabBar, writes trimmed titles and tooltips. `refit()` is public for
  `set_tab_hidden` (nothing signals that).
- `features/live/media_panel.gd` (+5 lines, 486): attaches the fitter after the tabs exist; the Placeholders visibility
  callback calls `refit()`.
- `features/live/project_media_bar.gd` (+`fit()`): the check box and Gather button are `clip_text` + ellipsis, `fit()` plans
  their font / text from the bar's real width (same `UiFit.plan`, chrome = measured icon+margins + separations, 24 px kept
  for the folder name), sets each one's `custom_minimum_size.x` to the planned text, so they no longer pin the column; the
  folder label got `OVERRUN_TRIM_ELLIPSIS`. Re-fits on `resized` and after `refresh()` (Gather's text changes).
- `app/shell.gd` (1 line): dev flag `--sources-w=N` sets the column minimum (default 280) so a probe can show narrower columns.
- `tests/test_ui_fit.gd` (new, 10 tests): planner (steps, chrome per size, trim order, hopeless width, `trim_to`, real Rewir
  font widths for the five tabs) and a real `TabContainer` at 280 / 230 / 170 px (no arrows, last tab inside the bar,
  tooltip), hide / rename / grow re-fit.

## 3. What was VERIFIED

- `./run-client.sh --test`: `[tests] 24684 passed, 0 failed` (the 10 new tests included); `--check`: boot OK, no script errors;
  `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- Probe client (own XDG_DATA_HOME copy, Xvfb :96, `-- --tab=Live --visuals-ring=probe899 --sources-w=N`), crops of the column:
  - baseline BEFORE: `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/base.png` (‹ › arrows, Timelines hidden).
  - 280 px: all five names whole at 14 px, no arrows — `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/s_280c.png`
    (full frame `s_280.png`); project row at natural size, folder name "mhp_ha…".
  - 230 px: font shrunk to 11 px, names whole — `.../s_230c.png`.
  - 170 px: trimmed "M…  CGs  Live  Vis…  Ti…", project row "proje… / Gath…", column no longer pinned — `.../s_170c.png`; Live /
    CGs / Visuals tabs at 170 px (rows already elide): `.../s_170livec.png`, `s_170cgc.png`, `s_170visc.png`; Visuals at 280: `s_280visc.png`.
- Not verified: the owner's real session (ui scale / second monitor); the Visuals tab row label squeezes to 1-2 letters at 170
  px (thumbnail column is a fixed 96 px) — not reachable in production (column >= 280) and that file is another agent's.
