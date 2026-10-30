# client/lib (part 3) — sweep 29.10.2026 (batch 015)

Files: 41 · lines: 6847 · findings: 0 BUG-HIGH, 7 BUG, 23 DEAD, 5 RISK, 29 QUALITY

Method notes: every file read in full. Dead-code claims were grepped over `client/ src/ tools/ scripts/ test/ godot/client/ index.js template/` (files of type js/mjs/cjs/gd/html/json/sh/py/css/yml, excluding `client/assets/map-data.json` and node_modules) with word-match, plus `tools/ci/unwired-exports-baseline.json` (the WO-367 ratchet: names listed there have no importer anywhere). Note `src/engine/scene-take-payload.js` and `src/api/routes-scene-layer-tools.js` / `routes-scene-new-layer.js` load several `client/lib` modules by dynamic `import()` (pip-overlay-registry, media-file-defaults, mixer-fill, ...), so those files must stay DOM-free. Behavioural claims below were re-run in node where marked "ran".

## client/lib/math-input.js
- `BUG` client/lib/math-input.js:248-249 — `createMathInput` wires BOTH `change` and `blur` to `apply(parseVal())`, and `apply` always calls `onChange`. Failing case: multiview cell inspector (`client/components/inspector-fill.js:339-408`, the only caller): click into W and tab out WITHOUT typing → `blur` → `onChange(w)` → `multiviewState.setCell` → `_save()` → `apply-request` (`multiview-editor.js:313`) → with `autoApply` on the whole multiview is re-pushed to Caspar (debounced); with the aspect lock on, `solveCellDimensions` also rewrites H from the rounded W, so a mere focus/blur can move the cell. Typing a value and pressing Tab fires `change` then `blur` = two `onChange` calls for one edit. Fix: only call `onChange` when the parsed value differs from the last committed one; drop one of the two listeners (or dedupe like `attachMathInput` does with `valueAtFocus`).
- `BUG` client/lib/math-input.js:428 and :222 — owner rule 1 (RULES.md "Focus selects the value") is not implemented by `attachMathInput` (its `onFocus` only resyncs `lastGood`) nor by `createMathInput` (no focus handler at all). Grep of `client/` finds a focus-select only in `inspector-clip-trim.js:135` (explicitly "RULES.md: focus selects the value") and unrelated modals; the Godot client does it centrally in `core/numeric_field.gd`. Failing case: click into any `attachMathInput` field holding `1920` and type `1080` → caret lands in the text, result `19201080`-style concatenation instead of replacing. Tab-focus is rescued by the browser's native select-all, click-focus is not. Fix: `inputEl.addEventListener('focus', () => inputEl.select())` plus a one-shot `mouseup` preventDefault so the click does not clear the selection.
- `RISK` client/lib/math-input.js:147 — `parseNumberInput` falls back to `parseFloat`, so an INVALID expression is salvaged instead of leaving the previous value (RULES.md rule 2). ran: `"1920/"`→1920, `"100+"`→100, `"1920/0"`→1920, `"1.2.3"`→1.2, `"12abc"`→12, `"5 5"`→5 (only `"(1920"` restores `lastGood`). The tail-tolerance is pinned on purpose (`tools/smoke/smoke-math-input.test.js:71` `'42px'`→42) and `godot/client/core/math_input.gd` mirrors it, so this is a documented deviation from the written rule, not an accident. Owner should decide: tighten both clients, or amend RULES.md rule 2.
- `DEAD` client/lib/math-input.js:187-192, 263-282, 284 — the mini-slider branch (`slider` option) and the returned `setValue` of `createMathInput`. grep: `createMathInput` has one importer, `client/components/inspector-fill.js`, whose four calls (lines 339, 346, 379, 394) pass no `slider` and never use `.setValue` (the `xInpRef.setValue` at :119-122 belongs to `createDragInput`).

## client/lib/media-audio-kind.js
- `QUALITY` client/lib/media-audio-kind.js:8 — private `AUDIO_EXT` (with leading dots) duplicates `AUDIO_EXT` in `media-ext.js:9` (without dots); `classifyMediaKind(source.value) === 'audio'` would do the same. Two lists to keep in sync (they currently match).

## client/lib/media-duration.js
- `RISK` client/lib/media-duration.js:105-113 — the probed overlay (`GET /api/media`) is fetched exactly once at init and never refreshed. A file added later whose only `state.media` row is the CINF-maths-broken one (fps<1, the trap this file documents at the top) has no probed counterpart in `_probed`, so `mediaDurationMs()` returns null until a full page reload. Fix: re-fetch (debounced) when `state.media` changes length/ids.
- `QUALITY` client/lib/media-duration.js:101-104 — `stateStore._emit('media', v)` calls the `'media'` listener AND the `'*'` listener (`state-store.js:88-90` passes `path='media'`), so every media push runs `rebuild()` twice (O(n) over media + `_probed`, with `pick()` per key). Same pattern in `media-exists.js:58-61`. Keep only the `'*'` handler (it also covers `setState`) or only `'media'`.

## client/lib/media-exists.js
- `BUG` client/lib/media-exists.js:19 — client `NON_MEDIA_RE` lacks the `|empty$` that the server twin gained in WO-768 (`src/media/media-exists.js:14`). The empty playlist item is `{type:'empty', value:'EMPTY'}` (`smoke-wo768-playlist-empty-item.test.js:49`). Failing case: playlist with an empty item, media list loaded → `clipMissing('EMPTY')` returns `true` (norm `empty` is in no id set) → `inspector-layer-playlist.js:166` marks the row missing and `playlist-control-panel.js:91` prefixes `⚠ ` in the item dropdown; `missingMediaInScene` (:76-86) also puts `EMPTY` into the take-time "Missing in Caspar media" toast. Fix: add `|empty$` (WO-768 comment says the web copy was left behind).
- `BUG` client/lib/media-exists.js:19 — the `decklink|live|color` alternatives are unanchored PREFIXES, not whole words. ran: `colorbars.mov`, `Live_Event_2024.mp4`, `livestream/clip`, `Decklink_Intro`, `colorado/trip.mp4` all match → `clipMissing` returns `null` ("not judgeable") so a genuinely missing clip with such a name never gets the ⚠ or the take warning. Same regex on the server (`src/media/media-exists.js:14`). Fix: anchor on the exact tokens Caspar sources use (`live`, `color`/`#rrggbb`, `decklink` followed by end, space or `:`), not on a bare prefix.
- `QUALITY` client/lib/media-exists.js:97-108 — `toastTakeAmcpFailures` has nothing to do with media existence; it lives here only because WO-360 did. Imported from `scenes-preview-runtime.js` and `scenes-editor-support.js` for that reason alone. Move to a take-feedback module.

## client/lib/media-ext.js
- `QUALITY` client/lib/media-ext.js:37-42 — doc says "Still images, routes, templates, audio, etc. get no loop control", but line 52 returns `true` for audio extensions (and the Godot mirror `mixer_math.gd:78` agrees with the code, golden-tested). The comment is stale; the behaviour is the intended one.
- `QUALITY` client/lib/media-ext.js:86 — `if (!ext && v.length > 0) return 'unknown'` is redundant with the next line (`return 'unknown'`).
- `DEAD` client/lib/media-ext.js:23, 32 — `isStillImageFilename` and `isVideoLikeFilename` are exported but only used inside this file. grep: `isStillImageFilename|isVideoLikeFilename` across all roots → only `media-ext.js` and `unwired-exports-baseline.json`. Dropping `export` is enough.

## client/lib/media-file-defaults.js
- `OK`

## client/lib/media-file-ops.js
- `BUG` client/lib/media-file-ops.js:21-28 (and the same shape in `deleteMediaFiles` :67-75) — a PARTIAL batch failure is reported as total failure. The server batch (`src/api/routes-media.js:247-266` `runBatchMediaOp`) answers HTTP 200 with `{ok:false, moved:2, count:2, errors:[…]}` when some ids fail. `batchTransfer` sees `res.ok === false`, ignores the counts, and replays EVERY id one by one. Failing case: move 3 files, one is locked → batch moves 2; the per-file replay then fails for those 2 (source gone → 404; copy → 409 "Destination file already exists", `local-media-api.js:335`) → result `ok:0 failed:3` → `formatMediaOpResult` says "Moved 0 of 3 — 3 failed" although 2 moved. Fix: when `res.ok === false` and `res.errors` is present, build the result from the batch response (`count`, `errors`) and do NOT replay; only fall back per-file when the batch endpoint itself is missing (HTTP 400/404/throws).
- `QUALITY` client/lib/media-file-ops.js:3 — `@see to_server/MEDIA_BROWSER_API.md`: the `to_server/` directory no longer exists in the repo.

## client/lib/media-multi-rename.js
- `OK` (verbatim twin of `src/media/media-multi-rename.js`, pinned by `smoke-wo603-multi-rename-plan.test.js`; the duplication is the documented WO-603 → WO-609 cutover state.)

## client/lib/media-notchlc.js
- `OK`

## client/lib/mixer-fill.js
- `DEAD` client/lib/mixer-fill.js:141, 155, 169 — `isFullCanvasFill`, `isMixerFillReasonable`, `isFullScaleWithNonZeroOrigin`. grep: names appear only here and in `tools/ci/unwired-exports-baseline.json` (no importer, no internal call, not in godot/src/tools).
- `QUALITY` client/lib/mixer-fill.js:108-111 — two JSDoc blocks stacked on `MEDIA_FILE_EXT` (the first, "Lowercase, strip extension…", belongs to `normalizeMediaIdForMatch`).

## client/lib/multiview-state-layout.js
- `BUG` client/lib/multiview-state-layout.js:68-87 — the decklink strip of `defaultLayout` is broken twice. (1) `bottomH >= 40` can essentially never hold when any PGM/PRV exists: the screen bands already use `cellH = floor(ch/activeScreens)` so `bottomH = ch - activeScreens*cellH` is < activeScreens px. ran: `programChannels:[1], previewChannels:[2], decklinkCount:5` → no decklink cells at all. (2) When it IS reachable (no PGM/PRV, `activeScreens = 0`), every cell gets `y = usedH` — the row index `floor(i/4)` is never added. ran: `decklinkCount:5` → `decklink_4` at x=0,y=0 exactly on top of `decklink_0` (`routing-map.js:187` allows up to 8 inputs). Low impact today because the only callers are `MultiviewState.buildDefault` (itself unused, see multiview-state.js) and `tools/dev/gen-godot-golden-multiview.mjs`; `godot/client/features/multiview/mv_layout.gd` mirrors the same maths, so fix both together or delete.
- `QUALITY` client/lib/multiview-state-layout.js:3 — `@see main_plan.md Prompt 15, HOW_TO_ACHIVE_MULTIVIEWER.MD`: neither file exists (also in `multiview-state.js:4`).

## client/lib/multiview-state.js
- `DEAD` client/lib/multiview-state.js:140 `buildDefault()` — no caller. grep: `buildDefault` across `client src tools godot/client` → only the definition. (`defaultLayout` stays alive through the golden-multiview tool and the Godot mirror.)
- `RISK` client/lib/multiview-state.js:86-111 — `_load()` only restores `bgColor/showOverlay/timerScale/canvas*/audioActiveCellId` when the stored layout has at least one cell; otherwise it sets `cells = []` and KEEPS whatever the previously active multiviewer had in memory. Failing cases: (a) `switchTo(2)` for a never-saved multiviewer inherits multiviewer 1's canvas size, bg colour and `audioActiveCellId` (the id `'pgm'` then matches MV2's own PGM cell → audio focus on a cell the operator never chose), and the first edit persists them into MV2's record; (b) a user who changes the bg colour and then "Reset layout" (`clearLayout` → empty cells) loses the colour on reload. Fix: reset all scalar fields to defaults at the top of `_load()` before overlaying stored data.
- `QUALITY` client/lib/multiview-state.js:318-321 — `toApiLayout` doc says "Clamps to valid range to avoid floating-point garbage", but `cellsToApiLayout` only rounds to 6 decimals; no clamp.

## client/lib/ndi-attribution.js
- `OK` (`NDI_TRADEMARK_NOTICE` is exported but only used locally — baseline-listed, harmless.)

## client/lib/offline-storage.js
- `DEAD` client/lib/offline-storage.js:62 `clear()` — grep `offlineStorage` → only `client/lib/state-store.js`, which calls `getSnapshot`/`saveSnapshot`; `clear` has no caller.

## client/lib/optional-modules-client-manifest.js
- `QUALITY` client/lib/optional-modules-client-manifest.js:16-22 — the "merge bundles/styles of enabled registry modules" loop is duplicated verbatim in `optional-modules-registry.js:31-38` (`buildModulesApiPayload`); `optional-modules.js:72` runs the fallback payload through both. Reuse one helper.

## client/lib/optional-modules-meta.js
- `OK`

## client/lib/optional-modules-registry.js
- `DEAD` client/lib/optional-modules-registry.js:14 `getOptionalModuleDef` — grep → definition and baseline only.
- `QUALITY` client/lib/optional-modules-registry.js:43 — `wsNamespaces: enabled.filter((id) => id !== 'cg-studio')` hard-codes a module id and invents namespaces equal to module ids, while the server's namespaces are prefixes like `'previs:'` (`src/module-registry.js:18`). The value only feeds `getOptionalModuleState()` (unused), so it is inert.

## client/lib/optional-modules.js
- `DEAD` client/lib/optional-modules.js:129 `getOptionalModuleState` (and with it `_state.wsNamespaces`, :24/:77) — grep → definition and baseline only.

## client/lib/os-mode-creation-status.js
- `DEAD` client/lib/os-mode-creation-status.js:6 `formatModeCreationStatus` — not used by the app: grep `modeCreation|os-mode-creation|formatModeCreationStatus` over client/, godot/client, src → the producer is `src/utils/os-config-xrandr-apply.js`, the formatter's ONLY consumer is `tools/smoke/smoke-cg-deck-thumb-contain.test.js:21` (a runtime import in a test whose name is about something else). No Device View code renders the apply-os mode-creation result in the web client, and Godot has no equivalent. If the Device View status line was intended (WO-80 T80.B.3), it was never wired; otherwise delete file + that test case.

## client/lib/osc-client.js
- `DEAD` client/lib/osc-client.js:2, 39-44, 111-144 — the standalone-socket mode (`_own`, `_retry`, constructor options `url/reconnectInterval/maxReconnectAttempts`, the `getWsUrl` import at line 2). grep `new OscClient` → one call, `client/app.js:146`, always with `{ wsClient: ws }`; `tools/` only stubs the class. The branch can never run.
- `DEAD` client/lib/osc-client.js:146-151, 160-165 — `onAudioLevels` and `onProfiler` (and the `_audio`/`_prof` maps iterated in `_run`, :80-84, :95-100). grep: no caller outside this file (`audio-mixer-peaks.js`/`-eligibility.js` read `oscClient.channels` directly; only `onLayerState` and `onAfterIngest` have callers, both in `playback-timer.js`).

## client/lib/pip-overlay-amcp.js
- `DEAD` client/lib/pip-overlay-amcp.js:449 `pipOverlayClearAmcpLinesForContentRange` — grep → definition and `unwired-exports-baseline.json` only.
- `QUALITY` client/lib/pip-overlay-amcp.js:15-21 — `TEMPLATE_MAP` repeats the `template` field of every `PIP_OVERLAYS` entry (`pip-overlay-registry.js`), and `src/engine/pip-overlay-utils.js:19` has a third copy. Derive from the registry.
- `QUALITY` client/lib/pip-overlay-amcp.js:105 — orphan JSDoc (`@param … contentFill`) sits above `isOutsideSide(overlay)` and describes nothing there.

## client/lib/pip-overlay-registry.js
- `DEAD` client/lib/pip-overlay-registry.js:54 `overlayLayer` and :300 `PIP_OVERLAY_TEMPLATE_FILES` — no consumer of the CLIENT copies: `src/config/routing-setup.js:96` and `src/api/routes-pip-overlay.js:14` take `PIP_OVERLAY_TEMPLATE_FILES` from `src/engine/pip-overlay*`, and the server loads this registry only via `scene-take-payload.js` / `routes-scene-layer-tools.js` (they use `getPipOverlaysFromLayer`, `PIP_OVERLAYS`). `overlayLayer` appears only as a parameter name elsewhere.
- `QUALITY` client/lib/pip-overlay-registry.js:102, 122, 148, 233, 287 — every definition carries `icon: ''`; no reader of `.icon` in `inspector-pip-overlay.js`, `inspector-global-border-effect.js`, `scene-state-global-border.js`.

## client/lib/placeholder-state.js
- `DEAD` client/lib/placeholder-state.js:21-27, 64-71 — `on()` (+ `_listeners`/`_emit`) and `update()`. grep `placeholderState` over client: only `getAll`, `add`, `remove`, `getExportData`, `loadFromData` are called (`app.js`, `api-client.js`, `project-state.js`, `default-project.js`, `placeholder-modal.js`, `sources-panel-*.js`); nobody subscribes or updates.
- `QUALITY` client/lib/placeholder-state.js:38 — `add()` does `p.template.toUpperCase()` before the later `p.template || 'color_grid'` default, so a call without `template` throws instead of defaulting. The one caller (`placeholder-modal.js:94`) always passes it.

## client/lib/planned-channel-map.js
- `QUALITY` client/lib/planned-channel-map.js:30-63 — the header (":1-4") and `effectiveChannelMap` still decide "planned vs live" by diffing two channel maps, but the doc of `liveCasparChannelSet` (:65-73, WO-381) says every `channelMap` the client holds is built from the same saved config, so such a diff "says nothing about what Caspar is actually running". `casparHostChannelsPendingApply` therefore can only differ during a state-lag window. Either document that or drop the dead branch once Godot (`host_channels.gd` mirrors it) is checked.
- `DEAD` client/lib/planned-channel-map.js:13, 19 — `plannedChannelMapFromSettings` / `plannedChannelMapFromPayload` are exported but only called inside `effectiveChannelMap` (baseline-listed). Drop `export`.

## client/lib/playback-timing-clock.js
- `QUALITY` client/lib/playback-timing-clock.js:78-83 — `layerLooksPaused` JSDoc documents a `clock` parameter the function does not take.

## client/lib/playlist-live-sync.js
- `OK`

## client/lib/playlist-timeless.js
- `OK` (same classification as the server's `isTimelessPlaylistItem`, `src/engine/scene-take-lbg-playlist.js:19`.)

## client/lib/previs-mesh-info.js
- `DEAD` client/lib/previs-mesh-info.js:166 `findTaggedScreenMeshes` and :189 `setMeshInteractive` — grep → definition, export and baseline only (`previs-scene-utils.collectTaggedMeshes` reimplements the first).
- `QUALITY` client/lib/previs-mesh-info.js:83-94 — `getMeshInfo().boundingBox` is documented "World-space AABB" but computed as `localBox * worldScale + worldPos`, ignoring rotation and the box centre offset; wrong for any rotated or off-centre mesh. Latent: the only consumers of `meshInfos` read `name`/`uuid` (`previs-pgm-3d-inspector-binder.js:144`, `previs-pgm-3d-dropzone.js:132`).

## client/lib/previs-model-loader.js
- `DEAD` client/lib/previs-model-loader.js:59 `loadModelFromUrl` — no caller (baseline-listed); the header (:11) advertises it as the "server-persisted model path" but the binder loads saved models through `loadModelFromArrayBuffer`. Also `normalizationFactor`/`originalBox` in the returned `LoadedModel` have no reader.
- `QUALITY` client/lib/previs-model-loader.js:225 — `disposeMaterial` is duplicated in `previs-scene.js:347` with slightly different guards (`highascgKeep` null-safe here, not there).

## client/lib/previs-scene-materials.js
- `QUALITY` client/lib/previs-scene-materials.js:13-23 — semicolon-chained one-liners (`mat.toneMapped = false; return mat`, `if (!material) return; material.map = tex`); below the repo's formatting standard and hard to read.

## client/lib/previs-scene-model.js
- `RISK` client/lib/previs-scene-model.js:19-20 — `cloneTex` clones the binding's CURRENT texture; at bind time that is often the 1×1 `DataTexture` placeholder, and `syncTex` later assigns the `<video>` element to the clone's `.image` while the clone is still a `DataTexture` (three.js uploads `isDataTexture` via `image.data/width/height`). Because `Texture.clone()` shares `source`, the assignment also swaps the placeholder's data. Unverified at runtime (needs a 3D previs session where the stream goes live after the mesh is bound); if the screen stays black in that order, this is why. Safer: create a `VideoTexture`/`CanvasTexture`-agnostic display texture, or just reuse `b.texture` and swap `material.map` (the `onTextureChanged` callback already does `applyTextureToScreenMaterial`).
- `QUALITY` client/lib/previs-scene-model.js:30-31 — `unbind`/`removeDemo` release the stream binding but never dispose the screen material or the cloned display texture they created (`bind` :34, `addDemo` :26); `dispose()` (:63) also leaves the `BoxHelper` from `setSelection` in the scene. Small GPU/heap leak per model reload.
- `DEAD` client/lib/previs-scene-model.js:49-50 — returned `getModel` and `getBindings`: grep `\.getModel\(\)|\.getBindings` in client → none outside the definition.
- `QUALITY` client/lib/previs-scene-model.js:10-65 — the whole module is dense multi-statement lines (`;`-chained, 200+ char lines); same style in `previs-scene-utils.js`. Readability and reviewability are well below the rest of `client/lib`.

## client/lib/previs-scene-utils.js
- `QUALITY` client/lib/previs-scene-utils.js:6-22 — compressed one-line functions (see previs-scene-model.js). No functional issue found.

## client/lib/previs-scene.js
- `BUG` client/lib/previs-scene.js:337-340 — the "ground grid" is rotated onto the vertical XY plane. `THREE.GridHelper` is built in the XZ plane (= the floor in three's Y-up space); `grid.rotation.x = Math.PI/2` stands it up as a wall through the origin (spanning y = ±30). Everything else in the previs scene is Y-up: models are placed on the floor at `y = 0` (`previs-model-loader.js:181`), the demo screen is at `y = h/2+0.2` (`previs-scene-utils.js:21`), the camera uses the default up vector (no `camera.up`, no scene rotation anywhere in `client/` previs code — grepped). The comment ("stage +Z is up") describes a stage→three conversion that is never applied. Found by code reading; not seen on screen. Fix: drop the rotation (floor grid) unless a Z-up stage group is introduced.
- `RISK` client/lib/previs-scene.js:280 — `renderer.dispose()` without `renderer.forceContextLoss()`. `previs-pgm-3d.js:162` creates a new `WebGLRenderer` on every 3D enter; browsers cap live WebGL contexts (~16) and warn/drop the oldest, and a disposed-but-unreleased context lingers until GC. grep `forceContextLoss` in client → none.
- `DEAD` client/lib/previs-scene.js:156 `setControlsEnabled` — grep → definition and handle only, no caller in client.
- `QUALITY` client/lib/previs-scene.js:105 — `controls.makeDefault` is a react-three-drei prop; plain `OrbitControls` ignores it.
- `QUALITY` client/lib/previs-scene.js:347 — duplicate of `previs-model-loader.js:225` `disposeMaterial`.

## client/lib/previs-state.js
- `DEAD` client/lib/previs-state.js:205 `clearTagsForModel` and :253 `reset` — no caller (previs components and tests call neither; the other smokes that call `.reset(` are unrelated modules).
- `QUALITY` client/lib/previs-state.js:253-256 — `reset()` commits `Object.values(EVENTS)`, which includes `change`, and `commit()` already emits `change` first → `change` listeners fire twice.

## client/lib/previs-stream-sources.js
- `OK`

## client/lib/previs-texture-crop.js
- `OK`

## client/lib/previs-uv-mapper.js
- `DEAD` client/lib/previs-uv-mapper.js:166, 245, 266, 284 — `computePanelUV`, `ledPanelSizeMeters`, `rotate2D`, `__selfTest`. Only `computeScreenUV` is imported (`previs-inspector-mapping.js:4`); `computePanelUV` is mentioned in a comment of `previs-pgm-3d.js:23` (the "irregular screen rendering" never landed), `__selfTest` is referenced by nothing (the `tools/smoke-previs-uv.js` it names does not exist; `godot/client/features/previs/previs_uv_mapper.gd` is a separate port). `computeContentBounds` is exported but only used by `computeScreenUV` and the self-test. ~180 of 382 lines are therefore test-only or unused.
- `QUALITY` client/lib/previs-uv-mapper.js:277-279 — self-test doc cites `tools/smoke-previs-uv.js` and `./web/lib/previs-uv-mapper.js`; neither path exists (`web/` was renamed to `client/`).

## client/lib/previs-video-texture.js
- `QUALITY` client/lib/previs-video-texture.js:6, 313-314 — comments point at `web/lib/webrtc-client.js` and `web/components/preview-canvas-panel.js`; the `web/` tree no longer exists.

## client/lib/program-audio-layouts.js
- `DEAD` client/lib/program-audio-layouts.js:162 `programBusChannelCountForMain` — only re-exported from `audio-channel-layouts.js:59-66`; no importer of the name anywhere.
- `QUALITY` client/lib/program-audio-layouts.js:5-9 — circular import with `audio-channel-layouts.js`, which re-exports this file's functions (:59-66). Works today because only hoisted function declarations are shared, but any top-level `const` use across the cycle would hit TDZ.

## client/lib/program-layer-bank.js
- `OK` (identical logic to `src/engine/program-layer-bank.js`.)

## client/lib/program-output-state.js
- `DEAD` client/lib/program-output-state.js:156-176, 178-193 — `getLayerName`, `setLayerName`, `getLayerSetting`, `setLayerSetting`, `resetForNewProject`, `on`/`_emit` (incl. the `layerSettingChange` event) and the `layerCount` field. grep (word match, all roots) → only this file. What remains alive is the persisted blob: `setCanvasResolutions`, `resetAllMainsForNewProject`, `loadFromData`, `getExportData` (project-state / default-project / app-ws-handlers / server-project-sync). The per-layer "Millumin-style" mixer rectangles are written and exported but never read by any UI.
- `DEAD` client/lib/program-output-state.js:10 — re-export `DEFAULT_TRANSITION` has no importer through this module (`scenes-shared.js` and `timeline-transport.js` import the other names from here, `DEFAULT_TRANSITION` only from `transition-presets.js`).
