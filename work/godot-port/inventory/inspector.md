> **Provenance:** Haiku-generated inventory (2026-10-17) for [WO-593](../../work-orders/593_WO_godot_client_port_epic.md), spot-checked by hand where a WO relies on it. Line refs are to the 2026-10-17 tree (synced to `origin/main` d5521d50) and will drift; re-grep before acting on one.

# B: Inspector area inventory (client web app, read-only)

Repo root: `/Users/marcin/highascg`. Paths below are repo-relative. LOC from `wc -l`.

## Scope and method

- **In-scope files (literal glob `client/components/inspector*.js`)**: 45 files, 9,632 LOC. All 45 are inventoried in the sub-features below.
- **Inspector-specific lib files** (`client/lib/*`) imported by the 45 files: 19 files, 2,462 LOC, listed under "Lib modules (inspector-specific)". Shared lib modules are listed separately and not totalled.
- **CSS**: 6 files named for the inspector (1,660 LOC). Mixed-use files with inspector rules are listed at the end.
- **Adjacent, excluded by the literal glob**: 33 files, 7,308 LOC (`device-view-inspector*`, `device-view-destinations-inspector*`, `previs-*inspector*`, `fixture-inspector.js`). Not inventoried; the pure-JS modules `fixture-inspector.js` and `device-view-inspectors.js` are referenced from the panel code.
- Evidence convention: `file:line`. "No match" means a grep over the in-scope files found nothing.

## Global architecture facts (cited once)

- The panel is one root `div` that is replaced via `root.innerHTML`/`createElement` on every render (e.g. `client/components/inspector-panel.js:69-75`, `inspector-panel.js:206-234`). Sub-inspectors are plain functions that build DOM and attach `addEventListener` handlers. No framework.
- Edits go to singletons: `sceneState` (`client/lib/scene-state.js`), `timelineState` (`client/lib/timeline-state.js`), `multiviewState`, `settingsState`, `dmxState`, plus a `stateStore` passed in by the caller. Most writes are `sceneState.patchLayer(sceneId, layerIndex, patch)` followed by `document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))` (count: 37 `patchLayer` call sites in the area).
- Live-to-Caspar edits go over HTTP through `api` (`client/lib/api-client.js`, 176 LOC). The inspector never calls `ws.send`. The only WS consumers in this area are `ws.on` subscriptions inside `client/lib/operator-gui-mode-report.js:416-417`, and the WS events are dispatched by `client/lib/app-ws-handlers.js` (out of scope, cited where they feed the inspector).
- Persistence: `sceneState` writes `localStorage['casparcg_scenes_v2']` (`client/lib/scene-state-persistence-logic.js:11`, written at `client/lib/scene-state.js:162`) with a 1000 ms debounce (`scene-state.js:152-166`), and reads legacy `casparcg_scenes_v1` (`scene-state-persistence-logic.js:10`). Server sync is out of scope.

---

## Panel shell and selection routing

### Files
- `client/components/inspector-panel.js` — 482 — Inspector hub. Owns `selection`, the mode (`inspector` / `layerPresets` / `lookPresets`), and 16+ window/document event subscriptions that set selection; calls the per-type renderer.
- `client/components/inspector-panel-routing.js` — 173 — Duplicate copy of the selection router plus a duplicate `inspectorSelectionKey`. **0 importers** (grep for the module path returns nothing) — dead code. It also lacks the `mediaFile` and `screenTimer` branches that `inspector-panel.js` has (`inspector-panel.js:179-183`, `:127-131`).
- `client/components/inspector-panel-views.js` — 44 — Thin view renderers: multiview cell, look (scene) title, re-exports `renderSceneLayerInspector`, `renderGlobalBorderInspector`, `getResolutionForScreen`.
- `client/components/inspector-panel-selection-key.js` — 33 — Pure function `inspectorSelectionKey(data)` returning a string key per selection type (used to decide "entity changed" vs same entity, `inspector-panel.js:207-233`).
- `client/components/inspector-panel-mode-storage.js` — 20 — Reads/writes the panel mode in `sessionStorage` key `hacg_inspector_panel_mode` (line 1; read line 6; write line 16).
- `client/components/inspector-panel-live-source-events.js` — 64 — Window event wiring for live-source selection (`live-audio-input-select`, `webpage-host-select`, `ndi-host-select`, `v4l2-input-select`) → `update({type,...})` (lines 4-63).
- `client/components/inspector-channel-resolution.js` — 16 — `getResolutionForScreen(stateStore, screenIdx)` reads the program resolution for a screen from `stateStore` (WO-532 comment, lines 1-10).
- `client/components/inspector-panel-timeline.js` — 7 — Re-export barrel for the timeline inspector modules (see Timeline section).

### What the operator can do
- Click a scene, look layer, multiview cell, screen timer ⏱, global border, timeline clip, timeline flag/layer, media file, live-audio slot, webpage/NDI/V4L2 live source, or pixel-map fixture — the right-hand inspector shows that item's properties (`inspector-panel.js:112-192`).
- Switch the panel between Inspector, Layer presets, and Look presets (`inspector-panel.js:246-254`); mode is session-scoped (`inspector-panel-mode-storage.js`).
- Any concrete selection flips the mode back to Inspector (`inspector-panel.js:238-242`).
- Empty state: "Select an item" (`inspector-panel.js:74`). PixelMap tab active → fixture inspector (`inspector-panel.js:70-72`, `:102-104`).

### Rendering tech
- DOM only (`root.innerHTML = ...`, `createElement`). Evidence: `inspector-panel.js:74`, `inspector-panel-views.js:24-40`.

### Interaction
- Wheel over an **unfocused** range slider scrolls the panel instead of changing the value: `inspector-panel.js:46-56` (`wheel`, `passive: false`, `preventDefault`, then `root.scrollTop += e.deltaY`).
- Click on a mode tab: `inspector-panel.js:246-254`. Click on any `.workspace__tabs .tab` triggers a redraw in the next animation frame: `inspector-panel.js:461-467`, `:463` (`requestAnimationFrame`).
- Re-render preserves focus when the entity did not change: `renderPreservingFocus` (`inspector-panel.js:229-233`, imported from `client/components/device-view-ui-utils.js`).
- Stale-render guard: field focus blocks re-render (`inspector-panel.js:416`, `:428`, `:340`, `:351`).

### Server contract
- None directly. Indirect inputs listed under "Client state".
- Inbound WS (indirect, produced by `client/lib/app-ws-handlers.js`): `timeline.tick` (`app-ws-handlers.js:189`), `timeline.playback` (`app-ws-handlers.js:190`). Consumed at `inspector-panel.js:60-67`.

### Client state
- `stateStore` keys read: `timeline.tick` / `timeline.playback` events (`inspector-panel.js:60`, `:64`); `extraLiveSources` (`inspector-panel.js:334`).
- `sceneState` events subscribed: `change` (`inspector-panel.js:422`), `softChange` (`:434`). `multiviewState` `change` (`:370`). `timelineState` `change` (`:380`). `settingsState.subscribe` (`:459`). `dmxState` `selection` (`:477`).
- Window events consumed (producer in parentheses): `timeline-flag-select`, `media-file-select` (`sources-panel-media-selection.js:66`), `timeline-clip-select` (`timeline-editor-inputs.js:154`, `timeline-editor-handlers.js:178`), `scene-layer-select` (`sources-panel-live-render.js:306`), `scene-select`, `global-border-select`, `screen-timer-select` (`scene-list-column.js:137`), `global-border-state-changed`, `global-border-artnet` (`lib/global-border-artnet-ws.js:56`), `timeline-layer-select` (`timeline-editor-handlers.js:339`), `multiview-select` (`multiview-editor.js:276`), `highascg-inspector-redraw`, `highascg-workspace-tab-activated` (`inspector-panel.js:256-475`).
- Document events: `highascg-settings-applied` (`inspector-panel.js:457`), `highascg-editor-defaults-changed` (`:458`), `multiview-select` capture (`:368`).
- Extension point: dispatches `highascg-inspector-render-external` (`inspector-panel.js:195`, also in the dead routing module). **No listener found under `client/`.**
- Global mutable flag: `window.__hacgSuppressSceneLayerInspectorRefresh` read at `inspector-panel.js:414`, written by the PIP colour picker (`inspector-pip-overlay.js:169-177`).

### Browser-only APIs
- `CustomEvent` / `window.addEventListener` (throughout), `requestAnimationFrame` (`inspector-panel.js:463`), `sessionStorage` (`inspector-panel-mode-storage.js:6`, `:16`), `setTimeout` debounce 120 ms (`inspector-panel.js:412-420`).

### Port-risk notes
- Routing is a long if-chain over `data.type` (`inspector-panel.js:112-192`). Pure in principle (`inspectorSelectionKey` is pure), but the renderers mutate `root`.
- The selection state machine is spread across ~16 event listeners that each call `update()`. This is the main place where a port must reproduce event ordering.
- Dead duplicate: `inspector-panel-routing.js` (0 importers) should not be ported.
- Dead event: `highascg-inspector-render-external` has a dispatcher and no listener in `client/`.

---

## Shared input primitives

### Files
- `client/components/inspector-common.js` — 296 — `createDragInput` (drag-to-adjust number field with mini slider, wheel, and math on commit), `createStepperInput` (integer field with ▲/▼ buttons and arrow keys), `KF_PROPERTIES` (keyframe property table, lines 290-296).

### What the operator can do
- Drag a number field left/right to scrub its value (after 5 px threshold); type an expression that is evaluated on commit (e.g. `1920/2`, `100+50`); wheel to step; Shift+wheel steps ×10; mini slider when bounds are finite.
- Layer index stepper: type, ▲/▼, Arrow keys (Shift = ×10), Enter blurs (`inspector-common.js:250-261`).

### Rendering tech
- DOM `<input type="text">` + optional `<input type="range">` (`inspector-common.js:21-23`, `:117-119`).

### Interaction
- Drag: `mousedown` on the input (`inspector-common.js:75`) starts tracking; `mousemove`/`mouseup` on `document` (`:100-101`). Threshold `DRAG_THRESHOLD = 5` (`:73`), sensitivity `0.5` (`:32`), delta per pixel = `dx * 0.5 * step` (`:87`), clamped to `[min,max]` (`:89`). `inp.blur()` on drag start (`:84`).
- Wheel: `wheel`, `preventDefault`, `passive:false` (`inspector-common.js:106-113`); uses `getWheelDelta` (`client/lib/wheel-delta.js`); Shift = ×10 (`:110`).
- Commit: `change` and `blur` both call `commitFromField` (`:103-104`); invalid text restores last committed value (`:66-68`).
- Mini slider `input` event: `inspector-common.js:127-136`.
- Stepper: `change`, `blur` (`:248-249`), `keydown` Enter/ArrowUp/ArrowDown (`:250-261`), button `click` (`:263-270`).
- Math parsing: `parseNumberInput` (`client/lib/math-input.js:141`) and `attachMathInput` (`math-input.js:407`), imported in `inspector-common.js:5`.

### Server contract
- None.

### Client state
- None (pure widget). Each instance keeps `lastCommitted`, `startX`, `startVal` in closures (`inspector-common.js:30-35`).

### Browser-only APIs
- `mousedown`/`mousemove`/`mouseup` on `document` (`inspector-common.js:75-101`), `wheel` (`:106`), `ev.clientX` (`:80`, `:86`).

### Port-risk notes
- Drag-to-scrub is pointer-driven with a 5 px dead zone and blur-on-drag. Portable as a state machine; needs the same sensitivity constants to keep feel.
- Expression evaluation is pure: `evaluateMath` is a regex whitelist (`[\d\s+\-*/.()]`, `client/lib/math-input.js:8-14`) feeding a tokenizer/recursive-descent parser (`math-input.js:36-40`, `:194`). Portable; no `eval`/`Function` (grep: no matches).

---

## Look layer: geometry (fill / position / size / align)

### Files
- `client/components/inspector-scene-layer.js` — 287 — Look layer inspector shell: layer-index stepper, layer-style clipboard (copy/paste/save preset), mounts playlist, transport, live-audio source, fill, mixer, HTML template, lower-third, countdown, effects, PIP, and "Look take" start-behaviour select. Also owns `patchFillPx` (aspect-lock aware) and `patchFillAlign`.
- `client/components/inspector-fill.js` — 425 — Fill group: alignment icon row, X/Y/W/H drag inputs, Scale %, Zoom % (pan-scan), aspect lock, content-sizing select. Also exports `appendMultiviewPositionSize` (multiview cell X/Y/W/H with aspect-lock solver). Exports `appendLayerAlignButtons`, `LAYER_ALIGN_MODES`, `SCENE_CONTENT_FIT_OPTIONS` re-export.

### What the operator can do
- Set a look layer's X/Y/W/H (display coordinates, origin-aware), scale %, zoom % (100-400, pan-scan), aspect lock, content sizing (`native`, `fill-canvas`, `horizontal`, `vertical`, `stretch`; options from `client/lib/scene-content-fit.js`).
- Align the layer: left, right, top, bottom, centre-h, centre-v, centre (7 icon buttons loaded from `/assets/*.svg`, `inspector-fill.js:21-54`, `:59-80`).
- Change the layer index (`sceneState.setLayerNumber`, `inspector-scene-layer.js:58-68`).
- Copy/paste/save layer style (`inspector-scene-layer.js:87-125`).
- Set multiview cell X/Y/W/H and lock aspect (`inspector-fill.js:335-424`).

### Rendering tech
- DOM (`createElement`, `innerHTML`). Icons: `<img src="/assets/...svg">` (`inspector-fill.js:52-54`, `:69-73`).

### Interaction
- Drag-to-adjust via `createDragInput` for X/Y/W/H (`inspector-fill.js:162-206`), so mouse drag, wheel, and typed expressions all apply.
- Align buttons: `click` (`inspector-fill.js:75`).
- Scale %: `keydown` Enter → `applyScale` (`:244-249`), Apply button `click` (`:254`).
- Zoom: `change` (`:276-281`). Aspect lock: `change` (`:295-299`). Content sizing: `change` → `reapplyLayerFrameForContentFit` (`:320-323`, `:125-146`).
- Multiview position/size: `createMathInput` with `onChange` (`inspector-fill.js:339-352`, `:379-408`).
- Layer-style buttons: `click` (`inspector-scene-layer.js:101-124`), `window.prompt` for preset name (`:116`).
- Layer index stepper: `onChange` (`:70-85`).
- Look take "Clip start point" select: `change` (`inspector-scene-layer.js:269-274`).

### Server contract
- `GET /api/media` (`inspector-fill.js:137`) — via `fetchMediaContentResolution` in `client/lib/mixer-fill.js`, to read the content resolution used by content sizing.
- Writes go through `sceneState.patchLayer` and are persisted by the scene-state layer (not an HTTP call from this file). Multiview writes go through `multiviewState.setCell(cellId, {...})` (`inspector-fill.js:343`, `:350`, `:391`, `:406`, `:422`). `multiviewState` `apply-request` (`client/lib/multiview-state.js:43`, `:280`) is what sends `/api/multiview/apply` (out of scope).

### Client state
- `sceneState`: `getScene`, `getCanvasForScreen(mainIdx)`, `patchLayer`, `setLayerNumber`, `copyLayerStyle`, `pasteLayerStyle`, `saveLayerPresetFromLayer`, `hasLayerStyleClipboard` (`inspector-scene-layer.js`, `inspector-fill.js:113`, `:132`, `:228-231`).
- `stateStore.getState().channelMap` (`inspector-fill.js:361`).
- Module-level `activeInteractionAr` / `activeInteractionTimer` (`inspector-scene-layer.js:23-24`, `:151-163`) — a 500 ms memory of the aspect ratio during drag.

### Browser-only APIs
- `window.prompt` (`inspector-scene-layer.js:116`). `img` with `draggable=false` (`inspector-fill.js:73`). No canvas drawing here.

### Port-risk notes
- Geometry is pure math shared with the canvas editor: `fill-math.js` (no DOM refs), `coordinate-origin.js` (no DOM refs), `layer-crop.js` (no DOM refs). Portable.
- Stored fill is a 0–1 fraction; display is origin-aware and crop-aware (WO-388B comments, `inspector-scene-layer.js:50-54`, `:141-145`). Port must reproduce crop-visible-rect inversion (`patchFillPx`, `inspector-scene-layer.js:136-174`).
- Aspect lock uses content aspect when known, else a 500 ms-sticky ratio (`:147-170`). Timing-dependent state.
- `patchFillPx` is the aspect-lock solver used for X/Y/W/H; `patchFillAlign` uses `alignFillForLayer` (`:179-190`).

---

## Look layer: mixer / audio

### Files
- `client/components/inspector-mixer.js` — 358 — Shared Audio group (route pair or source-channel select, mute, volume drag with dB label), look-layer Mixer group (rotation, opacity %, straight alpha, loop), "Fade on end", and timeline-layer rename/add/remove (`renderTimelineLayerInspector`, `:294-358`).

### What the operator can do
- Pick the audio output pair (`1+2`, `3+4`, ...) from the program layout (`inspector-mixer.js:88-106`), or for route sources the source channel set `all|1+2|3+4|5+6|7+8` (`:53-81`).
- Mute; set volume as a fader percent with dB readout (`inspector-mixer.js:128-152`); rotation (-180..180, step 0.5); opacity 0–100; straight alpha (KEYER); loop playback (only when source supports loop); fade-out frames (1–250) when clip ends.
- Timeline layer: rename, add layer below, remove layer (with confirm) (`:294-358`).

### Rendering tech
- DOM only.

### Interaction
- Route select `change` (`inspector-mixer.js:103`), mute `change` (`:137`), source-channel `change` (`:76-78`), alpha/loop/fade checkboxes `change` (`:196`, `:215`, `:240`), fade frames drag-input (`:248-259`), rotation/opacity/volume drag inputs (`:164-185`, `:143-151`). Name input `change` (`:316`). Remove confirm `confirm(...)` (`:349`).
- A canonical route is written back on render via `queueMicrotask(() => onPatch({ audioRoute: canonical }))` when stored value is non-canonical (`inspector-mixer.js:84-86`).

### Server contract
- Writes are `sceneState.patchLayer` / `timelineState.updateLayer` (`inspector-mixer.js:167`, `:180`, `:197`, `:216`, `:241`, `:256`, `:280`, `:317`, `:336`, `:350`). Timeline layer changes call `syncTimelineToServer()` (`inspector-mixer.js:318`, `:337`, `:351`; defined in `inspector-panel-timeline-shared.js:55-62`, which does `PUT /api/timelines/:id` (`:59`) or `POST /api/timelines` (`:61`)).
- No direct `api.*` call in this file.

### Client state
- `settingsState.getSettings()` (`inspector-mixer.js:29`), `settingsState.getSettings()?.channelMap`. `sceneState.activeScreenIndex`. `timelineState` (`inspector-mixer.js:317`).
- Lib (inspector-specific or shared): `client/lib/audio-routes.js` (71), `client/lib/program-audio-layouts.js` (147), `client/lib/audio-volume-scale.js` (86), `client/lib/media-ext.js` (`sourceSupportsLoopPlayback`, 128).

### Browser-only APIs
- None beyond DOM events.

### Port-risk notes
- Audio route canonicalisation depends on the program layout (`resolveProgramLayoutForMain`, `resolveEffectiveProgramLayout`). Pure lib functions; portable.
- Volume is a linear gain with a percent fader mapping and a dB label (`audio-volume-scale.js`). Portable math.
- Dependency note: a comment at `inspector-mixer.js:46-49` records a past `ReferenceError` in this path; keep the canonical-route variable function-scoped.

---

## Effects (mixer effects editor)

### Files
- `client/components/inspector-effects.js` — 326 — Mixer Effects group for look layers and timeline clips: drop zone + "Choose effect to add..." select, one card per effect with primary and advanced parameter editors. Parameter types: `select`, `bool`, numeric drag input, and a pixel-space editor for `displayAs:'px'` (crop) with a slider.

### What the operator can do
- Add an effect by drag-and-drop from the Effects tab, or from the select (`inspector-effects.js:223-256`, `:259-293`). Duplicates are refused (`:244`, `:281`).
- Edit each parameter; crop shows px of the content resolution, stored as 0–1 fractions (`:74-98`).
- Remove an effect (✕, `:166-175`) and reveal advanced params in a `<details>` (`:188-201`).

### Rendering tech
- DOM only. `<details>`/`<summary>`.

### Interaction
- Drop zone: `dragover` (`inspector-effects.js:227-233`, sets `dropEffect='copy'`), `dragleave` (`:234`), `drop` reads `application/json` from `dataTransfer` (`:237-256`, `:241`).
- Select `change` (`:277-293`). Checkbox/select editors `change` (`:46`, `:64`). Drag inputs per `createDragInput` (`:100-109`).

### Server contract
- None directly. Live apply goes through `scheduleLiveEffectApply` (`client/lib/effect-apply-live.js`), which calls `POST /api/mixer/effect` with `{channel, layer, effectType, params}` (`effect-apply-live.js:125`). Called from `inspector-effects.js:152`, `:251`, `:290`.

### Client state
- Effect definitions from `client/lib/effect-registry.js` (371 LOC, pure schemas): `MIXER_EFFECTS`, `EFFECT_MAP`, `createEffectInstance`, `effectPrimarySchema`, `effectAdvancedSchema`.
- Live context object `liveApplyContext` (`kind: 'scene_layer' | 'timeline_clip'`) is supplied by the caller (`inspector-scene-layer.js:218-224`, `inspector-panel-timeline-clip.js:420-427`).

### Browser-only APIs
- HTML5 drag and drop: `DataTransfer.getData`, `dropEffect` (`inspector-effects.js:230`, `:241`). Same for the playlist (see below). The drag source is in the Sources panel (not in scope).

### Port-risk notes
- Drag-and-drop payload is a JSON string under MIME `application/json`, with `type: 'effect'`. A native port needs an equivalent drag payload contract.
- Effect registry and schemas are pure data (`effect-registry.js`, no DOM refs).
- The px-vs-fraction conversion is presentation-only (`inspector-effects.js:26-28`).

---

## Layer playlist and playback mode

### Files
- `client/components/inspector-layer-playlist.js` — 414 — Layer Playback Mode select (single / playlist), playlist item list with drag-to-reorder, per-item timeless duration, per-item loop, delete, dropzone, playlist settings (advance auto/manual, loop list, transition type and frames, timeless seconds + Apply to all, Next button).
- `client/components/inspector-media-transport.js` — 380 — Look-layer media transport (play/pause, scrub, trim in/out, "Set in/out ← playhead") for a single video layer. Live-only: enabled when the look is on PGM or PRV. Drives Caspar via `/api/pause`, `/api/resume`, `/api/seek`.
- `client/components/inspector-live-audio-source.js` — 100 — Look layer whose source is a live audio slot: slot select, label, "audio only" toggle; sets `source = {type:'live_audio', value: slot}`.

### What the operator can do
- Switch a layer between single media and a playlist; seed the playlist from the current source (`inspector-layer-playlist.js:35-57`).
- Drop media from the Sources panel into the playlist (multi-select allowed) (`:86-128`).
- Reorder items by dragging rows (`:194-236`). Remove an item (`:260-273`). Toggle an item's loop (holds playlist until Next) (`:250-257`).
- Set duration for timeless items (graphics, templates, shaders), bulk "Apply to all" (`:331-352`). Timed media shows its real length as static text (`:179-181`).
- Set advance mode auto/manual, loop list, transition type MIX/CUT/SLIDE/WIPE and frames (`:288-327`, `:394-406`).
- Press **Next ▶** (shown when manual or any item loops) (`:362-386`).
- Media transport: play/pause, scrub bar (0 to duration), trim in/out (persisted on the layer, applies on next take), "Set in/out ← playhead". Disabled when the look is not on program or preview (`inspector-media-transport.js:233-259`).
- Live audio source: pick slot 1..N, label, audio-only (`inspector-live-audio-source.js:12-100`).

### Rendering tech
- DOM only. No canvas, no `<video>`. Thumbnails are `<img>` of `getThumbnailUrl(...)` with `onerror="this.remove()"` (`inspector-layer-playlist.js:156-165`).

### Interaction
- Drop zone: `dragover`, `dragleave`, `drop` with `parseDraggableSourcesPayload(e.dataTransfer)` (`inspector-layer-playlist.js:86-128`, parser in `client/components/scenes-shared.js`).
- Row reorder: `itemRow.draggable = true` (`:145`), `dragstart` sets `effectAllowed='move'` and remembers `playlistDragFromId` (`:194-199`), `dragover`/`drop` splice the list (`:205-236`).
- Duration input `change` + `attachMathInput` (`:239-248`). Loop checkbox `change` (`:250-257`). Delete `click` (`:260-273`).
- Settings selects/inputs `change` (`:355-407`). "Apply to all" `click` (`:338-351`). Next `click` (`:365-385`).
- Media transport: play `click` (`inspector-media-transport.js:261-272`), scrub `input` (debounced seek 60 ms, `:275-281`), `change` (`:282-288`). Trim via `createDragInput` (`:319-338`). Set in/out `click` (`:349-368`).
- Setup: `setInterval` 200 ms tick refreshes button and scrub state (`TICK_MS=200`, `inspector-media-transport.js:22`, `:301-307`). Duration retry loop: `setInterval` 400 ms up to 25 tries (`:132-135`, `:172-193`).

### Server contract
- `POST /api/playlist/next` `{channel, layerNumber}` (`inspector-layer-playlist.js:376`).
- `POST /api/pause` `{channel, layer}` or `POST /api/resume` (`inspector-media-transport.js:265-267`).
- `POST /api/seek` `{channel, layer, frame, positionMs}` (`inspector-media-transport.js:295`).
- Playlist, trims, and timeless duration are written with `sceneState.patchLayer` (`inspector-layer-playlist.js:54`, `:124`, `:231`, `:244`, `:254`, `:270`, `:348`, `:357`, `:390`, `:397`, `:404`). Persisted via scene-state (out of scope).
- Live audio source: no HTTP call; writes `sceneState.patchLayer` (`inspector-live-audio-source.js:80-91`).
- WS: none sent. Inbound layer state for the transport comes from `stateStore` `playback.matrix` (read at `inspector-media-transport.js:123`), filled by WS `state` (out of scope).

### Client state
- `stateStore.getState()`: `playback.matrix` or `playbackMatrix` keyed `"${channel}-${layer}"` with `playing`, `startedAt`, `pausedElapsedMs` (`inspector-media-transport.js:120-130`); `channelMap` `programResolutions` / `previewResolutions` for fps (`:81-84`).
- `sceneState.liveSceneIdByMain` / `previewSceneIdByMain` decide PGM/PRV target (`:97-104`).
- Lib: `client/lib/playlist-timeless.js` (31, pure), `client/lib/media-duration.js` (147), `client/lib/media-exists.js` (`clipMissing`, 106), `client/lib/thumbnail-url.js` (142).

### Browser-only APIs
- HTML5 DnD (`draggable`, `dataTransfer`), `Date.now()` for timing, `setInterval`/`setTimeout`. `document.body.contains(...)` as a lifetime check (`inspector-media-transport.js:173`, `:302`).

### Port-risk notes
- Transport target resolution is the key logic: a layer is controllable only if its look is PGM or PRV (`inspector-media-transport.js:93-106`). Pure given `sceneState` + `channelMap`.
- Elapsed time is client-extrapolated from `startedAt` (`:126-128`): `Date.now() - startedAt`. Clock-dependent.
- Playlist advancement/timing is server-side; the inspector only shows state and sends Next.
- Trim rules: trim-in null when 0, trim-out null when ≥ duration (`:327`, `:337`, `:355`, `:367`).
- `NON_VIDEO_SOURCE_TYPES` set (`:25-37`) defines which layers get no transport. Portable data.

---

## Media file (library clip) inspector

### Files
- `client/components/inspector-media-file.js` — 215 — Media-file inspector (one clip selected in Media tab). Kiosk preview via Caspar hole, waveform, transport (kiosk only), metadata list, mounts library + versions sections.
- `client/components/inspector-media-file-library.js` — 151 — Per-file trim/mute defaults (`POST /api/media/library/defaults`), a "Used in" list (`inspector-media-file-library.js:143`), rename (`POST /api/media/rename`), final delete (`POST /api/media/delete`). Exports `parseTimeInput`.
- `client/components/inspector-media-file-versions.js` — 118 — Versions: upload a new version (same path), list old versions, restore one, purge one.
- `client/components/inspector-media-file-wave.js` — 65 — Waveform canvas drawing and timecode formatter (`drawMediaWaveform`, `formatMediaTimecode`).

### What the operator can do
- See name, folder, codec, resolution, fps, duration (`inspector-media-file.js:44-52`, `:47-75`).
- Preview: on the **kiosk** (operator-GUI mode, video only), playback is on Caspar and shows through a DOM hole; play/pause and seek are on the waveform. Remote clients get a thumbnail (`:54-58`).
- Waveform with trim markers; click the waveform to seek (kiosk) (`:186-193`).
- Set per-file default trim in/out (`mm:ss.ff` input), mute default; rename (keeps extension); delete permanently (confirm says "final") (`inspector-media-file-library.js:83-137`).
- Upload a replacement version (file picker or drag-and-drop), list versions with size and date, restore or purge a version (`inspector-media-file-versions.js:32-118`).

### Rendering tech
- DOM with a `<canvas>` waveform (`inspector-media-file.js:65`, `inspector-media-file-wave.js:34` `getContext('2d')`). Thumbnail `<img>` (`inspector-media-file.js:58`).
- **Kiosk preview is a Caspar video layer drawn behind a transparent DOM hole.** `.media-insp__preview--hole` (`inspector-media-file.js:57`, `:130`). The hole's on-screen rect is measured with `getBoundingClientRect` every 200 ms (`:188`, `:206`, `:213`) and reported to the operator-GUI layout via `reportMediaPreviewRect` (`:201`, `:211`; implemented in `client/lib/operator-gui-mode-report.js:194`).
- No `<video>` or `<audio>` element anywhere in the area (grep: no matches).

### Interaction
- Canvas `click` → seek (`inspector-media-file.js:186-193`). `ResizeObserver` on the canvas redraws (`:126`).
- Play button `click` (`:173-185`).
- Library: time inputs `change` (`inspector-media-file-library.js:89-90`), mute `change` (`:91`). Rename via `prompt` (`:112`), delete via `confirm` (`:126`).
- Versions: file input `change` (`inspector-media-file-versions.js:90`), drop zone `dragover`/`drop` with `dataTransfer.files` (`:91-98`). Confirm before replace (`:73`) and before purge (`:109`).

### Server contract
- `GET /api/local-media/{id}/waveform?bars=600` (`inspector-media-file.js:108`) → `{durationMs, hasAudio, peaks}`.
- `POST /api/media/preview` (kiosk): `{action:'load', id}` (`:146`), `{action:'seek', seconds}` (`:179`, `:192`), `{action:'play'}` / `{action:'pause'}` (`:181`, `:159`), `{action:'stop'}` (`:202`). Response includes `channel`, `layer` (`:149-150`).
- OSC: `window.highascg_osc_client.onLayerState(channel, layer, cb)` (`:151-164`) — the OSC client (`client/lib/osc-client.js:167`) is fed by WS `osc` and `state` messages (`osc-client.js:56`, `:58`). Callback reads `file.elapsed`, `file.duration`, `paused`.
- `GET /api/media/library/entry?path=...` (`inspector-media-file-library.js:136`; `inspector-media-file-versions.js:63`).
- `GET /api/media/library/defaults` (in `client/lib/media-file-defaults.js:16`), `POST /api/media/library/defaults` `{path, ...patch}` (`inspector-media-file-library.js:72`).
- `POST /api/media/rename` `{renames:[{from,to}]}` (`:116`). `POST /api/media/delete` `{id}` (`:128`).
- `POST /api/media/version/upload?path=...` multipart with progress (`inspector-media-file-versions.js:79`; upload helper `client/lib/form-upload.js:10` uses `XMLHttpRequest`).
- `POST /api/media/version/restore` `{path, v}` (`:107`). `POST /api/media/version/purge` `{path, v}` (`:110`).
- WS: none sent.

### Client state
- Window events emitted: `media-library-changed` with `{renamed}`/`{deleted}`/`{}` (`inspector-media-file-library.js:117`, `:129`; `inspector-media-file-versions.js:25`). `media-file-select` with null on delete (`:130`). `sources-panel.js:303` listens to `media-library-changed`.
- `sceneState` via `setLocalMediaFileDefaults` in `client/lib/media-file-defaults.js` (imports `sceneState` indirectly through `scene-state-layer-ops.js`).
- Module state: `currentToken` (`inspector-media-file.js:21`) — "newest mount owns the Caspar preview layer".

### Browser-only APIs
- `ResizeObserver` (`inspector-media-file.js:126`), `getBoundingClientRect` (`:188`, `:206`), `setInterval` (`:213`), `CanvasRenderingContext2D` (`inspector-media-file-wave.js:34`), `FormData` + `XMLHttpRequest` upload progress (`client/lib/form-upload.js:10`), `File` / `dataTransfer.files` (`inspector-media-file-versions.js:95-98`), `prompt`/`confirm` (`inspector-media-file-library.js:112`, `:126`).

### Port-risk notes
- Kiosk preview depends on Caspar rendering codecs a browser cannot decode (NotchLC/HAP/ProRes; `inspector-media-file.js:4-8`). A native client must either decode or keep this Caspar-hole model. The hole rect is reported to the server as a DOM rect (`reportMediaPreviewRect`). This is a DOM-coupled contract.
- Waveform peaks: plain data, drawn with 2D canvas. Port-easy.
- Time-input parser `parseTimeInput` (`inspector-media-file-library.js:13-25`) is pure.
- Versions upload uses an XHR progress callback (`form-upload.js`); equivalent progress needed natively.

---

## PIP overlays

### Files
- `client/components/inspector-pip-overlay.js` — 486 — PIP overlay stack for look layers: add/remove/reorder overlays (max `PIP_OVERLAY_MAX_STACK`), type change, parameters (number drag inputs, select, bool, colour), and live push to program when the look is on PGM and not being edited.

### What the operator can do
- Add an overlay (border, drop shadow, glow, edge strip, from `client/lib/pip-overlay-registry.js`), up to the stack max (`inspector-pip-overlay.js:430-471`, `:454-456`).
- Edit params per overlay; move earlier/later; remove; change type (`:331-338`, `:250-341`, `:293-300`).
- Edits to an on-air look are pushed to Caspar with a 200 ms debounce (`:26`, `:48-63`).

### Rendering tech
- DOM. Colour is `<input type="color">` (`:165`). The overlay itself renders on Caspar (the inspector only sends params). The header comment says overlays are "Caspar CG on the PIP layer when z allows" (`:3`).

### Interaction
- Number params: `createDragInput` (`:226-235`). Select `change` (`:200`), bool `change` (`:218`), colour `input`/`change`/`blur` (`:171-178`).
- Reorder buttons `click` (`:285-298`, `:413-426`), remove `click` (`:307-310`), add-select `change` (`:460-471`).
- Colour picker suppresses inspector re-render via `window.__hacgSuppressSceneLayerInspectorRefresh` (`:169-177`).
- `visibleWhen` rows show/hide in place during a drag (`:345-367`).

### Server contract
- `POST /api/pip-overlay/remove` `{channel, layer, nextContentLayer}` (`:114`, `:134`).
- `POST /api/pip-overlay/update` `{channel, layer, stackIndex, overlay, overlays, fill, rotation, nextContentLayer}` (`:122-131`).
- `POST /api/pip-overlay/apply` (same body shape, `:136-145`).
- Live push skipped when `sceneState.editingSceneId === sceneId` or the look is not on PGM (`:50-51`, `:71-72`).
- Content rect comes from `resolveLayerContentRectForOverlay` in `client/lib/mixer-fill.js` (`:92-99`).
- WS: none sent.

### Client state
- `sceneState.liveSceneId`, `editingSceneId`, `getScene`, `getCanvasForScreen` (`:50`, `:71`, `:74`, `:89`).
- `stateStore.getState().channelMap` `programChannels`, `programResolutions` (`:79-87`).
- Module state: `_pipLiveTimers` Map and `_pipLiveShape` Map (`:21-24`) — the shape diff chooses update vs remove+apply (`:105-109`, `:120-147`).

### Browser-only APIs
- `setTimeout` debounce, `<input type="color">`, `window` global flag (`:169-177`).

### Port-risk notes
- Stack diff logic (`struct` string of type+side; `sameShape`) decides between `update` and `remove`+`apply` (`:103-109`). Pure, portable.
- Draft vs on-air separation is enforced here (`:50-51`, `:71-72`). Keep it.
- The global `window.__hacg...` flag is a timing hack shared with the panel (`inspector-panel.js:414`). Replace with explicit state in a port.

---

## HTML template, lower third, countdown, screen timer

### Files
- `client/components/inspector-html-template.js` — 227 — HTML/template source layers (not lower third): source label, "CALL RELOAD" button, and a timers-config form (`timersConfig` on `layer.source`).
- `client/components/inspector-lower-third.js` — 347 — Lower Third template editor: text fields, font family, position, sizes, render scale, display seconds, colours; debounced CG UPDATE; Play/Stop/Clear/Load buttons; polls active state.
- `client/components/inspector-lower-third-roster.js` — 222 — Spreadsheet roster for lower thirds: import CSV/XLSX, mapping, filter, row picker that applies a row to the layer.
- `client/components/inspector-lower-third-templates.js` — 22 — Cached `GET /api/lower-thirds/templates` list.
- `client/components/inspector-countdown.js` — 392 — Countdown / timer template editor (mode, duration HH:MM:SS, target clock time, format, thresholds, position, px override, hide, font sizes, colours, 3 aux lines), Start/Pause/Reset.
- `client/components/inspector-countdown-controller.js` — 177 — Countdown local config persistence, debounced CG UPDATE, propagation to all layers bound to the same timer.
- `client/components/inspector-screen-timer.js` — 246 — Screen-timer view (replaces an old modal): lists every timer assigned to the selected screen; start/pause/reset, show/hide, fade in/out, opacity slider, settings form (shared with corner panel), remove from screen, add timer.

### What the operator can do
- **HTML template**: see source, press "CALL RELOAD" to reload the page without re-taking the look (`inspector-html-template.js:222`). Edit timers-config fields for timer templates (`:181-192`).
- **Lower third**: edit title, subtitle, font, position, sizes, colours, display seconds, render scale; the CG on air updates after a debounce (`LOWER_THIRD_CG_UPDATE_DEBOUNCE_MS` = 450 ms, `client/lib/lower-third-cg-data.js:41`, used at `inspector-lower-third.js:275`); Play animates in (or out if on air), Stop, Clear, Load (`inspector-lower-third.js:186-344`).
- **Roster**: import a spreadsheet (CSV, XLSX), filter rows, pick a row to fill the fields, map columns (`inspector-lower-third-roster.js:185-222`).
- **Countdown**: all fields above; propagates config to every layer bound to the timer (`inspector-countdown-controller.js:117-138`); Start/Pause/Reset (`inspector-countdown.js:367-381`).
- **Screen timer**: per-timer start/pause/reset, show/hide cut, fade 25 frames, opacity slider, settings, unassign, add a timer to the screen (`inspector-screen-timer.js:61-231`).

### Rendering tech
- DOM with inline styles and `innerHTML` templates. Colour inputs `<input type="color">` (`inspector-countdown.js:322-328`, `inspector-lower-third.js:149-153`). Countdown preview is server-side CG; not drawn here.

### Interaction
- Lower third text fields `input` (`inspector-lower-third.js:63`, `:73`, `:132-135`); selects `change` (`:94`, `:109`); colours `input` (`:157-158`).
- Countdown: mode `change` (`inspector-countdown.js:196-199`), duration via `createHmsInput` (`:173-177`), target `input` (`:188`), format, thresholds `input` (`:236-237`), position, px override `change` (`:273-274`), hide checkbox, font sizes, colours (`:331-334`), aux lines `input` (`:352`). Transport `click` (`:368-380`).
- Screen timer: transport `click` (`inspector-screen-timer.js:110-117`), opacity `input` for label and `change` to commit (`:167-172`), remove `confirm` (`:200`), add `click` (`:216-231`).
- Roster: row `keydown` Enter/Space (`inspector-lower-third-roster.js:168-169`), file `change` (`:185`), filter `input` (`:211`), select `change` (`:102`).
- Countdown and lower third observe DOM removal with `MutationObserver` (`inspector-countdown.js:385-391`, `inspector-lower-third.js:204`) to cancel pending CG UPDATE timers.

### Server contract
- `POST /api/call` `{channel, layer, fn:'RELOAD', params:''}` (`inspector-html-template.js:222`).
- `GET /api/lower-thirds/templates` (`inspector-lower-third-templates.js:14`).
- Lower third: `POST /api/lower-thirds/update` (`inspector-lower-third.js:286`, `:329`, `:341`), `POST /api/lower-thirds/load` (`:337`), `POST /api/lower-thirds/play` (`:330`, `:342`), `POST /api/lower-thirds/stop` (`:321`), `POST /api/lower-thirds/clear` (`:190`), `GET /api/lower-thirds/active` (`:303`).
- Countdown: `POST /api/countdown/set` (`inspector-countdown-controller.js:160`), `POST /api/countdown/{start|pause|reset}` (`inspector-countdown.js:374`).
- Screen timer: `GET /api/timers/list` (`inspector-screen-timer.js:64`), `POST /api/timers/cmd` `{timerId, cmd}` (`:112`), `POST /api/timers/visible` `{timerId, screenIdx, visible, fadeFrames?, opacity?}` (`:145`), `POST /api/timers/unassign` (`:203`). Add timer uses `client/lib/screen-timer-create.js:35` → `POST /api/timers/assign` `{timerId, name, config, screenIdx}`.
- Roster: parsing only, no HTTP. Writes go to `sceneState.patchLayer`.
- WS: none sent. Inbound lower-third state dispatched as window event from `app-ws-handlers.js:215-217` (see Port-risk).

### Client state
- `sceneState`: `patchLayer` for `source.countdownConfig` and `cgData` (`inspector-countdown-controller.js:95-97`), `createTimer`, `getTimer`, `renameTimer`, `findBoundLayers`, `_save()` (`inspector-countdown.js:97-100`; `controller:103`).
- `stateStore.getState().channelMap` for CG routing (`inspector-lower-third.js` via `resolveLookStackChannelForBus`, `controller:46-54`).
- Window events dispatched on lower-third changes: `highascg-lower-third-state` (`inspector-lower-third.js:192`, `:288`, `:323`, `:332`, `:344`); `scenes-refresh-preview` on document (`:262`).
- `screen-timers-changed` window event (`client/lib/screen-timer-create.js:19`; listened at `inspector-screen-timer.js:243`).
- Module state: `autoCreateInFlight` Set (`inspector-countdown.js:19`, `:93-104`).
- `DEFAULT_COUNTDOWN_CONFIG` (`inspector-countdown.js:23-41`).

### Browser-only APIs
- `MutationObserver` (`inspector-countdown.js:385`, `inspector-lower-third.js:204`), `setInterval` 250 ms ticker in screen timer (`inspector-screen-timer.js:43-59`), `setInterval` for lower-third polling absent (only one-shot `setTimeout`, `inspector-lower-third.js:272`). `input type=color`, `window.confirm` (`inspector-screen-timer.js:200`).
- Roster parse: `File.arrayBuffer()`, `TextDecoder`, lazy `import('exceljs')` (`client/lib/lower-third-roster-import.js:167`, `:208`, `:214`). Size cap 2 MB (`:6`) and parse timeout 15 s (`:8`).

### Port-risk notes
- **Side effect in render**: `appendCountdownGroup` auto-creates a timer and patches the layer the first time the group is rendered (`inspector-countdown.js:86-106`). A port should move this out of the render path.
- Countdown propagation loops all bound layers (`inspector-countdown-controller.js:117-138`), with `propagateInFlight` guard only.
- Lower-third and countdown share a 450 ms debounce pattern (`COUNTDOWN_CG_UPDATE_DEBOUNCE_MS`, `inspector-countdown-controller.js:12`; lower third `:272`).
- The lower-third "active on layer?" check (`inspector-lower-third.js:303-311`) compares channel and layer numbers. Pure.
- `inspector-webpage-host.js` (see next section) hardcodes a template URL prefix; not here.
- Roster import: the spreadsheet path depends on the optional `exceljs` package. Pure parser otherwise.

---

## Live sources and host channels

### Files
- `client/components/inspector-browser-display.js` — 247 — Live browser source: URL, width, height, fps, Apply; "Move to operator monitor" (interact) toggle; Remove.
- `client/components/inspector-webpage-host.js` — 237 — Live webpage host channel: URL input or template select (checkbox), reload.
- `client/components/inspector-ndi-host.js` — 155 — Live NDI host: change NDI source on an existing host channel.
- `client/components/inspector-decklink-host.js` — 157 — DeckLink host channel: change device on an existing input channel (AMCP only, per header line 2).
- `client/components/inspector-v4l2-input.js` — 62 — USB/V4L2 input slot details and remove.
- `client/components/inspector-live-audio-input.js` — 275 — Live audio input slot: status, capture device select, shader FFT source checkbox, Refresh devices, Start, Stop, Remove.
- `client/components/inspector-source-label.js` — 151 — One operator-editable source label, mounted wherever a source is configured; shared between host channel and port inspectors (header comments lines 1-20).

### What the operator can do
- Browser source: edit URL, width (160–3840), height (120–2160), fps (1–60), Apply; move to operator monitor; remove with confirm (`inspector-browser-display.js:41-133`, `:138-186`, `:235`).
- Webpage host: edit URL or pick a template; reload; remove (`inspector-webpage-host.js:46-237`).
- NDI host: pick NDI source from a list, apply, remove (`inspector-ndi-host.js:19-155`).
- DeckLink host: change the device on an input channel (`inspector-decklink-host.js:53-157`).
- V4L2: remove slot (`inspector-v4l2-input.js:17-62`).
- Live audio input: choose capture device (applied immediately), toggle shader FFT source (single-select across slots), Refresh device list, Start (restart this slot's capture and put PGM routes back on air), Stop (`inspector-live-audio-input.js:28-216`), Remove (`:258-274`).
- Source label: type a label, Enter commits, Escape reverts (`inspector-source-label.js:137-139`).

### Rendering tech
- DOM with `innerHTML`. Input `type="number"` and `type="text"`. No canvas or iframe in this area.

### Interaction
- Enter key submit in URL/name fields: `keydown` (`inspector-browser-display.js:124-125`, `inspector-webpage-host.js:158-165`, `inspector-ndi-host.js:99-100`, `inspector-source-label.js:137-138`, `inspector-panel-timeline-shared.js:42-43` for SMPTE/ms).
- Remove buttons use `confirm()` (`inspector-browser-display.js:235`, `inspector-webpage-host.js:224`, `inspector-ndi-host.js:143`, `inspector-v4l2-input.js:50`, `inspector-live-audio-input.js:263`).
- Live audio: FFT checkbox `change` (`inspector-live-audio-input.js:124-138`), device `change` (`:140-161`), refresh `click` (`:163-174`), start `click` (`:178-201`), stop `click` (`:203-213`).
- Source label: `blur` commits and Enter blurs (`inspector-source-label.js:133`, `:138`); Escape reverts (`:139-142`).

### Server contract
- `POST /api/host-live/browser` (`inspector-browser-display.js:102`); `POST /api/host-live/browser/interact` (`:158`).
- `POST /api/host-live/webpage` `{...payload, action:'update'|'reload', templateOrUrl}` (`inspector-webpage-host.js:140-141`).
- `POST /api/host-live/ndi` (`inspector-ndi-host.js:60`); `GET /api/ndi/list` (`:79`).
- `POST /api/host-live/decklink` (lib `decklink-add-input.js:96`, `:116`, `:206`) via `changeDecklinkInputDevice` / `reloadDecklinkInputDevice` (`inspector-decklink-host.js:1-2`, import line).
- `POST /api/device-view` `{removeExtraLiveSource: {value}}` (lib `extra-live-source-remove.js:36`). `POST /api/host-live/operator-fullscreen` `{action:'off', sourceId}` (lib `:33`).
- `POST /api/v4l2-inputs/config` (lib `v4l2-remove-input.js:35`).
- `GET /api/audio/live-inputs` (`inspector-live-audio-input.js:93`); `GET /api/audio/devices` (`:114`) and `?refresh=1` (`:166`); `POST /api/audio/live-inputs/config` (`:128`, `:151`); `POST /api/audio/live-inputs/apply` (`:129`, `:152`); `POST /api/raw` `{cmd:'STOP ...'}` and `'MIXER ... CLEAR'` (`:208-209`). Start: `POST /api/audio/inputs/start` via `client/lib/live-input-start.js:69`.
- `POST /api/sources/label` `{sourceId, label}` (`inspector-source-label.js:116`).
- WS: none sent.

### Client state
- `stateStore.getState().extraLiveSources` (read in `inspector-panel.js:334`, `inspector-webpage-host` reads via `resolveWebpageHostSource(extras, query)`), `stateStore.getState().templates` (`inspector-webpage-host.js:89`), `stateStore.getState().liveAudioInputsStatus` (`inspector-live-audio-input.js:255`), `channelMap` (`inspector-live-audio-input.js:227`).
- `settingsState.getSettings().casparServer` (`inspector-live-audio-input.js:32`, `inspector-v4l2-input.js:5`); `settingsState.load()` after apply (`inspector-live-audio-input.js:131`, `:154`).
- Window events: `browser-display-changed` (`inspector-browser-display.js:34`), `browser-display-select` (`:241`), `webpage-host-select`, `ndi-host-select`, `v4l2-input-select`, `live-audio-input-select` (consumed in `inspector-panel-live-source-events.js`).

### Browser-only APIs
- `window.confirm` / `alert` (`inspector-browser-display.js:235`, `inspector-live-audio-input.js:263-269`), `CustomEvent`.
- Source label: `shortLabelPill` from `client/lib/source-label.js` (80 LOC).

### Port-risk notes
- **Hardcoded URL prefix**: `inspector-webpage-host.js:51-53` assumes `http://127.0.0.1:4200/template/` for template URLs. Environment assumption; a port must parametrise it.
- Live audio start uses the same route-restore logic as other inputs (`client/lib/live-audio-routing.js`).
- `inspector-decklink-host.js` header says AMCP only.
- Most of this area is form-to-REST with optimistic reload. Portable with a REST client.

---

## Global border (screen border effect, slices, Art-Net)

### Files
- `client/components/inspector-global-border.js` — 45 — Entry: title "Global Border: Screen N"; enable-on-screen button when not configured; mounts the three sections below.
- `client/components/inspector-global-border-effect.js` — 253 — Border type (border/shadow/edge_strip/glow), fade duration (frames), area X/Y/W/H in % of canvas, preset slots (save/apply/rename/delete, with prompt/confirm), and removal (confirm).
- `client/components/inspector-global-border-slices.js` — 132 — Slices (multi-segment layout): add slice, reset to full canvas, edit per-slice x/y/w/h (slices override area).
- `client/components/inspector-global-border-artnet.js` — 238 — Art-Net/sACN input: listen toggle, protocol, patch start channel, per-channel mapping table, download fixture file (Blob).
- `client/components/inspector-global-border-events.js` — 7 — Two helpers that dispatch window events (`highascg-global-border-push`, `highascg-global-border-config-save`).

### What the operator can do
- Enable global border on a screen; choose type; set fade frames; set area % (x, y, w, h); save/apply/rename/delete presets (up to a slot count) (`inspector-global-border-effect.js:16-251`).
- Add, reset, and edit slices (`inspector-global-border-slices.js:10-132`).
- Enable Art-Net/sACN listening (opt-in), choose protocol, set patch start channel, enable/disable each DMX channel, download the fixture text file (`inspector-global-border-artnet.js:39-238`, `:220-222`).

### Rendering tech
- DOM. Fixture download via `Blob` + object URL (`inspector-global-border-artnet.js:218-226`). Fixture text imported with Vite raw import: `import globalBorderFixtureText from '../fixtures/global-border.txt?raw'` (`inspector-global-border-artnet.js:1`).

### Interaction
- Type select `change` → patch + rerender (`inspector-global-border-effect.js:45-48`); fade `change` (`:65`); mirror checkbox `change` (`:84`); area inputs `change` (`:153-170`, percent 0–100 divided by 100); preset buttons `click`, `window.prompt` for name (`:226`), `window.confirm` for delete (`:242`), and confirm to remove the whole border (`:179`).
- Slices: `click` add/reset (`inspector-global-border-slices.js:29-48`), per-slice `change` (`:78-110`).
- Art-Net: listen `change` (`inspector-global-border-artnet.js:39-42`), protocol `change` (`:83-85`), start channel `change` (`:110-112`), universe `change` (`:139-141`), mapping table `change` event delegation (`:173-181`), `details` `toggle` (`:55-57`), download `click` (`:216-232`).
- Each change calls `scheduleGlobalBorderConfigSave()` (`inspector-global-border-artnet.js:41`, `:53`) which dispatches `highascg-global-border-config-save` on **window** (`inspector-global-border-events.js:6`).

### Server contract
- No direct `api.*` call in these five files.
- The Art-Net/UI path: `sceneState.setGlobalBorderForScreen(screenIndex, patch)` (`inspector-global-border.js:20`, `:40`, `inspector-global-border-effect.js`), `sceneState.saveGlobalBorderPresetSlot`, `deleteGlobalBorderPresetSlot`, `getGlobalBorderPreset`, `getGlobalBorderPresetSlotCount` (see `inspector-global-border-effect.js`).
- Window events out: `highascg-global-border-push` (`inspector-global-border-events.js:2`; listened at `client/components/scenes-editor.js:137` on window, consistent). `global-border-state-changed` (`inspector-global-border-effect.js:182`, `:215`).
- Save trigger: `highascg-global-border-config-save` is **dispatched on window** (`inspector-global-border-events.js:6`) and **listened on document** (`client/app.js:285`). See Port-risk.
- Inbound Art-Net: WS `global_border_sync` (`client/lib/app-ws-handlers.js:211-213`) → `ingestArtnetGlobalBorderSync` (`client/lib/global-border-artnet-ws.js:64`) → window `global-border-artnet` event (`global-border-artnet-ws.js:56`), consumed at `inspector-panel.js:347-353`.
- WS: none sent from this area.

### Client state
- `sceneState.globalBorders[screenIndex]` through `getGlobalBorderForScreen` (`inspector-global-border.js:14`).
- Lib: `client/lib/global-border-artnet-map.js` (113, `GLOBAL_BORDER_ARTNET_CHANNEL_DEFS`, `normalizeArtnetChannelMap`), `client/lib/global-border-artnet-ws.js` (not imported by inspector files; producer of the window event).
- `dmxDetailsOpen` module flag (`inspector-global-border-artnet.js:9`) keeps the disclosure state across rerenders.

### Browser-only APIs
- `Blob`, `URL.createObjectURL`, `URL.revokeObjectURL`, anchor `download` (`inspector-global-border-artnet.js:218-226`); `window.prompt`/`window.confirm`; `<details>` toggle event.

### Port-risk notes
- **Event target mismatch (probable bug)**: `scheduleGlobalBorderConfigSave` dispatches on `window` (`inspector-global-border-events.js:6`), but the only listener is on `document` (`client/app.js:285`). A window-dispatched event does not reach document listeners, so this autosave hook appears not to fire from the inspector. Not verified at runtime.
- Art-Net patch and per-channel mapping are data-only. The fixture file is static text.
- Area % edits are normalised to 0–1 fractions (`inspector-global-border-effect.js:156`).

---

## Timeline (clip, flag, layer, keyframes, position)

### Files
- `client/components/inspector-panel-timeline.js` — 7 — Barrel re-export (`syncTimelineToServer`, `appendTimelineInspectorPosition`, `renderTimelineFlagInspector`, `renderTimelineClipInspector`).
- `client/components/inspector-panel-timeline-shared.js` — 63 — SMPTE/ms position row under the title; `syncTimelineToServer()` (`PUT /api/timelines/:id`, fallback `POST /api/timelines`).
- `client/components/inspector-panel-timeline-clip.js` — 434 — Timeline clip inspector: start time, loop always, audio (route, mute, volume), position/size with aspect lock and content sizing, opacity, in-point trim, keyframes, effects.
- `client/components/inspector-panel-timeline-flag.js` — 434 — Timeline flag inspector: label, action (pause/play/jump/companion_press), jump time / jump to flag, Companion button picker, live preview image, test press, remove.
- `client/components/inspector-fill-timeline.js` — 273 — Clip keyframes (opacity, volume, position, scale) and add-keyframe UI.
- `client/components/inspector-mixer.js` (timeline layer section) — covered in Mixer.

### What the operator can do
- Set clip start time with SMPTE/ms (`inspector-panel-timeline-shared.js:10-54`; `inspector-panel-timeline-clip.js:60-70`).
- Set clip loop, audio route/mute/volume, position/size, aspect lock, content sizing, base opacity, in-point (frames), effects (`inspector-panel-timeline-clip.js:76-433`).
- Add/edit/remove keyframes per property (`inspector-fill-timeline.js:15-273`; `client/components/inspector-common.js:290-296` `KF_PROPERTIES`).
- Flags: rename, change action, set jump time (hh:mm:ss:ms or ±offset) or jump-to-flag, bind to a Companion button (page/row/column), see the button preview image, test-press, remove (`inspector-panel-timeline-flag.js:72-434`).

### Rendering tech
- DOM. Preview is an `<img>` of a Companion JPG from `GET /api/companion/button-preview/{page}/{row}/{column}.jpg` (`client/lib/companion-button-preview-url.js:54`, used at `inspector-panel-timeline-flag.js:193-197`).

### Interaction
- Position row: `change` and Enter (`inspector-panel-timeline-shared.js:41-43`).
- Clip: loop `change` (`inspector-panel-timeline-clip.js:87`), aspect `change` (`:296`), fit `change` (`:321`), drag inputs for X/Y/W/H/opacity/in-point (`:247-282`, `:348-360`, `:377-388`).
- Keyframes: per-row `change` on inputs and easing select (`inspector-fill-timeline.js:95-97`, `:128-137`, `:176-184`), property select `change` (`:239`).
- Flag: label `change` (`inspector-panel-timeline-flag.js:81`), type `change` (`:99`), jump input `change` (`:122`), ref select `change` (`:156`), location input `change` (`:272`), coordinate fields `change` (`:299`), "Choose button…" `click` opens picker modal (`:340-351`), "Test press" `click` (`:359-387`), remove `click` (`:427`).
- Companion preview refreshes on `window` event `companion-button-preview` (`:238-247`) and on `mtimeMs` cache-buster (`:193-197`).
- Redraw requests: `window.dispatchEvent(new CustomEvent('timeline-redraw-request'))` (`inspector-fill-timeline.js:101`, `:147`, `:191`, `:269`; `inspector-panel-timeline-clip.js:67`, `:152`, `:221`, `:229`, `:358`).
- Geometry drags are throttled: `createTrailingThrottle(fn, 80)` (`inspector-panel-timeline-clip.js:187`; `client/lib/trailing-throttle.js`).

### Server contract
- `PUT /api/timelines/{id}` (`inspector-panel-timeline-shared.js:59`), fallback `POST /api/timelines` (`:61`) — `syncTimelineToServer()`.
- `POST /api/timelines/{id}/seek` `{ms}` (`inspector-panel-timeline-clip.js:124`, `:182`) when the timeline is active and playing position matters.
- `POST /api/companion/button-preview/test-press` `{page,row,column}` (`inspector-panel-timeline-flag.js:372`).
- `GET /api/companion/button-preview/status` (`:392`).
- `GET /api/media` (`inspector-panel-timeline-clip.js:142`) for content resolution.
- Keyframe and flag writes are `timelineState` calls, then `syncTimelineToServer()`.
- WS: none sent. Inbound: `companion.buttonPreview` WS (`client/lib/app-ws-handlers.js:199-210`) → window `companion-button-preview` (`:207`) → `inspector-panel-timeline-flag.js:247`.

### Client state
- `timelineState`: `getTimeline`, `getActive`, `getSendTo(timelineId).screenIdx`, `updateClip`, `updateFlag`, `updateLayer`, `insertLayerBelow`, `removeLayer`, `removeFlag`, `addKeyframe`, `addPositionKeyframe`, `addScaleKeyframe`, `removeKeyframe`, `removePositionKeyframe`, `removeScaleKeyframe`, `clearKeyframesByProperty` (`inspector-panel-timeline-clip.js`, `inspector-fill-timeline.js`, `inspector-panel-timeline-flag.js`).
- `stateStore.getState().timeline.playback` (`inspector-panel-timeline-clip.js:114`, `:172`) and `timeline.tick` (`inspector-panel.js:60`).
- Window events read: `timeline-flag-select`, `timeline-clip-select`, `timeline-layer-select`.
- `companionFlagThumbs`-related helpers: `invalidateCompanionFlagThumbs`, `latestCompanionButtonPreviewMtime` (`client/lib/companion-button-preview-url.js`).

### Browser-only APIs
- `CustomEvent`, `window` events, `<img>` with `width`/`height`, `onload`/`onerror` (`inspector-panel-timeline-flag.js:202-212`), `setTimeout` retry 1200 ms (`:205-208`).

### Port-risk notes
- Companion button preview is a server JPG refreshed by a WS event and a mtime cache-buster. Port needs an image loader with cache-busting.
- Timeline geometry is a pixel/stored-px system with aspect-lock solver (`applyFillPx`, `inspector-panel-timeline-clip.js:202-223`). Pure math + state; DOM-free apart from `redrawClipInspector`.
- Jump-time parser `parseHmsInput` (`./timeline-canvas.js`, shared) and `fmtHms`.
- Companion location parse is pure (`client/lib/companion-location-parse.js`, 59 LOC).
- Keyframe UI mutates state in place with rerender; port must keep the same keyframe model.
- Trim semantics note: clip `inPoint` is frames, applied at take/seek server-side (`inspector-panel-timeline-clip.js:370-372`).

---

## Presets modes (layer style presets and look presets)

### Files
- `client/components/inspector-panel-presets-modes.js` — 376 — The two non-Inspector panel modes: "Layer style presets" (copy/paste/save clipboard, import from server, library via `mountLayerPresetControls`) and "Look presets" (save from PRV/PGM/open look, import from server, list of bookmarks with Preview, Auto, Cut, Overwrite, Remove, and ▶ Play).

### What the operator can do
- Save current layer style to a named preset; apply a preset to the target layer (`inspector-panel-presets-modes.js:17-123`).
- Import layer or look presets from the server copy of `scene.deck` (confirm, replaces local) (`:85-103`, `:208-226`).
- Save a look bookmark from the PRV, PGM, or open look (`:169-199`).
- For each look bookmark: Preview (PRV), Auto (PGM with deck transition), Cut (PGM forced cut), Play ▶ (PGM with each look's own transition), Overwrite (confirm), Remove (confirm) (`:297-365`).

### Rendering tech
- DOM only. Icon buttons with emoji labels `→📋`, `📋→`, `💾` (`:41-43`).

### Interaction
- `window.prompt` for names (`:60`, `:170`, `:180`, `:190`). `window.confirm` for import/overwrite/remove (`:86`, `:209`, `:349`, `:360`).
- Card click selects; card click on empty area sends PRV recall (`:261-265`, `:366-372`). Button click dispatches `CustomEvent`s (`:321-346`).
- Import and layer/look save buttons `click` (`:85`, `:169-199`).

### Server contract
- `GET /api/state` (`inspector-panel-presets-modes.js:88`, `:211`) — reads `scene.deck.layerPresets` / `scene.deck.lookPresets`.
- The bookmark recall events are consumed by the deck (out of scope): `LOOK_PRESET_RECALL_PRV`, `LOOK_PRESET_RECALL_PGM` (`client/lib/look-preset-events.js`, 8 LOC, constants) dispatched at `:322-345`. Listeners: `document` in `client/components/scenes-editor.js:442` and `:452`.
- WS: none sent.

### Client state
- `sceneState`: `hasLayerStyleClipboard`, `copyLayerStyle`, `pasteLayerStyle`, `saveLayerPresetFromLayer`, `importLayerPresetsFromServer`, `importLookPresetsFromServer`, `saveLookPreset(name, 'prv'|'pgm'|'editing')`, `overwriteLookPreset`, `removeLookPreset`, `getLookPresets`, `getPreviewSceneIdForMain`, `previewSceneId`, `liveSceneId`, `editingSceneId`.
- Module state `selectedLookPresetId` (`inspector-panel-presets-modes.js:9`, `:263`).

### Browser-only APIs
- `window.prompt`, `window.confirm`, `CustomEvent`.

### Port-risk notes
- Look bookmarks are references (`sceneId`) with recall via the deck path; not a snapshot (`:133`). Keep that semantics.
- Server import replaces local presets with no undo (`:86`, `:209`).

---

## Shared lib modules and sub-feature mapping

### Lib modules (inspector-specific; importers listed)

| Lib file | LOC | Other importers (non-inspector) | Purpose | Server contract (`file:line`) |
|---|---|---|---|---|
| `client/lib/decklink-add-input.js` | 365 | 4 (live-input modal and device view) | DeckLink add/change/reload | `POST /api/raw` (`:79-81`), `POST /api/host-live/decklink` (`:96`, `:116`, `:206`), `POST /api/device-view` `addExtraLiveSource` (`:183`, `:243`, `:261`), `removeEdge` (`:298`) |
| `client/lib/operator-gui-mode-report.js` | 445 | 1 (`scenes-editor-edit.js`) | Reports preview holes (rects) to the operator-GUI layout; WS reconnect re-sends | `POST /api/operator-gui/layout` (`:258`), `DELETE /api/operator-gui/layout` (`:256`); WS `connect` (`:416`), WS `change` (`:417`) |
| `client/lib/live-audio-play-targets.js` | 208 | 4 | Live audio play targets persisted in localStorage | localStorage `highascg_live_audio_play_targets` (`:7`), `highascg_live_audio_play_targets_multi` (`:8`) |
| `client/lib/live-audio-routing.js` | 150 | 6 | Plays a live audio route on a channel | `POST /api/raw` STOP/MIXER/PLAY (`:29-45`), `POST /api/audio/live-inputs/apply` (`:61`) |
| `client/lib/extra-live-source-remove.js` | 63 | 4 | Removes an extra live source | `POST /api/raw` (`:15-16`), `POST /api/host-live/operator-fullscreen` (`:33`), `POST /api/device-view` `removeExtraLiveSource` (`:36`) |
| `client/lib/live-audio-remove-input.js` | 56 | 1 (device view) | Removes a live audio slot | `POST /api/audio/live-inputs/config` (`:50`) |
| `client/lib/live-input-start.js` | 87 | 2 (audio mixer) | Starts an input's capture | `POST /api/audio/inputs/start` (`:69`) |
| `client/lib/companion-button-preview-url.js` | 100 | 2 | Builds Companion button JPG URL with cache-buster | `GET /api/companion/button-preview/{p}/{r}/{c}.jpg` (`:54`) |
| `client/lib/v4l2-remove-input.js` | 41 | 1 (device view) | Removes a V4L2 slot | `POST /api/v4l2-inputs/config` (`:35`) |
| `client/lib/media-file-defaults.js` | 59 | 1 (scene-state-layer-ops) | Local per-file trim/mute defaults | `GET /api/media/library/defaults` (`:16`) |
| `client/lib/effect-apply-live.js` | 129 | 0 | Live push of effect params to Caspar | `POST /api/mixer/effect` (`:125`) |
| `client/lib/selection-sync.js` | 129 | 0 | Pushes inspector selection to server | `POST /api/selection` (`:127`) |
| `client/lib/lower-third-roster-import.js` | 294 | 0 | Spreadsheet/CSV parse, mapping, filter | Lazy `import('exceljs')` (`:167`); `file.arrayBuffer()` (`:208`); `TextDecoder` (`:214`) |
| `client/lib/companion-location-parse.js` | 59 | 0 | Parse page/row/column strings | pure |
| `client/lib/trailing-throttle.js` | 86 | 0 | Trailing-edge throttle for drag sync | pure (`:24`) |
| `client/lib/playlist-timeless.js` | 31 | 1 (playlist control panel) | Which playlist items are timeless | pure |
| `client/lib/look-preset-events.js` | 8 | 1 (scenes-editor) | Event name constants | pure |
| `client/lib/global-border-artnet-map.js` | 113 | 1 (scene-state-global-border) | Art-Net channel defs and normaliser | pure |
| `client/lib/screen-timer-create.js` | 39 | 1 (scenes-editor-deck-drop) | Create timer and assign to screen | `POST /api/timers/assign` (`:35`); window `screen-timers-changed` (`:19`) |

Total inspector-specific lib: 19 files, 2,462 LOC.

### Shared lib modules (not inventoried; LOC for reference)
`client/lib/scene-state.js` 492; `client/lib/math-input.js` 473 (pure parser + DOM binding); `client/lib/effect-registry.js` 371 (pure schemas); `client/lib/mixer-fill.js` 344 (`GET /api/local-media/{id}/probe`, `:199`); `client/lib/lower-third-cg-data.js` 355; `client/lib/layer-crop.js` 272; `client/lib/input-channels.js` 284; `client/lib/live-audio-inputs.js` 274; `client/lib/timeline-state.js` 297; `client/lib/multiview-state.js` 413; `client/lib/pip-overlay-registry.js` 330; `client/lib/fill-math.js` 173 (pure); `client/lib/coordinate-origin.js` 165 (pure); `client/lib/thumbnail-url.js` 142; `client/lib/media-duration.js` 147; `client/lib/media-ext.js` 128; `client/lib/media-exists.js` 106; `client/lib/timeline-clip-interp.js` 78; `client/lib/program-audio-layouts.js` 147; `client/lib/audio-routes.js` 71; `client/lib/audio-volume-scale.js` 86; `client/lib/settings-state.js` 149 (`GET /api/settings`, `POST /api/settings`, `:96`, `:139`); `client/lib/api-client.js` 176; `client/lib/app-toast.js` 35; `client/lib/dom-escape.js` 33; `client/lib/wheel-delta.js` 32; `client/lib/form-upload.js` 44 (`XMLHttpRequest`, `:10`); `client/lib/operator-gui-mode.js` 153; `client/lib/scene-content-fit.js` 14; `client/lib/source-label.js` 80; `client/lib/duration-hms-input.js` 126; `client/lib/dmx-state.js` 211; `client/lib/timeline-program-canvas.js` 52; `client/lib/look-stack-amcp-channel.js` 52; `client/lib/selection-sync.js` is in the inspector-specific table above.

### Sub-feature to file mapping (for porting)
- Panel shell: `inspector-panel.js`, `inspector-panel-views.js`, `inspector-panel-selection-key.js`, `inspector-panel-mode-storage.js`, `inspector-panel-live-source-events.js`, `inspector-channel-resolution.js`, and dead `inspector-panel-routing.js`.
- Shared primitives: `inspector-common.js`.
- Presets: `inspector-panel-presets-modes.js`.
- Look geometry: `inspector-scene-layer.js`, `inspector-fill.js`.
- Look audio: `inspector-mixer.js`.
- Effects: `inspector-effects.js`.
- Playlist/transport/live audio source: `inspector-layer-playlist.js`, `inspector-media-transport.js`, `inspector-live-audio-source.js`.
- Media file: `inspector-media-file.js`, `inspector-media-file-library.js`, `inspector-media-file-versions.js`, `inspector-media-file-wave.js`.
- PIP: `inspector-pip-overlay.js`.
- CG and templates: `inspector-lower-third.js`, `inspector-lower-third-roster.js`, `inspector-lower-third-templates.js`, `inspector-html-template.js`, `inspector-countdown.js`, `inspector-countdown-controller.js`, `inspector-screen-timer.js`.
- Live sources: `inspector-browser-display.js`, `inspector-webpage-host.js`, `inspector-ndi-host.js`, `inspector-decklink-host.js`, `inspector-v4l2-input.js`, `inspector-live-audio-input.js`, `inspector-source-label.js`.
- Global border: `inspector-global-border.js`, `inspector-global-border-effect.js`, `inspector-global-border-slices.js`, `inspector-global-border-artnet.js`, `inspector-global-border-events.js`.
- Timeline: `inspector-panel-timeline.js`, `inspector-panel-timeline-shared.js`, `inspector-panel-timeline-clip.js`, `inspector-panel-timeline-flag.js`, `inspector-fill-timeline.js`.

## CSS (inspector-related)

Clearly inspector (by filename):
- `client/styles/05d-inspector-fields.css` — 448 — field chrome; `inspector` occurrences 66.
- `client/styles/05e-inspector-media-file.css` — 256 — media-file inspector (`.media-insp*`).
- `client/styles/06c-inspector-effects-pip.css` — 150 — effect and PIP cards; 28 hits.
- `client/styles/06c2-inspector-layer-style-presets.css` — 130 — layer style presets; 9 hits.
- `client/styles/06c3-inspector-lt-roster.css` — 300 — lower-third roster; 49 hits.
- `client/styles/09b3-device-view-inspector-sidebar.css` — 376 — inspector sidebar styling (device view scope); 23 hits. Included because the file name says inspector; its selectors are device-view scoped.

Mixed (inspector rules inside a non-inspector file; not inventoried): `01b-layout-panels-workspace.css` (253 LOC, 18 hits), `07b2-timer-control-panel.css` (461, 2), `06a1-scenes-deck-toolbar.css` (172, 8), `07b-audio-mixer-modal-shell.css` (357, 5), `09a3-device-view-segments-mapping.css` (177, 5), `08c3-modals-hardware-reconcile-banners.css` (211, 3), `cg-studio.css` (162, 13), `companion-button-picker.css` (123, 5), `previs-inspector.css` (255, 27 — previs scope), `07a-scenes-compose-canvas.css` (454, 2), `05c-multiview-editor.css` (131, 1), `09a1-device-view-layout-toolbar.css` (87, 1), `09-device-view.css` (7, 1), `09b-device-view-connectors-inspector.css` (4, 1).

Clearly-inspector CSS total: 6 files, 1,660 LOC.

---

## Area totals

- **Total files (in-scope literal glob)**: 45 components + 19 lib + 6 CSS = **70 files**.
- **Total LOC**:
  - components: **9,632** (45 files)
  - lib (inspector-specific): **2,462** (19 files)
  - css (inspector-named): **1,660** (6 files)
  - grand total: **13,754**
- Adjacent, excluded: 33 files, 7,308 LOC (device-view inspectors, destinations inspectors, previs inspectors, fixture inspector).
- Dead code: `client/components/inspector-panel-routing.js` (173 LOC, 0 importers).

### Top 5 most complex files
1. `client/components/inspector-pip-overlay.js` (486) — debounced live push to Caspar with shape diff choosing update vs remove+apply (`:48-152`), stack reorder, per-param visibility gating, colour-picker re-render suppression via a window global (`:169-177`).
2. `client/components/inspector-panel.js` (482) — the selection state machine: ~16 window/document listeners, mode switching, sceneState/timelineState/multiviewState/settings subscriptions, debounced refresh that defers while focused (`:60-467`).
3. `client/components/inspector-panel-timeline-clip.js` (434) — geometry editing with aspect-lock solver (`:202-223`), trailing-throttled server sync (`:187`), content-fit reapply that clears keyframes (`:131-154`), plus audio, trim, keyframes, effects, all coupled to `timelineState` and `stateStore`.
4. `client/components/inspector-panel-timeline-flag.js` (434) — Companion button binding with coordinate parse/format, live WS-driven preview with cache-busting and retry (`:193-247`), picker modal, test press, status-dependent messages (`:392-418`).
5. `client/components/inspector-layer-playlist.js` (414) — drag-to-reorder with drag-state closure (`:194-236`), timeless vs timed duration rules (`:171-181`), bulk apply, Next, transition settings.

Honourable mention: `client/components/inspector-media-transport.js` (380; 200 ms poll, duration retry loop, matrix state extrapolation) and `client/components/inspector-countdown.js` (392; render-time timer auto-create, `:86-106`).

### All distinct API endpoints used (HTTP, from the area)
Path shown as used by this area. Methods as called.

1. GET /api/state (presets-modes:88, :211)
2. GET /api/media (fill:137; timeline-clip:142)
3. GET /api/local-media/{id}/waveform?bars=600 (media-file:108)
4. GET /api/local-media/{id}/probe (lib mixer-fill:199)
5. GET /api/media/library/entry?path= (media-file-library:136; versions:63)
6. GET /api/media/library/defaults (lib media-file-defaults:16)
7. POST /api/media/library/defaults (media-file-library:72)
8. POST /api/media/rename (media-file-library:116)
9. POST /api/media/delete (media-file-library:128)
10. POST /api/media/version/upload?path= (media-file-versions:79, via lib form-upload XHR)
11. POST /api/media/version/restore (media-file-versions:107)
12. POST /api/media/version/purge (media-file-versions:110)
13. POST /api/media/preview (media-file:133, :146, :159, :179, :181, :192, :202)
14. POST /api/pause (media-transport:265)
15. POST /api/resume (media-transport:265)
16. POST /api/seek (media-transport:295)
17. POST /api/playlist/next (layer-playlist:376)
18. POST /api/mixer/effect (lib effect-apply-live:125)
19. POST /api/selection (lib selection-sync:127)
20. POST /api/call (html-template:222)
21. GET /api/lower-thirds/templates (lower-third-templates:14)
22. POST /api/lower-thirds/clear (lower-third:190)
23. POST /api/lower-thirds/update (lower-third:286, :329, :341)
24. GET /api/lower-thirds/active (lower-third:303)
25. POST /api/lower-thirds/stop (lower-third:321)
26. POST /api/lower-thirds/play (lower-third:330, :342)
27. POST /api/lower-thirds/load (lower-third:337)
28. POST /api/countdown/set (countdown-controller:160)
29. POST /api/countdown/{start|pause|reset} (countdown:374)
30. POST /api/pip-overlay/remove (pip-overlay:114, :134)
31. POST /api/pip-overlay/update (pip-overlay:122)
32. POST /api/pip-overlay/apply (pip-overlay:136)
33. GET /api/timers/list (screen-timer:64)
34. POST /api/timers/cmd (screen-timer:112)
35. POST /api/timers/visible (screen-timer:145)
36. POST /api/timers/unassign (screen-timer:203)
37. POST /api/timers/assign (lib screen-timer-create:35)
38. GET /api/companion/button-preview/status (timeline-flag:392)
39. POST /api/companion/button-preview/test-press (timeline-flag:372)
40. GET /api/companion/button-preview/{page}/{row}/{column}.jpg (lib companion-button-preview-url:54)
41. POST /api/timelines (timeline-shared:61)
42. PUT /api/timelines/{id} (timeline-shared:59)
43. POST /api/timelines/{id}/seek (timeline-clip:124, :182)
44. POST /api/sources/label (source-label:116)
45. GET /api/audio/live-inputs (live-audio-input:93)
46. GET /api/audio/devices (live-audio-input:114) and ?refresh=1 (:166)
47. POST /api/audio/live-inputs/config (live-audio-input:128, :151; lib live-audio-remove-input:50)
48. POST /api/audio/live-inputs/apply (live-audio-input:129, :152; lib live-audio-routing:61)
49. POST /api/audio/inputs/start (lib live-input-start:69)
50. POST /api/raw (live-audio-input:208-209; libs live-audio-routing, extra-live-source-remove, decklink-add-input)
51. POST /api/host-live/browser (browser-display:102)
52. POST /api/host-live/browser/interact (browser-display:158)
53. POST /api/host-live/ndi (ndi-host:60)
54. GET /api/ndi/list (ndi-host:79)
55. POST /api/host-live/webpage (webpage-host:140-141)
56. POST /api/host-live/decklink (lib decklink-add-input:96, :116, :206)
57. POST /api/host-live/operator-fullscreen (lib extra-live-source-remove:33)
58. POST /api/device-view (lib decklink-add-input:183, :243, :261, :298; lib extra-live-source-remove:36)
59. POST /api/v4l2-inputs/config (lib v4l2-remove-input:35)
60. POST /api/operator-gui/layout (lib operator-gui-mode-report:258)
61. DELETE /api/operator-gui/layout (lib operator-gui-mode-report:256)

Total distinct endpoint paths: 61 (method-level rows above). Not used directly by the area but referenced in the flow: `PUT`/`POST /api/settings` via `settingsState` (shared lib).

### All distinct WS message types used
The inspector area sends **no** WS messages. It also registers **no** `ws.on` handler of its own. Inbound WS types that reach the area (all handled in other files):

1. `connect` — `client/lib/operator-gui-mode-report.js:416` (ws.on in the lib; app dispatches `connect` at `client/lib/app-ws-handlers.js:289`).
2. `change` — `client/lib/operator-gui-mode-report.js:417` (path `operatorGuiRectsWanted`, `:402`); the app also listens for `change` at `client/lib/app-ws-handlers.js:138`.
3. `companion.buttonPreview` — `client/lib/app-ws-handlers.js:199`; forwarded to window `companion-button-preview` (`:207`) → `inspector-panel-timeline-flag.js:247`.
4. `lower-third.state` — `client/lib/app-ws-handlers.js:215`; forwarded to window `highascg-lower-third-state` (`:217`); **no listener in client/**.
5. `global_border_sync` — `client/lib/app-ws-handlers.js:211`; → `ingestArtnetGlobalBorderSync` (`client/lib/global-border-artnet-ws.js:64`) → window `global-border-artnet` (`global-border-artnet-ws.js:56`) → `inspector-panel.js:347`.
6. `timeline.tick` — `client/lib/app-ws-handlers.js:189` → stateStore → `inspector-panel.js:60`.
7. `timeline.playback` — `client/lib/app-ws-handlers.js:190` → stateStore → `inspector-panel.js:64`, `inspector-panel-timeline-clip.js:114`.
8. `osc` — `client/lib/osc-client.js:56` → `window.highascg_osc_client.onLayerState` → `inspector-media-file.js:151-164`.
9. `state` — `client/lib/osc-client.js:58` (osc-client) and `client/lib/app-ws-handlers.js:116` (store); used indirectly for `playback.matrix` (`inspector-media-transport.js:123`).

Distinct WS types consumed (directly or via app forwarding): 9. Distinct WS types sent: 0.

---

## Port-risk summary (cross-cutting)

- **DOM-coupled**: every sub-inspector renders with `innerHTML`/`createElement` and wires `addEventListener` inline. There is no separable view model; ports must rebuild each control.
- **Pure, portable**: `fill-math.js`, `coordinate-origin.js`, `layer-crop.js`, `effect-registry.js`, `pip-overlay-registry.js`, `math-input.js` (`evaluateMath` parser), `companion-location-parse.js`, `playlist-timeless.js`, `global-border-artnet-map.js`, `trailing-throttle.js`, `lower-third-roster-import.js` (apart from `File`/`exceljs`), `inspector-panel-selection-key.js`, `inspector-countdown.js` `DEFAULT_COUNTDOWN_CONFIG`, `inspector-media-file-library.js` `parseTimeInput`.
- **Global singletons**: `sceneState`, `timelineState`, `multiviewState`, `settingsState`, `dmxState`, `stateStore`, `window.highascg_osc_client`, `window.__hacgSuppressSceneLayerInspectorRefresh`.
- **Caspar-coupled rendering**: kiosk media preview is a DOM hole where Caspar draws. Its rect is measured with `getBoundingClientRect` and sent to the server (`inspector-media-file.js:188-211`). A native client can't reuse this without a replacement contract.
- **Timing constants** (ms): drag threshold 5 px, drag sensitivity 0.5, PIP live debounce 200 (`inspector-pip-overlay.js:26`), CG debounce 450 (`inspector-countdown-controller.js:12`), media-transport tick 200 (`inspector-media-transport.js:22`), media-file hole tick 200 (`inspector-media-file.js:213`), screen timer ticker 250 (`inspector-screen-timer.js:59`), scene-layer refresh 120 (`inspector-panel.js:420`), geometry throttle 80 (`inspector-panel-timeline-clip.js:187`), scrub seek debounce 60 (`inspector-media-transport.js:280`), aspect memory 500 (`inspector-scene-layer.js:159`), Companion preview retry 1200 (`inspector-panel-timeline-flag.js:208`).
- **Probable bug**: `highascg-global-border-config-save` dispatched on `window` (`client/components/inspector-global-border-events.js:6`) but listened on `document` (`client/app.js:285`). Confirm at runtime before porting the autosave path.
- **Dead or unhooked events**: `inspector-panel-routing.js` (0 importers); `highascg-inspector-render-external` (dispatched `inspector-panel.js:195`, no listener in client/); `highascg-lower-third-state` (dispatched; no listener in client/).
- **Environment assumption**: `inspector-webpage-host.js:51-53` hardcodes `http://127.0.0.1:4200/template/`.
- **Render-time side effect**: `inspector-countdown.js:86-106` creates a timer and patches the layer during render.
- **Global mutable flag**: `window.__hacgSuppressSceneLayerInspectorRefresh` (`inspector-pip-overlay.js:169-177`, `inspector-panel.js:414`).
- **Optional dependency**: `exceljs` loaded lazily (`client/lib/lower-third-roster-import.js:167`).
- **Vite-specific import**: `?raw` fixture import (`inspector-global-border-artnet.js:1`).
