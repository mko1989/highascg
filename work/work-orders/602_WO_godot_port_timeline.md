**Status: IN PROGRESS (2026-10-18) — slice 1 (canvas read-only + transport + server-synced playhead), slice 2 (clip select / move / resize / delete, Sources drops, clip Inspector page) slice 3 (clip transform: align / X Y W H / aspect lock / content sizing) slice 4 (keyframes: canvas diamonds + eased curve, drag / double-click / Delete, i o p s v t keys, Inspector keyframe groups) slice 5 (flags: add / select / drag / Delete, flag Inspector page with jump and Companion button) slice 6 (layers: select / drag-reorder / divider resize, double-click add, right-click menu, layer Inspector page) and slice 7 (full transport bar + the timeline keyboard: copy / paste, Space, arrows, Enter) DONE, box-verified; slice 8 (Dest screen select, PRV availability, Take with transition, effect drops) open. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599, WO-600 (sources drag contract, PRV/PGM), WO-601 (timeline clip/flag/layer inspector sections).**

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

### Slice 5 findings (2026-10-18) — flags

- Model (`client/lib/timeline-state.js:117-154`, `timeline-state-model.js:18`): `{id ("f" + base-36 ms + 4
  random), timeMs, type ∈ pause | play | jump | companion_press, label, jumpTimeMs?, jumpFlagId?, companionPage?,
  companionRow?, companionColumn?}`. Add, update and duplicate re-sort by time (stable in JS) and grow the
  duration to the content. An unknown type becomes `pause`. Remove does **not** clear other flags'
  `jumpFlagId` that point at it. The engine ignores a dangling reference (`timeline-playback.js:184-192`), and a
  `jumpTimeMs` wins over a `jumpFlagId`.
- Canvas (`timeline-canvas-render.js:168-260, 372`): ruler stem + triangle in the type colour (pause red, play
  green, jump purple, Companion orange). A Companion flag shows its button's 28 px thumbnail
  (`/api/companion/button-preview/P/R/C.jpg`), or "P/R/C" while there is none. Dashed trails run through the
  tracks; the selected flag is blue with a solid trail. The hit is in the ruler only, ±10 px, first match.
- Pointer (`timeline-canvas-pointer.js:70-77, 221-223`): a press on a flag selects it instead of seeking. The
  drag sets `timeMs` to the raw cursor ms clamped to the timeline, with **no snap** and no rounding, and does not
  move the playhead. Selecting a flag clears the clip selection and the other way round. The "Flag" transport
  button adds a pause flag at the playhead and selects it. Delete / Backspace removes the selected flag
  (`timeline-editor-inputs.js:176`).
- Inspector (`inspector-panel-timeline-flag.js`): Position (SMPTE), Label, Action, then for a jump a time
  (`parseHmsInput`: hh:mm:ss:mmm, ++/-- offsets, plain ms; empty clears) or another flag. For a Companion press:
  the live preview (follows `companion.buttonPreview` over WS), the preview status (per `reason`, WO-535),
  Location "page row column", Page / Row / Column, "Choose button…" (picker modal) and Test press
  (`POST /api/companion/button-preview/test-press`). Then Remove flag.
- Ctrl+C / Ctrl+V of flags and Alt+←/→ nudges belong to the copy / paste and navigation slices.

### Slice 6 findings (2026-10-18) — layers

- Model (`client/lib/timeline-state.js:158-215`): `reorderLayer` moves the layer and its `layerHeights` entry.
  `insertLayerBelow(li)` inserts a new "Layer N" (next free number) after `li`, or appends one when `li` is out of
  range, with the default height. `removeLayer` drops the layer, its clips and its height. Heights are
  index-aligned with `layers`.
- Divider (`components/timeline-canvas-render.js:391`, `timeline-canvas-pointer.js:89, 189, 207`): a press on the
  line under a layer trades height with the layer below. Their sum stays the same, and each stays within
  [MIN_LAYER_H 28, MAX_LAYER_H 120]. With Shift, every layer grows or shrinks by the drag, each clamped. The
  heights are saved on release, or on mouseleave.
- Header (`timeline-editor-handlers.js:330-382`): a click selects the layer. This clears the clip and flag
  selection and shows the layer page. A drag on a header reorders live (`onMoveLayer`), and the result is saved
  on release. A right-click opens the menu (`createShowLayerContextMenu`, `:418`): Rename layer (browser
  `prompt()`, empty = no change), Add layer below, Remove layer (`confirm("Remove "X" and all its clips?")`).
- Double-click (`timeline-canvas-pointer.js:349-372`): on a clip it adds a keyframe (slice 4); elsewhere below the
  ruler it adds a layer.
- Layer page (`components/inspector-mixer.js:294-357`): "Timeline Layer N", Layer → Name (on change: trimmed,
  empty → "Layer N"), Actions → Add layer below / Remove layer (same confirm, then the empty Inspector).
- Delete never removes a layer. The web header is not drawn as selected.

### Slice 7 findings (2026-10-18) — transport and keyboard

- The slice 1 bar was a subset of the web's, and the gap was not recorded. The web bar
  (`client/components/timeline-transport.js:196-232`) has: picker, ✎ rename (`prompt`, empty = no change), + new,
  to start / play / stop / to end / loop (`POST …/loop {loop}`), the current-time field (`#tl-tc-cur`:
  `parseTcInput` with ++/-- offsets, commit on change / blur, Enter blurs) and the duration field (`#tl-tc-tot`:
  accepted only ≥ 1000 ms), Trim (duration = the last clip end, clips only, untouched when 0), Flag, zoom − / Fit /
  + (`canvas.zoom` ×1.18 around the left edge), Dest screen select, PRV (only when a preview bus exists), PGM, the
  Take group (transition / frames / tween / Take), Follow. The Dest, PRV and Take items go to slice 8.
- On opening or switching a timeline, the web reads `GET /api/timelines/:id/state` (`timeline-editor.js:178-224`)
  and adopts loop, position and playing. A 404 pushes the timeline. `timeline.playback` also carries `loop`
  (`:406`).
- Keyboard (`timeline-editor-inputs.js:96-376`) is document-global while the tab is active:
  - Ctrl/Cmd+C copies the selected clip (deep, with its layer), else the selected flag.
  - Ctrl+V pastes at the rounded playhead. A clip goes to the selected layer, else the copied layer clamped,
    else the last layer (`resolvePasteLayerIdx`). The web's selected layer is the last layer *or clip* clicked
    and is never cleared (`timeline-editor-handlers.js:170-175`). `insertClipClone` gives a new id, appends,
    grows the duration (start + dur + 2 s, then expandDurationToContent) and selects the copy. A pasted flag
    is `duplicateFlag` (no `jumpFlagId`).
  - Delete / Backspace removes the flag, else the clip, when not in a field.
  - Space plays / pauses.
  - Shift+←/→ moves the playhead to the previous / next snap point: 0, duration, playhead, flags, clip edges,
    rounded, > 1 ms away (`buildTimelineSnapCandidates`).
  - Alt+←/→ moves the selected flag (clamped to the duration) or clip start (clamped to duration − clip
    length) to the previous / next snap point, excluding itself.
  - Plain ←/→ moves the selected clip one frame, unless the last canvas click was on the ruler; then it moves
    the playhead one frame (`canvas.dataset.lastClicked`).
  - i o p s v t (slice 4).
  - Enter (`attachTimelineEditorInput`) focuses and selects the current-time field.
- Web quirks: Space, Shift+arrows and Ctrl+C / V fire even while typing in a text field. Space types nothing,
  Shift+arrow can't extend a selection, and Ctrl+C copies the clip instead of the text.

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

### Slice 5 (2026-10-18) — flags

- `timeline_flags.gd` (new, pure): the model mutations (add / update with null = drop the key, the web's
  `undefined` / remove / duplicate for the later paste), a stable sort (Godot's `sort_custom` is not stable),
  `hitFlag`, `parseHmsInput`, the Companion location parser and the "jump to flag" option text.
- `timeline_flag_draw.gd` (new): markers and trails as in the web. Companion thumbnails are cached per location,
  retried once after 1.2 s (the jpg route subscribes on demand), and dropped when `companion.buttonPreview`
  names that button. The page's preview shares the same cache.
- `timeline_flag_inspector.gd` (new): the web flag page in web order. Not ported: "Choose button…", because it
  is a modal (WO-608 modals); typing the location or Page / Row / Column does the same.
- `timeline_view.gd`: a ruler press on a flag selects and drags it (web parity: unsnapped, fractional ms, no
  seek), and `flags_edited` fires only if the time changed. Delete removes the selected flag. `select_flag` and
  `select` clear each other. The old yellow line + label flag drawing is replaced.
- `timeline_tab.gd`: the Flag button, the flag page in the global Inspector, and every flag edit through the
  same `_commit` (autosave + PUT). The media lookups moved to `timeline_media.gd` (unchanged code) to stay well
  under 500 lines.

### Slice 6 (2026-10-18) — layers

- `timeline_layers.gd` (new, pure): reorder (heights travel), insert below / append, remove, rename (the layer
  page's trim / empty → "Layer N" rule) and `divider_heights`, a line-for-line port of
  `applyLayerDividerMouseMove`.
- `timeline_layer_inspector.gd` (new): the layer page in web order, plus the header's right-click menu. Rename
  focuses the page's Name field with the text selected, instead of a `prompt()` (Godot has no blocking prompt,
  and the field is the same edit). Remove asks with a ConfirmationDialog. When the page switches layer while
  Name has focus, it first releases the focus, so a typed name commits to the layer it was typed for. Without
  this, the field kept the old text and wrote it into the newly selected layer on blur (found on the box).
- `timeline_view.gd`: divider press and drag (VSIZE cursor on hover, Shift = all layers), header press = select
  + live drag-reorder (the selection follows the moved layer), header right-click = select + menu, double-click
  on a header or empty track = add a layer below (appended past the last) and select it. A press on empty track
  inside the layer range selects that layer. `select`, `select_flag` and `select_layer` clear each other.
  Deviation: the selected header is drawn lit (`#1f2a37`) so the operator sees which layer the page edits.
- `timeline_view_draw.gd` (new): the canvas painting moved out of the view (unchanged code, called as
  `VD.draw(self)`) to keep the view under 500 lines (it had reached 504).
- `timeline_tab.gd`: the layer page in the global Inspector, and every layer edit through `_commit` (autosave +
  PUT) plus the picker's "(N layers)" text.

### Slice 7 (2026-10-18) — transport and keyboard

- `timeline_transport.gd` (new): the bar and all playback state moved out of the tab (tab 493 → 285 lines). It
  adds ✎ rename (a dialog with the name selected), |◀ / ▶| (Rewir and the fallback font have no ⏮ ⏭), loop (state
  from `timeline.playback` and `/state`), the current-time and duration fields (LineEdits: Enter releases,
  release commits, as the web's blur), Trim, − / +. The engine state is read on the first show and on every
  timeline switch.
  - Transport buttons never take focus, so Space is always the play key and never a focused button's press.
  - A click on a transport button first releases the current focus owner, like the web's blur on a button
    click. This commits a half-typed field. Without it the field kept focus and Ctrl+C went to the text (found
    on the box).
- `timeline_keys.gd` (new): the web handler, line for line, with i o p s v t moved here from the tab. Deviation
  (WO "Behaviours to decide" 1, extended): no key fires while a text field (LineEdit / TextEdit) or a dialog /
  popup has focus. i o p s v t still fire from the Inspector's SpinBox fields (the web's "set X then P"). Echo
  repeats only for the arrows.
- `timeline_nav.gd` (new, pure): snap points, previous / next, frame length, clips end (Trim), paste layer,
  paste clip.
- `timeline_view.gd`: `delete_selected()` (Delete is now the tab's global key, so it no longer needs canvas focus),
  `zoom_step()`, `last_clicked` (ruler / divider / header / track / clip, set on every left press), `last_layer`
  (the paste target; reset on a timeline switch).
- `timeline_tab.gd`: wires the transport and keys. `root()`, `refresh()`, `commit()`, `kf_commit()`,
  `clip_rect()` and `clip_canvas()` are its public surface for them.

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

### Slice 5 verification (2026-10-18)

- Godot tests 834/0. New `test_timeline_flags.gd`: mutations, stable order, duration growth, null-drops-key,
  duplicate, hit (±10 px, ruler only, not over the headers), `parseHmsInput` forms and offsets, the location
  parser. `--check` boot clean. `check-max-file-lines` reports 0 over (tab 466, view 423).
- On the box, test timeline `tmve1ppeug1t`, each step read back from `GET /api/timelines/tmve1ppeug1t`:
  - Seek to ~20 s, then Flag gave `{timeMs 20156, type pause, label ""}`, selected (blue), with its page in the
    Inspector. The playhead draws over the selected trail.
  - Label "Hold", then Action → Jump to showed the jump rows. `0:05:000` stored `jumpTimeMs 5000` and displays
    `00:00:05:000`. A second flag at 40194 appeared in "Or jump to flag" as `pause - 00:00:40:194`, and picking
    it stored `jumpFlagId`.
  - Dragging the first flag gave `timeMs 10136.947…` (fractional, as in the web). Selecting the 40 s flag and
    pressing Delete removed it.
  - Action → Companion button press showed the 1/0/0 button's real thumbnail ("UP") in the ruler and the page,
    and the status "Preview via Companion Satellite". The status was empty at first when the type was changed
    in place; fixed by loading it on that change. Location `99 7 7` stored page / row / column, and the thumbnail
    became Companion's blank render. Test press on that empty button showed "Test press failed: Companion HTTP
    404" (the endpoint's real answer; it first read "404.0", now formatted as an integer).
  - Engine: Action → Pause, seek to 8 s, ▶. `GET …/state` then read `{position 10175, playing false}`, paused one
    tick past the 10137 flag, and the transport showed ▶ at 00:00:10:04.
  - Position `++1000` gave 11136.9. Remove flag gave `flags: []` (the test timeline's original state).
  - Selecting the clip afterwards still fills its page (content sizing known), so the `timeline_media.gd` move works.
- A Test press click "missed" because of a measuring error, not the UI: `ffmpeg` clamps a crop whose x + width
  passes 3840, so that crop's coordinates were off by 80 px.
- Owner-QA open:
  - The thumbnail and live update against a real Companion page change.
  - A jump flag in playback.
  - Whether a dangling `jumpFlagId` should be cleared on remove (web keeps it).

### Slice 6 verification (2026-10-18)

- Godot tests 857/0. New `test_timeline_layers.gd`: reorder with heights, same-index and out-of-range moves,
  insert below / append, remove with height, rename trim / empty, display name, and divider cases (trade, MIN
  clamp with the sum kept, partner at MAX holds, clamp at MAX, partner at MIN caps the grow, Shift grow, Shift
  clamp). `--check` boot clean. `check-max-file-lines` reports 0 over (view 414, draw 104, tab 493).
- On the box, test timeline `tmve1ppeug1t` (4 layers, heights 54), each step read back from
  `GET /api/timelines/tmve1ppeug1t`:
  - A click on Layer 2's header lit it, and the Inspector showed "Timeline Layer 2 / Name Layer 2 / Add layer
    below · Remove layer". Name "Lower thirds" + Enter was stored.
  - Dragging that header onto Layer 4 gave the order `Layer 1, Layer 3, Layer 4, Lower thirds`. The selection
    and page followed ("Timeline Layer 4").
  - Dragging the divider under Layer 1 down 20 px gave heights `[74, 34, 54, 54]`. A Shift-drag up 10 px on the
    next divider gave `[64, 28, 44, 44]` (Layer 3 clamped at 28).
  - A double-click on Layer 3's header inserted "Layer 5" below it (`[64, 28, 54, 44, 44]`). A double-click on
    the empty area below the last layer appended "Layer 6" (height 54) and selected it. The picker read
    "Timeline (6 layers)".
  - Right-click on a header first did nothing: the right-button branch was nested inside the left-button one.
    Fixed. It then selected the layer and opened Rename / Add layer below / Remove layer at the mouse. Rename
    focused Name with the text selected, and typing "Graphics" + Enter stored it.
  - Name-field focus bug (see What was done): typed " B" into Name, then right-clicked another layer. Before the
    fix the field kept "Graphics" for the other layer. After it, " B" was stored on Graphics and the field read
    "Lower thirds".
  - Menu → Remove layer showed `Remove "Lower thirds" and all its clips?`. Cancel left all 6 layers. Remove
    deleted the layer and its height (`[64, 28, 54, 44, 54]`), released the Inspector, and the picker read 5
    layers. The page's own Remove button opens the same dialog.
  - A click on empty track in Layer 4 selected it. The page's "Add layer below" inserted "Layer 7" after it.
    Clicking the clip afterwards swapped the Inspector back to the clip page.
- The playhead showed 00:00:10:04 after the first sync. That is the engine's real paused position
  (`GET …/state` → 10175, left by the slice 5 pause-flag test), not a layer side effect.
- The test timeline was left with the edited layers (`Layer 1, Layer 3, Graphics B, Layer 4, Layer 7, Layer 6`).
  It is the dev box's scratch timeline in an Untitled project.
- Owner-QA open:
  - The lit selected header (deviation).
  - Rename via the Name field instead of a prompt.

### Slice 7 verification (2026-10-18)

- Godot tests 876/0. New `test_timeline_nav.gd`:
  - snap points: unique, sorted, rounded, exclusions;
  - previous / next with the 1 ms epsilon;
  - frame length and a bad fps;
  - clips end ignores flags;
  - paste layer: all three fallbacks;
  - paste clip: new id, deep copy, append, the duration grows, a missing layer.

  `--check` boot clean. `check-max-file-lines` reports 0 over (tab 285, view 441, transport 381).
- On the box, test timeline `tmve1ppeug1t`, read back from `GET /api/timelines/tmve1ppeug1t` and `…/state`.

  Transport:
  - Loop gave engine `loop: true`. Current time `00:00:20:00` gave position 20000, and `++500` gave 20500.
  - ▶| gave 125651 (the duration) and |◀ gave 0.
  - Duration `00:01:30:00` gave 90000. `500` was rejected (stays 90000). Trim gave 60000 (the clip end), and
    the end shade moved.
  - Zoom: Fit at 8.5 px/s, three + to 14.0 px/s, one − to 11.8 px/s (×1.18 steps).
  - ✎ "Main show" + Enter stored the name, and the picker followed.

  Keyboard:
  - Clip copy / paste: selected the clip, Ctrl+C, clicked Layer 4's header, time 30 s, Ctrl+V. That gave a new
    clip on Layer 4 at 30000 with the source's keyframes, selected, with its page shown. The duration became
    92000.
  - Frame nudges: → → ← moved it to 30040.
  - Alt+← snapped it to 30000 (the playhead). Alt+→ aimed at the next point and was clamped to 32000
    (duration − clip length), as in the web.
  - Shift+→ → ← moved the playhead 32000 → 60000 → 32000.
  - After a ruler click at 9989.1, → → → ← moved the playhead (+80). The clip did not move.
  - Space played (`playing: true`, position advancing). Space again paused.
  - Enter focused the time field with its text selected. Typing `5:00` + Enter gave 5000.
  - Space while that field was focused did not play.
  - Flags: typed 8 s without Enter, then clicked Flag. The blur committed the seek, and the flag was added at
    8000 and selected. Ctrl+C, time 20 s, Ctrl+V gave a new flag at 20000. Alt+→ moved it to 32000 (the clip
    start). Delete removed it, without the canvas having focus.
  - Delete with a clip selected removed the clip.
  - `t` at 20017 added `opacity 0.603` (the eased value). Selecting that diamond and pressing Delete removed
    only the keyframe.
  - Restarting the GUI with the engine at 20000 and loop on showed `00:00:20:00`, the playhead at 20 s and Loop
    lit (the engine state is read on open).
- Restored afterwards: name "Timeline", one clip, no flags, loop off, duration 60000.
- Owner-QA open:
  - The |◀ / ▶| glyphs.
  - Keys never fire from text fields (deviation from the web).
  - The rename dialog in place of `prompt()`.
