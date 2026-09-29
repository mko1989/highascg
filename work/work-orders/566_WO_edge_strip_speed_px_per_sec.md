**Status: DONE (2026-09-10, offline suite 2403/0/2, JSON validity checked, prettier pre-existing-only)**

**Update 2026-09-10 (same day, owner confirmed speed fix): identical bug in `length`, also fixed.**
Owner: "now there is a similar issue with length which is calculated by percentage so its again
different between slices. should be just in pixels." Same root cause as speed — `length` was a
percent of each slice's OWN normalized `pathLength="100"` dash space (`Strip length % of edge`,
5–100%), so one shared percentage produced a different real pixel-length lit strip on every slice
(screen 1, thickness 6: 20% was 580.8px on the 2904px-perimeter slice vs 1041.6px on the
5208px-perimeter slice). Fixed the same way as speed: control is now `Strip length (px)` (10–2000,
default 300), and `template/pip_edge_strip.html`'s per-slice loop converts it back to the
dash-space percentage `L = clamp((lengthPx / perimPx) * 100, 2, 98)` per slice, using the same
`perimPx` already computed for the speed fix — one shared px value now lights the same real
length on every slice regardless of size. Same propagation as speed: `pip-overlay-registry.js`
(schema default 28→300, plus the overlay's own `defaults.length`/`defaults.speed` — the latter
was missed in the first pass, still read 2, now 400, matching the schema default already fixed),
`pip-overlay-utils.js`, `artnet-slot-config.js` (defaults), `artnet-dmx-border.js` (DMX byte 14
range 5–100%→10–2000px). Screen 1's live runtime state (`template/global-border-live-1.json`,
gitignored) — which the owner had since retuned live (thickness 6, speed 350, length 20, glowWidth
19, roundedTips true; `config/.highascg-state.json`'s persisted copy had NOT picked up that tuning,
still showing the pre-tuning `enabled:false`/`speed:600`/no thickness — left untouched, not this
WO's concern) — migrated `length` 20→600 to hold the visual roughly steady across the unit change.
Verified: full offline suite still 2403/0/2, both edited JSON files parse. Not yet built/reloaded/
restarted or eyeballed live for this second half either.

## Investigation

Owner report (Global Border → screen 1, type `edge_strip`, 2 slices): the animated glow strip runs
at visibly different speeds between the two slices, and the "Loop (sec)" slider maxes out too low
to get a fast loop.

Root cause, [template/pip_edge_strip.html](../../template/pip_edge_strip.html):

- `render()` drew each slice's marching-strip as an SVG `<rect>` with `pathLength="100"` and
  `stroke-dasharray` in that normalized 0–100 space, animated via a single shared
  `dur = state.speed` (seconds per full loop) applied identically to every slice
  (`old` line 119, `old` line 195: `r.style.animation = animName + ' ' + dur + 's linear infinite'`).
- Because `pathLength` normalizes the dash space to 100 units regardless of the rect's actual
  size, one "lap" (100 units) covers a different number of real pixels per slice — a slice's
  real speed is `perimeter_px / dur`. Two slices sharing one `dur` therefore move at different
  px/s whenever their rectangles differ in size, exactly the screen-1 config on this box
  (`config/.highascg-state.json` → `web_project.scenes.globalBorders[0].slices`:
  `{x:0,y:0,w:0.2,h:1}` and `{x:0.2,y:0,w:0.8,h:1}` — a ~2916px-perimeter slice next to a
  ~5220px one at 1920×1080, side `inside`, thickness 3).
- Separately, the control (`client/lib/pip-overlay-registry.js` edge_strip schema) exposed this
  as `Loop (sec)`, min 0.1 / max 10 — a duration, so *larger* number meant *slower*, and the max
  (10) only bounded how slow it could go, not how fast — matching the "max, which is too low"
  complaint (the owner wanted faster than a 10 s-minimum loop could give a big slice).

## What was done

Switched the control from a shared loop *duration* to a single global *rate* (px/s), and derived
each slice's own duration from its own on-screen perimeter — same rate in, same visual speed out,
regardless of slice size:

- [template/pip_edge_strip.html](../../template/pip_edge_strip.html): renamed the top-level
  `dur` to `speedPxPerSec` (`= state.speed`, clamped ≥1); inside the per-slice `forEach`, once
  `rw`/`rh` (the actual drawn rect, side-`inside`/`outside`-adjusted) are known, compute
  `perimPx = 2*(rw+rh)` and `dur = max(0.05, perimPx / speedPxPerSec)` — this `dur` (now
  per-slice) is what feeds the keyframe animation and the `count`-stagger delay, so multiple
  slices with one shared `speed` value complete their own loop in proportion to their own size.
  Default `state.speed` 2 → 400 (px/s).
- [client/lib/pip-overlay-registry.js](../../client/lib/pip-overlay-registry.js): edge_strip
  `speed` field relabeled `Speed (px/s)`, range 10–3000 step 10, default 400 (was `Loop (sec)`
  0.1–10).
- [src/engine/pip-overlay-utils.js](../../src/engine/pip-overlay-utils.js): matching
  `PIP_OVERLAY_PARAM_DEFAULTS.edge_strip.speed` default 2 → 400 (CG-JSON fallback path).
- [src/artnet/artnet-slot-config.js](../../src/artnet/artnet-slot-config.js): matching
  `runtimeParamsFromSlot` default 0.1 → 400.
- [src/artnet/artnet-dmx-border.js](../../src/artnet/artnet-dmx-border.js): DMX byte 7 previously
  fed one shared `spd` (0.1–10) into both `params.speed` (edge_strip) and `params.pulseSpeed`
  (glow's pulse duration, unrelated unit). Split into two formulas from the same byte: `speed =
  10 + byte/255*2990` (px/s) and `pulseSpeed = 0.1 + byte/255*9.9` (unchanged seconds) — glow's
  DMX-driven pulse speed is untouched, only the edge_strip half of the shared byte changed scale.
- Runtime state migrated to the new scale so the fix doesn't silently freeze what's already
  configured on screen 1: `config/.highascg-state.json` (`globalBorders[0].params.speed` and its
  `pgmAirSnapshot` copy) and `template/global-border-live-1.json` — both `"speed":10` (the old
  10 s-loop max) → `600` (px/s; both screen-1 slices now complete their own loop at the same real
  600 px/s instead of the old 291.6 px/s / 522 px/s split). Both are gitignored runtime files
  (`config/.highascg-state.json`, `template/global-border-live-*.json`), edited in place, not
  committed.

Not touched: `glow` type's `pulseSpeed` field/behavior (separate key, separate template
`pip_glow.html`, confirmed via grep — only `pip_edge_strip.html` ever reads `state.speed`), and
`GLOBAL_BORDER_ARTNET_CHANNEL_DEFS` label at offset 7 (still generic "Speed", correct for both
units now living on that one DMX byte).

## What was verified

- `python3 -c "import json; json.load(...)"` on both edited runtime JSON files — valid.
- `node tools/ci/run-offline-tests.js` — **2403 pass / 0 fail / 2 skip** (skips are the two
  pre-existing server-spawning tests gated off outside local runs), no smoke test pinned the old
  speed range/label (`smoke-wo179-*`, `smoke-pip-overlay-placement` — none reference `speed`).
  `check-max-file-lines.js` — 1 pre-existing violation (`scene-take-lbg.js`, unrelated).
  `prettier --check` on the 5 touched files warns on all 5, confirmed **pre-existing** by
  stashing the diff and re-running (same 5 files warn before this change) — not introduced here.
- Not yet verified live on the box (no kiosk reload / server restart performed this session —
  owner should recall the screen-1 border effect or nudge the new "Speed (px/s)" slider after the
  next `npm run build:client` + F5 reload and `kill -TERM $(systemctl show -p MainPID --value
  highascg)`, and visually confirm both slices now travel at the same rate).
