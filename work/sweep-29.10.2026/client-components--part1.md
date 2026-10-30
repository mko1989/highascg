# client/components (part 1) — sweep 29.10.2026 (batch 004)

Files: 30 · lines: 6733 · findings: 0 BUG-HIGH, 2 BUG, 22 DEAD, 9 RISK, 16 QUALITY

Method notes: every file read in full; unused imports checked mechanically for all 30 files (none); orphan exports cross-checked with `node tools/ci/check-unwired-exports.js --list` (read-only) and re-greped by hand over `client src tools scripts godot index.js .github` (excluding `client/assets/map-data.json`, `dist*`, `tools/ci/unwired-exports-baseline.json`, which only list names). Dispatch/listen pairs for the CustomEvents used in these files were checked (all alive except where noted).

## client/components/audio-mixer-console-input-groups.js
- `QUALITY` client/components/audio-mixer-console-input-groups.js:66-283 — the strip logic (cross-screen buttons, fader input/change/reset, mute, solo, route buttons, ~215 lines) is a near-verbatim copy of audio-mixer-panel-input-layers.js:59-279. The copies have already drifted: only this file guards scene-data writes with `!r.isTimelineClip` (:174,:241), the inspector copy does not (see its RISK). One shared row-controller (data/attrs differ, behaviour does not) would remove the drift.
- `QUALITY` client/components/audio-mixer-console-input-groups.js:252 — the mute handler looks the fader up with `document.querySelector(\`input[data-key="${r.key}"]\`)` (document-global, first match, key not escaped) while the live-inputs strip uses `strip.querySelector` (audio-mixer-console-live-inputs.js:245). With the Inspector panel and the console both mounted it may read the other surface's fader. Values are kept in sync by `syncFaderUI`, so low impact; use `strip.querySelector('.audio-mixer-view__fader')`.

## client/components/audio-mixer-console-live-inputs.js
- `RISK` client/components/audio-mixer-console-live-inputs.js:151 — `await disableLiveAudioPgmRoute(ch, destLayer).catch(() => {})` swallows a failed route STOP, then :152-154 still removes the persisted target and clears the active class. Failing case (non-server-routed kinds, i.e. NDI/other): `clearRouteFromChannel` rejects (AMCP/API error) → button shows OFF and localStorage target is dropped while the route keeps playing on the PGM channel; nothing is reported to the operator. The comment at :146 says "persist on success only", and the Inspector twin (audio-mixer-panel-live-inputs.js:203) lets the error propagate to the toast. Drop the `.catch`.

## client/components/audio-mixer-console-masters.js
- `OK`

## client/components/audio-mixer-cross-screen-bind.js
- `OK`

## client/components/audio-mixer-panel-input-layers.js
- `RISK` client/components/audio-mixer-panel-input-layers.js:181-186,234-239 — unlike the console copy (console-input-groups.js:174,241) the Inspector rows write `layer.muted` / `layer.volume` into `stateStore.scene.live[ch].scene.layers` without the `isTimelineClip` guard. Timeline-clip rows (audio-mixer-rows.js:156) reach this list too. If a look layer on the same channel has the same `layerNumber` as the clip's physical layer, the look's stored volume/mute is overwritten by the clip's fader. Failing state needs a layer-number collision, so RISK. Add the guard (or share the code, see QUALITY above).
- `QUALITY` client/components/audio-mixer-panel-input-layers.js:190 — same document-global `input[data-key="${r.key}"]` lookup as the console copy (:252 there); use `row.querySelector('.audio-mixer__fader-horizontal')`.

## client/components/audio-mixer-panel-live-inputs.js
- `OK`

## client/components/audio-mixer-panel-masters.js
- `OK`

## client/components/audio-mixer-panel-sync.js
- `OK`

## client/components/audio-mixer-panel.js
- `DEAD` client/components/audio-mixer-panel.js:13 — `export { syncFaderUI, syncMuteUI, syncAllSolosUI } from './audio-mixer-panel-sync.js'` has no importer. grep: `rg -n "audio-mixer-panel(\.js)?['\"]" client tools src` → only app.js:20 (`initAudioMixerPanel`) and two smokes that `readFileSync` the file (smoke-wo226-timer-overlay.test.js:181, smoke-wo381-…:176; neither asserts the re-export). The real consumers import from audio-mixer-panel-sync.js directly.
- `QUALITY` client/components/audio-mixer-panel.js:150-154 — on `highascg-live-audio-configured` the handler calls `stateStore.applyChange('liveAudioConfigured', …)`, whose `'*'` notification already re-renders (:130-143 matches `path === 'liveAudioConfigured'`), and then `onMixerRefresh()` renders again; with the console mounted too (audio-mixer-view-console.js:126-130, same pattern) one event costs up to four full rebuilds plus two redundant `applyChange` calls. Drop the explicit `onMixerRefresh()` after `applyChange`, and let only one listener apply the detail.

## client/components/audio-mixer-view-console.js
- `QUALITY` client/components/audio-mixer-view-console.js:22,132-141 — `void root` keeps an unused `root` param alive and the returned `{stop, unbindState, unbindScene, unbindSceneChange, unbindSettings}` is discarded by its only caller (audio-mixer-view.js:50). Since the view mounts once (`mounted` flag) nothing is leaked in practice, but the unbinders and `observer` (:93) are never torn down and the returned API is dead; drop the return value and the `root` param, or use them.

## client/components/audio-mixer-view.js
- `QUALITY` client/components/audio-mixer-view.js:25-27 — the header badge is hard-coded "OSC Active" with a status dot that nothing ever updates (grep `status-dot|status-badge` → this markup and 07c1-audio-mixer-view-shell-header.css only). It reads "active" while the OSC feed is down (meters flat). Either bind it to the meter loop's last-frame time or remove it.

## client/components/caspar-config-modal.js
- `BUG` client/components/caspar-config-modal.js:113-118 — the Escape listener is added per open and removed only when Escape itself is pressed. (1) After the modal is closed any other way (Close, Cancel, backdrop, or the 600 ms auto-close after Apply, :140), the listener stays; if the modal was closed dirty (Apply with edited XML, or Discard confirmed) `editing && textarea.value !== proposalXml` is still true, so the next Escape anywhere (closing another modal, leaving a field) pops `confirm('Discard your edits? …')` for a modal that no longer exists. (2) If the user presses Escape on a dirty modal and answers Cancel in the confirm, `tryClose()` returns but the listener has already been removed (:116 runs unconditionally), so Escape no longer closes this modal. Fix: remove the listener inside `modal.remove()` paths (one `close()` helper) and only after a successful close.

## client/components/cg-only-look-deck-thumb.js
- `DEAD` client/components/cg-only-look-deck-thumb.js:18 — `export function drawAlphaCheckerboard` is used only inside this file (:147); no importer. grep: `rg -n "drawAlphaCheckerboard" client src tools godot` → definition and the internal call. Drop `export`.
- `DEAD` client/components/cg-only-look-deck-thumb.js:205 — `clearCgOnlyLookDeckThumbCache` ("Test hook") has no caller, test or otherwise. grep: `rg -n "clearCgOnlyLookDeckThumbCache" client src tools godot scripts` → the definition only. Remove or wire into a project-switch/reset path (see QUALITY below).
- `RISK` client/components/cg-only-look-deck-thumb.js:130-132,198 — a failed `/api/cg-thumb/render` (server restarting, template not ready) sets `entry.error = true` and the repaint condition `!entry.img && !entry.loading && !entry.error` never retries that key; the thumb shows the grey "CG" placeholder until the page is reloaded or the layer's data changes. Retry once after a few seconds, or don't cache errors.
- `QUALITY` client/components/cg-only-look-deck-thumb.js:11,168 — `layerThumbCache` is never evicted (the only clear is the dead hook above) and its key is `JSON.stringify` of the full `cgData` + size, so every edit of a lower-third text creates a new entry holding a decoded `HTMLImageElement`; `cacheKey` is also recomputed (stringify) for every layer on every deck repaint. Bound the Map (LRU) and key on a cheap hash.

## client/components/cg-studio-tab.js
- `DEAD` client/components/cg-studio-tab.js:16 — `export function cgStudioIframeSrc` is used only by `ensureIframe` in the same file (:31). grep: `rg -n "cgStudioIframeSrc" client src tools` → definition + that call. Drop `export`.

## client/components/companion-button-picker-modal.js
- `RISK` client/components/companion-button-picker-modal.js:14-30,150 — when Companion previews are unavailable (`renderGrid([])` blind grid after a failed subscribe, :191/:211) each of the 64 cells starts `loadPreviewImgWithRetry` with 15 retries every 400 ms: ~960 failing `GET /api/companion/button-preview/<page>/<row>/<col>.jpg` over ~6 s (≈160 req/s) through the node that also drives playout, on every page flip/refresh, and the retries keep running after the modal is closed or the grid is re-rendered (detached `<img>`, timers never cancelled). Make the retry cancelable (`close()` / next `renderGrid`), back off, and skip image loading entirely when `sub.ok` was false.
- `RISK` client/components/companion-button-picker-modal.js:176-206 — `loadPage` has no re-entrancy/closed-modal guard. Two quick "Next" clicks run two interleaved `unsubscribe`→`subscribe` sequences; the later `sessionId = sub.sessionId` wins and the other session is never unsubscribed. Closing the modal while `subscribe` is in flight stores a `sessionId` after `close()` already ran (:117-123), so that Companion preview session is never released. Failing case: open the picker and close it within the first second. Server-side cleanup of idle sessions is outside this file, hence RISK. Add a `closed` flag and a load token.
- `QUALITY` client/components/companion-button-picker-modal.js:78,233-241 — the page field is `type="text" inputmode="numeric"` with `parseInt`: it holds a number but does not evaluate maths (RULES.md input rule 2) and does not select its value on focus (rule 1). Use `attachMathInput(pageInp, {min:1, decimals:0})`.

## client/components/connection-eye.js
- `QUALITY` client/components/connection-eye.js:277-286 (with :304-308) — the `FETCH_MIN_MS` throttle can never trigger: the `mouseenter` handler first sets `tip.textContent = 'Loading…'` and `loadHostStats()` only returns early when `tip.textContent !== 'Loading…'`. So `lastFetch` is dead state and every hover refetches `/api/host-stats` and blanks the previous values. Either keep the last text on re-enter (set 'Loading…' only when empty) or delete the throttle.

## client/components/device-view-actions.js
- `DEAD` client/components/device-view-actions.js:37 `applyDeviceSnapshot()` — grep: `rg -n "applyDeviceSnapshot" client src tools scripts godot` → definition only (the server route `/api/device-snapshot/apply` exists; this client wrapper has no caller).
- `DEAD` client/components/device-view-actions.js:45 `buildDeviceSnapshotEnvelope()` — grep → definition only (the server route `/api/device-snapshot/build` exists in src/api/routes-device-snapshot.js; this client wrapper has no caller).
- `DEAD` client/components/device-view-actions.js:128 `getCasparConfigOverride()` — grep → definition only. caspar-config-modal.js's header says "no saved override", consistent with this being a leftover.
- `DEAD` client/components/device-view-actions.js:132 `saveCasparConfigOverride()` — grep → definition only.
- `DEAD` client/components/device-view-actions.js:150 `syncDeviceGraphFromLive()` — grep → definition only (the comment at :154-156 even says "Avoids syncFromLive here").
- `DEAD` client/components/device-view-actions.js:278 `getPgmRecordStatus()` — grep → definition only.
- `QUALITY` client/components/device-view-actions.js:138 — `api.get('/api/caspar-config/generate' + q, { type: 'text' })`: `apiGet(path)` (lib/api-client.js:19) takes one parameter, so the options object is silently ignored; the call only works because the route answers `application/xml` and `apiGet` falls back to `res.text()`. Drop the dead argument (or make `apiGet` honour it).

## client/components/device-view-bands-render.js
- `DEAD` client/components/device-view-bands-render.js:34-199 `renderDeckLinkBand` — never called. grep: `rg -n "renderDeckLinkBand" client src tools scripts godot` → definition only. Only `renderBands` (:323) is imported (device-view-render.js:5), and it calls just `renderMappingsBand` + `renderCasparBand(Simple)`.
- `DEAD` client/components/device-view-bands-render.js:201-231 `renderStreamingBand` — definition only (same grep).
- `DEAD` client/components/device-view-bands-render.js:233-271 `renderVirtualCamBand` — definition only.
- `DEAD` client/components/device-view-bands-render.js:273-303 `renderRecordingBand` — definition only.
- `DEAD` client/components/device-view-bands-render.js:18-32 `addPortNodeDot` — local helper used only by the four dead renderers above; device-view-mappings-render.js:7 has its own identical copy. Together with the four renderers ~270 of the file's 495 lines are dead (and `decklinkInputState`, `stateClass`, `normalizeDecklinkIoDirection`, `appendCableAffordance` imports go with them).
- `DEAD` client/components/device-view-bands-render.js:461-487 `onApplyGpuSettings` — handler in `internalCtx` that nobody reads. grep: `rg -n "onApplyGpuSettings" client src tools godot` → this definition only. It is also the only client caller of `Actions.applyOsSettings` (device-view-actions.js:70), which becomes dead with it.
- `DEAD` client/components/device-view-bands-render.js:356-364,365-373,386-394,416-438 `onRemoveStreamOutput`, `onRemoveRecordOutput`, `onRemoveAudioOutput`, `onRemoveVirtualCamOutput` — in `internalCtx` but never read by the code that receives it (`renderMappingsBand`, `renderCasparBand`, `renderCasparBandSimple` only read `onAdd*`, `onAddMappingNode`, `mappingPersist`). The inspectors get their remove callbacks from `ctx.remove*Connector` (device-view-selection.js:126-129 → device-view-cable-outputs.js:89-154), which duplicate this logic.
- `DEAD` client/components/device-view-bands-render.js:305 — `export function appendSegment` is used only inside `renderBands` (:489,:492); no importer (grep `appendSegment` → this file only). Drop `export`.

## client/components/device-view-cable-affordance.js
- `OK`

## client/components/device-view-cable-outputs.js
- `OK` — (same undo-stack leak as device-view-cable.js, see the BUG there: `ctx.removeEdge` :12 pushes undo before a call that may fail.)

## client/components/device-view-cable.js
- `BUG` client/components/device-view-cable.js:337 (also :259, and device-view-cable-outputs.js:12) — `ctx.pushUndo()` runs before the server mutation and the snapshot is never popped when the mutation is rejected or throws. Failing case: arm a cable and click a sink the server refuses (`res.error` → :378-388 returns, or the `catch` at :446) → `undoStack` now holds a snapshot identical to the current graph. The next "Undo" restores that no-op (it still calls `saveSettingsPatch`, `setCasparRestartDirty(true)` and a full reload, "Undo successful") and the operator must press Undo again to undo the real previous action. Fix: pop the entry on every failure path (push after the first successful write, or `undoStack.pop()` in the error branches).
- `QUALITY` client/components/device-view-cable.js:295 — the failure toast always says "original connection restored", but the rollback `addCable` (:269-277) swallows its own errors (`catch { /* surfaced below */ }`), so a failed rollback still reports success; the forced `ctx.load()` shows the truth a moment later. Track `rolledBack` and word the message accordingly.

## client/components/device-view-cables-physics.js
- `RISK` client/components/device-view-cables-physics.js:140-209 — each cable (re)build runs 200 iterations × 6 substeps × three constraint passes over N≥30 points (~200k `Math.hypot` per cable, ~2-4 ms each), and `getOrBuild`'s cache key includes the endpoint coordinates to 0.1 px (:216), so any layout change (window resize, panel drag, scroll of a transformed container) misses the cache for every cable and rebuilds all of them. With ~15 cables that is a 30-60 ms frame stall per resize step (renderCableOverlay is raf-throttled, tools/smoke/smoke-wo313-cable-resize-raf.test.js, which bounds it to once per frame but not its cost). Reduce iterations when the delta is small, or reuse the previous solution as the warm start.
- `QUALITY` client/components/device-view-cables-physics.js:42,125,130,135 — `slackFactor` is a `let` that is never reassigned ("Slack factor disabled", = 1.0), so the three `* (… ? 1.0 : slackFactor)` terms are no-ops; drop them.
- `QUALITY` client/components/device-view-cables-physics.js:214-223 — `cableCache` is never pruned: cables that are removed keep their point arrays for the life of the page; entries are keyed by edge id so growth is slow, but it is unbounded. Delete entries for ids not in the current graph at the end of each `renderCableOverlay`.

## client/components/device-view-cables.js
- `RISK` client/components/device-view-cables.js:93-96 — `connectorCenter` falls back to `[data-real-ids*="${connId}"]`, a SUBSTRING match against the comma-joined RandR pair names written at device-view-caspar-render-markers.js:309 / -simple.js:72. A lookup of `DP-1` also matches a dot whose pairs are `DP-10,DP-11` (multi-GPU / many-output boxes). The candidate list puts exact `data-connector-id` matches first, but the "prefer a dot" step (:99-104) picks the first dot-class element anywhere in the merged list, so when the exact match is a non-dot container a wrong dot can win and the cable is drawn to the wrong port. Match tokens (`~=` on a space-separated attribute, or split on `,`).

## client/components/device-view-caspar-rear-data.js
- `QUALITY` client/components/device-view-caspar-rear-data.js:14-155 — presented as "shared rear-panel connector data for classic backplane and simple node layout" but only the simple layout uses it (`rg buildCasparRearPanelData` → device-view-caspar-render-simple.js:98); `renderCasparBand` repeats the same ~150 lines inline (device-view-caspar-render.js:49-198). The copies have drifted: WO-373's `resolvedSource` for stream/record items exists only in the classic copy (render.js:84-92,164,183), `devicePath` for USB/virtual cam only here (:96,:111). Have `renderCasparBand` call `buildCasparRearPanelData` and merge the two extras.

## client/components/device-view-caspar-render-gpu-doc-listeners.js
- `DEAD` client/components/device-view-caspar-render-gpu-doc-listeners.js:8-66 — `onGpuLayoutChanged`, `ensureDocumentListenersOnce` and `bindCasparGpuLayoutDocumentListeners` handle a `document` event `gpu-layout-changed` that nothing dispatches. grep: `rg -n "gpu-layout-changed" . --glob '!work/**' --glob '!dist*' --glob '!client/assets/map-data.json'` → only the `addEventListener` at :57 (client, src, tools, godot, scripts searched; `rg "gpu-layout-"` in client finds nothing else, so no constructed name). Its siblings `gpu-layout-save` / `gpu-layout-export` mentioned in work/archive/sweep1.md are gone too; the file's live content is just `saveGpuLayoutToStorage` (:69) and `exportGpuLayoutFile` (:74), both used by device-view-caspar-render.js and the GPU layout editor.

## client/components/device-view-caspar-render-helpers.js
- `OK`

## client/components/device-view-caspar-render-markers.js
- `DEAD` client/components/device-view-caspar-render-markers.js:64,173 — `labelHtml` is read (and injected raw via `innerHTML` at :173) but no producer exists anywhere. grep: `rg -n "labelHtml" client src tools godot scripts --glob '!client/assets/map-data.json'` → only readers (markers.js:64,173; render-simple.js:205; godot/client/features/devices/node_view_model.gd:74, a port of the same fallback). Always falls through to `escapeHtml(it.label)`. Remove the field; as written it is an unescaped-HTML sink waiting for the first item that sets it.
- `RISK` client/components/device-view-caspar-render-markers.js:188,245 — rear-panel markers are `<button>` elements made `draggable`. The owner/session memory note "Firefox breaks native drag on buttons" records that native drag on / inside a `<button>` is unreliable in Firefox (use Pointer Events), and the web UI is still opened in Firefox, so DeckLink reorder and GPU layout reorder (and the drag-to-connect payloads at :193-196) may silently not start there. Needs a Firefox check; not verified here.
- `QUALITY` client/components/device-view-caspar-render-markers.js:15-24 — the default DeckLink reorder picks `p1..p4` by `String(it.label).includes('1'|'2'|'3'|'4') || it.index === n`, i.e. by label substring. A label like "SDI 12"/"DeckLink 8K Pro 2" can satisfy two roles, and `p1..p4` may then be the same item, producing a duplicated/missing marker order. Use `it.index` only.
- `QUALITY` client/components/device-view-caspar-render-markers.js:264 — the GPU `drop` handler does `JSON.parse(data)` without try/catch (the DeckLink handler at :208-213 has one); a foreign drag carrying the same MIME type throws inside the event handler.

## client/components/device-view-caspar-render-simple.js
- `DEAD` client/components/device-view-caspar-render-simple.js:205 — `it.labelHtml` is never set (see markers.js DEAD above); the `.replace(/<[^>]+>/g, '')` that strips tags from it is therefore only ever applied to plain labels.
- `RISK` client/components/device-view-caspar-render-simple.js:219-229 — the simple-view DeckLink nodes are `<button>` + `draggable = true` (same Firefox caveat as markers.js:188). Unverified in Firefox.

## client/components/device-view-caspar-render.js
- `DEAD` client/components/device-view-caspar-render.js:107-116 — the call to `bindCasparGpuLayoutDocumentListeners({...})` (and the context object it builds) wires a listener for an event nobody dispatches (see gpu-doc-listeners DEAD). Remove together with that file's dead half.
- (duplication of `buildCasparRearPanelData`, :49-198, is reported under device-view-caspar-rear-data.js)

## client/components/device-view-destinations-inspector-form.js
- `OK` — number fields use `attachMathInput` (RULES input rule 2); the capture-phase commit makes the site `change` handlers see the evaluated value. Standard vs custom video-mode handling consistent.
