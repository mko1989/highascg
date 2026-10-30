# client/lib (part 1) — sweep 29.10.2026 (batch 013)

Files: 59 · lines: 6959 · findings: 0 BUG-HIGH, 3 BUG, 11 DEAD, 6 RISK, 22 QUALITY

Method: every file read in full; `node --check` passes on all 59. Dead-code claims grepped across `client src tools scripts tests` (js/mjs/html), excluding `work docs dist* vendor node_modules`. The unwired-export ratchet `tools/ci/unwired-exports-baseline.json` already lists most `DEAD` exports below (noted per finding); the ones with a dead *body* are the ones worth deleting.

## client/lib/alsa-mixer-api.js
- `QUALITY` client/lib/alsa-mixer-api.js:3 — `@see to_server/ALSA_MIXER_API.md` points at a file that does not exist (`ls to_server/ALSA_MIXER_API.md` → no such file). Fix: drop or repoint.
- `QUALITY` client/lib/alsa-mixer-api.js:89-90 — `if (n >= 0 && n <= 100) return Math.round(n)` is redundant with the next line (`Math.max(0, Math.min(100, Math.round(n)))` gives the same result for that range).

## client/lib/amcp-preview-batch.js
- `RISK` client/lib/amcp-preview-batch.js:22-36 — on any error from `/api/amcp/batch` the same chunk is re-sent via `/api/amcp/raw-batch`, and if that throws too, line by line via `/api/raw`. `batchSendChunked` (src/api/routes-amcp.js:101) can fail after earlier lines of the chunk already ran, so one rejected line replays the whole chunk up to three times (PLAY/LOADBG with transitions re-trigger, non-idempotent). All errors are then swallowed (`/* ignore */`), so the operator never learns a line failed. Failing case: a 64-line preview chunk whose line 40 is rejected by Caspar → lines 1-39 are executed again by raw-batch, then again by `/api/raw` one at a time.
- `DEAD` client/lib/amcp-preview-batch.js:47 `AMCP_BATCH_MAX_COMMANDS` — exported, never imported (internal use only). grep: `grep -rlw AMCP_BATCH_MAX_COMMANDS client src tools` → only this file; in the unwired-exports baseline.

## client/lib/api-client.js
- `QUALITY` client/lib/api-client.js:37-57, 83-103, 123-143 — the same 20-line error-parsing block (json detail/message/path/hint, `err.status`, `err.reason`, `err.storedRev`) is copy-pasted in `apiGet`, `apiPost`, `apiPut`. Fix: one `throwHttpError(res)` helper.
- `QUALITY` client/lib/api-client.js:150-169 — `apiDelete` has a thinner copy of that block: it throws a plain `Error` with no `err.status` / `err.reason`, unlike the other three verbs. Callers that test `e.status` (as `apiPost` callers do) would silently never match for DELETE (today's two callers, `project-files.js:285` and `shader-fx-modal.js:277`, only show `e.message`, so no live failure).

## client/lib/api-origin.js
- `OK`

## client/lib/app-multiview-sync.js
- `OK`

## client/lib/app-pgm-header-timer.js
- `OK`

## client/lib/app-range-dblclick.js
- `QUALITY` client/lib/app-range-dblclick.js:14 — a generic "reset any range on double-click" helper special-cases one component's element id (`cable-messiness`, defined in components/device-view-toolbar.js:75) and a magic `min=0.5 max=3 → 1` rule. Fix: give those inputs a `value` attribute / `data-default` so the generic path covers them.

## client/lib/app-runtime.js
- `OK`

## client/lib/app-scene-deck.js
- `QUALITY` client/lib/app-scene-deck.js:35-42 — `lastSentDeckJson/At` are recorded before `ws.send`, and a throwing send is swallowed (`catch {}`), so a send that never left the socket still suppresses an identical payload for `ECHO_WINDOW_MS` (2 s). Bounded and self-healing, hence not a BUG. Also `buildSceneDeckPayload` deep-copies every scene via `JSON.parse(JSON.stringify(s))` and then stringifies the whole payload again on every (100 ms-debounced) change; with a large deck that is two full serialisations per edit.
- `DEAD` client/lib/app-scene-deck.js:6 `buildSceneDeckPayload` export — only used inside this file (in the unwired baseline). Trivial.

## client/lib/app-status.js
- `OK`

## client/lib/app-tabs.js
- `OK`

## client/lib/app-toast.js
- `OK`

## client/lib/app-ws-handlers.js
- `RISK` client/lib/app-ws-handlers.js:157,163,228-232 — `_lastSceneLive` is only refreshed from `change` events for `scene.live`. The full `state` payload (line 117-136, `data.scene.live` applied via `applyWsStateSideEffects`) never updates it. After a server restart/reconnect `_lastSceneLive` still holds the pre-restart live map, and the next `project_sync` (line 228) re-applies it with `sceneState.applyServerLiveChannels(_lastSceneLive, …)` on top of the fresh state. Failing case (not reproduced on the box): look A live → server restarted with live cleared → reconnect applies `{}` → `project_sync` arrives → look A shows live again until the next `scene.live` change. Fix: set `_lastSceneLive = data.scene?.live ?? null` in the `state` handler.

## client/lib/audio-channel-layouts.js
- `DEAD` client/lib/audio-channel-layouts.js:59-69 — the `export { resolveEffectiveProgramLayout, resolveProgramLayoutForMain, resolveProgramLayoutForProgramChannel, resolveProgramAudioLayouts, programBusChannelCountForChannel, programBusChannelCountForMain } from './program-audio-layouts.js'` block has no consumer through this module. grep `audio-channel-layouts` in `client tools`: the only importers are `program-audio-layouts.js` (channelCountFromLayout, normalizeProgramLayout, maxProgramLayout), `audio-routes.js` (channelCountFromLayout, normalizeProgramLayout), `device-view-inspector-audio.js` (PORTAUDIO_LAYOUT_OPTIONS, portAudioLayoutOptionsForDevice), `device-view-destinations-inspector-form.js` (PROGRAM_LAYOUT_OPTIONS); every consumer of the six names imports them from `program-audio-layouts.js`. The block also makes an import cycle with `program-audio-layouts.js` (which imports this file). Safe to delete.
- `QUALITY` client/lib/audio-channel-layouts.js:55-56 — `if (key === 'mono') return 'stereo'` followed by `return 'stereo'` is the same result; the mono branch is redundant.

## client/lib/audio-cross-screen-apply.js
- `OK`

## client/lib/audio-cross-screen-routing.js
- `QUALITY` client/lib/audio-cross-screen-routing.js:9-12 — header says "the caller does the AMCP apply through the same playRouteOnChannel / clearRouteFromChannel path"; since WO-604 the server composes the route (see `audio-cross-screen-apply.js:50-52`), and the client ignores the returned `destLayer` / `route`. Stale comment.

## client/lib/audio-input-meter-map.js
- `OK`

## client/lib/audio-layer-levels.js
- `OK`

## client/lib/audio-mixer-bus-meters.js
- `OK`

## client/lib/audio-mixer-fader-bind.js
- `DEAD` client/lib/audio-mixer-fader-bind.js:6-8 `unityFaderPercent()` — never called. grep: `grep -rlw unityFaderPercent client src tools` → only the definition (in the unwired baseline).

## client/lib/audio-mixer-meter-eligibility.js
- `DEAD` client/lib/audio-mixer-meter-eligibility.js:99-168 `oscLayerIsPlaying`, `oscLayerHasAudio`, `oscLayerEligibleForMeter` — a ~70-line chain nobody calls (the live path is `isLayerStripOnAir`, used by audio-mixer-peaks.js). grep: `grep -rlw "oscLayerEligibleForMeter\|oscLayerHasAudio\|oscLayerIsPlaying" client src tools` → only this file; all three are in the unwired baseline; no smoke reads the file as text (`grep -rn meter-eligibility client tools src` → only audio-mixer-peaks.js).

## client/lib/audio-mixer-meter-loop.js
- `OK`

## client/lib/audio-mixer-peaks.js
- `OK`

## client/lib/audio-mixer-rows.js
- `QUALITY` client/lib/audio-mixer-rows.js:190-192 — three object-literal lines (`audioScreens`, `sourceAudioPair`) are indented one tab less than their siblings inside `rows.push({…})`. Cosmetic, but reads as a block boundary.
- `QUALITY` client/lib/audio-mixer-rows.js:103-105 — the JSDoc `options` type omits `previewLabel`, which the function destructures and uses.

## client/lib/audio-mixer-server-sync.js
- `RISK` client/lib/audio-mixer-server-sync.js:28-35 — only keys present in `next.gains` are re-synced to the on-screen faders. A key that disappears from the server snapshot (persistence wipe / config reset: `src/audio/mixer-state.js` never deletes a single gain, but `audioMixer` can be replaced wholesale) updates the cache (`getMasterVolume` → 1) while the fader stays at its old position until the strip re-renders. Muted keys are handled (line 33 iterates both sets); gains are not. Fix: iterate `new Set([...Object.keys(before.gains), ...Object.keys(next.gains)])`.

## client/lib/audio-mixer-state.js
- `DEAD` client/lib/audio-mixer-state.js:61-79 `getLayerRoute`, `setLayerRoute`, `getAllLayerRoutes` (and the `cache.layerRoutes` field, line 15) plus :122-124 `clearSolos` — no callers. grep: `grep -rlw "getLayerRoute\|setLayerRoute\|getAllLayerRoutes\|clearSolos\|layerRoutes" client src tools` → only this file; all four exports are in the unwired baseline.

## client/lib/audio-mixer-ui.js
- `OK`

## client/lib/audio-mixer-volume-api.js
- `OK`

## client/lib/audio-routes.js
- `OK`

## client/lib/audio-volume-scale.js
- `BUG` client/lib/audio-volume-scale.js:11 (consumer client/lib/scenes-preview-push-scene.js:253,289,331) — `linearGainToCasparDb()` still puts a dB figure on the AMCP wire in the look PRV push: `const vol = linearGainToCasparDb(volGain)` then `MIXER ${cl} VOLUME ${vol} DEFER`. WO-310 established that this Caspar build stores `MIXER … VOLUME` verbatim as a LINEAR coefficient (src/caspar/amcp-mixer.js:223-231). Failing case: a look layer at the default volume 1 → `MIXER 2-10 VOLUME 0 DEFER` (silent); volume 0.5 → `VOLUME -6.02` (inverted phase, ~2x gain); muted → `VOLUME -60` (inverted, 60x gain). The WO-310 smoke (tools/smoke/smoke-wo310-volume-wire-units.test.js:80) only pins the literal text `VOLUME ${volumeDb}`, and push-scene names the variable `vol`, so it slipped through. Not verified on the box; the exposure is whatever listens to the PRV channel (PRV solo/monitor bus) and any edit-on-PGM push. Fix: send `volGain` (linear) there and keep `linearGainToCasparDb` for display (`volumeDb`) only. Outside this batch's files; the misleading name below is the root cause.
- `QUALITY` client/lib/audio-volume-scale.js:3 — header says "Caspar AMCP `MIXER … VOLUME` expects decibels"; it is linear (WO-310, amcp-mixer.js:223). The function names `linearGainToCasparDb` / `casparDbToLinearGain` repeat the false premise. Fix: header + rename to `…ToDisplayDb`.
- `DEAD` client/lib/audio-volume-scale.js:7-8 `VOLUME_MIN_DB`, `VOLUME_MAX_DB` exports — internal use only (unwired baseline). Trivial.

## client/lib/auth-gate.js
- `OK`

## client/lib/caspar-restart-dirty-policy.js
- `OK`

## client/lib/caspar-restart-hint.js
- `OK`

## client/lib/client-prefs.js
- `BUG` client/lib/client-prefs.js:52-54, 77-78, 88-93 — a global pref that was cleared on the node comes back from this browser's localStorage. `readGlobalPref` is `globals[key] ?? readLocal(key)`; `applyClientPrefsBroadcast` for a removal (`value: null`, src/api/routes-client-prefs.js:71) sets `globals[key] = null` but leaves this browser's localStorage copy, so the next read returns the stale local value instead of "none". Worse, `loadClientPrefs` (runs on every WS `connect`, app-ws-handlers.js:292) sees `globals[k] == null` and a local copy and re-uploads it with `writeGlobalPref(k, local)`, resurrecting the cleared value for everyone. Failing case: browsers A and B both saved a rear-panel GPU layout (`gpuLayout`); A runs Factory reset (`performFactoryReset` → `clearGpuLayoutPrefs` → node value null, A's local removed); B receives the null broadcast but keeps its localStorage copy; B's next reconnect POSTs the old layout back to the node and broadcasts it. Same for `decklinkRearOrder` (`saveDecklinkOrder(null)`) and `hardwarePolicy`. Fix: on a null broadcast (and on a load where the node answered null after having had a value) remove the local copy; upload-from-local only once per browser (a flag), not on every connect.

## client/lib/clip-trim-model.js
- `OK`

## client/lib/companion-button-preview-url.js
- `OK`

## client/lib/companion-location-parse.js
- `BUG` client/lib/companion-location-parse.js:14 — the separator regex `/[\s/,/-]+/` includes `-`, so a minus sign is eaten as a separator. The range check at :21 explicitly allows negative `row` / `column` (`-MAX_COORD..MAX_COORD`), but no negative value can be produced. Verified by running it: `parseCompanionLocationInput('1 -2 3')` → `{page:1,row:2,column:3}`; `'1/-2/3'` → `{page:1,row:2,column:3}`. A user typing a negative row gets a different button silently. Fix: split on `[\s/,]+` and accept `-` only as a sign (or document that negatives are not supported and drop the dead range).

## client/lib/compose-preview-backpressure.js
- `OK`

## client/lib/compose-preview-url.js
- `DEAD` client/lib/compose-preview-url.js:47-54 `getComposePreviewCompanionUrl` — no callers. grep: `grep -rlw getComposePreviewCompanionUrl client src tools` → only this file (unwired baseline).
- `QUALITY` client/lib/compose-preview-url.js:81-87 — the `previewEnabledByMain[i] === false` branch pushes the program channel and `continue`s; the fall-through pushes the program channel and then the preview channel. Equivalent to `push(pgm); if (enabled !== false) push(prv)`.

## client/lib/connection-profiles.js
- `RISK` client/lib/connection-profiles.js:35 — `saveConnectionProfiles` calls `localStorage.setItem` outside try/catch while `loadConnectionProfiles` is guarded; with storage blocked or full (private window, quota) the A/B profile save and `switchToPeerProfile` throw into the caller (replication-status-banner.js). Fix: wrap in try/catch like every other storage access in this folder.

## client/lib/coordinate-origin.js
- `QUALITY` client/lib/coordinate-origin.js:126-145 — `applyDragDeltaToFill`'s centre-origin branch is arithmetically identical to the top-left branch: `ncx - sx/2 = (x + sx/2 + dx) - sx/2 = x + dx` (same for y). The `isCenterOrigin()` fork and `scaleX/scaleY` reads add nothing because a drag delta is origin-independent. Fix: single clamp-and-add path.

## client/lib/decklink-add-input.js
- `QUALITY` client/lib/decklink-add-input.js:88 — `changeDecklinkInputDevice(stateStore, …)` never uses `stateStore`.
- `QUALITY` client/lib/decklink-add-input.js:101,182,211,242,260 — the 3-line "apply `extraLiveSources` to `window.__highascgApplyExtraLiveSources`" block is repeated five times (plus once at 349). Fix: one `applyExtras(list)` helper.

## client/lib/decklink-input-toast.js
- `QUALITY` client/lib/decklink-input-toast.js:23,63 — both watchers subscribe to `'*'`, which `state-store.js:102` emits on every `applyChange`, including each `timeline.tick` during playback; each emission rebuilds a `Set` per source. Cheap, but pure waste when the keyed events (`decklinkInputsStatus`, …) already cover the case; the comment says `'*'` is needed for full-state pushes only.

## client/lib/decklink-io-direction.js
- `OK`

## client/lib/default-project.js
- `RISK` client/lib/default-project.js:95-117 — `postProjectSave` turns any save conflict into a forced overwrite: on `/409|payload is older|save rejected/` it re-posts with `force: true`. Today only `performFactoryReset` calls it (`force: true`, which first checks whether the server project is already empty), so the non-force path is unreachable, but `saveDefaultUntitledProjectToServer()` defaults to `force = false` and would overwrite a newer server project with an empty Untitled one. The `409` alternative also matches any message containing those digits. Fix: only force-retry when `opts.force`.
- `DEAD` client/lib/default-project.js:40-45 `buildDefaultUntitledProject` — no callers (`grep -rlw buildDefaultUntitledProject client src tools` → only this file; unwired baseline).

## client/lib/deferred-catalog-ws.js
- `OK`

## client/lib/device-snapshot-capture.js
- `OK`

## client/lib/device-view-cable-messages.js
- `OK`

## client/lib/device-view-cable-preflight.js
- `OK`

## client/lib/device-view-cable-regrab.js
- `OK`

## client/lib/device-view-cable-resolve.js
- `QUALITY` client/lib/device-view-cable-resolve.js:5 — a `lib/` module imports `normRandrCaspar` from `../components/device-view-caspar-render-helpers.js`, which merely re-exports it from `./device-view-randr-norm.js` (the module every sibling lib file uses). Layering inversion and an avoidable cycle risk; import `./device-view-randr-norm.js` directly.

## client/lib/device-view-decklink-keyfill.js
- `OK`

## client/lib/device-view-decklink-order.js
- `OK`

## client/lib/device-view-gpu-layout-debug.js
- `QUALITY` client/lib/device-view-gpu-layout-debug.js:14-23 — tracing is ON by default (only `'0'` disables it), so every Device View render runs `traceGpuLayoutRearPanelRender` (console tables, `querySelectorAll`, several `localStorage` reads via `isGpuLayoutDebugEnabled`) and every port build logs a collapsed group on the production box. The header documents "Enable (default)", so this is a choice, but it is dev tooling running always. Fix: default off, opt in via `localStorage`.
- `QUALITY` client/lib/device-view-gpu-layout-debug.js:97-102 — the build trace prints `localStorage gpu_custom_layout`, but since WO-598 D the layout of record is the node's client-prefs (localStorage is only a fallback copy), so the trace can show a different layout from the one in use.

## client/lib/device-view-gpu-port-constants.js
- `OK`

## client/lib/device-view-gpu-port-entries.js
- `DEAD` client/lib/device-view-gpu-port-entries.js:93-95,97-130,140-148,363-368,413-416 — `shouldExpandPhysicalPortToConnectors()` is hard-wired to `return false`, so everything behind it is unreachable: `entryFromPhysicalPortSide` (its only caller is the `if (shouldExpand…)` branch of `entriesFromPhysicalPort`), the `'physical-split'` phase labels, the `seenIds.add(id)` after a split (:366-368), and the `e.parentPortId === id` skip at :413 (inside this build, `parentPortId` is only ever set at :115, in the dead function; the read at :454-455 therefore only ever takes the `__` regex fallback). grep: `grep -rn "shouldExpandPhysicalPortToConnectors\|entryFromPhysicalPortSide" client` → only this file. The split-jack feature is dead since the "DP-N and DP-(N+1) share one socket" decision (the comment at :92 says so); `consolidateBracketSplitEntries` in device-view-gpu-port-utils.js (outside this batch) exists only to undo it.
- `RISK` client/lib/device-view-gpu-port-entries.js:264-269 — `entryFromInferredPhysicalPort` calls `entryFromTopologyRow(row, displays, suggestedGpuOuts, 0)` but the signature is `(row, displays, connectors, suggestedGpuOuts, index, graphGpuOuts, socketCount)`. So `suggestedGpuOuts` lands in `connectors` (RandR inventory; harmless today because gpu_out suggestions carry no `shortName`/`name`), `suggestedGpuOuts` becomes `0`, and `index` is `undefined`. In the raw build `push()` overwrites `entry.index`, but the merge path (device-view-gpu-port-merge.js:116) pushes the entry straight into `result`, so those inferred rows keep `index: undefined`. Fix the argument list.

## client/lib/device-view-gpu-port-layout-prefs.js
- `OK`

## client/lib/device-view-gpu-port-list.js
- `QUALITY` client/lib/device-view-gpu-port-list.js:150 — `connectors: live.gpu.connectors` is passed to `mergeGpuLayoutEntriesWithPrefs`, whose options destructure it as `_connectors` (port-merge.js:35), so the value is silently dropped. Either use it or stop passing it.
- `QUALITY` client/lib/device-view-gpu-port-list.js:131,145-146 — `let base` is never reassigned; `hideDefault` ternary is `hideDisconnectedByDefault ?? false`.

## client/lib/device-view-gpu-port-merge.js
- `DEAD` client/lib/device-view-gpu-port-merge.js:36-41 `connectedNames` — computed (Set of normalised connected display names) and never read. grep: only the declaration at :36.
- `QUALITY` client/lib/device-view-gpu-port-merge.js:16,35 — unused parameters kept for call-compat: `_prefs` in `resolveGpuSlotIdFromSavedLayout` (callers still pass `readGpuLayoutPrefs()` in device-view-cable-resolve.js:23, an unneeded localStorage/client-prefs read per call) and `_connectors` (see port-list finding). Also `hiddenReason` strings say `localStorage hidden=…` although prefs come from client-prefs, and `let livePresent/connected/monitor/pairs` at :64-67 are identity copies of `entry` fields.
