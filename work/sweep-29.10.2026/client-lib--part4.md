# client/lib part 4 — sweep 29.10.2026 (batch 016)

Files: 46 · lines: 6959 · findings: 0 BUG-HIGH, 6 BUG, 15 DEAD, 7 RISK, 15 QUALITY

Lead from the earlier batch (`scene-state-layer-logic.js` patchLayer fill overwrite) is CONFIRMED, see the scene-state-layer-logic.js section. The BUG count of 6 lists the main-editor-visibility bug twice (persistence-logic and scene-state.js), so there are 5 distinct bugs. All 46 files were read in full.

## client/lib/project-files.js
- `RISK` client/lib/project-files.js:223-230 `triggerBlobDownload()` calls `URL.revokeObjectURL(url)` synchronously right after `a.click()` on a detached anchor. Browsers start the download asynchronously; a synchronous revoke can abort it (Firefox is the project's browser per the memory notes). Failing case: Download on a project file in Firefox with a large JSON → empty or failed download. Not reproduced here (needs a browser). Fix: `setTimeout(() => URL.revokeObjectURL(url), 1000)` and append the anchor to `document.body` before the click.
- `QUALITY` client/lib/project-files.js:85-88 mis-indented block inside `if (res && typeof res === 'object')`. Line 186 `let res` is never reassigned (`const`).

## client/lib/project-fps.js
- `OK`

## client/lib/project-hardware-apply.js
- `OK`

## client/lib/project-hardware-mismatch.js
- `DEAD` client/lib/project-hardware-mismatch.js:425 `buildDeviceSnapshotFromHardwareConfig()` — unused. grep: `rg -w buildDeviceSnapshotFromHardwareConfig . --glob '!node_modules' --glob '!work/sweep*'` → only the definition, plus a prose mention in `work/work-orders/579_WO_new_project_resets_gpu_port_layout.md:54`. No client, src, tools, godot or smoke test reference. It is the only user of the `copyKeys` list.
- `QUALITY` client/lib/project-hardware-mismatch.js:142-146 the JSDoc for `isLikelySameMachine` (`@param hardwareConfig, liveCtx`) sits above the `LEGACY_SAVED_HOSTNAME_RE` constants, so the function itself (line 151) has no doc. Move the block.

## client/lib/project-hardware-policy.js
- `OK`

## client/lib/project-import-flow.js
- `DEAD` client/lib/project-import-flow.js:199-202 `noteHardwareIncludedInSave()` — an empty function (comment only, body returns nothing). grep: `rg -w noteHardwareIncludedInSave . --glob '!node_modules' --glob '!work/sweep*'` → only the definition.

## client/lib/project-load.js
- `OK`

## client/lib/project-media-context.js
- `OK`

## client/lib/project-media-gather.js
- `DEAD` client/lib/project-media-gather.js:332-335 `gatherProjectMediaIntoFolder()` — unused wrapper. grep: `rg -w gatherProjectMediaIntoFolder client src tools scripts godot` → only the definition. Callers use `planGatherProjectMediaIntoFolder` and `executeGatherProjectMedia` directly.
- `RISK` client/lib/project-media-gather.js:52 `resolveRefToCatalogId()` matches `id.split('/').pop() === leaf` even when the full ref is not in the catalog. Failing case: the project references `Archive/intro.mp4` (offline drive, not in the catalog) and the catalog has an unrelated `Backup/intro.mp4`. The plan treats that file as the ref and moves it into the project folder (`idsToMove`), then rewrites the ref to it. The wrong clip ends up in the look silently. Fix: only fall back to the leaf match when exactly one catalog id has that leaf, and tell the operator about the substitution.
- `QUALITY` client/lib/project-media-gather.js:60-61 `if (inProject.length === 1) return inProject[0]` and `if (inProject.length > 1) return inProject[0]` are the same outcome; collapse them to `if (inProject.length) return inProject[0]`.
- `QUALITY` client/lib/project-media-gather.js:10 duplicates `SKIP_VALUE_RE` from project-media-context.js:26 and project-media-refs.js:5. Three copies of the same regex will drift. Export one from project-media-refs.js.

## client/lib/project-media-location.js
- `OK`

## client/lib/project-media-reconcile.js
- `RISK` client/lib/project-media-reconcile.js:57-66 `mediaExists()` counts a ref as present when only its basename exists anywhere in the index (`index.has(base)`, and the `endsWith` checks). Failing case: the project references `clips/old/intro.mp4`, the server only has an unrelated root `intro.mp4` → the banner says nothing is missing. This is the client fallback, used only when `POST /api/project/reconcile` fails or when offline, so it is fuzzy by design. Worth a comment.

## client/lib/project-media-refs.js
- `OK`

## client/lib/project-remote-sync.js
- `RISK` client/lib/project-remote-sync.js:4-15 the skip is a single boolean, set by `markLocalProjectSaved()` and cleared only by the next incoming `project_sync` (app-ws-handlers.js:220). If the save went out while the WS was down, or the server did not echo (no change), the flag stays armed and the next genuine `project_sync` from another client is silently dropped. Callers are guarded (`if (res?.changed)` in app.js:178), which narrows it but does not close it. Fix: expire the flag after a few seconds.

## client/lib/project-state.js
- `DEAD` client/lib/project-state.js:9,132 `SERVER_STORE_NAME` — exported constant that nothing imports. grep: `rg -n "SERVER_STORE_NAME|casparcg_web_project" client src tools godot` → only the definition and the export line.

## client/lib/raf-throttle.js
- `OK`

## client/lib/replication-media-spread.js
- `BUG` client/lib/replication-media-spread.js:121-146 `refreshProjectMediaParity()` expects `out.ok === false` bodies (lines 123-136, including the `peerNeedsUpdate` once-only toast) but `api.get` THROWS on any non-2xx (api-client.js:34-52), and `GET /api/replication/compare-project-media` answers HTTP 503 whenever `out.ok` is false (src/api/routes-replication-get.js:139-146). So the `!out?.ok` branch can never run. The `_warnedPeerNeedsUpdate` dedupe is bypassed and every failure lands in the `catch` (line 140-145), which toasts `HTTP 503: …` as an error every time. `onReplicationStatus()` (line 98) re-calls the refresh on every status emission (2.5 s poll plus WS push) while `_parity == null && _role === 'leader'`. Failing case: a leader with no project media whose peer is on an older build (peer manifest 404, `compareProjectMediaWithPeer` returns `ok:false`, `peerNeedsUpdate:true`, src/replication/project-media-parity.js:230-237) → a red toast "HTTP 503: peer missing project media API (404)…" every ~2.5 s for as long as the pair is up. Same for `peer unreachable` from `forcePeerPing`. Fix: handle the thrown error (`e.status === 503`, parse the `peerNeedsUpdate` flag from the error) with the once-only toast, and do not re-poll a failed parity on every status emission.
- `DEAD` client/lib/replication-media-spread.js:148-151 `noteMediaListForReplication()` — marked `@deprecated`, never called. grep: `rg -w noteMediaListForReplication . --glob '!node_modules' --glob '!work/sweep*'` → only the definition.

## client/lib/replication-status-banner.js
- `DEAD` client/lib/replication-status-banner.js:1-163 the whole module is unwired. grep: `rg "replication-status-banner" client src tools scripts index.js` → no importer; only the CSS in client/styles/08c3-modals-hardware-reconcile-banners.css:142+ (`.replication-status-banner*`), a comment in godot/client/app/connection_menu.gd:2, and the CI baseline `tools/ci/unwired-exports-baseline.json:211-212` listing `initReplicationStatusBanner` / `stopReplicationStatusBanner`. `header-bar-replication.js` and `device-view-inspector-replication-controls.js` replaced it. The CSS block is dead with it. If the file is ever wired in again, two bugs come with it: the dismiss button (line 99) is undone at the next 3 s poll because `renderBanner()` resets the className and re-renders, and `initReplicationStatusBanner()` line 152-153 re-applies a stored A/B origin on every start (conflicts with RULES.md Linked servers 4). Recommend deleting the file and the CSS, and removing the baseline entries.

## client/lib/replication-ui-state.js
- `DEAD` client/lib/replication-ui-state.js:29 `getReplicationStatus()` — unused. grep: `rg -w getReplicationStatus client src tools godot` → only the definition. Consumers use `subscribeReplicationStatus`.
- `DEAD` client/lib/replication-ui-state.js:128-133 `stopReplicationUiState()` — never called, so the poll started in `initReplicationUiState` cannot be stopped. grep: `rg -w stopReplicationUiState client src tools godot` → only the definition.

## client/lib/scene-content-fit.js
- `OK`

## client/lib/scene-layer-rotation-amcp.js
- `OK`

## client/lib/scene-live-main-sync.js
- `OK`

## client/lib/scene-live-sync.js
- `RISK` client/lib/scene-live-sync.js:52 `refreshSceneLiveFromServer()` returns early when the server's `channels` is empty, so an empty `scene.live` never clears client state, while `clearPreviewLiveOnServer` (line 67-71) does apply an empty map. Failing case: all looks cleared server-side, then a reconnect or gap-triggered refresh → the client keeps showing the stale PGM look ids. May be intentional (a transient empty reply); needs a comment or a `data.channels` presence check.

## client/lib/scene-look-kind.js
- `OK`

## client/lib/scene-look-name-commit.js
- `OK`

## client/lib/scene-route-preview-remap.js
- `OK`

## client/lib/scene-state-global-border-ops.js
- `DEAD` client/lib/scene-state-global-border-ops.js:49-51 `setGlobalBorder(sceneId, border)` mixin method, and its worker `sceneStateSetGlobalBorder` in scene-state-global-border.js:370-377. grep: `rg -w "setGlobalBorder|sceneStateSetGlobalBorder" client src tools godot` → only the two definitions and the import. All callers use `setGlobalBorderForScreen`. The per-look `scene.globalBorder` field itself is still live (migrateScene, scenes-shared.js:420, src take payload); only this setter is dead.

## client/lib/scene-state-global-border.js
- `DEAD` client/lib/scene-state-global-border.js:370-377 `sceneStateSetGlobalBorder()` — see the entry in scene-state-global-border-ops.js.
- `QUALITY` client/lib/scene-state-global-border.js:101-154 `applyRemoteGlobalBorderSlot()` keeps `local.borderPresets` and `local.pgmAirSnapshot` for an existing slot. WS state pushes (`app-ws-handlers.js:96`, source `project`) therefore never carry remote preset changes into an already-existing slot; they arrive only on a full project import. This looks deliberate (local edit guard), but there is no comment saying so.

## client/lib/scene-state-helpers.js
- `BUG` client/lib/scene-state-helpers.js:119-138 `consecutiveAlignIfNeeded()` (run by `migrateScene` on every load, every `ingestRemoteDeckScenes`, every `applyPersistedData`) closes ANY gap in layer numbers, but `removeLayer` (scene-state-layer-ops.js:45-51) leaves gaps on purpose (`nextLayerNumber` refills them, smoke-wo160 line 147) and nothing rewrites `route://` sources. Failing case, verified with node: layers `[11 'b.mp4', 12 route://1-11]` (the look had a layer 10 that was removed) → after `migrateScene` → `[10 'b.mp4', 11 route://1-11]`. The route layer now targets ITSELF and the clip it was meant to tap is on 10. It happens silently on the next reload or remote deck ingest (only a `console.warn`). Fix: renumber together with the route targets (`lookLogicalLayerNumbers` mapping), or renumber only for the legacy decade/overflow shapes the WO-160 comment describes, not for ordinary gaps.
- `QUALITY` client/lib/scene-state-helpers.js:54-57 and 108-112 two orphaned JSDoc blocks (`@returns LayerConfig` before another doc block; the `@param s / @returns Scene` block above the `consecutiveAlignIfNeeded` doc) no longer sit above the function they describe (`defaultLayerConfig`, `migrateScene`).

## client/lib/scene-state-layer-logic.js
- `BUG` client/lib/scene-state-layer-logic.js:149-151 (lead CONFIRMED) `patchLayer` first merges `patch.fill` / `patch.fadeOnEnd` into `L` (lines 140-149), then `const { startBehaviour, ...rest } = patch; Object.assign(L, rest)` copies `rest.fill` and `rest.fadeOnEnd` over the merged values, so the merge and the Infinity/NaN sanitising are thrown away. Verified with node (scratch script): `L.fadeOnEnd={enabled:false,frames:30}`, `patchLayer(L,{fadeOnEnd:{enabled:true}})` → `{"enabled":true}` (frames lost). `patchLayer(L,{fill:{x:Infinity}})` → `L.fill = {x:Infinity}` (y/scale dropped, non-finite value kept; also `L.fill` is now the caller's own object, not a copy).
  Concrete user-visible failure: inspector-mixer.js:241 sends `{ fadeOnEnd: { enabled } }` and :256 sends `{ fadeOnEnd: { frames } }`, both partial. Enable "Fade out when clip ends", then change Duration to 30 → `L.fadeOnEnd = { frames: 30 }`, `enabled` is gone, the checkbox un-ticks on re-render and take payloads (`src/engine/scene-take-payload.js:73`, scenes-shared.js:305) send `enabled:false`. Today every `fill` caller passes a full rect, so the fill half is latent (sanitising never applies, so Infinity/NaN from a div-by-zero drag reaches `MIXER FILL`). Fix: `const { startBehaviour, fill, fadeOnEnd, ...rest } = patch` and assign only `rest`.
- `QUALITY` client/lib/scene-state-layer-logic.js:55 `applyLayerStyleData` sets `L.transition = c.transition` unconditionally, so a preset without a `transition` key writes `undefined` (the getter writes `null`); every other field is guarded by `!= null`.
- `QUALITY` client/lib/scene-state-layer-logic.js:91 `importLayerPresetsFromServer(presets, list)` never uses `presets`. Lines 80-89 `uniqueLayerPresetName` and scene-state-look-logic.js:26-35 `uniqueLookPresetName` are the same function; one helper would do.

## client/lib/scene-state-layer-ops.js
- `OK`

## client/lib/scene-state-look-logic.js
- `QUALITY` client/lib/scene-state-look-logic.js:37-64 `importLookPresetsFromServer` duplicates the preset-normalising map in scene-state-persistence-logic.js:149-180 (same `sk`, same item mapping). They differ only in the scene-existence filter, so a fix in one will not reach the other.

## client/lib/scene-state-persistence-logic.js
- `BUG` client/lib/scene-state-persistence-logic.js:133-139 together with scene-state.js:460-467. `getExportData()` (used by project export and server autosave) omits `mainEditorVisibleScreenCount` and `mainEditorVisibilityMigrated`, which `getPersistPayload` writes to localStorage. On a project import `applyPersistedData` recomputes the count from the visible flags and sets `migrated=false`. Failing case, verified with node: 4 screens, operator hides Screen 4 (`mainEditorVisible=[t,t,t,f]`) → export → reload/import → count=3, migrated=false → on `scenes-tab-activated` `syncMainEditorVisibleToScreenCount(4)` takes the `n > prevCount` branch and flips index 3 back to `true`. Same for the `[t,f,f,f]` shape with 2+ screens (legacy-migration branch, line 49). The hide is lost after every reload or sync. Fix: add both fields to `getExportData`.

## client/lib/scene-state-preset-actions.js
- `QUALITY` client/lib/scene-state-preset-actions.js:53-60 and 84-91 the `items`-building loop (sourceKind → scene id per armed screen) is copied between `sceneStateSaveLookPreset` and `sceneStateOverwriteLookPreset`.

## client/lib/scene-state-preset-ops.js
- `OK`

## client/lib/scene-state-timer-ops.js
- `DEAD` client/lib/scene-state-timer-ops.js:42-48 mixin methods `ensureCanonicalLayer()` and `listTimers()` have no callers. grep: `rg -n "\.ensureCanonicalLayer\(|\.listTimers\(" client src tools godot` → none. Only the mixin wrapper and the worker functions in scene-state-timers.js (lines 92, 131) reference them. All other timer-ops methods (`createTimer`, `getTimer`, `renameTimer`, `findBoundLayers`) are called from inspector-countdown*.js.

## client/lib/scene-state-timers.js
- `DEAD` client/lib/scene-state-timers.js:92-124 `ensureCanonicalLayer()` and 131-133 `listTimers()` — only reachable through the dead mixin methods above. Its doc claims the layer is moved when taken by another layer, but for an already allocated screen (line 101) the stored number is returned without a conflict check, so reviving it would need rework first.
- `QUALITY` client/lib/scene-state-timers.js:47 `name: \`Timer #${Date.now() % 100}\`` with the comment "Will be renumbered later": nothing renumbers (grep `renumber` finds only unrelated media-rename code), and the 100-value modulus means timers created at unlucky times get the same name. The name is copied into `source.label`, so duplicates are visible. Use a counter over `sceneState.timers`.
- `QUALITY` client/lib/scene-state-timers.js:15-36 `DEFAULT_TIMER_CONFIG` is duplicated key for key in components/timer-control-panel-display.js:9-30 (whose comment says it mirrors this file). screen-timer-create.js:9 (a lib file) imports it from that component file.

## client/lib/scene-state.js
- `DEAD` client/lib/scene-state.js:283-289 `setSceneMainScope(id, scope)` — unused. grep: `rg -w setSceneMainScope client src tools godot` → only the definition. Scope is set via `addScene` opts / `duplicateScene`.
- `BUG` client/lib/scene-state.js:460-467 `getExportData()` drops `mainEditorVisibleScreenCount` / `mainEditorVisibilityMigrated`, see the scene-state-persistence-logic.js entry for the failing case and fix.
- `QUALITY` client/lib/scene-state.js:91,96 `const visChanged = …; void visChanged` — an unused value kept alive with `void`. Delete the variable.

## client/lib/scenes-preview-edit-chrome.js
- `BUG` client/lib/scenes-preview-edit-chrome.js:74 `JSON.stringify({ rects })` is escaped for AMCP with `.replace(/"/g, '\\"')` only. The repo's rule (`amcpParam` in components/scenes-shared.js:18-22) escapes backslashes first, then quotes. Failing case: a layer whose source value contains a quote or a backslash, e.g. `media/clip "x".mp4`, gives the label `L10 clip "x".mp4`, JSON `…\"x\"…`, and after the replace `…\\"x\\"…`. Caspar's AMCP parser reads `\\` as a backslash and then `"` closes the argument early → a malformed `CG … ADD/UPDATE` line inside the deferred preview batch. A backslash in a filename breaks the JSON the same way. Fix: `amcpParam(data)` (it quotes when there is whitespace; the payload always has it), or the same two-step escape.
- `RISK` client/lib/scenes-preview-edit-chrome.js:75-79 `_chromeLive.add(ch)` is set while the lines are built. If `pushSceneToPreviewImpl` then fails before `postAmcpPreviewPipeline` runs (any thrown API call, the catch at scenes-preview-push-scene.js:484 returns null), the module believes the chrome is up and every later push sends `CG UPDATE` for a CG instance that was never added, so no chrome appears until the editor is closed.

## client/lib/scenes-preview-global-border.js
- `OK`

## client/lib/scenes-preview-look-stack.js
- `DEAD` client/lib/scenes-preview-look-stack.js:54-72 `layersToClearBeforePgmTake()` — unused. grep: `rg -w layersToClearBeforePgmTake . --glob '!node_modules' --glob '!work/sweep*'` → only the definition.
- `DEAD` client/lib/scenes-preview-look-stack.js:80-91 `buildClearLookStackLayerCommands()` — unused. grep: `rg -w buildClearLookStackLayerCommands . --glob '!node_modules' --glob '!work/sweep*'` → only the definition. `allMatrixLayersOnPreviewChannel` (line 13) stays live: scenes-preview-runtime-clear.js uses it.
- `QUALITY` client/lib/scenes-preview-look-stack.js:148-155 `resolvePreviewAmcpChannel` has an `if (forcePrvBus)` branch identical to the fall-through, and `sceneState` is unused. `allMatrixLayersOnPreviewChannel` (key-regex reader) and `getOccupiedPreviewLookLayersFromState` (cell.channel/layer reader) are two readers of the same playback matrix with different rules (`playing === false` skipped in only one).

## client/lib/scenes-preview-push-scene.js
- `RISK` client/lib/scenes-preview-push-scene.js:139,335,464-466 the push result carries ONE `lastPreviewChannel`, one snapshot and one fill map, but a look scoped `all` is pushed to several mains, each on its own PRV channel. `lastPreviewCh` is overwritten per main (including with `null` on `continue`, line 139-142, so `Number(null)` = 0 is returned when the last main has no PRV bus). `sameSceneOnSamePrv` (line 145-148) compares the first main's channel with the last main's. Failing case: a 2-screen setup, look scoped `all`; every compose drag then takes the full re-PLAY path for all but the last main instead of the MIXER-only path, which is the latency the WO-comment at line 37 is trying to avoid. Not verified on the box.
- `QUALITY` client/lib/scenes-preview-push-scene.js:76-488 one 410-line function (`pushSceneToPreviewImpl`) in a file at 488 of the 500-line limit. The pip-overlay block (lines 343-385) repeats the same `buildPipOverlayAmcpLinesAll(...)` call twice with only the stale-slot call differing; `incrementalPreviewEdit` (150) and `getMediaListOnce` (119) are plain aliases.

## client/lib/scenes-preview-snapshot.js
- `OK`

## client/lib/screen-consumer-defaults.js
- `OK`

## client/lib/screen-destination-index.js
- `OK`

## client/lib/screen-label.js
- `OK`

## client/lib/screen-timer-create.js
- `OK`
