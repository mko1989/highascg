# WO-327 — Compose preview screen-dest borders wrong with custom resolutions

**Source:** todos24.07.26 — "The borders around screen dests in compose preview don't act
well with custom res."
**Status: OPEN.** Written 2026-07-24 from a read-only code survey (claims spot-checked).

## Verified current state (2026-07-24, source read)

- The borders live in `client/components/preview-canvas-destination-overlay.js`:
  outer border ~line 108 (`1px solid rgba(88,166,255,.65)`), inner frame ~line 132.
- Rect source: saved `cfg.deviceGraph.layout` per destination (~lines 14-31). When a
  destination has NO saved layout, the fallback auto-tiler (**lines 53-67, confirmed**)
  tiles with hardcoded `cellW = 1920 / cellH = 1080` and only clamps w/h to minimums —
  it never reads the destination's actual `width`/`height`.
- Custom resolution IS stored on the destination: `src/config/screen-destinations.js`
  ~84-93 (`width`, `height`, custom videoMode). The overlay reads
  `cfg.screenDestinations.destinations` (~line 15) but never touches `.width`/`.height`.
  Contrast: `client/lib/mapping-state.js` ~92-93 parses them correctly for canvas sizing —
  that is the pattern to copy.
- Additional 1920x1080 fallbacks that may compound on custom-res boxes:
  `client/lib/program-output-state.js:23`, `client/lib/input-channels.js:190`,
  `client/lib/mixer-fill.js:312,320`, `client/lib/selection-sync.js:43`.

Net: with a custom-res destination (e.g. 1024x576 or a 2160p50 registered RandR mode),
the border box is drawn at a wrong size/aspect relative to the preview content, and the
auto-tiled fallback positions assume every screen is a 1080p cell.

## Fix direction

1. In `preview-canvas-destination-overlay.js`, resolve each destination's true pixel size:
   `parseInt(d.width/d.height)` when set, else the videoMode's canonical dims, else
   1920x1080 — one small shared helper (consider exporting the existing logic from
   `mapping-state.js` instead of a third copy).
2. Fallback auto-tiler: cell size per destination = its true dims (tile by running max
   row height, not a fixed grid), so mixed-res setups don't overlap or gap.
3. Saved layouts: when a saved `graphLayout[id]` rect's aspect no longer matches the
   destination's current res (owner changed res after laying out), keep position but
   re-derive w/h from the true dims — the border must always show the real output aspect.
4. Sweep the listed 1920x1080 fallbacks only where they feed THIS overlay's math; do not
   refactor the unrelated ones in this WO.

## Acceptance
- A destination at a custom res (test at least one smaller-than-HD and 3840x2160@50,
  which this box can register via the EDID-native custom mode) shows a border that matches
  the preview content's real aspect and position, both with a saved layout and with the
  auto-tile fallback (clear the saved layout to test).
- Mixed setup (one 1080p + one custom-res dest) auto-tiles without overlap.
- 1080p-only setups render pixel-identical to today (no regression for the common case).
- Offline test: rect-resolution table (explicit w/h, videoMode-derived, missing → fallback)
  in tools/smoke/; `npm run test:ci` → 0 fail.
- Client-only change: `npm run build:client` + kiosk reload to verify (no service restart).

## Constraints
- Don't change the deviceGraph layout persistence format — only how missing/stale rects
  are derived for display.
