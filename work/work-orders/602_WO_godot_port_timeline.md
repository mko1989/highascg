**Status: IN PROGRESS (2026-10-18) — slice 1 (canvas read-only + transport + server-synced playhead) DONE, box-verified; editing slices open. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599, WO-600 (sources drag contract, PRV/PGM), WO-601 (timeline clip/flag/layer inspector sections).**

# WO-602 — Godot port: timeline editor (canvas NLE, keyframes, flags, transport)

## Investigation

Inventory (Haiku): [`timeline-audio-media-secondary.md` §1](../godot-port/inventory/timeline-audio-media-secondary.md).
Scope: **24 JS files, 4,948 LOC + 272 CSS**. Top files: `timeline-editor.js` (472),
`timeline-editor-handlers.js` (469), `timeline-editor-inputs.js` (406), `timeline-canvas-pointer.js` (404).

- Rendering: one Canvas 2D (`timeline-canvas.js:68-70`), draw code in `timeline-canvas-render.js`
  and `timeline-canvas-clip.js` (`roundRect`, `drawImage` of thumbnails loaded with `new Image()`,
  `fillText`); rAF redraw (`timeline-canvas.js:169`) + playback rAF (`timeline-editor-playback.js:88-102`).
  **No devicePixelRatio handling** (`timeline-canvas.js:184-191` sizes from the container rect).
- Interaction: drag types `seek`, `flag-move`, `layer-divider`, `layer-move`, `clip-move`,
  `clip-resize` (`timeline-canvas-pointer.js:62-392`); dblclick adds keyframe; context menu on layer
  header (rename via `prompt`); wheel zoom around cursor / pan (Alt, Shift); keys I/O/P/S/V/T add
  keyframes, Delete, Ctrl/Cmd+C/V, Space play.
- Server contract: `timeline.tick` / `timeline.playback` WS (playhead extrapolated from server ticks
  with 80 ms / 35 ms snap thresholds), timelines CRUD (`POST /api/timelines`, `PUT /api/timelines/{id}`,
  `POST /api/timelines/{id}/seek`), take with transition.
- Pure, portable 1:1: `timeline-canvas-snap.js`, `timeline-clip-interp.js` (piecewise-linear
  keyframes), `timeline-track-heights.js`, `timeline-canvas-utils.js` (SMPTE/timecode).

### Behaviours to decide, not silently change (inventory "Port-risk summary")

1. **Space-to-play is document-global**, not focus-gated (`timeline-editor-inputs.js:187`) — Godot
   port: same when the timeline tab is active, but never while a text field has focus (owner call).
2. **Keyframe `easing`: the client preview ignores it, the server output honours it** (✔ read by
   hand). Client `interpClipProp` is plain linear (`client/lib/timeline-clip-interp.js:16-30`), while
   server playback maps easing to Caspar tweens (`src/engine/timeline-playback-amcp-schedule.js:239,284`
   `mapKeyframeTween(easingAtTime(...))`). The editor canvas can therefore disagree with what goes to
   air for non-linear keys. Godot port: implement the eased curve in the canvas preview to match the
   server (a small improvement, owner-visible — note it in the parity checklist).
3. **Only in-app source drops** on the canvas (no OS file drops) — keep.

## Port plan

- `TimelineView` (custom `Control`): `_draw()` for ruler/tracks/clips/keyframes/playhead, thumbnail
  `ImageTexture` cache (HTTP), `_gui_input()` implementing the six drag types; HiDPI handled by
  Godot's content scale (fixes the missing-DPR issue for free).
- `TimelineState` autoload: port of `timeline-state*.js`, same JSON (project compatibility, WO-598).
- Transport bar: Controls; timecode fields via the WO-599 `TimeField`.
- Playhead: server tick extrapolation with identical thresholds.

## Acceptance

- Parity checklist `work/godot-port/parity/timeline.md` from the inventory bullets, owner-ticked.
- A timeline created/edited in Godot opens identically in the web client and vice versa
  (project JSON round-trip diff = ∅).
- Snap/interp/timecode pure-module tests identical to the JS ones.

## What was done

### Slice 1 (2026-10-18) — view + transport

- `godot/client/features/timeline/timeline_math.gd` — 1:1 pure ports: `fmtTimecode` / `fmtSmpte` /
  `fmtHms` / `parseTcInput` (timeline-canvas-utils.js), `ensureLayerHeights` + track geometry
  (lib/timeline-track-heights.js; note the web maps a below-min height to the DEFAULT 54, not the min
  28 — kept), ruler nice-interval (≥ 55 px), x↔ms, wheel zoom ×1.18 clamped 0.0001–5 px/ms, the
  server-tick clock (snap when the server is > 80 ms ahead, ignore when ≤ 35 ms behind), `hitClip`,
  `uid`, `defaultTimeline`.
- `timeline_view.gd` — custom `Control._draw`: tracks, clips in the layer palette with labels, flags,
  past-the-end shade, headers, ruler with sub-ticks, playhead. Wheel zooms around the cursor,
  Shift/Alt+wheel pans; click/drag on the ruler seeks. Page-follow while playing.
- `timeline_tab.gd` — picker, ＋ New, ■ / ▶ ❚❚, SMPTE readout, PRV / PGM send-to, Fit, Follow.
  Timelines live in `Store.project.timelines` (same JSON as the web; autosave carries it). Before play
  the timeline is pushed to the engine like the web's syncToServer (PUT, POST when missing), then
  seek → sendto → play {from, sendTo}; Stop is `{force:true}` (WO-552 operator stop).
  **Deviation from the plan:** no `TimelineState` autoload yet — slice 1 reads/writes the project slice
  directly; the autoload comes with the editing slice that needs undo/selection.
- `app/shell.gd` — Timeline tab after Previs (placeholder removed).

## What was VERIFIED

- Godot unit tests 665/0 (`test_timeline_math.gd` goldens generated from the web modules under node);
  `run-client.sh --check` boot clean.
- Box, GUI on the operator monitor driven by XTest clicks: ＋ New → `GET /api/timelines` shows the
  timeline on the engine and `GET /api/project` has `timelines.activeId` = it (autosave). ▶ → engine
  `{position 3504, playing true}` while the GUI playhead / SMPTE track it; ❚❚ → `playing false`;
  ruler click at 10 s → engine `position 10254`, GUI `00:00:10:06` (25 fps ✓); ■ → `position 0`.
- Owner-QA open: everything editing (next slices: clip move/resize, keyframes with eased preview,
  flags, source drops, clip/flag/layer inspector).

Easing behaviour verified by hand on both sides (refs in item 2) — the Haiku inventory's
"easing is ignored" holds only for the client preview.
