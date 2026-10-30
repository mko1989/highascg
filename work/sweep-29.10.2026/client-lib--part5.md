# client/lib (part 5) — sweep 29.10.2026 (batch 017)

Files: 44 · lines: 5039 · findings: 0 BUG-HIGH, 9 BUG, 9 DEAD, 3 RISK, 11 QUALITY

Method: every file read in full. Dead-code claims checked with `rg -w <name> client src tools scripts godot index.js` (excluding `client/assets/map-data.json`, `dist*`, `tools/ci/unwired-exports-baseline.json`, `work/`), including smoke tests under `tools/smoke`. Bug claims were reproduced with throw-away node scripts (scratchpad, nothing written to the repo) unless stated.

## client/lib/selection-sync.js
- `OK`

## client/lib/server-project-sync.js
- `DEAD` client/lib/server-project-sync.js:43 `isProjectGoneOnServer()` — exported getter for the WO-311 latch, never called. grep: `rg -nw "isProjectGoneOnServer" client src tools scripts godot` → only the definition. (`canPushProjectToServer()` reads the flag directly.)

## client/lib/settings-nuclear-shared.js
- `OK`

## client/lib/settings-state.js
- `BUG` client/lib/settings-state.js:139 — `save()` POSTs the whole cached `this.settings`, which was filled from the REDACTED `GET /api/settings`. Failing case: no nuclear password set (`config/ui.json` has `nuclearPasswordHash: ""`). Live GET returns `ui.nuclearPassword:"[REDACTED]"`, `ui.nuclearPasswordHash:"[REDACTED]"`. Editing a DMX fixture runs `dmx-state.js:165` → `settingsState.save(settings)` → POST carries `ui` unchanged → `settings-post.js:63` → `mergeUiNuclearPasswordSettings(...)` (reproduced in node) returns `{ nuclearPassword:'', nuclearPasswordHash:'[REDACTED]' }` when the previous hash is empty. The literal string `[REDACTED]` is persisted as the nuclear password hash, so a later "require password" with no new password keeps a hash nobody can match. Same whole-object-echo class as the open part of WO-619, but reached by a path (DMX autosave) that has nothing to do with the settings modal. Fix: `save()` should post only the sections the caller changed (as the Godot `settings_payload.gd` does), or strip every `'[REDACTED]'` value before posting.

## client/lib/shader-cg-update.js
- `OK`

## client/lib/shader-controls.js
- `OK`

## client/lib/shader-live-instances.js
- `OK`

## client/lib/shader-param-describe.js
- `OK`

## client/lib/shader-param-naming.js
- `OK`

## client/lib/shader-param-scan.js
- `BUG` client/lib/shader-param-scan.js:74 and :95 — `#define` and `const float` declarations are silently skipped when the NAME contains a digit. `extractFloatLiteralsFromLine(source, lineStart, effectiveText)` runs the number regex over the whole line, so the `2` in `SPEED2` counts as a literal and `floatTexts.length === 1` fails. Failing input (run in node): `#define SPEED2 0.5`, `const float K2 = 3.0;`, `#define LAYER_1 2.5 // @slider(0,5)` → `scanShaderParams` returns none of them, while `#define SPEED 0.5` and `const float K = 3.0;` are found. The m2/m4 (vec) branches are fine because they scan only the capture group. Fix: scan only the value capture (`m1[2]`, `m3[2]`) with the right offset, as m2/m4 do.
- `BUG` client/lib/shader-param-scan.js:58-66 — the block-comment tracker does not know about `//`. A `/*` inside a line comment opens a "block comment" that swallows the rest of the file. Failing input (run in node): `const float A = 1.0; // note /* x` then `const float B = 2.0;` → only `A` is returned, `B` is skipped. Also a line that starts inside a block comment is skipped whole, even when code follows the closing `*/` on that line (`/* open\n */ const float C = 3.0;` → none). Rare, but it makes a declared knob vanish from the Shader Live panel with no message. Fix: stop the `/*` scan at the first `//` of the line.
- `QUALITY` client/lib/shader-param-scan.js:309-310 — two `import` statements in the middle of the file (after ~300 lines of code). Hoisted so it works, but it hides the module's dependencies.

## client/lib/source-label.js
- `DEAD` client/lib/source-label.js:49 `liveSourceLabelForValue()` and :19 `sourceLabel()` — no production caller. grep: `rg -nw "liveSourceLabelForValue" client src tools godot` → definition + `tools/smoke/smoke-wo530-compose-labels-and-surfaces.test.js` only. `sourceLabel` is used only by `liveSourceLabelForValue`. The WO-530 smoke header says the resolver was kept on purpose after WO-646 deleted the tile label-bar wiring (`operator-compose-tiles*.js`). Owner decision: keep as a parked helper or delete it with its test. `shortLabelPill` in the same file is live (`app-pgm-header-timer.js`, `inspector-source-label.js`).

## client/lib/state-store.js
- `QUALITY` client/lib/state-store.js:102 (`setState`) / :86-91 (`_emit`) — `this._emit('*', null)` hits both branches of `_emit` because the path IS `'*'`: every `'*'` listener runs twice per full-state push, once as `fn(null)` and once as `fn('*', null)` (reproduced in node: 2 calls). Existing listeners compensate (`path == null || path === '*'` in `audio-mixer-panel.js:136`, `scenes-editor.js:342` lists `'*'`, `app-pgm-header-timer.js:84` lists `null`), and `header-bar.js:277` / `decklink-input-toast.js:23` just run their checks twice. Fix: in `_emit` skip the wildcard pass when `path === '*'` and emit one agreed shape; then drop the double handling.

## client/lib/stream-state.js
- `QUALITY` client/lib/stream-state.js:104-106 — `settingsState.subscribe(() => streamState.refreshStreams())` fires a `GET /api/streams` on every settings notify (every `settingsState.save()`, e.g. each debounced DMX autosave), not only when `streaming.*` changed. Also `setGo2rtcApiPort(data.config.go2rtcPort)` at :50 calls a function that webrtc-client.js documents as a deprecated no-op.

## client/lib/streaming-channel-state.js
- `QUALITY` client/lib/streaming-channel-state.js:67-77 — `mergeOutputSlice` has dead and wrong-way branches. (a) `normalizeOutputSlice` (:83-103) never emits `url` or `channel`, so `out.url`/`out.channel` and the `prev.url`/`prev.channel` carry-over (:73-75) can never fire, although the server payload has both (`src/streaming/streaming-channel-status.js:78,88`) and they are thrown away. (b) The server always sends `lastError: null` when clear; `normalize` omits null `lastError`, so `:72` keeps the previous error forever — a cleared error can never disappear. No client code reads `status.*.lastError` today (rg), so there is no visible effect yet.
- `QUALITY` client/lib/streaming-channel-state.js:33-45 — the second `if` in `parseActiveFlag` lists values that all `return false`, then the function returns `false` anyway; the branch is dead and misleading.

## client/lib/template-category.js
- `OK`

## client/lib/template-thumb.js
- `BUG` client/lib/template-thumb.js:158-161 (written at :198, :221, :232) — a failed render is never remembered. The `error` flag is only ever written (rg `\.error` in the file: writes only); the cache hit test is `entry?.url`, so after a template whose render and poster both fail, every later `getTemplateThumbUrl(layer)` call starts a new `POST /api/cg-thumb/render` (server-side Puppeteer render). Caller `scenes-compose-layer-thumb.js:66` calls it each time a layer thumb DOM is rebuilt, so any scene re-render with a broken template re-posts. Failing state: `apiPost` throws or returns no `url`, and no `/templates/<dir>/thumbnails/<name>.png` exists → entry `{ error: true }` → next call repeats the POST. Fix: check `entry?.error` and return null (with a TTL if retries are wanted).
- `BUG` client/lib/template-thumb.js:101,104,110 — the poster probe uses a bare relative `/templates/...` for `fetch(HEAD)` and returns it as the `<img src>`. The rest of the client resolves server assets through `assetUrl()` / `resolveApiUrl()` (`api-origin.js:143`), and line 185 of this same file does. When the UI is served from another origin than the API (Vite/Electron launcher on :4350 with `VITE_HIGHASCG_API_ORIGIN`) the poster fallback never resolves. Fix: `assetUrl(...)`.
- `DEAD` client/lib/template-thumb.js:277 `invalidateTemplateThumbForLayer()` — no caller. grep: `rg -nw "invalidateTemplateThumbForLayer" client src tools godot` → only the definition (the doc says "on cgData change", but cgData is part of the cache key so nothing needs it).
- `DEAD` client/lib/template-thumb.js:250 `getCachedTemplateThumbUrl()` — only `tools/smoke/smoke-wo187-template-thumb.test.js` uses it; production uses `getCachedTemplateThumbImage` and `getTemplateThumbUrl`.
- `RISK` client/lib/template-thumb.js:35-47 — the cache key is a 32-bit hash of `{sourceValue, cgData}` with no collision check. Two different lower-third texts that hash alike would show each other's thumbnail. Low probability, wrong picture on a deck card. Use the JSON string as the Map key.
- `QUALITY` client/lib/template-thumb.js:19 — comment cites `thumbnail-url.js:93`; the template/cg/html check is now at `thumbnail-url.js:125`.

## client/lib/thumbnail-error-handler.js
- `OK`

## client/lib/thumbnail-url.js
- `OK`

## client/lib/timeline-clip-interp.js
- `RISK` client/lib/timeline-clip-interp.js:26 — no zero-length guard. The server twin (`src/engine/timeline-engine.js:136` `_lerp`) has `if (b.time === a.time) return b.value`; here two keyframes of one property with equal time at the head of the list give `(Δv * 0) / 0` = NaN for `localMs === time`. Not reachable through normal UI (`addKeyframe` de-dupes same time, drag clamps with a 1 ms gap), but project import of such data would feed NaN to `selection-sync` / compose rects. One-line fix.

## client/lib/timeline-clip-layout.js
- `OK`

## client/lib/timeline-compose-preview.js
- `OK`

## client/lib/timeline-program-canvas.js
- `OK`

## client/lib/timeline-state-clips.js
- `OK`

## client/lib/timeline-state-keyframes.js
- `OK`

## client/lib/timeline-state-model.js
- `DEAD` client/lib/timeline-state-model.js:175 `findClipAtTimeOnTimeline()` — no caller. grep: `rg -nw "findClipAtTimeOnTimeline" client src tools godot` → only the definition. It is a byte-for-byte duplicate of `timelineClipMethods.findClipAtTime` (timeline-state-clips.js:90), which is the one used (`timeline-editor-handlers.js:221`).
- `RISK` client/lib/timeline-state-model.js:91-97 — `uid()` / `flagUid()` are `Date.now()` base36 plus 3 (clip/layer) or 4 (flag) random base36 chars. Ids created in the same millisecond collide with p≈n²/93k (n=20 → 0.4 %). `insertClipClone`, paste and import loops can create several clips in one ms; a duplicate clip id makes `findClipOnTimeline` and every `clipId` update hit the wrong clip. Use a counter or `crypto.randomUUID()`.

## client/lib/timeline-state.js
- `OK`

## client/lib/timeline-track-heights.js
- `OK`

## client/lib/trailing-throttle.js
- `QUALITY` client/lib/trailing-throttle.js:60-73 — `flush()` always ends with its own `await run()`, even when the run that just finished was the queued trailing run. Reproduced in node: schedule, schedule again while in flight, then `flush()` → `fn` runs 3 times, the third with no new state. Harmless for idempotent PUTs but it adds a redundant request at every gesture end; skip the final `run()` when nothing was queued or pending.

## client/lib/transition-duration.js
- `OK`

## client/lib/transition-presets.js
- `BUG` client/lib/transition-presets.js:44 — the legacy `+ MERGE` migration eats the space before the `+`. `.replace(/\s*\+\s*MERGE\b/gi, '+ ANIMATE')` turns `"MIX + MERGE"` into `"MIX+ ANIMATE"` (node: `migrateTransitionTypeToAnimate("MIX + MERGE")` → `"MIX+ ANIMATE"`). That string is in neither `TRANSITION_TYPES` nor `PGM_ONLY_TRANSITION_TYPES`, so `normalizeTransitionForPgmOnly({type:'MIX + MERGE',duration:25})` returns a CUT (node-verified). `src/api/routes-scene-take-look.js:65` and `src/engine/scene-take-payload.js:124` load this file server-side, so a "Take (global)" of a deck whose transition was saved before the rename goes on air as a hard cut on PGM-only outputs, and `scenes-shared.js:113,136` / `timeline-transport.js:172` put the mangled string into the dropdown value. The engine itself still accepts `+ MERGE` (`src/engine/scene-transition.js:177`). Godot's twin (`godot/client/features/live/transitions.gd:25`) has the same regex and `godot/client/tests/test_transitions_timer.gd:19` pins the mangled `"MIX+ ANIMATE"` output, so fix both and the test (replace with `' + ANIMATE'`, keeping the leading space).

## client/lib/ui-font.js
- `OK`

## client/lib/v4l2-add-input.js
- `BUG` client/lib/v4l2-add-input.js:51-72 (with v4l2-remove-input.js:29-35 and v4l2-inputs.js:36-44) — a new device added to a re-used slot inherits the previous device's label, format, size, fps and audio. `buildV4l2ConfigBody` only sends `…_label/_format/_width/_height/_fps/_audio` when truthy, and `POST /api/v4l2-inputs/config` (`src/api/routes-v4l2-input.js:70-88`) only overwrites keys that are present (`!= null`), so omitted keys keep their old value. Remove only blanks `v4l2_input_N_device`. Failing sequence: add a USB camera to slot 1 with label "Cam A", format `mjpeg`, 30 fps, audio `hw:1,0` → remove it from its tile → add another device to slot 1 in the modal with defaults (modal sends no label/format/fps/audio for blank/`auto`/`none`, `live-input-modal-submit.js:256-262`) → slot 1 is the new device but still named "Cam A", `mjpeg`, 30 fps, audio `hw:1,0`. Fix: send explicit empty/default values for the slot being (re)written, and clear the slot's extra keys on remove.
- `QUALITY` client/lib/v4l2-add-input.js:57-62 — `prevUi.labels/formats/widths/heights/fps/audio` are always undefined: `readV4l2CasparSettings` (v4l2-inputs.js:11-24) returns only `count, slots, captureBridge, inputsChannelMode`, so the `|| Array(...).fill(...)` fallback is the only path. Root cause of the stale-field bug above; either read those keys in `readV4l2CasparSettings` or drop the dead spread.

## client/lib/v4l2-input-state.js
- `OK`

## client/lib/v4l2-inputs.js
- `QUALITY` client/lib/v4l2-inputs.js:11-24 — `readV4l2CasparSettings` omits the per-slot label/format/width/height/fps/audio that `buildV4l2ConfigBody` (:29-46) writes back (see v4l2-add-input.js finding). No other file to fix for the read side.

## client/lib/v4l2-remove-input.js
- `BUG` client/lib/v4l2-remove-input.js:20-27 — with a `null` stateStore the host channel is never stopped. `device-view-destinations-inspector-host-channel.js:308` calls `removeV4l2InputSlot(null, slot)`; `cm` becomes `{}`, `v4l2InputForSlot({}, s)` returns null (input-channels.js:82-96), so `stopHostChannelPlayback` is skipped. The `onHostInputRemoved` handler in `device-view-selection.js:217` does not stop playback either, so the removed USB input keeps playing on its host channel until Caspar is restarted (the UI only sets "restart dirty"). The other caller (`inspector-v4l2-input.js:54`) passes a store and works. Fix: fall back to `v4l2_input_channels` from `GET /api/v4l2-inputs` (`refreshV4l2Configured`) when no store is given, or pass the store at the device-view call.

## client/lib/variable-state.js
- `OK`

## client/lib/virtual-camera-state.js
- `DEAD` client/lib/virtual-camera-state.js:51 `applyVirtualCameraStatusFromState()` — no caller. grep: `rg -nw "applyVirtualCameraStatusFromState" client src tools godot` → only the definition. It would also never work: it calls `stateStore?.get?.()`, but `StateStore` has no `get()` (only `getState()`/`_get`), so it always sees `undefined`. Delete, or use `getState()` and wire it to the state push.

## client/lib/waveform-fetch-queue.js
- `BUG` client/lib/waveform-fetch-queue.js:9-30 — the stagger does not stagger. `pump()` shifts the job off `_pending` immediately and then waits in a timer, so `_pending` is empty during the wait and `enqueueWaveformFetch` (`_pending.length === 1`) starts a new independent `pump()` for every call; each computes its wait from the same stale `_lastStart`. Reproduced in node with 6 enqueues in a loop: jobs run at 0, 120, 121, 121, 121, 121 ms. The stated purpose (WO T5.4: "stagger waveform GET starts so many clips do not hammer the server") is defeated for the normal case of a timeline with many clips rendering at once (`timeline-canvas-clip.js:244`). Fix: a single `running` flag, or set `_lastStart` when scheduling, and keep the job in the queue until it starts.

## client/lib/webrtc-client.js
- `QUALITY` client/lib/webrtc-client.js:186,190-199 — `destroy()` sets `pc = null` but the pending `waitForGo2rtcRunning()` (polls `/api/streams` up to 20 s) still calls `negotiate()`, which throws on `pc.createOffer()` of null, logs "Negotiation error" and schedules a reconnect timer that does nothing (`renegotiate` returns on `!pc`). Visible as a console error plus up to 20 s of polling per destroyed view. Add a `destroyed` flag checked in `negotiate`/`scheduleReconnect`.
- `QUALITY` client/lib/webrtc-client.js:65 `setGo2rtcApiPort` — documented "no longer used… kept for stream-state compatibility", yet `stream-state.js:50` still calls it. Delete both.

## client/lib/webui-port.cjs
- `OK`

## client/lib/webui-port.js
- `DEAD` client/lib/webui-port.js:1 — the ESM twin of webui-port.cjs is not imported anywhere. grep: `rg -n "webui-port" client src tools scripts vite.config.js package.json` → references only `webui-port.json` (vite.config.js:10, README) and `webui-port.cjs` (electron-launcher main.js/renderer-port.js, sync-launcher-bundle.sh, build-launcher-packages.sh). It also imports `node:fs`, so it cannot be bundled into the browser. Delete it. (`api-origin.js:7` hard-codes 4350 a third time with a "must match" comment.)

## client/lib/wheel-delta.js
- `OK`

## client/lib/workspace-layout.js
- `OK`

## client/lib/ws-client.js
- `DEAD` client/lib/ws-client.js:185 `reconnectNow()` — never called (`rg -nw reconnectNow client src tools godot` → only the definition). It is also broken: it nulls `this.ws` and closes the old socket, but the old socket's `onclose` still runs `this.emit('disconnect')` and `this._reconnect()`, which fires `_connect()` 1 s later and replaces `this.ws` while the socket `reconnectNow` just opened stays open. Reproduced with a fake WebSocket: 3 sockets created, 2 left open, a spurious `disconnect` event; with a real server every state/change message would be delivered twice. If it is ever wired (the doc says "after login sets session cookie"), detach the old handlers first.
- `DEAD` client/lib/ws-client.js:107 `sendAmcpStructured()` and :96 `sendAmcp()` — no production caller. grep: `rg -nw "sendAmcpStructured" client src tools godot` → definition only; `sendAmcp` → definition + `tools/smoke/smoke-ws-restart-reconnect.test.js`. Also `_send` (:58) silently drops the frame when the socket is not open, so `sendAmcp` then waits the full 10 s timeout instead of rejecting at once.
