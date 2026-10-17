> **Provenance:** Haiku-generated inventory (2026-10-17) for [WO-593](../../work-orders/593_WO_godot_client_port_epic.md), spot-checked by hand where a WO relies on it. Line refs are to the 2026-10-17 tree (synced to `origin/main` d5521d50) and will drift; re-grep before acting on one.

# D: Timeline, audio, media and related client features (inventory)

Repo root: `/Users/marcin/highascg` (read-only inventory; no files modified, no git commands run).
All paths are relative to the repo root. Line numbers are from reading the files at inspection time.

## Scope and method notes

- Prefix globs matched 108 unique JS files (48 under `client/components/`, 60 under `client/lib/`) and 20 CSS files under `client/styles/`. `streaming-channel-state.js` matches two globs and is counted once.
- `client/components/lower*` matches nothing. The lower-third operator UI is `client/components/inspector-lower-third*.js`, which is outside the prefix list. It is cited below only where it is the caller of an in-scope lib file.
- `client/components/map-explorer.js` (1059 LOC) is a standalone developer code-map page (`map.html`, `assets/map-data.json`). It is not an operator feature. `client/assets/map-data.json` was not present in `client/assets/` at inspection time.
- `client/styles/02c-timeline-multiview-sources-sidebar.css` is a 5-line index/comment file.
- CSS is assigned to features by selector content (grep for class prefixes). Shared files are noted.
- Wrapper files that import in-scope code but are outside the prefix list (e.g. `header-bar-led-test.js`, `device-view-actions.js`, `app-ws-handlers.js`) are cited as callers only.

---

## 1. Timeline editor (canvas NLE)

### Files
- `client/components/timeline-canvas.js` — 249 — canvas orchestrator: owns view state (`pxPerMs`, `scrollX`, `scrollY`), schedules redraws via rAF, follow-playhead logic.
- `client/components/timeline-canvas-clip.js` — 424 — draws one clip: palette fill, thumbnail, waveform strip, keyframe markers, edge handles; fetches waveform JSON.
- `client/components/timeline-canvas-pointer.js` — 404 — mouse state machine (mousedown/move/up/leave, dblclick, contextmenu) for seek, flags, layers, clips, keyframes, dividers.
- `client/components/timeline-canvas-render.js` — 424 — full-frame draw (ruler, layer headers, tracks, clips, flags, playhead) and hit-test helpers.
- `client/components/timeline-canvas-snap.js` — 148 — pure snap math for clip move/resize and keyframe drag.
- `client/components/timeline-canvas-utils.js` — 127 — SMPTE/timecode formatting and parsing, `roundRect`.
- `client/components/timeline-canvas-wheel.js` — 100 — wheel zoom/pan, `dragover`/`drop` of a source onto the canvas.
- `client/components/timeline-editor.js` — 472 — editor shell: builds transport, canvas, playback runtime; subscribes to `timeline.tick` / `timeline.playback`.
- `client/components/timeline-editor-handlers.js` — 469 — callbacks passed into the canvas (seek throttle, source drop, keyframe ops, layer context menu, toasts, media duration/resolution resolution).
- `client/components/timeline-editor-inputs.js` — 406 — document-level keydown shortcuts (copy/paste, Delete, Space, arrows, I/O/P/S/V/T keyframe keys), Enter to focus timecode.
- `client/components/timeline-editor-playback.js` — 123 — per-timeline playback map, client-extrapolated playhead clock, rAF playback loop.
- `client/components/timeline-editor-split.js` — 51 — draggable preview/timeline split, height persisted.
- `client/components/timeline-transport.js` — 429 — transport bar DOM: play/stop/loop/follow, timecode fields, zoom, screen selector, take (transition/duration/tween), `syncToServer` (PUT).
- `client/lib/timeline-state.js` — 297 — client `TimelineStateManager`: CRUD, localStorage cache, server sync.
- `client/lib/timeline-state-model.js` — 195 — timeline JSON shape, defaults, normalization, sendTo coercion.
- `client/lib/timeline-state-clips.js` — 150 — clip and flag mutation helpers (mixed into the state manager).
- `client/lib/timeline-state-keyframes.js` — 109 — keyframe add/clamp/clear helpers, position and scale keyframe presets.
- `client/lib/timeline-track-heights.js` — 97 — per-layer heights (default 54, min 28, max 120 px), layer-at-Y and divider hit math.
- `client/lib/timeline-clip-interp.js` — 78 — keyframe interpolation and pixel rect at a clip-local time.
- `client/lib/timeline-clip-layout.js` — 50 — computes `clip.fillPx` from media resolution and `contentFit`.
- `client/lib/timeline-compose-preview.js` — 32 — rule for which compose cell shows timeline output vs live bus.
- `client/lib/timeline-program-canvas.js` — 52 — program canvas dimensions for the timeline's `sendTo` screen.
- `client/lib/waveform-fetch-queue.js` — 30 — spaces waveform GETs 120 ms apart.
- `client/lib/wheel-delta.js` — 32 — `deltaX`/`deltaY` normalization with touchpad inversion setting.
- CSS: `client/styles/02c-timeline-multiview-sources-sidebar.css` (5), `client/styles/02c1-timeline-sidebar.css` (68), `client/styles/05b-timeline-editor.css` (199).

Subtotal: 24 JS files, 4948 LOC; CSS 272 LOC.

### What the operator can do
- Scrub: click or drag on the ruler seeks the playhead; each move sends a seek (throttled in handlers). Empty-track click only deselects.
- Zoom: vertical wheel zooms around the cursor; horizontal wheel/trackpad pans time; Alt+vertical pans layers; Shift+vertical pans time. Zoom-fit button. Zoom in/out buttons (`#tl-zp`, `#tl-zm`, `#tl-zf` in transport).
- Clips: drag to move (time and layer); drag left or right edge to resize (left edge also moves `inPoint`); double-click on a clip adds a keyframe at the click time; Delete/Backspace removes the selected clip.
- Keyframes: drag diamonds; I/O (opacity fade in/out over 500 ms), P (position), S (scale), V (volume), T (opacity) add keyframes at the playhead or clip-local time (works from canvas or inspector fields).
- Flags: add flag (`#tl-add-flag`), drag flag on ruler, Delete removes selected flag, Ctrl/Cmd+C/V copies and pastes clips or flags at the playhead.
- Layers: drag header to reorder; drag divider to resize layer height; double-click empty area or header adds a layer; right-click the layer header area opens a menu (rename via prompt, add, remove).
- Drop a source from the sources panel onto the canvas: adds a clip at the drop time on the drop layer. An effect source dropped on a clip appends an effect instance.
- Transport: play/stop, loop, follow toggle, timecode entry (`#tl-tc-cur`, `#tl-tc-tot`), send-to selector (`#tl-screen`, `#tl-s-prev`, `#tl-s-pgm`), take with transition type, duration and tween, new/select/rename timeline (`#tl-new-tl`, `#tl-select`, `#tl-rename-tl`).
- Preview split: drag handle between preview and timeline, height persisted.

### Rendering tech (with evidence)
- Canvas 2D: `client/components/timeline-canvas.js:70` (`canvas.getContext('2d')`), `client/components/timeline-canvas.js:68` (container innerHTML is a single `<canvas class="tl-canvas">`).
- Canvas draw calls: `timeline-canvas-render.js:116,147,193,200,322` (`fillText`, `drawImage`); `timeline-canvas-clip.js:160,171,213,215,315,393,418` (`roundRect`, `drawImage`, `fillText`).
- Thumbnails and clip images: `new Image()` at `timeline-canvas-clip.js:199`, `src` at `:209`; loaded image drawn at `:215`.
- Redraw loop: rAF in `timeline-canvas.js:169`; playback loop rAF in `timeline-editor-playback.js:88,100,102`.
- No `devicePixelRatio` handling anywhere in scope. Canvas size comes from container `getBoundingClientRect()` (`timeline-canvas.js:184-191`).
- DOM for transport, menus, toasts: `timeline-transport.js`, `timeline-editor-handlers.js:23-28,426-431` (layer menu via `innerHTML` plus inline `style.cssText`).

### Interaction
- Mouse: `timeline-canvas-pointer.js:62` mousedown, `:175` mousemove, `:299` mouseup, `:338` mouseleave, `:349` dblclick, `:392` contextmenu.
- Pointer drag types (`api.drag.type`): `seek` (`:79`), `flag-move` (`:74`), `layer-divider` (`:92`), `layer-move` (`:107`, applied at `:211-219`), `clip-move` (`:155`, applied at `:228-242`), `clip-resize` (`:144-153`, applied at `:243-279`; `edge` = left/right from `edgeZone`), `keyframe-drag` (`:130-138`, applied at `:280-294`).
- Drag-and-drop: `timeline-canvas-wheel.js:77-80` `dragover` sets `dropEffect='copy'`; `:82-99` `drop` reads `application/json` via `dataTransfer.getData` and calls `onDropSource(source, li, ms)`. Source → canvas only. No OS file-drop handling found in scope (no `Files` type check).
- Context menu: `timeline-canvas-pointer.js:392-403` (track area only, not ruler or header); menu built in `timeline-editor-handlers.js:418-464`.
- Prompts: `timeline-editor-handlers.js:439` (layer name), `timeline-transport.js:265` (rename timeline).
- Keyboard (document capture listener, `timeline-editor-inputs.js:389`, gated by the timeline tab being active at `:94` and `:13-14`):
  - Ctrl/Cmd+C: `:118`; Ctrl/Cmd+V: `:134`.
  - Delete/Backspace flag: `:176`; delete clip: `:370` (both gated by `!inField`).
  - Space toggles play: `:187-190`. **Not gated by `inField`**, so Space typed into a timeline-tab input is consumed (`preventDefault`) and toggles playback.
  - Shift+Arrow: `:193-210` (snap-point seek). Alt+Arrow: `:211`. Arrow: `:263`.
  - Keyframe keys `CLIP_KEYFRAME_KEYS` (`:10`): I `:323`, O `:327`, P `:338`, S `:348`, V `:351`, T `:354`.
  - Enter in root focuses `#tl-tc-cur` (`:391-400`); Enter blurs the timecode fields (`timeline-transport.js:393,413`).
- Wheel: `timeline-canvas-wheel.js:28-75`; `preventDefault` at `:29`, `{passive:false}` at `:75`. Zoom accumulator threshold 50 (`:11`), zoom step 1.1 (`:10`), `ZOOM_FACTOR` 1.18 (`:9`), `pxPerMs` clamp 0.0001 to 5.0 (`:7-8`).
- Settings-driven wheel inversion: `lib/wheel-delta.js:23-29` reads `settings.ui.invertTouchpadScroll`.

### Server contract
- REST (all `api` client, `client/lib/api-client.js`):
  - `GET /api/timelines/{id}/state` — `timeline-editor.js:183`.
  - `PUT /api/timelines/{id}` (whole timeline sync) — `timeline-transport.js:63`.
  - `POST /api/timelines` (create) — `timeline-transport.js:66`.
  - `POST /api/timelines/{id}/sendto` — `timeline-transport.js:76,128`.
  - `POST /api/timelines/{id}/seek` `{ms}` — `timeline-transport.js:99,127`; `timeline-editor-handlers.js:148,154,167,285,291,373`; `timeline-editor-inputs.js:205,308`.
  - `POST /api/timelines/{id}/pause` — `timeline-transport.js:120`.
  - `POST /api/timelines/{id}/play` `{from, sendTo}` — `timeline-transport.js:129`.
  - `POST /api/timelines/{id}/stop` `{force:true}` — `timeline-transport.js:155`.
  - `POST /api/timelines/{id}/loop` `{loop}` — `timeline-transport.js:292`.
  - `POST /api/timelines/{id}/take` `{transition, duration, tween, screenIdx}` — `timeline-transport.js:362-367` (preceded by `syncToServer`).
  - Media: `POST /api/media/cinf` `{id}` — `timeline-editor-handlers.js:72`; `GET /api/media` — `timeline-editor-handlers.js:49`, `lib/timeline-clip-layout.js:38`.
  - Waveform: `GET /api/local-media/{value}/waveform?bars=N` — built at `timeline-editor-handlers.js:318`; fetched at `components/timeline-canvas-clip.js:245`. Bars tiers: 512 / 2048 / 8192 (`timeline-canvas-clip.js:16`, selector `:18-24`; handlers `:306-313`).
  - Thumbnail: `getThumbnailUrl(value, 320, 2)` at `timeline-editor-handlers.js:299` (helper defined in `client/lib/thumbnail-url.js:45`, outside scope).
- WebSocket (read only, via stateStore):
  - `timeline.tick` — `app-ws-handlers.js:189` (outside scope) → `stateStore`; consumed at `timeline-editor.js:424`.
  - `timeline.playback` — `app-ws-handlers.js:190` → `timeline-editor.js:425`.
  - `compose.preview` refresh — subscribed at `timeline-editor.js:349` (source `app-ws-handlers.js:194`, outside scope).
- Sends no WS messages.

### Client state
- stateStore keys read: `timeline.tick`, `timeline.playback`, `channelMap` (`timeline-editor.js:426`), `media` (`timeline-clip-layout`/`handlers` via `getState().media`), `scene` (via `sceneState`, `screenChange` at `timeline-editor.js:449`).
- localStorage:
  - `casparcg_timelines_v1` — `lib/timeline-state-model.js:9` (`STORAGE_KEY`); written `timeline-state.js:229,247`; read `:256`. Holds `{timelines, activeId}`. Server sync is the source of truth per the file header.
  - `casparcg_timeline_preview_split_px` — `timeline-editor-split.js:5,10,41` (range 120–1200, default 220).
- In-memory: `playbackById` and `clockById` maps (`timeline-editor-playback.js:15-17`); view state object `api` in `timeline-canvas.js:74-133`; thumbnail and waveform caches (`timeline-canvas.js:65-66`).

### Browser APIs used
- Canvas 2D (see above). `requestAnimationFrame` `timeline-canvas.js:169`; `timeline-editor-playback.js:88-102`, `cancelAnimationFrame` `:107`.
- `window` `resize` listener `timeline-canvas.js:179`.
- `DataTransfer` `getData('application/json')` and `dropEffect` `timeline-canvas-wheel.js:79,89`.
- `Image` `timeline-canvas-clip.js:199`.
- `fetch` `timeline-canvas-clip.js:245`.
- `localStorage` `timeline-editor-split.js`, `timeline-state.js`.
- `document` keydown capture `timeline-editor-inputs.js:389`.
- `CustomEvent` dispatch on `window`: `timeline-clip-select`, `timeline-flag-select`, `timeline-keyframe-select` (`timeline-editor-handlers.js:347`, `timeline-editor-inputs.js` and `timeline-editor-handlers.js:153-154`).
- `setTimeout` throttle for seek (`timeline-editor-handlers.js:150,287`).
- `prompt()` `timeline-editor-handlers.js:439`, `timeline-transport.js:265`; `confirm()` `timeline-editor-handlers.js` (delete confirm).

### Port-risk notes
- Pure, portable logic:
  - Snap math in `timeline-canvas-snap.js` (no DOM imports, header line 3). `snapValue` (`:6-17`); `resolveSnappedStart` (`:39-60`): chooses between start-snap and end-snap, then "now" snap at 14/8 × threshold (`:51`); `resolveSnappedEdge` (`:62-70`); keyframe candidates (`:83-99`); keyframe marker Y uses value-aware height only for `opacity`/`volume` (`:108-120`).
  - Interpolation in `lib/timeline-clip-interp.js:16-31`: piecewise linear between sorted keyframes, returns the default before the first key and the last value after the last key. **Easing is ignored**: keyframes are written with `easing:'linear'` (`timeline-state-keyframes.js:63-71`) and `interpClipProp` never reads `easing`.
  - Track height and hit math `lib/timeline-track-heights.js` (pure).
  - Timecode: `timeline-canvas-utils.js:6-13` `fmtTimecode` (default 25 fps when falsy; frame index `floor(ms*fps/1000)`); `fmtSmpte` (`:~21-28`); `fmtHms` ms-based (`:~33-41`); `parseHmsInput` (`:~43-...`) accepts `++500`/`--500` offsets.
  - View math `timeline-canvas.js`: `msAt`/`xAt` (`:110-115`), `zoomFit` = `(canvas.width - HEADER_W - 20)/duration` (`:204`), follow-playhead margin 80 px with auto-scroll state (`:209-243`).
  - Playhead clock `timeline-editor-playback.js:49-78`: `serverTickPos + (Date.now() - serverTickAt)`; server ticks snap if more than 80 ms ahead (`:21,70`) and are ignored if more than 35 ms behind (`:23,72`).
  - Clip resize: left edge converts ms delta to frames with `Math.floor(deltaMs*fps/1000)` and adjusts `inPoint` (`timeline-canvas-pointer.js:255-258`); minimum duration 200 ms (`:254,269`); right-edge grow resets `inPoint` to 0 (`:271`). Left edge only applies when `newDur > 200` (`:254`), right edge clamps to 200 (`:269`).
- DOM-entangled: `timeline-canvas-pointer.js`, `timeline-canvas-render.js` (depend on `api` object and canvas), `timeline-editor-inputs.js` (reads `document.getElementById`, `closest('input,...')`).
- Note: `timeline-state.js` header describes the client manager as the source of truth for timeline structure on the client, persisted to localStorage and synced to the server with PUT (`timeline-transport.js:60-63`).
- Waveform fallback: when peaks are empty, a synthetic sine waveform is drawn: `timeline-canvas-clip.js:52-54,275`. Waveform sampling tiles the source over clip duration (`:57-64`).
- Canvas is not DPR-scaled (see above). Hit-testing is in CSS px, drawing in canvas px.
- No OS file drops onto the timeline canvas; only sources from the in-app sources panel (`application/json`).

---

## 2. Audio mixer, meters and cross-screen audio routing

### Files
- `client/components/audio-mixer-panel.js` — 155 — Inspector "program master faders" collapsible section; subscribes to `stateStore` `*`, `sceneState`, `settingsState`.
- `client/components/audio-mixer-panel-input-layers.js` — 276 — layer-strip list in the Inspector mixer (faders, solo, stop audio-only).
- `client/components/audio-mixer-panel-live-inputs.js` — 320 — live input strips (SDI/USB/live audio), auto-mix policy toggles.
- `client/components/audio-mixer-panel-masters.js` — 82 — master/bus faders in the Inspector panel.
- `client/components/audio-mixer-panel-sync.js` — 61 — gain-to-fader sync helper.
- `client/components/audio-mixer-cross-screen-bind.js` — 59 — click wiring for the "Screens" routing matrix (WO-284).
- `client/components/audio-mixer-view.js` — 57 — full Audio Mixer tab view shell.
- `client/components/audio-mixer-view-console.js` — 125 — full mixer console: groups, live inputs, masters.
- `client/components/audio-mixer-console-input-groups.js` — 283 — console input groups (layers grouped by program channel).
- `client/components/audio-mixer-console-live-inputs.js` — 233 — console live input strips.
- `client/components/audio-mixer-console-masters.js` — 99 — console master faders and solo.
- `client/lib/audio-mixer-meter-loop.js` — 143 — 50 ms interval meter loop with smoothing; writes fill heights.
- `client/lib/audio-mixer-peaks.js` — 159 — reads dBFS peaks from OSC state, falling back to variable strings.
- `client/lib/audio-input-meter-map.js` — 89 — level → meter mapping, `NO_DATA` / `SILENCE` / `SIGNAL` states (pure).
- `client/lib/audio-mixer-bus-meters.js` — 66 — program bus width and meter fill key parsing.
- `client/lib/audio-mixer-meter-eligibility.js` — 168 — when a strip may show VU activity (playing + carries audio).
- `client/lib/audio-mixer-rows.js` — 301 — builds mixer rows from scene layers (still images excluded).
- `client/lib/audio-mixer-state.js` — 128 — persisted master gains, layer routes, solo list (localStorage).
- `client/lib/audio-mixer-volume-api.js` — 53 — `POST /api/audio/volume` with debounce helper.
- `client/lib/audio-mixer-fader-bind.js` — 26 — fader reset to 0 dB on double-click or Ctrl/Cmd+pointerdown.
- `client/lib/audio-mixer-ui.js` — 35 — filename shortening for narrow labels.
- `client/lib/audio-volume-scale.js` — 86 — linear gain ↔ Caspar dB, piecewise fader curve (pure).
- `client/lib/audio-routes.js` — 71 — stereo pair id → output channel indices by program layout (pure).
- `client/lib/audio-channel-layouts.js` — 66 — channel layout ids for PortAudio outputs and program bus.
- `client/lib/audio-cross-screen-routing.js` — 133 — rules for sending a layer's audio to another screen's program channel (pure).
- `client/lib/audio-cross-screen-apply.js` — 78 — applies and persists cross-screen routing (AMCP first, persist on success).
- CSS: `client/styles/07b-audio-mixer-modal-shell.css` (357), `07b3-audio-mixer-modal-shell-controls.css` (162), `07c-audio-mixer-view.css` (7), `07c1-audio-mixer-view-shell-header.css` (114), `07c2-audio-mixer-view-console-layout.css` (100), `07c3-audio-mixer-view-channel-strip.css` (277), `07c4-audio-mixer-view-matrix-empty-modal.css` (184).

Subtotal: 26 JS files, 3352 LOC; CSS 1201 LOC.

### What the operator can do
- Move program master faders (MIXER master volume) from the Inspector section or the full mixer tab.
- Move per-layer faders on each program channel; double-click a fader (or Ctrl/Cmd+click) resets to 0 dB.
- Solo layers or masters (`POST /api/audio/solo`), stop audio-only layers (`POST /api/scene/audio-only/stop`).
- Toggle auto-mix policy for live inputs (`POST /api/settings` with `casparServer.audio_auto_mix` and `policyKey`).
- Route a layer's audio to another screen via the "Screens" matrix (cross-screen apply, see `audio-cross-screen-apply.js`).
- Read per-strip VU meters that distinguish no data, silence, and signal.
- Expand/collapse the Inspector mixer section (persisted).

### Rendering tech (with evidence)
- DOM only. Strips are built with `innerHTML` (e.g. `audio-mixer-console-input-groups.js`, `audio-mixer-panel.js`).
- Faders are native `<input type="range" class="audio-mixer-view__fader" min="0" max="100">`: `audio-mixer-console-input-groups.js:125`, `audio-mixer-console-live-inputs.js:91`, `audio-mixer-console-masters.js:39`.
- Meters are `div` fills whose `style.height`/`style.width` is set per tick (`lib/audio-mixer-meter-loop.js:110-116`, `:138`). No canvas, no SVG.
- No `<audio>`, no Web Audio. Audio is handled entirely server-side by Caspar; the client only reads levels.

### Interaction
- Fader pointer: native range plus `fader.addEventListener('dblclick')` `lib/audio-mixer-fader-bind.js:17` and `pointerdown` with meta/ctrl `:21-26`.
- No drag-and-drop in scope (`dragstart`/`drop` not found).
- Cross-screen matrix click wiring: `audio-mixer-cross-screen-bind.js:10` imports `toggleCrossScreenAudio`; `audio-cross-screen-apply.js:12-13` imports `sceneState`, `clearRouteFromChannel`, `playRouteOnChannel` (from `lib/live-audio-routing.js`, outside scope).
- Keyboard: none found in audio files.

### Server contract
- REST:
  - `POST /api/audio/volume` `{channel, master:true | layer, ...volumeApiPayload(linearGain)}` — `lib/audio-mixer-volume-api.js:31`.
  - `POST /api/audio/solo` `{solos}` — `audio-mixer-console-input-groups.js:207`, `audio-mixer-console-masters.js:55`, `audio-mixer-panel-input-layers.js:154`.
  - `POST /api/scene/audio-only/stop` `{channel}` — `audio-mixer-panel-input-layers.js:206`.
  - `POST /api/settings` `{casparServer:{audio_auto_mix}}` — `audio-mixer-panel-live-inputs.js:60`; `{casparServer:{[policyKey]}}` — `:136`; `:205`.
- WebSocket: none sent. Levels come from `getAppOsc()` (OSC client) and from `variables` (`osc_ch{N}_audio_L/R` and `osc_ch{N}_audio_c{K}_dBFS` keys, `audio-mixer-peaks.js:18-35`). Variable updates arrive via WS `variable_update` (see the Variables section).
- Cross-screen apply goes through `live-audio-routing.js` (outside scope).

### Client state
- stateStore: `stateStore.on('*')` at `audio-mixer-panel.js:130` and `audio-mixer-view-console.js:92`; `sceneState` `change`/`softChange` (`audio-mixer-panel.js:147-148`, `audio-mixer-view-console.js:108-109`); `settingsState.subscribe` (`audio-mixer-panel.js:146`, `audio-mixer-view-console.js:110`). Reads `scene.live[ch].scene.layers` (`audio-mixer-peaks.js:6-14`), `variables`, `getState().scene`.
- localStorage:
  - `casparcg_audio_mixer_v1` — `lib/audio-mixer-state.js:6` (`STORAGE_KEY`), read `:12`, write `:28`. Stores `{master, layerRoutes, soloedLayers}` (typedef at `:389`).
  - `highascg_inspector_program_audio_expanded` — `audio-mixer-panel.js:15` (`LS_EXPANDED`).
- Module-level maps: `meterFills`, `meterLayerMeta`, `meterSmooth` passed into the meter loop (`lib/audio-mixer-meter-loop.js:14-22`).

### Browser APIs used
- `setInterval` 50 ms: `lib/audio-mixer-meter-loop.js:42,138` (`TICK_MS = 50`), cleared at `:50`. Skips work when `document.hidden` (`:62`).
- `document.hidden` `lib/audio-mixer-meter-loop.js:62`.
- `setTimeout` debounce `lib/audio-mixer-volume-api.js` (`debounceAsync`, default 80 ms).
- `localStorage` (see above).
- `console.warn` only; no error UI in volume path.

### Port-risk notes
- Pure math (portable):
  - Gain ↔ dB: `linearGainToCasparDb` clamps to [-60, +6] dB; `g <= 0` maps to -60 (`lib/audio-volume-scale.js:8-14`). `casparDbToLinearGain` (`:16-19`). `formatVolumeDb` shows "−∞" at the floor (`:23-27`).
  - Fader taper: `FADER_CURVE` table with breakpoints 100→+6, 83.333→0, 66.667→-6, 50→-12, 33.333→-24, 16.667→-48, 0→-60 dB (`:29-37`); linear interpolation in dB between breakpoints, then to gain (`faderPercentToLinearGain`, `:39-...`). Note: the table is piecewise linear in dB, not a continuous log formula.
  - Meter level: dBFS → 0..1 via `(level + 60) / 60`, clamped (`audio-mixer-meter-loop.js:102-104`). Attack is instant (`:105`); release is `s += (aim - s) * 0.45` per 50 ms tick (`:106`, `SMOOTH_FALL` at `:43`). Clip colour when `level > -1` dBFS (`:120`). Silent threshold `level > -90` (`:102`).
  - Input meter floor -60 dBFS and clip -1 dBFS (`lib/audio-input-meter-map.js:14,17`); states `METER_STATE` (`:20`); `mapLevelToMeter` (`:75`). File header says the module is pure with no timers or DOM (`:346-347`).
  - Peak source precedence: OSC levels first, then scene/variable strings (`audio-mixer-peaks.js:93-102`); `readBusPeakDbfsOrNull` returns `null` for "never heard" vs `-99` for quiet (`:83-92`).
  - No peak-hold is implemented; "peak" is the smoothed instantaneous level.
- DOM-entangled: all `audio-mixer-*` components (innerHTML, `document.querySelector`), `audio-mixer-meter-loop.js` (DOM fills).
- Routing rules: `audio-routes.js` mirrors `src/engine/audio-route.js` (header line 3). `audio-cross-screen-routing.js` returns reason codes (`:118-128`) and is pure.

---

## 3. Media browser operations, library defaults and HAP encode

### Files
- `client/components/media-folder-picker-modal.js` — 126 — modal folder picker for copy/move destinations (built from `GET /api/media` rows with `isDir`).
- `client/components/media-hap-encode-modal.js` — 116 — "Encode to HAP" options modal (Alpha, HQ toggles, both off on each open).
- `client/components/media-multi-rename-modal.js` — 103 — multi-rename dialog with live old→new preview.
- `client/lib/media-file-ops.js` — 121 — batch copy/move/delete and HAP encode API wrappers.
- `client/lib/media-multi-rename.js` — 86 — pure planning for numbered-name rename (`parseNumberedName`, `buildMultiRenamePlan`).
- `client/lib/media-file-defaults.js` — 59 — per-file trim-in/out and mute defaults cache (copied onto a layer when a clip becomes its source).
- `client/lib/media-duration.js` — 147 — clip length index from `state.media`; playlist rows show real length.
- `client/lib/media-exists.js` — 106 — "is this clip known to Caspar" index (case-insensitive, extension-stripped, basename fallback).
- `client/lib/media-ext.js` — 128 — filename classifiers (still image, video-like, loop-capable, straight alpha).
- `client/lib/media-audio-kind.js` — 23 — audio-only heuristic for a source.
- CSS: `client/styles/04-media-lists-sources-tree.css` (285; shared with the sources panel, out of scope), `client/styles/05e-inspector-media-file.css` (256).

Subtotal: 10 JS files, 1015 LOC; CSS 541 LOC.

Note: the media browser list, the media inspector (`inspector-media-file*`) and the sources panel are outside the prefix list and not inventoried here.

### What the operator can do
- Pick a destination folder, then copy or move selected media files (folder tree built from `GET /api/media`). Errors are reported per file when the batch call fails.
- Delete selected media files (`POST /api/media/delete`).
- Multi-rename: set a shared title, optionally renumber (start, step, zero-pad digits), see a live preview with conflict detection, then Rename. Renames are all-or-nothing and references in looks, playlists and timelines follow.
- Encode selected files to HAP (Alpha and HQ toggles; probe and cancel endpoints exist).
- Per-file trim/mute defaults copied onto a layer when the clip is assigned (`media-file-defaults.js:1-6`).
- Show clip lengths in playlist rows (`media-duration.js:1-...`).
- Flag missing media on take (`media-exists.js`, `warnMissingMediaOnTake` at `:87`).

### Rendering tech (with evidence)
- DOM only. Modals built with `document.createElement('div')` and `innerHTML`: `media-folder-picker-modal.js` (class `modal-overlay`), `media-hap-encode-modal.js` (`modal-overlay`), `media-multi-rename-modal.js:33-45` (`innerHTML` template, class `modal-overlay`).
- No canvas, no `<img>`, no `<video>` in these files. Thumbnails are not drawn here.

### Interaction
- Folder picker: root button `media-folder-picker-modal.js:82`; folder buttons `:96`; close, cancel, ok `:111-113`; backdrop click `:122`.
- HAP modal: Alpha and HQ `change` `:75-76`; ok/cancel/close `:77-79`; backdrop click `:80`; `document` keydown capture `:73`, Escape handled at `:~68-70`.
- Multi-rename: `input` and `change` on modal re-run plan (`:82-83`); click delegation for cancel/ok (`:84-92`).
- Drag-and-drop: none in these files.
- Native `alert()` in `media-folder-picker-modal.js` (error path).
- Context menus: none here (menus for media are in outside files).

### Server contract
- `GET /api/media` — `lib/media-duration.js:106`; `components/media-folder-picker-modal.js` consumes rows (`:9`); `lib/timeline-clip-layout.js:38`.
- `POST /api/media/copy` `{sourceIds, targetId}` and `POST /api/media/move` `{sourceIds, targetId}` (batch), fallback per file `{sourceId, targetId}` — `lib/media-file-ops.js:16,21,35`.
- `POST /api/media/delete` `{ids}` (batch) and `{id}` (fallback) — `lib/media-file-ops.js:68,82`.
- `POST /api/media/rename` `{renames}` — `components/media-multi-rename-modal.js:92`.
- `GET /api/media/library/defaults` — `lib/media-file-defaults.js:16` (cache keyed by normalized path, NFC, lowercased, `:12`).
- HAP: `POST /api/media/hap-encode` `{ids, alpha, hq}` — `lib/media-file-ops.js:107`; `POST /api/media/hap-encode/probe` `{ids}` — `:112`; `POST /api/media/hap-encode/cancel` `{jobId}` — `:116`; `GET /api/media/hap-encode` — `:120`.
- `POST /api/media/cinf` — used from timeline (`timeline-editor-handlers.js:72`), not in this group.
- No upload (multipart or streaming) found in scope.

### Client state
- stateStore: `state.media` (`media-duration.js:37,106`, `media-exists.js:54`), `stateStore` passed to indexes.
- Module caches: `media-file-defaults.js:11` `byPath` Map; `media-duration.js:37` last-known media list; `media-exists.js` singleton index.
- localStorage: none in these files.

### Browser APIs used
- `File` and `FileReader`: none. `fetch`: none directly (uses `api-client.js`).
- `document.createElement`, `innerHTML`, `addEventListener`.
- `setTimeout`: `media-file-defaults.js` none; `media-multi-rename` none.
- Dynamic `import()`: none here.

### Port-risk notes
- Pure and portable:
  - `parseNumberedName` (`lib/media-multi-rename.js:18-37`): splits extension, lead number, title, trailing separator and trailing digits; keeps "03_LOOP_2x3" as title "LOOP_2x3" (`:28-30`).
  - `buildMultiRenamePlan` (`:52-...`): applies title override or per-file title, renumbering with `pad()` (`:39-41`), checks conflicts against `existingIds`. Result has `{from, to, error?}`.
  - `media-ext.js` classifiers are string-based (extension lists). `media-exists.js` index normalises case, extension and basename.
- Path semantics: `media-file-defaults.js:12` normalizes NFC, backslashes → slashes, lowercase. Media ids are `folder/name.ext` strings.
- Operation semantics: server endpoints are called batch-first with a per-file fallback on any thrown error (`lib/media-file-ops.js:20-40`, `:67-89`), so partial failures are counted.
- DOM-entangled: all three modals.

---

## 4. Playlists (compact Inspector footer panel)

### Files
- `client/components/playlist-control-panel.js` — 235 — collapsible footer panel: live playlist dropdown, item dropdown (goto), Prev/Play/Next, timeless-item seconds apply.
- `client/lib/playlist-live-sync.js` — 16 — pushes playlist edits to the running engine when the look is live.
- `client/lib/playlist-timeless.js` — 31 — timeless item classifier and default 20 s duration.
- CSS: `client/styles/07b2-timer-control-panel.css` contains `.playlist-control-panel__*` selectors (shared with timers; counted under Timers).

Subtotal: 3 JS files, 282 LOC; CSS shared (see Timers).

### What the operator can do
- See every playlist currently LIVE on any channel (polled every 2 s while open).
- Select a playlist and an item; selecting an item = goto (`set_start` on the server).
- Prev / Play / Next on live playlists; on a non-live playlist, Prev/Next step the preview index instead (`step_preview`).
- Set the duration of all timeless items in the selected playlist (1–86400 s) and apply to the project state.
- Edits made while a look is live are pushed to the engine (`update_live`).

### Rendering tech (with evidence)
- DOM only. Built with `innerHTML` (`playlist-control-panel.js`, 5 sites). Icons are inline `<svg>` (3 sites).
- No canvas, no WebGL.

### Interaction
- Selects: `change` listeners `playlist-control-panel.js:141,145`.
- Buttons: `plp-timeless-apply` `:159`; `plp-prev` `:197`; `plp-next` `:202`; `plp-play` `:207`; collapse toggle `:229`.
- No keyboard shortcuts. No drag-and-drop. No context menus.

### Server contract
- `GET /api/playlist/state` — `playlist-control-panel.js:117`; polled via `setInterval(…, POLL_MS=2000)` at `:16` and `:225`; also `shader-live-instances.js:65` (see Shader).
- `POST /api/playlist/control` with actions: `prev`/`next`/`play` (`control()` at `:125-130`, invoked `:197-207`), `set_start` `{sceneId, layerNumber, index}` (`:154`), `step_preview` `{sceneId, layerNumber, direction}` (`:186-190`).
- `POST /api/playlist/control` `{action:'update_live', sceneId, layerNumber, playlist}` — `lib/playlist-live-sync.js:14`. Failures are swallowed (`.catch(() => {})`, `:15`).
- WS: none.

### Client state
- stateStore/scene: `sceneState.scenes` (`playlist-control-panel.js:~169`), `sceneState.patchLayer(sceneId, layerIndex, {playlist})` (`:172`); fires `scenes-refresh-preview` on `document` (`:173`).
- localStorage: `highascg_playlist_panel_collapsed` — `playlist-control-panel.js:15` (`LS_COLLAPSED`), read and written around `:228`.
- Module state: `appliedSecs` map keyed per playlist (`playlist-control-panel.js`, used at `:174`).

### Browser APIs used
- `setInterval` `playlist-control-panel.js:225`; `document.dispatchEvent(CustomEvent)` `:173`; `localStorage` (collapse state).

### Port-risk notes
- `isTimelessItem` (`playlist-timeless.js:11-16`): timeless when type is image/template/shader/graphic, or when the value is an image extension, or when it does **not** match the timed-media extension list (`TIMED_EXT_RE`, `:6`). Pure.
- `timelessSecsOf` returns the first timeless item with a positive duration, else 20 (`:24-31`).
- Mirror of a server function: header says it mirrors `isTimelessPlaylistItem` in `src/engine/scene-take-lbg-playlist.js`. Two copies of the rule must stay in sync.
- The panel mutates `sceneState` directly through `patchLayer` (`:172`), then calls `refresh()`.

---

## 5. Shader Live and Shader FX (GLSL library and live controls)

### Files
- `client/components/shader-live-editor.js` — 491 — Shader Live workflow overlay (WO-345): live instance list, parameter editor, CG UPDATE pushes, save to library.
- `client/components/shader-fx-modal.js` — 269 — Shader FX manager modal (CRUD over `/api/shaders`, Shadertoy paste import, preview iframe).
- `client/components/shader-fx-params.js` — 166 — auto-detected tweakable parameter rows in the FX modal (color picker, slider).
- `client/components/shader-controls-panel.js` — 228 — curated "main panel" controls: sections, palette swatches, macros, toggles, presets, randomize, pin, hide.
- `client/components/shader-live-rows.js` — 86 — pure HTML builders for Shader Live rows and groups.
- `client/components/shader-live-stack.js` — 124 — PGM layer stack (layers 10–20) for shader stacking.
- `client/components/shader-live-audition.js` — 45 — stages a shader from the templates browser on the preview bus.
- `client/lib/shader-controls.js` — 230 — turns raw scanned literals into a small set of human controls.
- `client/lib/shader-param-scan.js` — 400 — GLSL float/color literal scanner and rewriter (pure, no DOM).
- `client/lib/shader-param-naming.js` — 175 — GLSL literal → human name and category (string heuristics on masked source).
- `client/lib/shader-param-describe.js` — 79 — one-sentence description of what a literal does (idiom recognition).
- `client/lib/shader-live-instances.js` — 94 — every shader LIVE on any channel, from `scene.live`, with playlist-now tracking.
- `client/lib/shader-cg-update.js` — 68 — `CG <ch>-<layer> UPDATE` push and wiggle preview (AMCP quoting).
- CSS: `client/styles/08d-modals-shader-fx.css` (488), `client/styles/08d2-shader-live-controls.css` (232).

Subtotal: 13 JS files, 2455 LOC; CSS 720 LOC.

### What the operator can do
- Shader Live: click the header mascot while `operatorTools.cefEnableGpu` is on to open an overlay (`shader-live-editor.js:38,486`). The overlay lists every shader LIVE on any channel, shows its parameters, and pushes each change to the running producer with `CG … UPDATE`. Hot recompile, no restart.
- Per-parameter: slider/colour change, reset, wiggle (shows the effect briefly on PRV instances), rename label via `window.prompt` (`:321`), wheel adjusts with a 150 ms apply delay (`:118`).
- Save to library: `POST /api/shaders` (`:355`, `:431`).
- Shader FX modal: list, new, open, save, delete shaders; paste Shadertoy-style code into per-pass textareas; import from a Shadertoy URL; live preview iframe of the exported HTML template.
- Presets, randomize, pin, hide, and "restore original" in the controls panel (`shader-controls-panel.js:82-86,118,173,184`). Manifest stored on the shader config (`shader-live-editor.js:79-80`).
- Audition a shader from the templates browser on the preview bus (`shader-live-audition.js:35`).
- Stack shaders on PGM layers 10–20; clicking layer 10 on a PRV instance exchanges it with PGM (`shader-live-stack.js:48,67`).

### Rendering tech (with evidence)
- DOM only. `innerHTML` in every component (e.g. `shader-live-editor.js` 7 sites, `shader-fx-modal.js` 4 sites, `shader-live-stack.js:~`, `shader-fx-params.js`).
- `<iframe id="shaderfx-preview">` in the FX modal: `shader-fx-modal.js:97`; `src` set to `/templates/shaders/{id}.html?_=<ts>` at `:125` and `:233`.
- No canvas, no WebGL in these client files. Shaders run on the server/Caspar producer.
- Shader sources are plain `<textarea>` elements: `shader-fx-modal.js:44`.

### Interaction
- Modal: `modal.addEventListener('input')` `shader-fx-modal.js:217`; backdrop click `:240`; close `:239`; import Enter key `:246-251`.
- Shader Live overlay: `#shl-instance` change `shader-live-editor.js:62`; save `:66`; take `:69`; reset all `:74`; `#shl-params` click (reset, wiggle, rename) `:100-102`; change/input `:122-123`; mascot click `:486`.
- Controls panel: host click/change/input `shader-controls-panel.js:222-224`.
- Stack: host click `shader-live-stack.js:107`.
- FX params: change and input `shader-fx-params.js:137,158`; debounced rescan `setTimeout` `:115`.
- Keyboard: `shader-fx-modal.js:246` Enter on import URL. No global shortcuts in shader files.
- `window.prompt`: `shader-live-editor.js:321` (parameter label), `shader-controls-panel.js:173` (preset name).
- Drag and drop: none in shader files. Shader audition arrives via a custom event `shader-audition-request` (`shader-live-audition.js:5`).

### Server contract
- REST:
  - `GET /api/shaders` — `shader-fx-modal.js:151`; `shader-live-editor.js:425`.
  - `GET /api/shaders/{id}` — `shader-fx-modal.js:198`; `shader-live-editor.js:171`.
  - `POST /api/shaders` (create/save) — `shader-fx-modal.js:227`; `shader-live-editor.js:355,431`.
  - `POST /api/shaders/import` `{url}` — `shader-fx-modal.js:175`.
  - `DELETE /api/shaders/{id}` — `shader-fx-modal.js:256`.
  - `POST /api/raw` `{cmd}`: `CG {ch}-{pLayer} UPDATE 0 "<json>"` — `lib/shader-cg-update.js:24`; `CG {ch}-{pLayer} ADD 0 "{cgName}" 1 "{}"` (re-host) — `shader-live-editor.js:285`; `MIXER {ch}-{pLayer} {cmd} {v}` — `shader-live-editor.js:249`.
  - `POST /api/shader-stack` — `shader-live-stack.js:48,67`.
  - `POST /api/scene/take` `{channel, target:'preview', forceCut, useServerLive, incomingScene}` — `shader-live-audition.js:35`.
  - `GET /api/playlist/state` — `lib/shader-live-instances.js:65`, polled `setInterval(…, 1000)` at `:83`.
  - Static: `/templates/shaders/{id}.html` (iframe), `/cg-studio` not used here.
- WS: none sent or read directly in these files. Live state arrives through `stateStore` (`scene.live`) and `settings`.

### Client state
- `shader-live-editor.js`: `selectedKey`, `shaderCfg` (working copy with `controls` manifest), `dirty`, `params`, `pristine`.
- stateStore: `scene.live` (`lib/shader-live-instances.js`), `settingsState.getSettings().operatorTools.cefEnableGpu` (`shader-live-editor.js:38`).
- Playlist-now tracker: `<channel>-<layerNumber>` → active item map from `GET /api/playlist/state` (`shader-live-instances.js:54-65`).
- localStorage: none in shader files.

### Browser APIs used
- `setTimeout`/`setInterval`: `shader-live-editor.js:118,~; shader-fx-params.js:115`; `shader-live-instances.js:83` (1 s poll).
- `window.prompt`, `window.dispatchEvent` (`shader-live-audition.js`), custom events.
- `document.createElement`, `innerHTML`, `addEventListener('input'|'change'|'click'|'keydown')`.
- `console.warn` on CG UPDATE failure (`shader-live-editor.js:289`).

### Port-risk notes
- Pure (portable):
  - `shader-param-scan.js` (header lines 500-503: "Pure functions, no DOM/browser APIs (runs in node)"). Detects float/vec literals in GLSL (masked comments and `#` lines), returns spans, and rewrites values by offset.
  - `shader-param-naming.js` (header: "Pure string heuristics"). `shader-param-describe.js` works on masked source with offsets matching scan spans.
  - `shader-controls.js` has no DOM API use (grep). It collapses ~45 raw literals to a small control set, which is heuristic.
- AMCP quoting: `shader-cg-update.js` header (`:470-473`): backslashes must be escaped **before** quotes, or multi-line GLSL becomes invalid JSON inside the AMCP string and the update is a silent no-op.
- Two update paths: `CG UPDATE` for playlist-driven producers, `CG ADD` re-host for PLAY-plain HTML producers that return 403 on UPDATE (`shader-live-editor.js:282-285`).
- Live state is polled (1 s) rather than pushed for playlist position (`shader-live-instances.js:83`).
- DOM-entangled: `shader-live-editor.js`, `shader-fx-modal.js`, `shader-controls-panel.js`, `shader-live-stack.js` (all build markup with `innerHTML` and query by id).

---

## 6. Timers and countdowns (screen timer control panel)

### Files
- `client/components/timer-control-panel.js` — 378 — collapsible bottom-right panel: timer list, transport (start/pause/reset), per-screen show/hide with fade, settings access.
- `client/components/timer-control-panel-display.js` — 88 — pure display-time math and `DEFAULT_TIMER_CONFIG`.
- `client/components/timer-control-panel-inline-time.js` — 136 — per-row time input (`90`, `5:00`, `01:30:00`), saves through `/api/timers/assign`.
- `client/components/timer-control-panel-settings-form.js` — 316 — per-timer settings form (duration/clock mode, target time, position x/y, colours, aux text, font sizes).
- CSS: `client/styles/07b2-timer-control-panel.css` (461; also contains `.playlist-control-panel__*` selectors).

Subtotal: 4 JS files, 918 LOC; CSS 461 LOC.

### What the operator can do
- See all screen timers from `/api/timers/list`; countdown shown at 4 Hz.
- Start, pause, reset a timer (`POST /api/timers/cmd`).
- Show or hide a timer per screen with a 25-frame fade (`POST /api/timers/visible`).
- Type a time in each row: `90` (seconds), `5:00`, `01:30:00`; Enter commits (blur), Escape reverts (`timer-control-panel-inline-time.js:123-130`).
- Edit settings per timer: mode duration or clock, duration seconds, target clock time, format, amber and red thresholds, position, font size, colours, border, three aux text lines.
- Collapse the panel (persisted).

### Rendering tech (with evidence)
- DOM text only. Countdown text is updated with `textContent` on `[data-timer-id] .timer-control-panel__timer-display` (`timer-control-panel.js:331-346`). No canvas, no SVG.
- Panel markup via `innerHTML` (3 sites in `timer-control-panel.js`).

### Interaction
- Buttons and toggles (transport, eye toggle) in `timer-control-panel.js` (e.g. `:309` cmd, `:320` visible).
- Inline input: `keydown` Enter/Escape `timer-control-panel-inline-time.js:123-130`.
- Settings form: `setTimeout` at `timer-control-panel-settings-form.js` (one site).
- `MutationObserver` on the mount element cleans up timers on unmount (`timer-control-panel.js:~370`).
- No drag-and-drop. Position is set as numeric x/y in the form (header lines 221-223).
- Keyboard: Enter/Escape only in the inline time input.

### Server contract
- `GET /api/timers/list` — `timer-control-panel.js:160`, polled every 1000 ms (`POLL_INTERVAL_MS`, `:36`) while not collapsed (`:357-361`).
- `POST /api/timers/cmd` `{timerId, cmd: start|pause|reset}` — `timer-control-panel.js:309`.
- `POST /api/timers/visible` `{timerId, screenIdx, visible, fadeFrames: 25}` — `timer-control-panel.js:320`; refresh after 700 ms (`FADE_REFRESH_MS`, `:41`, `:323`).
- `POST /api/timers/assign` `{timerId, screenIdx, config}` — `timer-control-panel-inline-time.js:60`; per-screen save also in `timer-control-panel.js` header.
- Server merges `config` and emits the CG update (`timer-control-panel-inline-time.js:9`, outside scope).
- WS: none directly. Timer state is polled.

### Client state
- Module: `lastTimersList` (used by the tick), `listContainer`, `isCollapsed`, `tickTimer`, `pollTimer`.
- Snapshot helper `getScreenTimersSnapshot(scene, screenIndices)` (`timer-control-panel.js:60-77`).
- localStorage: `highascg_timer_panel_collapsed` — `timer-control-panel.js:35` (`LS_COLLAPSED`), written `:~271`.
- `DEFAULT_TIMER_CONFIG` (`timer-control-panel-display.js:9-36`).

### Browser APIs used
- `setInterval` 250 ms (`TICK_INTERVAL_MS`, `timer-control-panel.js:37`, used `:331`); poll 1000 ms (`:36`, `:357`).
- `setTimeout` FADE_REFRESH 700 ms (`:41`, `:323`).
- `Date` for clock-mode and elapsed time (`timer-control-panel-display.js:37-62`).
- `localStorage` for collapse state.
- `MutationObserver` `timer-control-panel.js:~370`.

### Port-risk notes
- `computeDisplayTime` (`timer-control-panel-display.js:38-...`):
  - Duration mode: when `lastCmd==='start'`, remaining = basis − (now − cmdAt)/1000, where basis is the server `remainingSec` if present, else `durationSec`/`config.durationSec` (`:52-57` area). When `pause`, returns `remainingSec` (frozen). Otherwise the full duration.
  - Clock mode: remaining = (target − now)/1000 where the target is today at `targetTime` in **local time** (`:~62-66`). Does not roll over at midnight (target is always "today").
- `formatDisplayTime` (`:80-88`): sign + `HH:MM:SS`, truncates to whole seconds (`Math.trunc`).
- Display time is computed in the browser from server timestamps `cmdAt` (ms since epoch). Clock skew between browser and server affects the display.
- Pure: `timer-control-panel-display.js` (header: "pure helpers, no DOM"). The other three files are DOM-entangled.
- Config defaults mirror `scene-state-timers.js` (header line 7).

---

## 7. CG, lower thirds, CG Studio, and template thumbnails

### Files
- `client/components/cg-studio-tab.js` — 76 — injects the "CG Studio" workspace tab (when the `cg-studio` module is enabled) and a lazy iframe of the studio UI.
- `client/components/cg-only-look-deck-thumb.js` — 207 — CG-only look thumbnails: checkerboard alpha plus server-rendered PNG.
- `client/lib/cg-studio-caspar-export.js` — 148 — wraps GrapesJS output in the lower-third engine contract for Caspar export.
- `client/lib/cg-studio-lt-presets.js` — 190 — lower-third engine presets (animation: fade, slide-left, rise) for CG Studio export.
- `client/lib/lower-third-cg-data.js` — 355 — lower-third CG payload helpers (`layer.cgData`), font choices, body for `/api/lower-thirds/*`.
- `client/lib/lower-third-roster-import.js` — 294 — Excel/CSV roster import (row picker → title/subtitle).
- `client/lib/template-thumb.js` — 289 — template thumbnail resolver: static poster PNG if present, else server render, cached per source + CG data.
- CSS: `client/styles/cg-studio.css` (162), `client/styles/06c3-inspector-lt-roster.css` (300).

Subtotal: 7 JS files, 1559 LOC; CSS 462 LOC.

Out-of-scope callers: lower-third inspector `client/components/inspector-lower-third.js` (and `-roster.js`, `-templates.js`) call the `/api/lower-thirds/*` endpoints described below.

### What the operator can do
- Open CG Studio as a workspace tab (iframe to the studio UI served by the playout server) and export lower-third HTML templates (`lower-thirds/{templateId}.html`, `cg-studio-caspar-export.js:129`).
- Pick animation presets for the lower-third engine export (`cg-studio-lt-presets.js`).
- Build a lower-third payload from primary/secondary text (`lower-third-cg-data.js` maps primary → `name`, secondary → `title`, per file header).
- Import a roster spreadsheet (`.xlsx`, `.csv`, `.txt`, or try xlsx then csv) and pick title/subtitle columns (`lower-third-roster-import.js`).
- See template and CG look thumbnails in the deck and editors.

### Rendering tech (with evidence)
- CG Studio: `<iframe data-cg-studio>` created lazily `cg-studio-tab.js:34-45`; `src` = `resolveApiUrl('/cg-studio/index.html')` (`:22-23`).
- Thumbnails: `new Image()` + `img.onload` (`template-thumb.js:132-135`). `cg-only-look-deck-thumb.js:95-98` creates `Image`, `ctx.drawImage(entry.img, px, py, pw, ph)` at `:180`, `drawImageContainInRect` at `:51`. Checkerboard alpha background in that file (header line 2).
- Canvas 2D is used by `cg-only-look-deck-thumb.js` (grep for `drawImage`). The canvas element itself is created outside scope.
- Lower-third templates themselves are HTML rendered by Caspar (not in client).

### Interaction
- CG Studio tab: `window` `highascg-workspace-tab-activated` `cg-studio-tab.js:71`; tab button built at `:57-67`; `registerVideoBlockingTab` at `:70`.
- Roster import: parses a `File` (`lower-third-roster-import.js:203-208` `file.arrayBuffer()`).
- Thumbnails: no pointer handling in these files.
- No drag-and-drop or keyboard in these files.

### Server contract
- `POST /api/cg-thumb/render` `{sourceValue, templateId, cgData}` — `lib/template-thumb.js:178`; `components/cg-only-look-deck-thumb.js:117`. Returns `{url}` used as `${resolveApiUrl(url)}?t=<ts>`.
- `HEAD /templates/{dir}/thumbnails/{basename}.png` — static poster probe, `lib/template-thumb.js:95-104`.
- `/api/lower-thirds/*` (payload builder in `lower-third-cg-data.js:148`; callers in out-of-scope `inspector-lower-third.js`): `GET /api/lower-thirds/templates`, `POST /api/lower-thirds/update`, `POST /api/lower-thirds/play`, `POST /api/lower-thirds/load`, `POST /api/lower-thirds/stop`, `POST /api/lower-thirds/clear`, `GET /api/lower-thirds/active` (lines in `components/inspector-lower-third.js:14,190,286,303,321,329,330,337,341,342`).
- WS: the lower-third state WS message `lower-third.state` is handled in `app-ws-handlers.js:215` (outside scope; not read by in-scope files).
- CG Studio talks to the server from inside its iframe (outside scope).

### Client state
- `template-thumb.js`: cache `templateThumbCache` keyed per source value + CG data; entries `{url, img, error, staticFallback}`.
- `cg-only-look-deck-thumb.js:~` module Map of entries `{url, img, loading, error}`.
- `lower-third-roster-import.js`: roster object `{fileName, importedAt, headers, mapping, rows}` (typedef at `:11`).
- stateStore: `layer.cgData` (scene take), `sceneState` (layer source) via `layer.source`.
- localStorage: none in these files.

### Browser APIs used
- `iframe` (`cg-studio-tab.js:34`); `window.addEventListener` (`:71`).
- `Image`, `onload`, `onerror`, `drawImage`, `canvas 2D`.
- `fetch` with `HEAD` (`template-thumb.js:104`).
- `File.arrayBuffer()` and `TextDecoder('utf-8')` (`lower-third-roster-import.js:208,214`).
- Dynamic `import('exceljs')` (`lower-third-roster-import.js:167`).
- `setTimeout` timeout guard for workbook parse (`:59`, 15 s `ROSTER_PARSE_TIMEOUT_MS` at `:8`).

### Port-risk notes
- Roster import limits: 2 MB (`ROSTER_MAX_BYTES`, `:6`), 15 s parse timeout (`:8`); legacy `.xls` rejected (`:218-220`). `UNSAFE_KEYS` blocks `__proto__`, `constructor`, `prototype` (`:14`).
- Roster parsing depends on an optional npm package loaded at runtime (`:167-169`).
- `lower-third-cg-data.js` font list: "System / Caspar-safe font choices" (`:521`), stored by id.
- Template thumbs: cache key includes CG data, so each edit creates a new render; `?t=Date.now()` cache-busts the server PNG (`template-thumb.js:~182`).
- `cg-studio-caspar-export.js` wraps GrapesJS HTML in the `lt-engine.js` contract (header). Output path `lower-thirds/{id}.html`.
- `cg-studio-caspar-export.js` and `cg-studio-lt-presets.js` contain `document.` references only inside template strings that become browser JS in the exported HTML (e.g. `cg-studio-lt-presets.js:108`, `cg-studio-caspar-export.js:48`). They do not touch the app DOM at runtime. `lower-third-cg-data.js` has no DOM references.

---

## 8. LED test card, pixel/DMX mapping editor, fixture inspector, mapping state

### Files
- `client/components/led-test-modal.js` — 384 — LED wall test card modal (grid size, pattern, labels, builder speed); persists settings and calls an injected apply callback.
- `client/components/pixel-map-editor.js` — 152 — unified Mapping Editor shell (opened by `highascg-pixel-mapping-open`); toolbar, delete slice, close, keyboard Escape.
- `client/components/pixel-map-editor-canvas.js` — 268 — 2D canvas for mapping rectangles: pan, zoom, move, rotate, magnetism snap.
- `client/components/pixel-mapping-browser.js` — 142 — "Mapping Sources" browser: video output and DMX fixture templates, add/edit/delete, drag source.
- `client/components/fixture-inspector.js` — 128 — DMX fixture properties in the Inspector (universe, address, protocol, colour order, grid, sample mode, etc.).
- `client/lib/mapping-node-service.js` — 429 — single source of truth for device-graph mutations for `pixel_mapping` nodes.
- `client/lib/mapping-state.js` — 247 — active mapping node state; debounced save of the device graph.
- CSS: `client/styles/03d-mapping-editor.css` (321).

Subtotal: 7 JS files, 1750 LOC; CSS 321 LOC.

Out of scope but on the path: `client/components/header-bar-led-test.js` and `client/lib/led-test-apply.js` (issues `POST /api/led-test-card`, `led-test-apply.js:133`).

### What the operator can do
- LED test card: choose grid columns/rows, panel width/height, centre label, show centre character, panel labels, spec line, circle and cross, channel enables, per-channel grid, pattern (grid-white, bouncing element, animated "Bunny builds the wall" only when Full LED grid is on), builder speed 1–10, character count 1–48. Test card is the template `led_test_pattern` on layer 999 (`led-test-modal.js:157`).
- Mapping editor: open for a node; drag rectangles to move; right-drag or Shift+drag to pan; wheel to zoom; drag handle to rotate; delete the selected slice (with confirm); close with Escape or the backdrop.
- Mapping sources browser: add video output (1920×1080 @50, default) or DMX fixture templates; rename (prompt for label, resolution or universe); delete (confirm); drag a template out.
- Fixture inspector: set universe, start channel, protocol, destination, colour order, source channel, grid cols/rows, brightness, rotation, mirror H/V, sample mode; delete fixture (confirm).

### Rendering tech (with evidence)
- LED test modal: DOM and `innerHTML` (`led-test-modal.js:~157-200`). No canvas.
- Mapping canvas: Canvas 2D `canvas.getContext('2d')` (`pixel-map-editor-canvas.js:20`); `fillRect`/`strokeRect` (`:88-110`); `setLineDash` (`:93-96`). Output rect is left unfilled when `shouldShowLiveVideo()` is true (`:89-92`), implying a live `<video>` underlay outside this file.
- Mapping browser: DOM list items with `dragstart` (`pixel-mapping-browser.js:88`).
- Fixture inspector: DOM form (`innerHTML`, `change` listeners).

### Interaction
- Mapping canvas pointer (`pixel-map-editor-canvas.js`): mousedown `:169` (right button or Shift → pan; hit test `getItemAt`; handle `rotate` or move), contextmenu `:199` (prevent default), wheel `:201-212` (zoom factor 1.1/0.9, clamp 0.05–20, zoom around cursor), mousemove `:215-252` (pan, move with `applyMagnetism` 12 px threshold `:227-234`, rotate with `Math.atan2` `:~240`), mouseup `:253`.
- `ROTATE_HANDLE_DIST = 30`, `HANDLE_SIZE = 8` (`:5-6`).
- Editor shell: wrap mousedown closes when target is the wrap (`pixel-map-editor.js:82`); delete slice `confirm('Delete this slice?')` (`:~70`); `window` resize `:108`; `window` `keydown` Escape closes `:136-138`; custom events `highascg-pixel-mapping-open` `:115` and `highascg-mapping-inspector-updated` `:140`.
- Mapping browser: template item `dragstart` sets `application/x-highascg-mapping-template` (`pixel-mapping-browser.js:88-91`); click handlers add/delete/edit; `confirm('Delete template?')` (`:83`); `prompt` for label/resolution/universe (`:~122-133`). The drop target is outside scope.
- LED test modal: `change`/`input` on fields → `persistAndApply` (`led-test-modal.js:354-374`), debounced 400 ms for settings (`:341-345`), 300 ms for label (`:350`). Escape/backdrop handling in the modal shell.
- Fixture inspector: `change` listeners `fixture-inspector.js:86-112`; delete `confirm('Delete this fixture?')` `:123`.

### Server contract
- `GET /api/device-view` — `pixel-map-editor.js:130,145`; `lib/mapping-state.js:230`; `lib/mapping-node-service.js:148` (`?_ts=`).
- `POST /api/device-view` with bodies:
  - `{deviceGraph: graph}` — `lib/mapping-state.js:236` (debounced save of device graph after `_save`, `:221-240`); `lib/mapping-node-service.js:152`.
  - `{removeMappingNode:{id}}` — `lib/mapping-node-service.js:296`.
  - `{mappingTemplates: templates}` — `components/pixel-mapping-browser.js:112,118,139`.
  - `{addExtraLiveSource}`, `{removeEdge}`, `{removeExtraLiveSource}`, `{removeDestination}` — used by `lib/decklink-add-input.js` (see Streaming section).
- `POST /api/led-test-card` — outside scope: `lib/led-test-apply.js:133`, reached from outside `led-test-modal.js` via the injected `onApplied` callback.
- WS: `highascg-device-view-reload` is dispatched after save (`lib/mapping-state.js` `_save`); no WS message types read here.

### Client state
- `mappingState` (`lib/mapping-state.js`): `activeNodeId`, `activeNode`, `mappings` (with `rect`, `rotation`, `outputId`), `canvasWidth`, `canvasHeight`; events `change` (`mappingState.on`). Save debounce `_saveDebounceMs` and timer `_saveTimer`.
- stateStore: `mappingTemplates` (`pixel-mapping-browser.js` reads `getState().mappingTemplates`, writes via `setState`).
- localStorage (LED test card): keys `highascg_led_test_pattern`, `…_builder_speed`, `…_char_count`, `…_show_cross`, `…_grid_by_ch`, `…_channels_enabled`, plus rows/cols/panel size/label keys (`led-test-modal.js:18-27`). Read via try/catch helpers (`:28-...`).

### Browser APIs used
- Canvas 2D (`pixel-map-editor-canvas.js`), `getBoundingClientRect`, `window.getComputedStyle` (`pixel-map-editor.js`), `confirm`, `prompt`, `DataTransfer` `setData` (`pixel-mapping-browser.js:89-90`), `setTimeout` debounces (led-test-modal, mapping-state), `localStorage`.
- `contextmenu` preventDefault (`pixel-map-editor-canvas.js:199`).

### Port-risk notes
- Pure:
  - `mapping-node-service.js`: device graph mutations and mode-string resolution (header `:538-539`: common Caspar video-mode ids, and resolution resolved from the mode string including custom ids such as `3456x1152p50`). Pure data transforms around `api` calls.
  - `applyMagnetism` (`pixel-map-editor-canvas.js:134-...`): candidate targets are canvas edges and every other mapping's edges, including opposite-edge alignments (`:137-144`), 12 px threshold.
- Rotation math: angle from `Math.atan2` relative to the rect centre; stored as integer degrees (`Math.round(angle * 180/π)`).
- Zoom around cursor: `offsetX = mx - before.x*scale` (`:208-209`).
- DOM-entangled: `pixel-map-editor*.js`, `pixel-mapping-browser.js`, `fixture-inspector.js`, `led-test-modal.js`.
- Save model: whole device graph is re-fetched and re-posted (`mapping-state.js:228-236`), so concurrent edits from another client can be overwritten. This is the code's current behaviour.

---

## 9. Map explorer (developer code map, not an operator feature)

### Files
- `client/components/map-explorer.js` — 1059 — standalone code-architecture explorer: nested "cards", breadcrumb, search, minimap, dependency-edge SVG, hash routing. Loaded by `client/map.html`.

Subtotal: 1 JS file, 1059 LOC.
CSS: `client/styles/map-explorer.css` (800).

### What the user can do
- Browse a JSON tree of subsystems, applications, modules, files, functions, routes, WS events and scripts (`KIND_COLORS` `:3-13`).
- Search with a modal (`showModal` `:646`), arrow keys and Enter.
- Pan/zoom with wheel and mouse drag; minimap click.
- Toggle dependency edges (SVG) and cross-module edges; persisted in localStorage.
- Copy a node link to the clipboard (`:1021`).

### Rendering tech (with evidence)
- DOM cards via `innerHTML` (10 sites).
- SVG edges: `document.createElementNS('http://www.w3.org/2000/svg', 'path')` `:409`.
- Minimap canvas: `this.canvas.getContext('2d')` `:175`.
- `requestAnimationFrame` `:864,928,1039`.
- Native `<dialog>` search overlay `showModal` `:646`.

### Interaction
- Wheel: `viewport.addEventListener('wheel', …, {passive:false})` `:86`.
- Mouse pan: `handleMouseDown/Move/Up` `:111-131`.
- Keyboard: `document` keydown `:524`; arrow navigation `:615`.
- Hash routing `handleHashChange` `:744`, `updateHash` `:758`.
- Clipboard write `:1021`.

### Server contract
- None. Fetches `assets/map-data.json` at `:731` (static file, absent from `client/assets/` at inspection time).

### Client state
- localStorage: `map-cross-edges`, `map-show-edges` (`map-explorer.js` `setItem` and `getItem`).
- In-memory: `this.data`, `this.path`, search index.

### Port-risk notes
- Not part of the operator app. Its data model and layout code are DOM/SVG-specific. `SearchIndex` (`:15-69`) and `PanZoom` (`:71-166`) are plain JS logic.

---

## 10. Variables panel

### Files
- `client/components/variables-panel.js` — 119 — searchable table of variables, category filter, copy `$(highascg:KEY)` button.
- `client/lib/variable-state.js` — 63 — `VariableStore` singleton fed by WS `state` and `variable_update`.
- CSS: no dedicated stylesheet. Selectors `variables-table`, `var-search`, `var-copy` live in `client/styles/08b-modals-settings.css` (shared file, not counted).

Subtotal: 2 JS files, 182 LOC.

### What the operator can do
- Search variables by key substring (`variables-panel.js` `oninput`, `:100-104`).
- Filter by category prefix (`btn-filter` `data-prefix`, `:105-111`).
- Copy the Companion-style key `$(highascg:<key>)` with a button (`:83-96`).
- See live values; long values are truncated at 56 characters with a `title` of the length (`:6-16`).

### Rendering tech (with evidence)
- DOM table (`innerHTML` `:30-60`, `:71`), inline SVG copy icon (`:~80`). No canvas.

### Interaction
- Input `oninput` (`:100`), filter buttons `onclick` (`:105`), copy `onclick` (`:86`).
- `navigator.clipboard.writeText` (`:87`), button flash for 1000 ms (`:91-96`).
- No keyboard shortcuts. No drag-and-drop.

### Server contract
- REST: none in these files. Initial snapshot arrives via WS `state` (`variable-state.js:14-19`) and `mergeFromServer` for GET snapshots (`:50-54`).
- WS read: `variable_update` (`variable-state.js:22-26`, incremental `Object.assign`); `state` replaces `variables` (`:14-19`). `app-ws-handlers.js:110` (outside scope) also listens for `variable_update`.
- WS sent: none.

### Client state
- `VariableStore` (`variable-state.js:4-40`): `variables` object, `listeners` Set; global instance via `getVariableStore(ws)` (`:60-63`).
- No localStorage.

### Browser APIs used
- `navigator.clipboard.writeText` (`variables-panel.js:87`), `setTimeout` 1000 ms (`:91`), `innerHTML`, `onUnmount` hook (`:118`).

### Port-risk notes
- `VariableStore` is pure JS (no DOM) and portable. Values are strings from the server; `get` returns `''` for missing keys (`variable-state.js:~44`).
- Audio meter levels are read from these variables as a fallback (`osc_ch{N}_audio_*` keys), see Audio section.

---

## 11. Streaming, recording, WebRTC monitoring, virtual camera, V4L2 and DeckLink inputs

### Files
- `client/lib/stream-state.js` — 112 — go2rtc stream list (`GET /api/streams`, polled 10 s), browser monitor audio source and mute, and "live view" gating.
- `client/lib/streaming-channel-state.js` — 324 — live stream and record status, event-driven from WS `streaming_channel`, with on-demand GET.
- `client/lib/webrtc-client.js` — 207 — WHEP-style WebRTC client: POST SDP to same-origin `/api/go2rtc/webrtc?src=`, attaches the stream to a `<video>`.
- `client/lib/virtual-camera-state.js` — 89 — virtual camera (v4l2 loopback) status and REST calls.
- `client/lib/v4l2-inputs.js` — 107 — USB/V4L2 input slot config reader (max 8 slots).
- `client/lib/v4l2-add-input.js` — 100 — add a V4L2 slot from the Sources modal; config then apply.
- `client/lib/v4l2-input-state.js` — 23 — V4L2 input API hydration.
- `client/lib/v4l2-remove-input.js` — 41 — remove a V4L2 slot.
- `client/lib/decklink-add-input.js` — 365 — add/remove/change DeckLink SDI input slots (host channel + PLAY DECKLINK + device-view edges).
- `client/lib/decklink-input-toast.js` — 95 — toasts on transitions of failed DeckLink / live input sources.
- `client/lib/decklink-io-direction.js` — 38 — SDI port direction normalisation (pure).
- CSS: `client/styles/08c2-modals-header-audio-usb-import.css` (237; USB import modal and header audio toggle).

Subtotal: 11 JS files, 1501 LOC; CSS 237 LOC.

Out of scope callers that issue the POSTs for streaming: `components/device-view-actions.js` (`POST /api/streaming-channel/rtmp`, `POST /api/streaming-channel/record`), `components/device-view-inspector-stream.js` and `device-view-inspector-record.js` (call `applyStreamingChannelActionResponse`).

### What the operator can do
- See whether RTMP stream and record outputs are live (state from WS and GET).
- Start/stop stream and record from the device view (outside scope; in-scope lib applies responses).
- Hear the chosen source in browser monitoring (PGM or off, from Settings) and mute monitoring (persisted).
- View a live WebRTC preview of a go2rtc stream in a `<video>`.
- Add/remove/configure USB/V4L2 inputs (up to 8 slots) and DeckLink SDI input slots.
- Turn the virtual camera on or off and set its config.

### Rendering tech (with evidence)
- `<video>` element created in `webrtc-client.js:86` (`createElement('video')`), `srcObject` set `:100`, `play()` `:103-111`.
- No canvas, no `<audio>` element in scope. Audio monitoring is via the `<video>` element's stream tracks (`:123-124` adds audio `recvonly` transceiver).
- DOM only elsewhere.

### Interaction
- None user-facing in these lib files; UI lives in outside components. Toast on failed inputs (`decklink-input-toast.js`).
- Browser monitor and visibility: `document.visibilityState` gate on 10 s poll (`stream-state.js:109-110`).

### Server contract
- REST:
  - `GET /api/streams` — `lib/stream-state.js:42`; `lib/webrtc-client.js:45-49` (via `resolveApiUrl`). Response fields: `streams`, `isRunning`, `config.go2rtcPort`.
  - `POST /api/go2rtc/webrtc?src={name}` with `Content-Type: application/sdp`, body = offer SDP, response = answer SDP — `lib/webrtc-client.js:140-150`.
  - `GET /api/streaming-channel` — `lib/streaming-channel-state.js:305`.
  - `GET /api/virtual-camera/status` — `lib/virtual-camera-state.js:36`; `POST /api/virtual-camera/config` `:65`; `POST /api/virtual-camera/start` `:74`; `POST /api/virtual-camera/stop` `{persist}` `:83`.
  - `POST /api/v4l2-inputs/config` — `lib/v4l2-add-input.js:72`, `lib/v4l2-remove-input.js:35`; `POST /api/v4l2-inputs/apply` `{}` — `lib/v4l2-add-input.js:84`; `GET /api/v4l2-inputs` — `lib/v4l2-input-state.js:11`.
  - `POST /api/raw` `{cmd}`: `STOP {ch}`, `MIXER {ch} CLEAR`, `PLAY {ch} DECKLINK {dev}` — `lib/decklink-add-input.js:79-81,323-324`.
  - `POST /api/host-live/decklink` — `lib/decklink-add-input.js:96,116,206`.
  - `POST /api/device-view` with `{addExtraLiveSource}` (`:183,243,261`), `{removeEdge:{id}}` (`:298`), `{removeExtraLiveSource:{value}}` (`:332`), `{removeDestination:{id}}` (`:348`).
- WS read:
  - `streaming_channel` — `app-ws-handlers.js:192` (outside scope) → `ingestStreamingChannelWsEvent` (`streaming-channel-state.js:232`).
  - stateStore `decklinkInputsStatus`, `liveAudioInputsStatus`, `v4l2InputsStatus` via `stateStore.on(...)` (`decklink-input-toast.js:23-24,63-65`).
- WS sent: none.

### Client state
- `streamState` (`stream-state.js:23-31`): `activeAudioSource` (default `pgm_1`), `monitoringMuted`, `availableStreams`, `isStreamingEnabled`, listeners.
- `streaming-channel-state.js`: module `status` `{rtmp, record}` with setter/subscriber (`:178-205`).
- `virtual-camera-state.js`: module status object and subscriber Set (`:6-8`, `:29`).
- localStorage:
  - `highascg_audio_source` — `stream-state.js:26,67`.
  - `highascg_monitoring_muted` — `stream-state.js:27,73`.
  - `highascg_dev_remote_preview` — `webrtc-client.js` (`getItem`, `setItem`, `removeItem`).

### Browser APIs used
- `RTCPeerConnection` (`webrtc-client.js:26,33`), `addTransceiver('video'|'audio', {direction:'recvonly'})` (`:123-124`), `createOffer` (`:137`), `setRemoteDescription` (`:~155`), `RTCSessionDescription` (`:~150`).
- `<video>` `srcObject`, `play()` (`webrtc-client.js:86-111`).
- `fetch` POST SDP (`:140-150`), `fetch` GET (`stream-state.js:42`, `webrtc-client.js:49`).
- `setInterval` 10 s (`stream-state.js:108`); `document.visibilityState` (`:109`).
- `setTimeout` reconnect (`webrtc-client.js:163`, `reconnectDelayMs`), 400 ms wait (`:57`).
- `localStorage` (keys above).
- ICE: `iceServers = [{urls:'stun:stun.l.google.com:19302'}]` (`webrtc-client.js:24`). This contacts a public STUN server.

### Port-risk notes
- `webrtc-client.js` header: direct calls to port 1984 fail CORS from the web UI origin, so the same-origin proxy path is used.
- `stream-state.js` monitoring: `applyBrowserMonitorFromSettings` reads `settings.audioRouting.browserMonitor` defaulting to `'pgm'` (`:93-94`).
- `shouldShowLiveVideo()` (`stream-state.js:17`) gates the live underlay in the mapping canvas.
- `streaming-channel-state.js` (header): event-driven, no polling. Pure helpers `normalizeStreamingChannelStatus` (`:109`), `isStreamOutputLive` (`:150`), `isRecordOutputLive` (`:164`), `parseActiveFlag` (`:28`).
- `decklink-io-direction.js`: pure, mirrors `src/config/decklink-io-direction.js` (header line 3).
- `decklink-add-input.js` is a multi-step API sequence (stop → clear → play; add edge; change device; rollback calls with `.catch(() => {})`), with each step awaited. Partial failure leaves server state in the intermediate step.
- V4L2 maximum 8 slots (`v4l2-inputs.js:6`); slot device settings keys `v4l2_input_{N}_device`, `v4l2_input_count`, `v4l2_capture_bridge` (`:13-16`).

---

## 12. Shared utilities used across the groups

- `client/lib/waveform-fetch-queue.js` (30) — `enqueueWaveformFetch` spaces starts by 120 ms via `setTimeout` (`:6` `MIN_GAP_MS`, `:17-20`). Used by timeline clips.
- `client/lib/wheel-delta.js` (32) — normalises wheel deltas, reads `settings.ui.invertTouchpadScroll` (`:23-29`). Used by timeline wheel, pixel map canvas (`pixel-map-editor-canvas.js:201-212`) and map explorer (`:86`).
- `client/lib/template-thumb.js` (289) is in section 7.

These are counted in the totals of their owning sections.

---

## Port-risk summary (cross-cutting)

- The most reusable pure modules are: `timeline-canvas-snap.js`, `timeline-clip-interp.js`, `timeline-track-heights.js`, `timeline-canvas-utils.js` (timecode), `audio-volume-scale.js`, `audio-input-meter-map.js`, `audio-routes.js`, `audio-cross-screen-routing.js`, `media-multi-rename.js`, `media-ext.js`, `media-exists.js`, `playlist-timeless.js`, `shader-param-scan.js`, `shader-param-naming.js`, `shader-param-describe.js`, `timer-control-panel-display.js`, `variable-state.js`, `streaming-channel-state.js` (state shape), `decklink-io-direction.js`, `mapping-node-service.js` (graph transforms).
- The most DOM-coupled areas are: timeline editor components (`timeline-editor*.js`, `timeline-transport.js`), all `audio-mixer-*` components, shader editor components, timer panel, pixel map canvas/editor and LED test modal.
- Two behaviours to keep in mind when porting: (a) the timeline keyboard handler is document-global and not gated on focus for Space (`timeline-editor-inputs.js:187`); (b) the timeline canvas has no DPR scaling and no OS-file drop.

---

## Area totals

### Totals by directory
- Components (`client/components/`): **48 JS files, 11,018 LOC**.
- Lib (`client/lib/`): **60 JS files, 8,003 LOC**.
- CSS (`client/styles/`): **20 files, 5,015 LOC** (includes shared files; see section notes).
- All JS: **108 files, 19,021 LOC**.

### Totals by sub-feature (JS files / LOC; CSS LOC)
| Sub-feature | JS files | JS LOC | CSS LOC |
|---|---|---|---|
| 1. Timeline editor (+ state, waveform, wheel utils) | 24 | 4,948 | 272 |
| 2. Audio mixer, meters, cross-screen routing | 26 | 3,352 | 1,201 |
| 3. Media ops, rename, HAP, defaults | 10 | 1,015 | 541 |
| 4. Playlists (footer panel) | 3 | 282 | (in 07b2) |
| 5. Shader Live / Shader FX | 13 | 2,455 | 720 |
| 6. Timers | 4 | 918 | 461 |
| 7. CG / lower thirds / CG Studio / thumbs | 7 | 1,559 | 462 |
| 8. LED test / pixel map / fixtures / mapping state | 7 | 1,750 | 321 |
| 9. Map explorer (developer tool) | 1 | 1,059 | 800 |
| 10. Variables | 2 | 182 | (shared 08b) |
| 11. Streaming / WebRTC / V4L2 / DeckLink / virtual camera | 11 | 1,501 | 237 |
| **Total** | **108** | **19,021** | **5,015** |

CSS note: `04-media-lists-sources-tree.css` (285) is counted under media but is shared with the out-of-scope sources panel.

### Top 5 most complex operator files (by LOC and logic density)
1. `client/components/shader-live-editor.js` (491) — overlay workflow with live instance list, parameter wiring to `CG UPDATE`/`CG ADD`/`MIXER`, playlist-now tracking, wiggle preview, library save, mascot gating.
2. `client/components/timeline-editor.js` (472) — editor shell tying transport, canvas, playback runtime, WS tick/playback, compose refresh, channel map and screen changes.
3. `client/components/timeline-editor-handlers.js` (469) — the callback hub for the canvas: seek throttling, source drop with duration resolution, effect drop, keyframe operations, layer context menu, media content-resolution fetches.
4. `client/components/timeline-editor-inputs.js` (406) — document-level keyboard map with tab-activity gating, clipboard for clips and flags, frame/snap stepping, keyframe shortcut family.
5. `client/components/timeline-canvas-pointer.js` (404) — drag state machine with 7 drag types, snap resolution, keyframe hit tests, layer divider and layer move.

Also large but excluded from operator complexity: `client/components/map-explorer.js` (1059, developer tool) and `client/lib/timeline-state.js` (297) / `client/lib/shader-param-scan.js` (400, pure parser).

### All distinct API endpoints used (in-scope call sites)
Method + path, deduplicated. `{x}` = path parameter. Query and body variants are noted in the sections above.

1. GET /api/media
2. POST /api/media/cinf
3. POST /api/media/rename
4. POST /api/media/copy
5. POST /api/media/move
6. POST /api/media/delete
7. GET /api/media/library/defaults
8. POST /api/media/hap-encode
9. POST /api/media/hap-encode/probe
10. POST /api/media/hap-encode/cancel
11. GET /api/media/hap-encode
12. GET /api/local-media/{id}/waveform?bars=N
13. GET /api/timelines/{id}/state
14. POST /api/timelines
15. PUT /api/timelines/{id}
16. POST /api/timelines/{id}/seek
17. POST /api/timelines/{id}/pause
18. POST /api/timelines/{id}/play
19. POST /api/timelines/{id}/stop
20. POST /api/timelines/{id}/loop
21. POST /api/timelines/{id}/take
22. POST /api/timelines/{id}/sendto
23. POST /api/scene/take
24. POST /api/scene/audio-only/stop
25. POST /api/audio/solo
26. POST /api/audio/volume
27. POST /api/settings
28. GET /api/playlist/state
29. POST /api/playlist/control
30. GET /api/shaders
31. POST /api/shaders
32. POST /api/shaders/import
33. GET /api/shaders/{id}
34. DELETE /api/shaders/{id}
35. POST /api/shader-stack
36. POST /api/raw
37. GET /api/timers/list
38. POST /api/timers/cmd
39. POST /api/timers/visible
40. POST /api/timers/assign
41. POST /api/cg-thumb/render
42. GET /api/device-view
43. POST /api/device-view
44. POST /api/host-live/decklink
45. POST /api/v4l2-inputs/config
46. POST /api/v4l2-inputs/apply
47. GET /api/v4l2-inputs
48. GET /api/streams
49. GET /api/streaming-channel
50. POST /api/go2rtc/webrtc?src={name}
51. GET /api/virtual-camera/status
52. POST /api/virtual-camera/config
53. POST /api/virtual-camera/start
54. POST /api/virtual-camera/stop

Endpoints used only by outside-prefix callers that these lib files document or depend on (not counted above):
- POST /api/led-test-card (`lib/led-test-apply.js:133`)
- GET /api/lower-thirds/templates; POST /api/lower-thirds/{update,play,load,stop,clear}; GET /api/lower-thirds/active (`components/inspector-lower-third*.js`)
- POST /api/streaming-channel/rtmp; POST /api/streaming-channel/record; GET /api/streaming-channel (`components/device-view-actions.js`)
- Static: `/templates/shaders/{id}.html`, `/templates/{dir}/thumbnails/{name}.png` (HEAD), `/cg-studio/index.html`, `assets/map-data.json`.

Total distinct in-scope endpoints: **54** (plus the 10 static/outside-caller items above).

### All distinct WS message types used
Read by in-scope code (wired in `client/lib/app-ws-handlers.js`, outside scope, and consumed through `stateStore`/`VariableStore`):
1. `timeline.tick` (`app-ws-handlers.js:189` → `timeline-editor.js:424`)
2. `timeline.playback` (`app-ws-handlers.js:190` → `timeline-editor.js:425`)
3. `variable_update` (`app-ws-handlers.js:110`; `lib/variable-state.js:22`)
4. `state` (`lib/variable-state.js:14`; `app-ws-handlers.js:116`)
5. `streaming_channel` (`app-ws-handlers.js:192` → `lib/streaming-channel-state.js:232`)
6. `compose.preview` (subscription at `timeline-editor.js:349`; WS source `app-ws-handlers.js:194`, outside scope)

Not consumed directly by in-scope files (they reach panels only through generic `stateStore` `*` subscriptions): `change` (`app-ws-handlers.js:138`), `mixer_update` (`:247`), `dmx:colors` (`:136`), `lower-third.state` (`:215`), `project_sync` (`:221`), `gpu_topology_changed` (`:283`), `operatorGuiLayout` (`:197`), `companion.buttonPreview` (`:199`), `global_border_sync` (`:211`).

WS message types **sent** by in-scope code: **none**.

stateStore event names read in scope (not WS types): `timeline.tick`, `timeline.playback`, `channelMap`, `screenChange` (sceneState), `*` (generic), `decklinkInputsStatus`, `liveAudioInputsStatus`, `v4l2InputsStatus`, `mappingTemplates`, `scene`/`scene.live`, `media`, `variables`, `settings`.
