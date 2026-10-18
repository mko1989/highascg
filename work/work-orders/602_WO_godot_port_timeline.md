**Status: IN PROGRESS (2026-10-18) — slice 1 (canvas read-only + transport + server-synced playhead), slice 2 (clip select / move / resize / delete, Sources drops, clip Inspector page) slice 3 (clip transform: align / X Y W H / aspect lock / content sizing) and slice 4 (keyframes: canvas diamonds + eased curve, drag / double-click / Delete, i o p s v t keys, Inspector keyframe groups) DONE, box-verified; flags editing, layer ops open. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599, WO-600 (sources drag contract, PRV/PGM), WO-601 (timeline clip/flag/layer inspector sections).**

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
   hand — ⚠ corrected in slice 4: the server *meant* to honour it, but every non-linear name it sent was
   rejected or ignored by Caspar's tweener until [WO-618](./618_WO_caspar_tween_names.md)). Client `interpClipProp` is plain linear (`client/lib/timeline-clip-interp.js:16-30`), while
   server playback maps easing to Caspar tweens (`src/engine/timeline-playback-amcp-schedule.js:239,284`
   `mapKeyframeTween(easingAtTime(...))`). The editor canvas can therefore disagree with what goes to
   air for non-linear keys. Godot port: implement the eased curve in the canvas preview to match the
   server (a small improvement, owner-visible — note it in the parity checklist).
3. **Only in-app source drops** on the canvas (no OS file drops) — keep.

### Slice 2 findings (2026-10-18, read before writing)

- **Flag fields:** the model is `{id, timeMs, type, jumpTimeMs, jumpFlagId, label}`
  (`client/lib/timeline-state.js` `addFlag`). Slice 1's canvas read `f.time` / `f.name`, so every flag drew at
  0 with its type as the label — fixed here.
- **Web snapping bug** (`client/components/timeline-canvas-snap.js` `resolveSnappedStart`): when only one
  clip edge has a candidate in range, `snapValue` returns the other edge's raw value, distance 0, which wins the
  `<=` comparison. A clip move therefore never snaps to clips / flags / 0 / the end in the browser, only to the
  playhead branch. Caught by the Godot golden test (expected 5000, got 4995). Godot treats "no candidate" as
  infinitely far; the web fix joins the web-only bugs queued in [WO-601](./601_WO_godot_port_inspector.md) (addendum bugs 1–2, 5, 9) for one small web WO.
- **Playhead as snap target during resize:** `onClipResizePreview` moves the playhead to the dragged edge and
  the playhead is a snap candidate, so the edge would snap back to where it was on the next event. Godot snaps
  to the playhead position at mouse-down.
- **Duration grows under a right-edge drag:** `updateClip` → `expandDurationToContent` pushes `tl.duration`
  (a snap candidate) 2 s past the dragged end, so dragging toward the end never snaps to it. That matches the web
  and is kept.
- **Slice 1 fit bug:** `fit()` ran from `_ready`, before the canvas had a size, so it silently kept 0.1 px/ms.
  It now defers to the first `resized`.
- Drop pipeline (`timeline-editor-handlers.js` `onDropSource`): duration = payload `durationMs` → media row →
  `POST /api/media/cinf` → 5 s; add layers up to the drop row; a clip under the drop is replaced
  (`replaceClipSource`, WO-523: an operator-resized clip keeps its length) and refit inside its old rect
  (`containRectPreservingAspect`); otherwise `addClip` then `applyTimelineClipLayoutFromMedia` (fillPx from
  `sceneLayerPixelRectForContentFit` on the sendTo screen's program resolution, full canvas when the media size is
  unknown).

### Slice 3 findings (2026-10-18) — clip transform

- Web: `client/components/inspector-panel-timeline-clip.js`. The base rect is `fillPx`, else
  `getClipBasePixelRect` (the content-fit rect of the media). `applyFillPx` runs `applyFillPxPatch`
  (`client/lib/coordinate-origin.js:62`), then the aspect lock: a lone W edit sets H = max(1, round(W / ar)) and a
  lone H edit the reverse. `ar` is the media's own ratio, else the rect's, else 16:9. The lock is on unless
  `aspectLocked === false`.
- Every transform edit (`applyFillPx`, `patchFillAlign`, `reapplyClipFrameForContentFit`) first runs
  `clearClipTransformKeyframes` (fill_x / fill_y / scale_x / scale_y). A whole-clip rect wins over motion keyframes.
- Geometry reaches the engine through `refreshTimelineClipGeometryOnServer`: a PUT of the timeline plus a seek to
  the playback position. The seek happens only when this timeline is the one in `state.timeline.playback`, or
  when no playback timeline is known. Drags go through the WO-522 80 ms trailing throttle.
- A Content sizing change stores `contentFit`, then refits `fillPx` to `sceneLayerPixelRectForContentFit` when the
  media size is known. Unknown media keeps the rect.
- Centre origin: with `editorDefaults.coordinateOrigin = "center"`, X/Y show the layer centre's offset from the
  canvas centre. Stored data stays top-left (`displayPositionFromStoredPx` / `storedPxFromDisplayPosition`).
- Align buttons (`client/components/inspector-fill.js:59`): the web artwork mixes plain SVGs and SVGs that embed
  PNGs, so the Godot buttons draw the same glyphs procedurally in the theme text colour. They also need no import
  step (WO-596: no editor import).

### Slice 4 findings (2026-10-18) — keyframes

- Model (`client/lib/timeline-state-keyframes.js`): `{time (clip-local ms), property, value, easing}`.
  `addKeyframe` replaces the same property at the exact same time and sorts. `removeKeyframe` matches within
  0.5 ms. A drag (`clampKeyframeDragTime`, WO-152) stops 1 ms short of a same-property neighbour; other
  properties are no barrier. Fill / scale values are normalized to the program canvas.
- Canvas (`timeline-canvas-clip.js:318-372`, `timeline-canvas-snap.js:72-150`): diamonds per property colour,
  opacity / volume at value height (clamped 0–1, so volume > 1 draws at the top), others on the bottom lane. Hit
  box ±8 px. The drag snaps (`resolveSnappedEdge`) to bounds, playhead, flags, every clip edge and every other
  keyframe, and commits (PUT + seek to the playhead) only when the time changed. A double-click on a clip adds an
  opacity key with the current value (`timeline-editor-handlers.js:349`).
- Keys `i o p s v t` (`timeline-editor-inputs.js:322-357`) work with the clip selected, also while focus is in
  an inspector field. They do fade in / fade out over 500 ms, and record position / scale / volume / opacity at
  the playhead. The web has **no** keyframe delete on the canvas: Delete always removes the clip, and the
  `timeline-keyframe-select` event it dispatches has no listener.
- Playback: the engine (`timeline-keyframe-mixer.js`) tweens each segment toward the next key with the **end**
  key's easing. Scrub and pause send the linear `_lerp` value. The non-linear names failed in Caspar
  (WO-618, fixed first).
- Web limitations kept for parity, owner to decide:
  - Any X / Y / W / H edit drops every transform keyframe (`clearClipTransformKeyframes`). The hinted "set X
    then P" therefore always leaves a single position key. Motion is built from the Position keyframe rows or Add
    keyframe instead.
  - `addScaleKeyframe` writes one value (w / W) to both axes, which squashes media that is not the canvas shape.
    It is changed here (below).

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

### Slice 2 (2026-10-18) — clip editing

- `features/timeline/timeline_edit.gd` (new, pure) — `snapValue` / `collectTimelineSnapCandidates` /
  `resolveSnappedStart` (with the fix above) / `resolveSnappedEdge`, `edgeZone` (6 px), the clip-resize step
  (left: in-point += ⌊Δms·fps/1000⌋, ≥ 200 ms; right: ≥ 200 ms, in-point 0 when longer), `defaultClip` +
  editor defaults (`editorDefaults.timeline.contentFit / loopAlways`), `addClip` (naturalDuration),
  `updateClip` / `moveClipToLayer` / `removeClip` / `replaceClipSource`, `expandDurationToContent`,
  `sceneLayerPixelRectForContentFit` (with JS `Math.round` semantics), `containRectPreservingAspect`,
  `findMediaRow`, `nextLayerDisplayName`.
- `timeline_view.gd` — selection outline; click selects (empty track deselects); body drag moves (also to
  another layer), 6 px edge drag resizes with the playhead scrubbing the edge (engine seek ≤ every 100 ms + a
  trailing one); hover cursors; Delete/Backspace removes; `_can_drop_data` / `_drop_data` for the Sources
  payload `{type, value, label}` (below the last layer = a new one); `edited` fires once per gesture that changed
  start / duration / in-point / layer. Flags now read `timeMs` / `label`. Deferred `fit()`.
- `timeline_clip_inspector.gd` (new) — the clip page for the global Inspector (WO-608 R2), in web order:
  title, Position (SMPTE / ±offset / ms via `parse_tc`), Loop always (`{loopAlways, loop:false}`), Audio route
  (from `/api/scene/layer-options?mainIdx=<sendTo.screenIdx>`) / Mute / Volume (mixer fader curve), Opacity %,
  In-point (frames), and a Remove clip button.
- `timeline_tab.gd` — wiring: selection → `InspectorPanel.present/release`; every commit → `mark_dirty` +
  redraw + page refresh + PUT (POST fallback); volume / opacity / in-point use the web's 80 ms trailing sync; a
  route change re-seeks while playing so the engine re-applies it; the drop pipeline above.
- Not in this slice (later): keyframes (with eased preview),
  flags editing, layer header ops (rename, reorder, heights), effect drops, copy/paste.

### Slice 3 (2026-10-18) — clip transform

- `features/live/px_rect_math.gd` (new, pure, shared with the live layer inspector later). 1:1 ports of
  `displayPositionFromStoredPx` / `storedPxFromDisplayPosition` / `applyFillPxPatch` / `alignStoredPxRect` (JS
  `Math.round`), the clip aspect lock as `apply_patch(…, locked, ar)`, and `lock_ratio`.
- `features/live/align_row.gd` (new): the seven align buttons (`align(mode)` signal), with procedural icons.
- `timeline_clip_inspector.gd` adds the "Position / size (canvas px)" section in web order. It holds the centre-mode
  subtitle, the align row, X / Y / Width / Height, Aspect lock (`aspectLocked`), Content sizing (`contentFit`,
  plus a refit when the media size is known) and the hint. Every rect edit emits `fillPx` together with the
  keyframes minus the transform properties. Opacity and in-point now use the same "geometry" path.
- `timeline_tab.gd`: on selection it gives the page the program canvas (`channelMap.programResolutions` of the
  sendTo screen) and the origin setting, then probes the media size (`_media_res`) and passes it in with
  `set_content`, which ignores a stale reply. The "geometry" kind uses the 80 ms trailing sync, and that sync also
  seeks under the web's playback-timeline guard (`_pb_last`).

### Slice 4 (2026-10-18) — keyframes

- `timeline_keyframes.gd` (new, pure). It has the web mutations (add / remove / clear range / position and scale
  pairs / fade in / fade out / the shortcut keys), the drag clamp and an in-place `move` that keeps the dragged
  key's identity, marker geometry, the hit test and the snap candidates. `interp` matches the engine's `_lerp`.
  `eased` is the curve Caspar plays: Penner power and sine families, keyed by the end key, through the same name
  mapping as `toCasparTween`. Elastic, back and bounce preview as linear.
- `timeline_kf_draw.gd` (new): diamonds in the web colours and sizes, with the selected one outlined. Where the
  web joins opacity / volume keys with straight dashed lines, this draws the eased curve sampled every 3 px
  (decision 2 above).
- `timeline_view.gd`: a press on a diamond selects and drags it, snapped and clamped, and emits
  `keyframes_edited` only if the time changed. A double-click adds an opacity key. **Deviation:** Delete removes
  the selected keyframe (with its fill / scale partner), and removes the clip only when no key is selected.
- `timeline_kf_section.gd` (new): the Inspector groups from `inspector-fill-timeline.js`, in web order (Position
  in display px with centre-origin support, Scale, Opacity, Volume, then Add keyframe). Pairs are edited in place,
  so the canvas selection and the easing selectors keep their keys. A rebuild never happens while the operator is
  typing in a field.
- `timeline_tab.gd`: `_input` handles `i o p s v t` on the selected clip when the Timeline tab is visible. It
  skips text fields but not number fields, and commits a typed number first. Every keyframe edit syncs and
  re-seeks under the playback guard, so a paused preview shows it at once (the web re-seeks only after a drag).
- **Deviation:** `s` and the scale row keep each key's own x / y ratio (`scale_y = h / H`), so recording a scale
  key never changes the picture.

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

### Slice 2 verification (2026-10-18)

- Godot tests 739/0 (new `test_timeline_edit.gd`: 6 cases, goldens from the web formulas: snap / edge / resize /
  mutations / replace / fit rects / contain refit / media row lookup / layer names); `--check` boot clean;
  `check-max-file-lines` 0 over (tab 416, view 328).
- Box, GUI on DP-3 driven by XTest, every step read back from `GET /api/timelines/tmve1ppeug1t`:
  - Drop "1. GŁÓWNE TŁO" on Layer 1 → clip at 1870 ms, 60000 ms (CINF), timeline 63870, fillPx
    `{-960,-132,3840,1344}` (native, centred on 1920×1080); Inspector shows the clip page.
  - Body drag left + down → `startTime 0` (snapped), moved to Layer 2; Inspector title follows the layer.
  - Left edge +200 px → `startTime 2030, duration 57970, inPoint 50` (= ⌊2030·25/1000⌋); right edge drag →
    duration grows, in-point reset to 0.
  - Drop below the last layer → "Layer 4" created, picker shows 4 layers.
  - Clip-edge snap: Layer 4 clip dragged to raw 63159 → `startTime 63750.17` = the Layer 2 clip's end (no
    playhead nearby).
  - Replace-drop "3. TŁO 3" on the resized Layer 2 clip → source swapped, duration kept 61720,
    `naturalDuration 60000`, in-point 0.
  - Inspector: Opacity 50 → `0.5`; Loop always → `loopAlways true, loop false`; Position "5000" → `startTime
    5000`; Mute → `muted true`; Volume drag → `0.1009` (throttled sync).
  - Empty-track click → "Select an item"; Delete key and Remove clip each removed a clip on the engine;
    `GET /api/project` autosave matched (4 layers, no clips).
- Owner-QA open: route change while playing (re-seek path not exercised live); feel of snapping and
  resize scrubbing; a timeline edited here opened in the web editor.

### Slice 3 verification (2026-10-18)

- Godot tests 756/0 (new `test_px_rect_math.gd`: origin round trip, patch and lock, align with JS rounding).
  `--check` boot clean. `check-max-file-lines` reports 0 files over (tab 432, clip page 282).
- On the box, with the GUI on DP-3 driven by XTest, every step was read back from `GET /api/timelines/tmve1ppeug1t`
  and from the server's `[Timeline] MIXER` journal line. The clip was "1. GŁÓWNE TŁO", media 3840×1344, on a
  1920×1080 program.
  - Native: `fillPx {-960,-132,3840,1344}`. Content sizing "Fit canvas" gave `contentFit fill-canvas`,
    `fillPx {0,204,1920,672}`. "Stretch" gave `{0,0,1920,1080}`.
  - Width 960 with the lock on gave `{0,0,960,336}` (the media's ratio, not the stretched rect's). Align right gave
    `x 960`, and Align left after a restart gave `x 0`.
  - After each edit the engine re-applied the layer on preview: `MIXER 2-210 FILL 0 0 0.5 0.3111` and then
    `0.5 0 0.5 0.3111` (the seek path).
  - The Content sizing popup works with both mouse and keyboard.
- Owner-QA open: centre-origin mode (unit-tested only), the align icons' look, and the guarded seek while a
  *different* timeline plays.

### Slice 4 verification (2026-10-18)

- Godot tests 802/0. New `test_timeline_keyframes.gd` has 46 assertions: mutations, the drag clamp and identity,
  `_lerp` parity, the eased values (`easeoutquad` 0.75 at u = 0.5, Penner in-out / out-in), the tween-name mapping,
  marker / hit geometry, snap candidates and the shortcut keys. `--check` boot clean. `check-max-file-lines`
  reports 0 files over (tab 466, view 387).
- On the box, on clip "1. GŁÓWNE TŁO" (60 s), every step was read back from `GET /api/timelines/tmve1ppeug1t`:
  - `i` then `o` gave opacity `0@0, 1@500, 1@59500, 0@60000`. The re-seek primed preview with
    `MIXER 2-210 OPACITY 0 0` and `… OPACITY 1 13 linear DEFER`.
  - Two double-clicks added `1@22160` and `1@39841` (the current value). Setting 0.2 and then ease-in-out in the
    Inspector reached the engine as `{39841, 0.2, ease-in-out}`, and the canvas drew the S-curve.
  - Dragging the 22160 diamond gave 26756.8 (the web also stores fractional ms). The curve re-eased and the
    outline showed. Delete then removed that key alone.
  - With the playhead at 10 s, `p` and `s` gave `fill_x -0.3036 / fill_y 0 / scale_x 1.6073 / scale_y 1` at
    10019 ms, which is exactly the clip's `fillPx {-583,0,3086,1080}`. The re-seek re-applied preview.
  - The Inspector shows the Position, Scale and Opacity groups and Add keyframe at the normal Inspector width.
- A mouse pick in a popup missed once because the Inspector layout had moved between the screenshot and the click.
  Re-measured, hover and click match exactly.
- Owner-QA open:
  - The eased curve against what plays on air.
  - Centre-origin position rows.
  - Volume keys above 1 (drawn at the top, like the web).
  - Whether Delete should remove the keyframe.
  - The parity limitation "set X then P" (above).
