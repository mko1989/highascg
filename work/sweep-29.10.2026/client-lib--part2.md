# client/lib (part 2) — sweep 29.10.2026 (batch 014)

Files: 50 · lines: 6608 · findings: 0 BUG-HIGH, 11 BUG, 20 DEAD, 8 RISK, 25 QUALITY

Method note: no `rg` on this box, so dead-code greps used `grep -rnw` over `client src tools scripts test godot index.js package.json .github`
(excluding `client/assets/map-data.json`, which is a one-line index that matches every identifier). `tools/ci/unwired-exports-baseline.json`
is the WO-367 ratchet of known orphan exports; it matches a name anywhere outside the defining file (comments, same-name mirrors in `src/`),
so it under-reports. Where I say "test-only" the only reference is a `tools/smoke` file.

## client/lib/device-view-gpu-port-migrate.js
- `QUALITY` device-view-gpu-port-migrate.js:8-12 — the `|| [...(prefs?.byId || new Map()).keys()]` fallback is unreachable: `readGpuLayoutPrefs()` (device-view-gpu-port-layout-prefs.js:15-29) fills `orderIds` and `byId` in lockstep, so `orderIds` is empty only when `byId` is. Remove the fallback (and the `hiddenOnly` path at :48 already assumes `orderIds`).
- `RISK` device-view-gpu-port-migrate.js:46-65 — the "keep hidden flags only" rewrite goes straight to `localStorage.setItem(GPU_CUSTOM_LAYOUT_KEY…)`, bypassing `writeGlobalPref('gpuLayout')`. `readGlobalPref` (client-prefs.js:`globals[key] ?? readLocal(key)`) prefers the node's copy, so if the node already holds the legacy full layout (with `pairs`) the strip has no effect on what is read. Only the one-time local copy changes. Not a failing case I can build without the node state, so RISK.

## client/lib/device-view-gpu-port-topology.js
- `DEAD` device-view-gpu-port-topology.js:20 `detectRtx2030QuadFromLive()` — marked `@deprecated`, no caller. grep: `grep -rnw detectRtx2030QuadFromLive client src tools godot` → only the definition and the barrel re-export device-view-gpu-port-list.js:64. Its private helpers `connectedLiveRandrNames` (:3) and `bracketHasLiveRandr` (:13) die with it.
- `DEAD` device-view-gpu-port-topology.js:33 `reconcileTopologyWithLiveDisplays()` — no-op stub (`return Array.isArray(topology) ? topology : []`), `@deprecated`. grep: client hits are only the definition and the barrel re-export list.js:66; the other hits (`src/utils/gpu-topology-reconcile.js`, `src/utils/gpu-physical-map.js`, `tools/smoke/smoke-gpu-topology-ssot.test.js`) are the unrelated SERVER function of the same name. A same-named no-op beside the real one invites a wrong import.
- `DEAD` device-view-gpu-port-topology.js:41 `resolveEffectiveGpuTopology()` — grep: only the definition and the barrel re-export list.js:67.

## client/lib/device-view-gpu-port-trace-state.js
- `OK`

## client/lib/device-view-gpu-port-utils.js
- `QUALITY` device-view-gpu-port-utils.js:103 `hasDrmGpuPhysicalMap()` — deprecated alias of `hasServerGpuPhysicalMap` ("name retained for existing imports") but one live importer remains, client/components/device-view-helpers.js:1,223. Repoint it and drop the alias.

## client/lib/device-view-gpu-source-inherit.js
- `QUALITY` device-view-gpu-source-inherit.js:28 — `fps` falls back to a flat `50` (`raw.fps ?? spec?.fps ?? 50`) although `fallback = videoModeToResolution(videoMode)` (:21) already carries the mode's rate. Case: a destination with custom mode `3840x1080p60` and no explicit `fps` → `CASPAR_VIDEO_MODE_SPECS` has no entry, `fallback.fps` is 60, result is 50. Use `fallback.fps` as the last fallback.
- `QUALITY` device-view-gpu-source-inherit.js:4-6 — a `client/lib` module imports from `client/components/device-view-destinations-inspector.js` (lib → component inversion; the same file pair that device-view-matrix-ports.js's header says it avoids). Move `CASPAR_VIDEO_MODE_SPECS` to a lib module.

## client/lib/device-view-host-channels-destination-utils.js
- `OK`

## client/lib/device-view-host-channels-inputs.js
- `QUALITY` device-view-host-channels-inputs.js:11 — circular import: this file imports `normalizeHostChannelDestination` from device-view-host-channels.js, which imports this file (host-channels.js:8-12). It works only because both sides use the bindings at call time, never at module evaluation. Move `normalizeHostChannelDestination`/`hostChannelDestinationId`/`defaultHostChannelLabel` into a leaf module.

## client/lib/device-view-host-channels.js
- `QUALITY` device-view-host-channels.js:20,75,155,218 — `HOST_CHANNEL_DEST_ROLES`, `defaultHostChannelLabel`, `listHostLiveSourceDestinations`, `listPersistedScreenDestinations` are exported but referenced nowhere outside this file (they are in the unwired-exports baseline). They are used internally, so not dead; the `export` keywords are noise.

## client/lib/device-view-matrix-ports.js
- `QUALITY` device-view-matrix-ports.js:89 — the sink-kind list (`gpu_out, decklink_out, decklink_io, caspar_mv_out, stream_out, record_out, audio_out, v4l2_out`) duplicates the list in `isSingleInputSinkId` at :20. If one gains a kind the matrix will offer a second cable on a single-input sink (the very rule WO-373 added). Use one constant.
- `RISK` device-view-matrix-ports.js:93-96 — `c.kind.includes(...)` throws a TypeError if any `suggested.connectors` entry has no `kind`; the guard at :87 only checks `c.id`.

## client/lib/device-view-output-layer.js
- `OK`

## client/lib/device-view-randr-norm.js
- `OK`

## client/lib/device-view-refresh.js
- `DEAD` device-view-refresh.js (whole file) — no production importer. grep: `grep -rn "device-view-refresh" client src tools` → only `tools/smoke/smoke-device-view-refresh.test.js:8,24,30` (dynamic imports of `mergeDeviceViewMutation`, `normalizeRefreshMode`). `syncDeviceViewSettingsCache` (:32) is referenced nowhere, not even by a test. The Device View code evidently refreshes some other way (`mergeSettingsIntoDeviceViewPayload` etc.). Decide: delete file and smoke, or wire it.

## client/lib/device-view-simple-wiring-prefs.js
- `OK`

## client/lib/device-view-snapshot-prewarm.js
- `OK`

## client/lib/dmx-state.js
- `DEAD` dmx-state.js:132-137 `setLiveColors()` and the `liveColors` Map (:17) — written on every `dmx:colors` WebSocket frame (client/lib/app-ws-handlers.js:137) but never read. grep: `grep -rn "liveColors\|'live-colors'" client` → only this file. It also emits `'live-colors'` with no subscriber (`dmxState.on(` is called only for `'selection'`, inspector-panel.js:477). Per-frame work with no consumer.
- `DEAD` dmx-state.js:144 `syncCanvasFromProgramResolution()` and `canvasWidth`/`canvasHeight` (:12-13) — grep for `syncCanvasFromProgramResolution` → definition only; `dmxState.canvasWidth/Height` read nowhere.
- `DEAD` dmx-state.js:61 `getFixtures()`, :69 `addFixture()`, :189 `setEnabled()`, :194 `setDebugLogDmx()` — no callers (`grep -rn "\.addFixture\b\|\.getFixtures\b\|\.setEnabled\b\|\.setDebugLogDmx\b" client src tools` → nothing outside this file). Fixtures are only ever updated/removed/renamed from client/components/fixture-inspector.js; `enabled`/`debugLogDmx` can only be read back from settings.
- `QUALITY` dmx-state.js:29-31 vs :82 — the load-time migration defaults a missing `sampleMode` to `'center'`, but `addFixture` (dead anyway) defaults to `'average'`. Two defaults for the same field.
- `QUALITY` dmx-state.js:40,168 — `_emit('change')` fires on every settings update and every debounced save, and nothing listens to `'change'`.

## client/lib/dom-escape.js
- `DEAD` dom-escape.js:26 `html` tagged template — grep: no file imports `html` from dom-escape (checked every `import { … } from '…dom-escape(.js)'` statement in client/src/tools/template/scripts with a script, multi-line imports included). The name evades the unwired-exports ratchet only because `html` appears as a word everywhere.

## client/lib/drag-highlight-cleanup.js
- `OK`

## client/lib/duration-hms-input.js
- `QUALITY` duration-hms-input.js:63,75,87 — fixed element ids `hms-hours`, `hms-minutes`, `hms-seconds`. Two HMS controls in one document (timer-control-panel-settings-form.js and inspector-countdown.js both use `createHmsInput`) produce duplicate ids. Lookups are scoped via `hField.querySelector`, so it works, but the ids are invalid HTML and unnecessary.

## client/lib/edid-preferred-mode.js
- `OK`

## client/lib/editor-defaults-constants.js
- `BUG` editor-defaults-constants.js:53 — `Math.round(Number(transition.duration) || DEFAULT_EDITOR_DEFAULTS.transition.duration)` turns an explicit `0` into 12, which `isAutoTransitionDuration` (transition-duration.js:20-23) treats as the "auto, half the project fps" sentinel. Failing case: Settings → Defaults → Transition duration `0` → `collectEditorDefaultsFromModal` (editor-defaults.js:87) → `mergeEditorDefaults({transition:{duration:'0'}})` returns `duration: 12` (verified by running it) → new looks get a 25-frame MIX at 50 fps instead of a 0-frame cut. `resolveTransitionDuration` itself handles 0 correctly, so the loss is only here. Fix: treat only empty/NaN as default (`Number.isFinite(n) ? n : default`).

## client/lib/editor-defaults.js
- `DEAD` editor-defaults.js:22 `getCoordinateOrigin()` — grep: `grep -rnw getCoordinateOrigin client src tools godot` → only the definition (it is in the unwired baseline).
- `QUALITY` editor-defaults.js:57-63 — both branches of `applyTimelineClipDefaults` set `clip.loop = false`; only `loopAlways` differs. Collapse to `clip.loopAlways = !!t.loopAlways; clip.loop = false`.

## client/lib/effect-apply-live.js
- `RISK` effect-apply-live.js:118-128 — each debounced edit applies the effect twice: first `postAmcpPreviewPipeline(lines)`, then `api.post('/api/mixer/effect', …)`. The server route `case 'effect'` (src/api/routes-mixer.js:171) calls `applyInspectorEffect`, which sends the same MIXER command again. The comment "AMCP batch is authoritative" is misleading, and when the batch throws (:120-122) the second call still runs, so a failed batch is silently retried by a different path. No wrong output shown, but double AMCP traffic per slider tick on air. Pick one path.

## client/lib/effect-registry.js
- `DEAD` effect-registry.js:291 `effectToAmcpBody()` — test-only. grep: only `tools/smoke/smoke-mixer-effects-catalog.test.js:181-185`. It is a second hand-maintained effect→AMCP mapping beside `effectToAmcpLines` (:336) and can drift from it; the smoke only proves it matches itself. Delete both, or have the test cover `effectToAmcpLines` instead.

## client/lib/extra-live-source-remove.js
- `OK`

## client/lib/fill-math.js
- `DEAD` fill-math.js:8 `nativeFill()` — grep: `grep -rnw nativeFill client src tools godot` → definition plus a comment at src/engine/scene-native-fill.js:2 ("same math as web nativeFill"); the server has its own `nativeFillNorm` (scene-native-fill.js:63). No importer.
- `DEAD` fill-math.js:30 `pixelRegionFill()` and :170 `normalizedToPixels()` — grep → definitions only (both in the unwired baseline).

## client/lib/form-upload.js
- `RISK` form-upload.js:10-42 — XHR without `withCredentials` and without the 401 hook `apiGet` uses (`noteUnauthorized`, api-client.js, WO-811). Callers pass `getApiBase()`-based URLs (sources-panel-ingest-logic.js:67, inspector-media-file-versions.js:78, scenes-editor-deck-ingest.js:23), and `getApiBase()` can be another origin (A/B hot-backup override, split UI per api-origin.js). Cross-origin uploads then go out without the session cookie while every `fetch` in api-client sends `credentials: 'include'`. Same-origin is unaffected. Also an expired session shows "HTTP 401…" instead of the sign-in prompt.

## client/lib/global-border-artnet-map.js
- `OK`

## client/lib/global-border-artnet-ws.js
- `OK`

## client/lib/hap-encode-status.js
- `OK`

## client/lib/hot-backup-project.js
- `OK`

## client/lib/input-audio-routing-api.js
- `OK`

## client/lib/input-channels.js
- `DEAD` input-channels.js:99 `routeForV4l2Slot()` — grep → definition only (unwired baseline). Its siblings `routeForDecklinkSlot`/`routeForLiveAudioSlot` have callers.

## client/lib/layer-crop.js
- `DEAD` layer-crop.js:229-271 `cropFractionToPx`, `cropPxToFraction`, `cropParamsToPixels`, `cropPixelsToParams` — test-only. grep: referenced only from `tools/smoke/smoke-layer-crop.test.js:25-27`. effect-registry.js (:40-44) says the inspector does its own px↔fraction conversion at the presentation layer, so these are a parallel implementation nobody calls.

## client/lib/layer-playhead-resolve.js
- `RISK` layer-playhead-resolve.js:81-98 — the fuzzy fallback in `readCurrentDurationFramesFromVariables` matches by substring, so channel/layer numbers collide. Verified by running it: `readCurrentDurationFramesFromVariables({'caspar_ch11_layer5_current_duration':'4'}, 1, 5, 'a', 25)` returns 100 (ch 11's value for ch 1), and `({'caspar_ch1_layer10_current_duration':'4'}, 1, 1, null, 25)` returns 100 (layer 10's value for layer 1), because `includes('ch1')` matches `ch11` and `includes('1')` matches `layer10`. The result feeds SEEK on a "continue from previous" take (scenes-shared.js:194,236). Needs a producer of such keys to bite, see next item.
- `RISK` layer-playhead-resolve.js:54-100 — nothing in this repo produces a variable containing `current_duration` (`grep -rln current_duration` → only this file and two UI strings). The server variables are `osc_ch<N>_l<L>_{clip,time,remaining,progress}` and `channel_<N>_layer_<L>_time_sec` (src/osc/osc-variables.js, src/engine/scene-play-seek.js:127). The whole variables branch therefore only works if an external Companion module supplies those names; otherwise it is dead and the OSC/INFO fallback does the work. Confirm with the owner whether that external source is still used.
- `QUALITY` layer-playhead-resolve.js:16 — `resolveProgramCasparChannel(cm, st, mainIdx, programChannel)` never uses `mainIdx`. `readCurrentDurationFramesFromVariables`'s JSDoc (:49-53) omits the `fps` parameter it takes.
- `QUALITY` layer-playhead-resolve.js:16,37,54,107 — `resolveProgramCasparChannel`, `parseCurrentDurationToFrames`, `readCurrentDurationFramesFromVariables`, `readCurrentDurationFramesFromOscLayer` are exported but only used inside this file (unwired baseline).

## client/lib/led-test-apply.js
- `OK`

## client/lib/live-audio-add-input.js
- `BUG` live-audio-add-input.js:70 — `hostLivePlay = await applyLiveAudioCapture()` but `applyLiveAudioCapture` (live-audio-routing.js:61-63) has no `return`, so `hostLivePlay` is `undefined` on success (and `{ok:false,…}` only on failure). The caller (components/live-input-modal-submit.js:218-221) shows "Capture started on ch N." only when `r.hostLivePlay?.ok` is truthy, so after a successful add the operator never sees it; they get just "Live audio slot N added." The v4l2 twin (v4l2-add-input.js:84) returns the API result and works. Fix: `return api.post(...)` in `applyLiveAudioCapture`, or set `{ ok: true }` here.
- `QUALITY` live-audio-add-input.js:64-65 — `livePayload` and `entry` are declared with `let` and never reassigned.

## client/lib/live-audio-inputs.js
- `DEAD` live-audio-inputs.js:13 `liveAudioHostLayer()`, :20 `liveAudioPgmLayer()`, :8 `LIVE_AUDIO_PGM_LAYER_BASE` — grep → definitions (plus each other) only. `liveAudioPgmLayer` hard-codes base 1 ("slots 1→L1") while the real rule is `live_audio_pgm_layer` default 2 (server src/config/live-audio-input.js:348-355, readLiveAudioCasparSettings :152), so the doc comment is also stale.
- `DEAD` live-audio-inputs.js:56 `resolveInputsHostChannel()` — grep → definition only (unwired baseline).

## client/lib/live-audio-play-targets.js
- `DEAD` live-audio-play-targets.js:29 `getAllPlayTargets`, :42 `getPlayTarget`, :184 `defaultPlayTarget`, :206 `resolvePlayTarget`, :18 `migrateLegacyLayer` — the single-target read side. `resolvePlayTarget` has no caller; `getPlayTarget`/`defaultPlayTarget` are called only by it. The write side is still called (live-audio-mixer-modal.js:306 `setPlayTarget`, :255/:266/:314 `clearPlayTarget`, live-audio-remove-input.js:26) so localStorage key `highascg_live_audio_play_targets` is written and never read. Only the `*Multi*` store has readers.
- `QUALITY` live-audio-play-targets.js:122-124,144-146 — `Math.max(1, parseInt(...) || 0)` can never be non-finite, so the `isFinite` guard that follows is dead, and a malformed stored entry (`{}`) becomes channel 1 / layer 1 instead of being dropped. live-audio-mixer-modal.js:150 uses these targets to start routes.

## client/lib/live-audio-remove-input.js
- `BUG` live-audio-remove-input.js:35-46 — the slot's persisted PGM selection is not cleared. `nextUi = {...prevUi, slots, count}` keeps `prevUi.routeTargets[s-1]`, and `buildLiveAudioConfigBody` (live-audio-inputs.js:214-217) re-sends it as `live_audio_input_<s>_pgm_channels`; the server stores it as given (src/api/routes-audio.js:447-455). `stopDroppedLiveAudioPgmRoutes` only stops the routes. Failing case: slot 1 routed to PGM `1,2` → remove it → add another capture device (`pickLiveAudioSlotForDevice` reuses the first empty slot) → slot 1 still has `pgm_channels="1,2"`, and `addLiveAudioInputSlot` calls `applyLiveAudioCapture()` (live-audio-add-input.js:70) → the new input is put on air on PGM 1/2 without the operator choosing it. Fix: set `nextUi.routeTargets[s-1] = null` (or `[]`) for the removed slot before building the body. Confirm that "route to nothing" is the intended state for a fresh slot; the server's null/absent case falls back to the legacy always-on routing instead.

## client/lib/live-audio-routing.js
- `BUG` live-audio-routing.js:61-63 — `applyLiveAudioCapture()` returns nothing; see live-audio-add-input.js:70 for the effect (no "capture started" feedback).
- `DEAD` live-audio-routing.js:71 `enableLiveAudioPgmRoute()` — grep → definition only (unwired baseline); `enableInputPgmRoute` (:125) replaced it.
- `QUALITY` live-audio-routing.js:11-15 — `pgmDestLayerForSlot` defaults the base to 1 when `liveUi.pgmLayer` is absent, while the server default is 2 and the server clamps to the 9 audio tracks (`liveAudioPgmLayerForSlot` returns null above `PGM_AUDIO_TRACK_LAYER_MAX`). The client has neither the same default nor the clamp, so slot ≥ 8 with base 2 asks for layer 9+ that the server refuses. Callers normally pass `liveUi` from `readLiveAudioCasparSettings` (default 2), so the 1 only shows when `liveUi` is missing.

## client/lib/live-audio-state.js
- `OK`

## client/lib/live-input-start.js
- `OK`

## client/lib/logs-modal-shared.js
- `QUALITY` logs-modal-shared.js:76-79,92-99 — JSDoc drift: `triggerBlobDownload` documents an `apiBase` param it does not take; `downloadSupportBundleFromApi` documents `{ onError }` but ignores `_opts`.
- `QUALITY` logs-modal-shared.js:105-137 — `parseMarkdownBasic` escapes `<` and `>` but not `&`, quotes or backticks content, and its italic rule `\*(.*?)\*` turns any pair of `*` on a line into `<em>`. Input is the static shortcuts file so no exploit, but it should use `escapeHtml` from dom-escape.js like the rest of the client. The `<ul>`/`</ul>` checks at :130 can never match inside the `else` branch.

## client/lib/look-air-compose-channel.js
- `OK`

## client/lib/look-preset-events.js
- `OK`

## client/lib/look-stack-amcp-channel.js
- `QUALITY` look-stack-amcp-channel.js:45-51 — the `prv` branch and the fall-through `edit` branch are identical. `mapCount = 4` (:16) is a hard-coded screen limit.

## client/lib/lower-third-cg-data.js
- `DEAD` lower-third-cg-data.js:34 `resolveLowerThirdFontStack()` — grep → definition only (unwired baseline); `LOWER_THIRD_FONT_OPTIONS` (used by inspector-lower-third.js) still carries the `stack` field it was for.
- `RISK` lower-third-cg-data.js:60-65 — `parsePositiveNumber` accepts 0 (`Math.max(0, n)`), so `titleFontSize`, `subtitleFontSize` or `renderScale` of `0` pass through to the template/UPDATE payload (:113-115, :222-226). A scale of 0 renders the lower third invisible with no error. The name says "positive"; clamp to a minimum above 0 for the size/scale fields (only `displayDurationSec` legitimately takes 0).
- `QUALITY` lower-third-cg-data.js:149,166 — `delete safeStyle.fontFamily` is a no-op: `buildLowerThirdCgData` only ever sets `style.fontFamilyId` (:126).
- `QUALITY` lower-third-cg-data.js:360-365 — the two final branches are the same call (`buildLowerThirdCgData(src.lowerThirdConfig || {})`); the earlier `if (src.lowerThirdConfig …)` at :360 only avoids the `isLowerThirdSource` test.

## client/lib/lower-third-roster-import.js
- `BUG` lower-third-roster-import.js:80-84 — `guessRosterMapping` picks the first-name column with the needle `'name'` (`h.low.includes(n)`), which matches `Surname` / `Last Name` / `Nachname`. Verified by running it: headers `['Surname','Given name','Role']` → `{firstName:'Surname', surname:'Surname', subtitle:'Role'}`; `['Nachname','Vorname']` → firstName `Nachname`, no surname. The Title then reads "Smith Smith" until the operator re-maps by hand. Fix: try exact matches for all needles first, drop bare `'name'` or exclude headers already claimed by `surname`.
- `BUG` lower-third-roster-import.js:182-196 — `row.values` from ExcelJS holds objects for formula cells (`{formula,result}`), hyperlinks (`{text,hyperlink}`, which Excel creates automatically for e-mail addresses) and rich text (`{richText:[…]}`); `cellString` (:16-19) does `String(value)` → `"[object Object]"`. Failing case: a roster where the Role column is formula-derived or the Name column is hyperlinked → Title/Subtitle become `[object Object]`. Fix: unwrap `result`, `text`, `richText.map(t=>t.text).join('')` before stringifying.
- `BUG` lower-third-roster-import.js:115-121 — CSV parsing splits on newlines before handling quotes, so a quoted cell containing a line break splits one record into two broken rows (Excel exports multi-line cells exactly like this). Parse quotes on the whole text, not per line.
- `QUALITY` lower-third-roster-import.js:55-62 — `withParseTimeout` never clears its `setTimeout` and cannot interrupt `wb.xlsx.load`, so the 15 s limit only stops waiting, not the work; the timer also keeps a reference alive for 15 s per call.
- `QUALITY` lower-third-roster-import.js:279 — `normalizeLowerThirdRoster` maps row keys through `safeHeaderKey(k, 0)`, so an unsafe/blank key always becomes `"Column 1"` and can overwrite a real column of that name.

## client/lib/mapping-node-service.js
- `BUG` mapping-node-service.js:312-314 — `addMappingOutput` names the new output `out_${outputs.length + 1}`. After removing a middle output, that id already exists. Failing case: outputs `out_1,out_2,out_3` → `removeMappingOutput('out_2')` → `[out_1,out_3]` → add output → new id is `out_3` again. Two outputs now share an id, `syncPixelMapOutputConnectors` (:178-184) emits two connectors `<node>_out_3`, and `updateMappingOutputFields`/`removeMappingOutput` (which find by id) can only ever reach the first. Fix: pick the lowest unused `out_N`.
- `BUG` mapping-node-service.js:241-247 — `duplicateMappingNode` renumbers the copied outputs to `out_1…out_N` but copies `settings.mappings` verbatim (:257-262), so each mapping keeps its old `outputId`. When the source ids are not contiguous (see previous bug: `out_1,out_3`) the copy's mappings point at `out_3`, which no longer exists. `MappingState.setActiveNode` (mapping-state.js:44-56) then sizes those slices with the 1080p default and also adds an extra `auto_out_2` slice. Fix: keep the source output ids, or remap `outputId` through the same old→new table. The copy also drops stored `width/height/fps` per output (only `id/mode/label` are copied).
- `QUALITY` mapping-node-service.js:41 — `Number.isInteger(f) ? String(f) : String(f)`: both branches identical.
- `QUALITY` mapping-node-service.js:52-54,66-71 — `Number.isFinite(Number(output?.width))` is true for `null` and `''` (`Number(null) === 0`), so an output with `width: null` resolves to width 0 instead of falling through to the mode's size.

## client/lib/mapping-state.js
- `BUG` mapping-state.js:230 — `_save` is a read-modify-write of the whole device graph (`api.get` → set `node.settings.mappings` → `POST {deviceGraph}`) but reads with a plain `api.get('/api/device-view')`. The route answers `Cache-Control: private, max-age=3` (src/api/routes-device-view.js:126,132), the exact hazard WO-436 fixed for the service via `fetchDeviceView()` (`_ts` bust, mapping-node-service.js:143-149, pinned by smoke-wo436). Failing case: open the pixel-map editor (plain GET, pixel-map-editor.js:130) → within 3 s change an output via the inspector (busted GET + POST) → drag a slice (this `_save`, 450 ms later) → the browser serves the pre-change graph from cache → the POST writes it back and silently reverts the output change. Fix: use `fetchDeviceView()` here (and in pixel-map-editor.js:130).
- `BUG` mapping-state.js:77-98 — `setActiveNode` only updates `canvasWidth/Height` when the node has an input cable whose source resolves; otherwise the previous node's values stay (`mappingState` is a singleton). Failing case: edit node A fed by a 3840x2160 source, then open node B with no cable → B is edited on a 3840x2160 canvas and the "Canvas: 3840×2160" label (pixel-map-editor.js:98) is wrong. Fix: reset to 1920x1080 at the top of `setActiveNode`.
- `RISK` mapping-state.js:36,226 — `setActiveNode` does not cancel or flush a pending `_saveTimer`. Edit a slice on node A and switch to node B within 450 ms: the timer fires with `this.activeNodeId = B` and `this.mappings` = B's, so A's edit is never saved.
- `DEAD` mapping-state.js:110 `addMappingFromTemplate`, :155 `renameNode`, :166 `duplicateNode`, :177 `deleteNode`, :188 `addOutput`, :199 `removeOutput`, :213 `updateOutput`, :105 `_getNodeOutputCount` — grep for `\.addMappingFromTemplate(`, `\.renameNode(`, `\.duplicateNode(`, `\.deleteNode(`, `\.addOutput(`, `\.removeOutput(`, `\.updateOutput(` across client/src/tools/godot → no caller. The only methods used are `setActiveNode`, `updateMapping`, `removeMapping`, `on` and the fields (pixel-map-editor.js, pixel-map-editor-canvas.js). device-view-inspector-mapping.js calls `MappingNodeService` directly. About 90 lines of unused stateful wrappers that would also mishandle `mappings` (`duplicateNode`/`removeOutput` assign `node.settings.mappings` raw, without the defaulting `setActiveNode` does).
