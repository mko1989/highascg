# client/components (part 5) — sweep 29.10.2026 (batch 008)

Files: 27 · lines: 6828 · findings: 0 BUG-HIGH, 11 BUG, 9 DEAD, 6 RISK, 30 QUALITY (6 files OK)

Notes on method: every file read in full. Dead-code greps covered `client/ src/ tools/ scripts/ .github/ package.json vite*.config.js` plus html `<script>` tags and `tools/ci/unwired-exports-baseline.json` (WO-367 ratchet; entries already listed there are marked "baseline-known"). `client/components/map-explorer.js` is the Pages-only code-map viewer (built by `npm run build:map`, `client/map.html`, `.github/workflows/pages.yml`); it is exempt from the 500-line rule in `tools/ci/check-max-file-lines.js` (1059 lines, deliberate).

## client/components/live-audio-mixer-modal.js
- `BUG` client/components/live-audio-mixer-modal.js:150, 254-284 — after "Remove", a hidden slot keeps its old localStorage route targets, and the next "+ Add" shows them as already routed. Failing case: 3 saved inputs, slot 3 routed to PGM ch 1; remove input 1 (handler clears slot 1, re-sets slots 1-2 from the DOM, but never touches stored slot 3); `renderSlotRows(nextUi)` renders hidden row 3 with `ui.routeTargets[2]` undefined, so `|| getMultiPlayTargets(3)` returns the stale `[{channel:1}]`; click "+ Add" → `readUiFromDom()` reads the active class from the hidden row, so the "new" input 3 appears with "PGM ch 1" pre-selected and, once a device is picked and Save runs, is routed to PGM. Fix: clear `setMultiPlayTargets`/`clearMultiPlayTargets` for slots `newSlots.length+1..LIVE_AUDIO_MAX_SLOTS` in the remove handler (Save already does this for `ui.count+1..MAX` at :312-315).
- `BUG` client/components/live-audio-mixer-modal.js:204, 306-310 — the "Label" field is a no-op. `renderPanel()` does `labels.push('')` for every slot, so the field is blank every time the modal opens and after every Save; `setPlayTarget(i, {label})` is the only place the typed label goes (localStorage `highascg_live_audio_play_targets`), and nothing reads it: `rg -n "getPlayTarget|resolvePlayTarget|getAllPlayTargets" client src tools` → only definitions and internal calls in `client/lib/live-audio-play-targets.js` (`resolvePlayTarget` has no caller); `buildLiveAudioConfigBody` does not send labels. Failing case: type "Mic A", Save, reopen → empty field, label shown nowhere; Save again → the stored label is overwritten with `undefined`. Fix: either persist it server-side (and render it) or remove the field; the `setPlayTarget` writes (:306-311, `clearPlayTarget` at :255/:266/:314) are write-only dead state either way.
- `QUALITY` client/components/live-audio-mixer-modal.js:99 — `const cm = stateStore.getState()?.channelMap || {}` in `readUiFromDom` is never used.
- `QUALITY` client/components/live-audio-mixer-modal.js:58-64 — the Escape listener is removed only by the Escape path; closing via ✕ (:54) or overlay click (:55-57) leaves a stale `keydown` listener on `document` until the next Escape press (self-removes then). Harmless but leaks one listener per open/close; `live-input-modal.js` does it right (`close()` removes it).

## client/components/live-input-modal-shell-v4l2.js
- `OK`

## client/components/live-input-modal-shell.js
- `DEAD` client/components/live-input-modal-shell.js:66-101, 469-470 — the generic "Channel / Layer" row (`chRow`, `chInput` `#live-input-ch`, `layerInput` `#live-input-layer`) can never be seen: `live-input-modal.js:219` forces `chRow.style.display = 'none'` for every kind and nothing else shows it. The values are only read for a validity check in `live-input-modal-submit.js:67-72` and are never sent. grep: `rg -n "live-input-ch\b|live-input-layer\b|chInput|layerInput" client tools` → only shell, modal (`defaultCh`, `suggestLiveInputChannel`) and submit. Remove the row, `suggestLiveInputChannel`, and the submit validation together (smoke `tools/smoke/smoke-wo232-template-tick.test.js` reads these three files as text but pins only the template/browser strings, not the channel row).
- `DEAD` client/components/live-input-modal-shell.js:471 — `statusText: statusEl` alias is unused: `rg -n "statusText" client/components` finds no `elements.statusText` consumer (submit uses `elements.statusEl`).
- `QUALITY` client/components/live-input-modal-shell.js:270 — hint hard-codes "1920x648 on this box"; box-specific text in a generic modal that goes stale on any other display layout.

## client/components/live-input-modal-submit.js
- `DEAD` client/components/live-input-modal-submit.js:67-72 — `ch` / `layer` are parsed from the hidden (never displayed) channel/layer inputs and only used for the "Invalid channel/layer" guard; neither value reaches any `item`/API body in the ndi, browser_display, browser, live_audio or usb_video branches. The guard can only fire if the hidden default is corrupted. See the shell entry.
- `QUALITY` client/components/live-input-modal-submit.js:83 — NDI display-name regex (`name.substring(6).replace(/\/"([^"]+)"/, ' $1')`) is duplicated verbatim in `live-input-modal.js:351`; extract one helper.
- `QUALITY` client/components/live-input-modal-submit.js:96, 137, 187 — `r.casparRestartRecommended || r.pendingApply` dereferences `r` without `?.` while the lines right above and below use `r?.`; a null/empty POST reply would throw into the catch and show an error although the source was added. (Server `routes-device-view.js:211-250` always returns an object, so latent only.)

## client/components/live-input-modal.js
- `QUALITY` client/components/live-input-modal.js:38-42, 238, 257 — `channelMap` is computed once at open and used by `syncLiveAudioSlotHint` / `syncV4l2SlotHint`, while the DeckLink path correctly recomputes via `decklinkChannelMap()` (:44-49). After `settingsState.load()` resolves (:327) or a later channel-map change, the live-audio / USB hints keep saying "Apply Caspar config if this is a new channel" from the stale map. Use `decklinkChannelMap()` (rename) in those two hints.
- `DEAD` client/components/live-input-modal.js:20-28, 42, 51, 60, 219 — `suggestLiveInputChannel`, `defaultCh` and `chRow` only serve the permanently hidden channel row (see shell entry).
- `QUALITY` client/components/live-input-modal.js:160-161 and 5 similar sites — `hintEl.textContent = ''` immediately followed by `hintEl.innerHTML = …` is redundant.

## client/components/live-view.js
- `BUG` client/components/live-view.js:23-27 — initial audio state ignores the persisted mute. `setup()` creates the view with `audioEnabled: streamState.activeAudioSource === streamName`, while the subscription (:31-37) uses `focused && !muted`. Failing case: `localStorage.highascg_monitoring_muted === 'true'` (default `activeAudioSource` is `pgm_1`), open the compose preview → the PGM `<video>` is created un-muted (`webrtc-client.js:105` `video.muted = !audioEnabled`) and stays so until the next `streamState.notify()` (poll tick) corrects it. Same for every `updateStream()` → `setup()` (:44-48). Fix: `audioEnabled: isAudioFocused && !streamState.monitoringMuted`.
- `QUALITY` client/components/live-view.js:60-66 — JSDoc of `initDualComposeLiveView` says `{ destroy }` but the object also carries `kind: 'dual'` and `updateStreams()`, both used by `preview-canvas-panel.js:339`.

## client/components/load-project-modal.js
- `QUALITY` client/components/load-project-modal.js:268 — `importDeps(_entry)` takes an argument it never uses (call at :288 passes `entry`).

## client/components/logs-modal-filter.js
- `QUALITY` client/components/logs-modal-filter.js:83 — `const categoryDrop = modal.querySelector('#logs-category-drop')` is never used in `attachLogsCategoryFilter`.

## client/components/logs-modal.js
- `BUG` client/components/logs-modal.js:245-252, 296-310 — a live line arriving while the history request is in flight discards the whole history. `loadInitialHighas()` sets the pane text to the placeholder `'(loading…)'`; the WS `log_line` handler (`setupWsLivePush`, already subscribed) calls `appendHighLine`, whose first branch replaces the placeholder with that one line (:245-246); when `/api/logs` returns, `if (preHigh.textContent === '(loading…)')` (:305) is false, so the 500 history lines are never shown. Failing case: open the logs modal (or toggle a category/level filter, which calls `scheduleFilterReload` → same function) on a server that logs more than once per round-trip → pane shows only the live tail. Fix: keep a `loading` flag instead of comparing text, buffer WS lines during the load, and prepend history.
- `BUG` client/components/logs-modal.js:199-218, 324 — the raw AMCP echo/reply is wiped by the 2 s poll. `sendRawAmcpCommand` writes `>> cmd` and `<< reply` into `#logs-pre-caspar`, but `loadCasparLog()` (called every `POLL_MS` unless "Pause" is ticked) overwrites `preCaspar.textContent` with the log-file tail (:324-326). Failing case: type `VERSION` + Enter → the reply is visible for at most 2 s. Fix: render the AMCP transcript in its own element, or pause the poll for a few seconds after a send.
- `QUALITY` client/components/logs-modal.js:268 — `appendHighLine(record?.line || String(payload))`: for an object payload without `line`/`message`, `recordFromWsPayload` returns `line: ''` and the fallback prints `[object Object]`.
- `QUALITY` client/components/logs-modal.js:250-252 — every appended line re-reads `textContent` and `split('\n')`s up to 2000 lines (O(n) per line, plus a full text-node rewrite on each `+=`); under a busy log this is the hot path. Use a line-array buffer or trim only when a counter passes the cap.

## client/components/map-explorer.js
- `BUG` client/components/map-explorer.js:719-720 — picking a search result throws. `selectSearchResult()` runs `this.flatGraphBtn.classList.remove('active')`, but `flatGraphBtn` is never assigned anywhere (`rg -n "flatGraph|FlatGraph" client` → only :719-720, :850 and the css class). Failing case: Ctrl+K, type a query, Enter (or click a result) → `closeSearch()` has already run, then `TypeError: Cannot read properties of undefined (reading 'classList')`, and `navigateToPath` below is never reached, so search never navigates. Fix: delete the two flat-graph lines (the feature is gone: `renderLevel` only removes the css class).
- `BUG` client/components/map-explorer.js:1020 — "Copy Link" builds `window.location.origin + '/map' + hash`. The viewer is deployed at `_site/map/` of the project Pages site, whose base is `/highascg/` (`docs/_config.yml` baseurl `/highascg/docs`, `.github/workflows/pages.yml`), so the copied URL is `https://<user>.github.io/map#/…` (404). Fix: `location.origin + location.pathname + hash`.
- `BUG` client/components/map-explorer.js:944-951 — breadcrumb click calls `this.updateHash()` before the path changes, so it pushes the OLD (deeper) hash; `navigateToPath` then moves up without touching the URL. Failing case: drill to Layer 4, click the Layer 2 breadcrumb → view shows Layer 2, address bar still `#/…/layer4`; reload jumps back to Layer 4. (`navigateUp` at :810-817 pops first, which is why it works.) Fix: set `this.path = newPath` (or build the hash from `newPathIds`) before `pushState`.
- `BUG` client/components/map-explorer.js:301-311, 395-402 — dependency edges are mispositioned whenever zoom is not 100%. `getCardAnchor` measures with `getBoundingClientRect()` (screen px, already multiplied by `panZoom.scale`) but the `#map-edges` SVG carries the same `scale()` transform (`applyTransform`, :154-162), so the scale is applied twice. `renderLevel` calls `resetView()` first so the default path is fine, but the "show edges" / "cross-module" toggles and the window `resize` handler call `renderEdges()` at any zoom. Failing case: zoom to 200%, toggle "cross-module" → edges drawn at 2x offset. Fix: divide the anchors by `panZoom.scale`.
- `RISK` client/components/map-explorer.js:744-756 — `handleHashChange()` dereferences `this.data.root`; the `popstate` listener is bound in the constructor (:522) before `init()` has fetched the data, so a Back/Forward during loading throws.
- `QUALITY` client/components/map-explorer.js:664-682 — `highlightText` builds `regex` and then immediately clones it into `re`; the clone is redundant.

## client/components/media-folder-picker-modal.js
- `OK`

## client/components/media-hap-encode-modal.js
- `OK`

## client/components/media-multi-rename-modal.js
- `QUALITY` client/components/media-multi-rename-modal.js:38-40 — the three `type="number"` fields (from / step / digits) don't call `attachMathInput`, so they don't evaluate `+ - * /` as RULES.md "Input fields" rule 2 requires (other modals such as `live-input-modal-shell.js` and `multiview-editor.js` do).

## client/components/multiview-editor-canvas-apply.js
- `QUALITY` client/components/multiview-editor-canvas-apply.js:54-73 — on a 404 from `/api/multiview/apply` the legacy `/api/multiview` fallback is tried; if THAT fails with a non-404 error (503/500), the code only `console.error`s and then falls through to the alert "Multiview apply route is missing on this server build" (:72), which is wrong for that case. `fallback404` is computed but only gates the console line.

## client/components/multiview-editor-canvas-draw.js
- `OK`

## client/components/multiview-editor-canvas-interaction.js
- `QUALITY` client/components/multiview-editor-canvas-interaction.js:10-13 — `canvas.width = w` with the fractional `getBoundingClientRect()` size: the property truncates, so `canvas.width !== w` is true on every call and the bitmap is re-allocated (and cleared) each refit; there is also no `devicePixelRatio` handling (blurry on HiDPI). Round `w`/`h` before comparing.
- `QUALITY` client/components/multiview-editor-canvas-interaction.js:37, 57 — `getCellAt(…, cm)` / `getResizeHandle(…, _cm)` pass or accept a channel-map that `getCellOuterRect(cell)` ignores.

## client/components/multiview-editor-canvas-layout.js
- `QUALITY` client/components/multiview-editor-canvas-layout.js:133-146 vs 220-233 — `getContainedVideoRect` re-implements `stageLabelSizeForCellInnerH` line for line (dock/title/maxChrome/clamp). The file comments say this must mirror the server's `chromeReserveForCellLayout`; two client copies can drift. Call `stageLabelSizeForCellInnerH(innerH, ovType, showTimersUnderLabels)` from `getContainedVideoRect`.

## client/components/multiview-editor-canvas.js
- `QUALITY` client/components/multiview-editor-canvas.js:9, 17 — the barrel re-exports `getCellOuterRect` and `getContainedVideoRect`, but no importer of the barrel uses them (`multiview-editor.js:12` and `inspector-fill.js:13` import other names; `draw.js` imports `getContainedVideoRect` straight from `-layout.js`). Drop the two re-exports.

## client/components/multiview-editor.js
- `DEAD` client/components/multiview-editor.js:356-361 — `root._multiviewCleanup` is assigned but never called: `rg -n "_multiviewCleanup" client src tools scripts` → only this line. It is also incomplete (it does not unsubscribe `streamState.subscribe`, `settingsState.subscribe`, the three `multiviewState.on(...)` handlers or the `ResizeObserver`), so it would not make a second `initMultiviewEditor` safe. `initMultiviewEditor` is called exactly once (`client/app.js:325`). Delete it or make it real.
- `RISK` client/components/multiview-editor.js:285 — `canvas.onclick` calls `multiviewState.setAudioActiveCell(c.id)` for every click, including the click that follows releasing a drag/resize on the same cell. Each fires `audio-change` → `applyMultiviewAudioFocus()` → `streamState.setAudioSource('multiview')`, `setMuted(false)` and a `POST /api/multiview/audio-focus` (MIXER VOLUME on the multiview channel). Moving a cell therefore also un-mutes the operator monitor and re-posts audio focus. Confirm this is intended.
- `QUALITY` client/components/multiview-editor.js:83 — `prevVal` is read and never used.
- `QUALITY` client/components/multiview-editor.js:192-201 vs 224-233 — the snap-candidate lists (`xCandidates`/`yCandidates`, thresholds) are built identically in the move and resize branches of `onmousemove`; extract once per drag.
- `QUALITY` client/components/multiview-editor.js:64, 110-114, 179-188, 283-311 — dense multi-statement one-liners (drop handler is ~28 statements on a handful of lines) make the file hard to review; the drop logic belongs in a named function in the canvas helper files.

## client/components/pixel-map-editor-canvas.js
- `RISK` client/components/pixel-map-editor-canvas.js:215-256 — `mousemove`/`mouseup` are bound on the canvas only. Releasing the button outside the canvas (e.g. over the toolbar) never clears `dragMode`; moving back in continues the move/rotate/pan with no button held. Bind `mouseup` (and the move handler during a drag) on `window`, or add `mouseleave`.
- `DEAD` client/components/pixel-map-editor-canvas.js:6-7 — `HANDLE_SIZE` and `ROTATE_HANDLE_DIST` are exported but only used inside this file (`rg -n "HANDLE_SIZE|ROTATE_HANDLE_DIST" client` → the `HANDLE_SIZE` hit in `multiview-editor-canvas-interaction.js` is that file's own local constant). `ROTATE_HANDLE_DIST` is baseline-known in `tools/ci/unwired-exports-baseline.json`; `HANDLE_SIZE` is masked from the ratchet only by the name collision.
- `QUALITY` client/components/pixel-map-editor-canvas.js:134-163 — magnetism threshold is a fixed 12 canvas units regardless of zoom (the multiview editor uses `10 / scale`), so snapping is far too sticky when zoomed out and too weak when zoomed in.

## client/components/pixel-map-editor.js
- `OK`

## client/components/pixel-mapping-browser.js
- `DEAD` client/components/pixel-mapping-browser.js:6 `renderMappingBrowser()` — never called; the whole file is dead. grep: `rg -n "renderMappingBrowser|pixel-mapping-browser|mapping-browser" client src tools scripts --include=*.js --include=*.html` → only the definition and the css class in `client/styles/03d-mapping-editor.css` (`.mapping-browser*`, also dead). Baseline-known (`unwired-exports-baseline.json:38`). The drag payload `application/x-highascg-mapping-template` has no drop target anywhere.
- `RISK` client/components/pixel-mapping-browser.js:113, 119, 140 — if this file is ever re-wired: `stateStore.setState({ mappingTemplates })` REPLACES the whole store (`state-store.js:93-97` `this._state = { ...full }`), wiping `channelMap`, `media`, `scene`, … on every add/delete/edit. It should use `stateStore.applyChange('mappingTemplates', templates)`.
- `BUG` client/components/pixel-mapping-browser.js:135 — (latent, file is dead) `if (univ) patch.universe = parseInt(univ)` accepts any non-empty string: entering `abc` stores `NaN` (serialised as `null`). Same for width/height only being guarded by `if (w && h)`. Also `parseInt` without radix and `.then()` without `.catch()` at :139.

## client/components/placeholder-modal.js
- `QUALITY` client/components/placeholder-modal.js:50-53, 91, 98 — the "Duration (seconds)" group is permanently `display:none`, so every placeholder gets the 60 s fallback; either show it or drop the field and the `attachMathInput` at :74.
- `QUALITY` client/components/placeholder-modal.js:9-13 — the toggle-close path (`existing.remove()`) does not remove the old modal's `document` keydown listener (:83); it leaks until the next Escape.
- `QUALITY` client/components/placeholder-modal.js:94 — reaches the singleton through `window.placeholderState` (set in `app.js:78`) although `placeholder-state.js` is already imported for `PLACEHOLDER_TEMPLATES`; import `placeholderState` directly.

## client/components/playback-timer-format.js
- `RISK` client/components/playback-timer-format.js:10-15 — `formatHmsf` mishandles non-integer fps: `ff = Math.min(f - 1, Math.floor(frac * f))`. Failing case: `formatHmsf(5.99, 29.97)` → `Math.min(28.97, 29)` = `28.97` → `"00:00:05:28.97"` (same for 59.94 / 23.976 in the last ~3% of each second). Currently unreachable: nothing passes `format: 'hmsf'` (`rg -n "hmsf" client` → only this file), so it is latent. Use `Math.min(Math.ceil(f) - 1, …)`.
- `QUALITY` client/components/playback-timer-format.js:79 — `paintPlaybackDisplay(ctx, displayFile, _layerNum)` ignores its third argument (both callers pass it).

## client/components/playback-timer.js
- `DEAD` client/components/playback-timer.js:35-87 `mountPlaybackTimer()` — never called. grep: `rg -n "mountPlaybackTimer" client src tools scripts .github` → only the definition (smoke tests use `mountPgmTopLayerPlaybackTimer`, `pickTopLayer*`, `idleLayerContentLabel`). Baseline-known (`unwired-exports-baseline.json:40`). With it gone, the `format` option of `mountPgmTopLayerPlaybackTimer` is never set by `app-pgm-header-timer.js:75` / `scenes-editor.js:202`, so the `'hmsf'` branch of `paintPlaybackDisplay` and `formatHmsf` become unreachable too.
- `DEAD` client/components/playback-timer.js:22 — `export { formatHmsf, formatMmSs, playbackFileLabel }`: no importer takes these from `playback-timer.js` (`rg -n "formatHmsf|formatMmSs|playbackFileLabel" client tools` → only the two timer files; `template/*.js` have their own copies).
- `QUALITY` client/components/playback-timer.js:89-94 — the JSDoc "Among all layers on a channel, pick the one with the highest layer number…" sits on `fileHasPlaybackHints`, not on `pickTopLayerStateForPlayback` (:237); likewise the `pickTopLayerStateBy` doc block (:241-250) is separated from its function by `isRouteOscLayer` (:251-258), and the `isStaleOscPlaybackLayer` doc (:210-220) sits above `STALE_OSC_LAYER_MS`. Misattached docs.
- `QUALITY` client/components/playback-timer.js:407-409 — `container.className += ' header-pgm-timer'` is redundant: `paintPlaybackDisplay` already preserves the class (`playback-timer-format.js:110-111`) and the container is created with it (:335).

## client/components/playlist-control-panel.js
- `BUG` client/components/playlist-control-panel.js:161-162 — "Set all" with an empty or invalid timeless field sets every timeless item to 1 s. `Math.max(1, Math.min(86400, parseFloat('') || 0))` = `1`, so the `!secs` guard can never fire. Failing case: clear the field (or type `abc`), click "Set all" → all image/template/shader items of the selected playlist get `duration: 1` via `sceneState.patchLayer`. Fix: `const v = parseFloat(…); if (!Number.isFinite(v)) return`.
- `QUALITY` client/components/playlist-control-panel.js:36 — `#plp-timeless` is a plain `type="number"`, not `attachMathInput` (RULES.md "Input fields" rule 2).
- `RISK` client/components/playlist-control-panel.js:73-95, 115-123 — every 2 s poll rewrites `innerHTML` of both `<select>`s even when nothing changed; a native dropdown that is open while the poll lands can collapse and lose the hover item, which matters because picking an item here is an immediate `goto` on a live playlist. Diff against the last rendered key list before touching the DOM.

## client/components/preview-canvas-compose-cell-chrome.js
- `OK`
