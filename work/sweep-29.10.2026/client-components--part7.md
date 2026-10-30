# client/components (part 7: scenes-editor*, scenes-preview-runtime*, scenes-shared, settings-*, shader-*) — sweep 29.10.2026 (batch 010)

Files: 33 · lines: 6951 · findings: 0 BUG-HIGH, 9 BUG, 9 DEAD, 12 RISK, 20 QUALITY

## client/components/scenes-editor-deck-drop.js
- `QUALITY` client/components/scenes-editor-deck-drop.js:89 — `showScenesToast(msg, 'warn')` uses a type the toast does not know. `showScenesToast` (scenes-editor-support.js:22-24) colours only `'error'` red; everything else is blue, so the WO-156 self-route rejection looks like an info message. Fix: pass `'error'` or add a warn colour.

## client/components/scenes-editor-deck-ingest.js
- `RISK` client/components/scenes-editor-deck-ingest.js:42-45 — the uploaded file is matched back by basename only (`id === base || id.endsWith('/'+base) || label === base`), first hit wins. Failing case: upload `clip.mp4` into the project subfolder while `media/other/clip.mp4` already exists and sorts first in `/api/media` → the look gets the OLD file. Fix: prefer the entry whose id starts with `getDefaultUploadSubdir()`, or compare against the path the upload response returns.

## client/components/scenes-editor-deck-thumb.js
- `DEAD` client/components/scenes-editor-deck-thumb.js:23 `getProgramChannel` — destructured from ctx, never read. grep: `rg -n "getProgramChannel" client/components/scenes-editor-deck-thumb.js` → only the destructure. The caller (scenes-editor.js:274) can stop passing it.
- `RISK` client/components/scenes-editor-deck-thumb.js:38-41 — canvas `height` is only updated inside `if (c.width !== cw)`. A repaint of an existing canvas whose screen resolution changed to a different aspect keeps the old height, so the thumb is squashed until the deck re-renders. In practice the deck re-renders on `channelMap` changes (scenes-editor.js:342) and creates fresh canvases (scene-list-column.js:287), so this is mostly covered; still fragile. Fix: compare both width and height.

## client/components/scenes-editor-edit.js
- `QUALITY` client/components/scenes-editor-edit.js:146-149 — a route drop that `routeDropRejectionMessage` rejects removes the new layer silently. The deck drop path (scenes-editor-deck-drop.js:87-90) toasts the same message. The operator drops a route onto the layer strip and nothing happens. Fix: `showScenesToast?.(msg, 'error')`.

## client/components/scenes-editor-global-preview-take.js
- `QUALITY` client/components/scenes-editor-global-preview-take.js:16-64 — `globalTakeFromPreview` and `globalCutFromPreview` are line-for-line copies except the `forceCut` flag and one toast string. Fix: one `runGlobal(forceCut)`.

## client/components/scenes-editor-keyboard.js
- `RISK` client/components/scenes-editor-keyboard.js:16-23 — no `e.repeat` guard. Holding Space auto-repeats keydown (~30 Hz after 500 ms); `takeScenesToProgram` only guards while a take is in flight (`takeBusy`, scenes-editor-support.js:144), so once a take finishes the next repeat fires another take of the still-armed preview look. On a live box a long press can replay the transition several times. Fix: `if (e.repeat) return`.
- `RISK` client/components/scenes-editor-keyboard.js:20 — only input/textarea/select/contenteditable are excluded. With a `<button>` focused (for example a look's Delete or CUT button) Space runs a global take as well as whatever the button does. Fix: also skip `button, a, [role=button]`.

## client/components/scenes-editor-layer-route.js
- `OK`

## client/components/scenes-editor-logic.js
- `QUALITY` client/components/scenes-editor-logic.js:5,7,82-94 — `getResolutionForScreen(screenIdx, sceneState, …)` shadows the module-level `sceneState` import, and `runLookRecall` ignores the injected `deps` pattern (it uses the imported singleton for `armedScreenIndices`, `_emit('screenChange')`). `[...new Set(…)].sort()` (line 89) is a lexicographic sort; harmless for indices 0-3 but should be `(a, b) => a - b`. `showScenesToast` is missing from the JSDoc of `deps`.

## client/components/scenes-editor-preview-actions.js
- `RISK` client/components/scenes-editor-preview-actions.js:27-30 — `sendSceneToPreviewWithTimelineClear` calls `previewRuntime.sendSceneToPreviewCard(sceneId, opts)` without `return`/`await`. Its callers `await` it expecting "staged": scene-list-column.js:353 and :388 (Edit click: `await send…` then `setEditingScene`), scenes-editor-logic.js:102 (`Promise.all(items.map(send…))`). All of them resolve before the PRV push has run, and a rejection of the push becomes an unhandled rejection with no toast (see the scenes-preview-runtime.js BUG). Fix: `return previewRuntime.sendSceneToPreviewCard(...)`.

## client/components/scenes-editor-support.js
- `DEAD` client/components/scenes-editor-support.js:357 `renderScreenTabs` — unused. grep: `rg -nw renderScreenTabs client src tools scripts godot --glob '!client/assets/*'` → only the definition and `tools/ci/unwired-exports-baseline.json:50`. Delete it (and the baseline line).
- `QUALITY` client/components/scenes-editor-support.js:22-24 — `showScenesToast` has two colours (error red, everything else blue) but callers pass `'warn'` (deck-drop.js:89). Add the missing type or normalise the callers.
- `QUALITY` client/components/scenes-editor-support.js:144,309 — a take pressed while `takeBusy` is set returns silently, with no toast. On air, a second take that is dropped for about a second looks like a dead button. Consider a toast or a short queue.

## client/components/scenes-editor.js
- `RISK` client/components/scenes-editor.js:435,445 — `Logic.runLookRecall(...)` is neither awaited nor `.catch`-ed in the preset-recall listeners. If `sendSceneToPreviewCard` rejects (see the preview-runtime BUG) the failure is an unhandled promise rejection and the operator sees no toast for a failed preset recall.
- `QUALITY` client/components/scenes-editor.js:409,413 — leftover `console.log('Received scenes-edit-live-on-pgm event, detail:', …)` and `console.log('Live scene ID for main', …)` debug lines in a production listener. Also `render()` (lines 286-287) and `dispatchLayerSelect` (line 179) are single 400-600 character lines, which hides the logic. The file is 456 lines, near the 500 limit.

## client/components/scenes-preview-runtime-clear.js
- `OK`

## client/components/scenes-preview-runtime-mixer-nudge.js
- `OK`

## client/components/scenes-preview-runtime.js
- `BUG` client/components/scenes-preview-runtime.js:62,371 — `previewPushRequest` is a single slot, so a second `sendSceneToPreviewCard` made while a push is in flight overwrites the first queued request. Failing case: a look-preset recall to PRV with items on 3 distinct mains (scenes-editor-logic.js:102 runs `Promise.all(items.map(send…))`). Call 1 sets request 1 and `drainPreviewPushQueue` consumes it at once (lines 100-101). Call 2 sets request 2 and only sets `previewPushPending` (line 95). Call 3 overwrites request 2. When push 1 finishes only request 3 runs, so the middle main is never staged on PRV. Two mains work; three or more lose the middle ones. Fix: queue the requests (an array, or merge `targetMains` per scene).
- `BUG` client/components/scenes-preview-runtime.js:93-115,145,152,166,372 — `drainPreviewPushQueue` has `try/finally` but no `catch`. A failing `POST /api/scene/take` inside `pushSceneToPreviewViaServer` (line 227; an HTTP 4xx/5xx makes `api.post` throw) rejects. The editor paths call it as `void drainPreviewPushQueue()`, and the deck path `await`s it through a wrapper that drops the promise, so nothing handles it. Failing case: click a look's PRV thumbnail while the server returns a take error → only a console "Uncaught (in promise)"; the card never arms and the operator gets no toast. There is no global `unhandledrejection` handler (`rg unhandledrejection client` → none). Fix: catch in `drainPreviewPushQueue` and toast.
- `DEAD` client/components/scenes-preview-runtime.js:28 `getPreviewChannel` — destructured, never used (only a JSDoc mention at line 26). grep: `rg -n getPreviewChannel client/components/scenes-preview-runtime.js` → lines 26, 28. The caller scenes-editor.js:86 can stop passing it.
- `DEAD` client/components/scenes-preview-runtime.js:450,452,455 — the returned members `pushSceneToPreview`, `flushPreviewPush`, `drainPreviewPushQueue` are never used from outside. grep: `rg -nw "pushSceneToPreview|flushPreviewPush|drainPreviewPushQueue" client tools src --glob '!client/assets/*'` → only this file plus text-pin reads in tools/smoke/smoke-wo326-inspector-fill-live-apply.test.js (they read the function bodies, so the functions stay). Only the exports on the returned object are dead. `runLookRecall` also receives `...previewRuntime` (scenes-editor.js:436,446) but reads only `sendSceneToPreviewCard` / `takeSceneToProgram`.
- `QUALITY` client/components/scenes-preview-runtime.js:120-126 — `waitForPreviewPushComplete` gives up silently after 400 × 16 ms (about 6.4 s) and returns as if idle. `exitLookEditor` (scenes-editor.js:96) then proceeds with a push still running. Log or toast on timeout.

## client/components/scenes-shared.js
- `DEAD` client/components/scenes-shared.js:447 `parseRouteChannelLayer` — no client user. grep: `rg -nw parseRouteChannelLayer client tools src scripts --glob '!client/assets/*'` → the definition, and `src/config/extra-live-source-enrich.js` (its own separate copy, which the smoke test imports). The unwired-exports CI check does not flag it because the name exists elsewhere. Delete.
- `DEAD` client/components/scenes-shared.js:250 `playSeekFramesForSceneLayerFromTimeline` — unused. grep: only the definition plus `tools/ci/unwired-exports-baseline.json:51`. `playSeekFramesFromClip` (186) and `clipAtTimelineMs` (157) are exported but only used inside this file (baseline line 52 for the former); un-export them. The server has its own `clipAtTimelineMs` in src/engine/scene-play-seek.js.
- `QUALITY` client/components/scenes-shared.js:86-98 — the `opts.label` option never renders. `transitionRow.innerHTML` (lines 92-96) contains no `.scenes-look-transition__label` element, so `labelEl` is always null. Callers still pass labels (scenes-editor-edit.js:185 "Look transition (this look)", scene-list.js:133 "Default transition"). Either restore the label span or drop the option and the unused CSS rule at client/styles/06b-scenes-edit-transitions-layerstrip.css:66.
- `QUALITY` client/components/scenes-shared.js:94,132 — the duration field is `class="inspector-math-input"` and `parseNumberInput` evaluates maths on change, so RULES.md input rule 2 holds, but rule 1 (focus selects the value) does not.

## client/components/settings-alsa-mixer-panel.js
- `QUALITY` client/components/settings-alsa-mixer-panel.js:145-162 — each slider POSTs on every `input` through `debounceAlsaSet` and again immediately on `change`, so every drag ends with a duplicate `setAlsaMixerControl` for the same value. Harmless, but one of the two is redundant.

## client/components/settings-live-audio-panel.js
- `DEAD` client/components/settings-live-audio-panel.js:173 `const deviceOpts = alsaCaptureDeviceOptions(captureDevices)` — never used. grep: `rg -n deviceOpts client/components/settings-live-audio-panel.js` → line 173 only (`renderSlotRows` computes its own `opts`).

## client/components/settings-modal-caspar-collect.js
- `BUG` client/components/settings-modal-caspar-collect.js:4-16 — `collectOpenalAudioRoutingFromModal` reads 12 element ids (`#set-caspar-screen-N-pgm-openal`, `-prv-openal-en`, `-prv-openal`) that exist in no markup. grep: `rg "set-caspar-screen" client --glob '!client/assets/*'` → only this file. It therefore always returns `['','','','']` / `[false×4]` / `['','','','']`, and `buildSettingsPayload` (settings-modal-logic.js:99, `audioRouting: { ...prevAr, ...openalAr }`) spreads them over the stored values. The server persists `audioRouting` from the payload (src/api/settings-post.js:104), so ANY settings autosave resets `audioRouting.programSystemAudioDevices`, `previewSystemAudioEnabled` and `previewSystemAudioDevices`. Failing case: set `programSystemAudioDevices[0]="hw:1,0"` via `POST /api/audio/config` (src/api/routes-audio.js:160-171) or by editing config/audio_routing.json, open Settings, change any field → autosave → the device is blanked and the next Caspar config build drops it. Today's stored values are all empty and no current UI sets these keys, so there is no live damage yet (latent). Fix: delete the collector and stop spreading it, or keep `prevAr` for those keys.

## client/components/settings-modal-companion.js
- `DEAD` client/components/settings-modal-companion.js:75 `refreshCompanionConnectionStatus` — exported but only used inside this file (lines 107, 112). Listed in `tools/ci/unwired-exports-baseline.json:53`. `onTabInactive() {}` and `dispose() {}` (114-115) are empty stubs, called from settings-modal.js:60,110. Remove the export keyword; the stubs are harmless.

## client/components/settings-modal-diagnostics.js
- `OK`

## client/components/settings-modal-logic.js
- `DEAD` client/components/settings-modal-logic.js:66-67,78-80,138-143 — the ids `#set-caspar-host`, `#set-caspar-port`, `#set-osc-port`, `#set-osc-bind`, `#set-osc-peak` appear in no template. grep: `rg "set-osc-(port|bind|peak)|set-caspar-(host|port)" client --glob '!client/assets/*'` → only this file. Every read falls back to the previous settings and every hydrate `if (el)` is skipped, so these branches are dead. Either remove them or restore the controls.
- `RISK` client/components/settings-modal-logic.js:138-139 — `hydrateSettings` reads `cfg.caspar.host` / `cfg.caspar.port` unguarded while `buildSettingsPayload` uses `prevAll.caspar?.host`. A GET /api/settings without a `caspar` object throws and aborts the whole hydrate, so autosave stays suspended (settings-modal.js:228,266). Use `cfg.caspar?.host`.

## client/components/settings-modal-mount-hardware-summary.js
- `QUALITY` client/components/settings-modal-mount-hardware-summary.js:255 — `${d.type}` is put into `innerHTML` unescaped next to an escaped `d.name`. Server-sourced, low risk; use `escapeHtml(d.type)`.

## client/components/settings-modal-mount-hardware.js
- `BUG` client/components/settings-modal-mount-hardware.js:264-374 — `wireSystemTimeListeners` is called on EVERY activation of the "system" tab (settings-modal.js:78-82) and adds a fresh `click`/`change` listener each time with no guard. Failing case: open Settings → system → another tab → system → click "Set time" → two confirm dialogs and two `POST /api/system/time` (and two nuclear-password prompts when the gate is on). Same for the NTP checkbox. Fix: wire once (outside the activation branch), or guard with a flag on the modal.
- `BUG` client/components/settings-modal-mount-hardware.js:252-255 — `refreshSystemTimePanel` starts a `setInterval(updateClock, 200)` on every call and never clears the previous one (`_tickInterval` is written but never read; `rg _tickInterval client` → lines 252/255 only). It runs on every system-tab activation and after every NTP toggle / Set time. After "Set time" the old interval keeps writing the pre-change clock into the same `#system-time-clock` element, so the displayed time flickers between old and new, and every interval keeps running after the modal is closed. Fix: `clearInterval(clockLine._tickInterval)` before creating a new one, and clear it in the modal close path.
- `BUG` client/components/settings-modal-mount-hardware.js:275-290 — the "Set time" button is enabled/disabled by `updateSetBtnState`, which is called once at wire time and never on `change`, and at that moment the NTP checkbox has not been loaded yet (`refreshSystemTimePanel` runs async). So the button state does not follow NTP. Separately, when the password prompt is cancelled (`enteredNtp === null`, line 284) the handler returns without reverting the checkbox, so the UI shows NTP flipped while nothing was sent. Fix: call `updateSetBtnState()` from the change handler and after each refresh; revert the checkbox on cancel.
- `RISK` client/components/settings-modal-mount-hardware.js:395 — the DeckLink package upload uses a bare `fetch(resolveApiUrl(...), { method: 'POST', body: fd })` without `credentials: 'include'`, while `api-client.js` uses `FETCH_CREDENTIALS` everywhere (WO-811 sign-in gate). With a cross-origin API base the upload goes out without the session cookie and gets 401. Use `postFormDataWithProgress` as scenes-editor-deck-ingest.js does.
- `QUALITY` client/components/settings-modal-mount-hardware.js:287-290 — unreachable branch: `password` is always a string at that point (`''` or the entered text; the `null` case already returned at line 284).

## client/components/settings-modal-system-updates.js
- `BUG` client/components/settings-modal-system-updates.js:82-102,114 — the normal update path kills the poll. `apply` makes the server stop and restart itself (src/system/server-update.js:319-320, 430: "this server will stop and restart itself"). The next `GET /api/system/update/status` then fails, so `pollApplyStatus` runs its `catch`, writes the fetch error into the log and `stopApplyPoll()`s. The Apply button was disabled at line 114 and is only re-enabled in the `!st.active` branch, so it stays disabled and the panel never reports completion until the modal is reopened. Fix: on poll errors keep polling (with a timeout) until the server answers again, then re-enable and `refreshSystemUpdatesPanel`.

## client/components/settings-modal-tailscale.js
- `OK`

## client/components/settings-modal-templates.js
- `QUALITY` client/components/settings-modal-templates.js:135,140-142 — the Companion port / satellite port / preview size / picker grid fields are plain `type="number"` with no `attachMathInput` and no focus-select. RULES.md input rules 1 and 2 (focus selects, `+ - * /` evaluated on commit) are not honoured; a `type=number` field cannot even receive `*` or `/`. Same for `#ed-transition-duration` (line 75): the class `inspector-math-input` is only a style hook, nothing attaches maths, and `resolveTransitionDuration('50/2')` (client/lib/transition-duration.js) treats the NaN as "auto" instead of keeping the previous value.
- `QUALITY` client/components/settings-modal-templates.js:13-23 — tab labels mix capitalised and lowercase ("Defaults", "Companion", "media/usb", "updates", "system", "decklink"). Cosmetic.

## client/components/settings-modal.js
- `BUG` client/components/settings-modal.js:250-257 (with settings-modal-logic.js:87) — typing into the Nuclear password field autosaves it as the NEW password. The same field `#set-nuclear-password` is both "set the password" and the value sent to authorise Reboot/Shutdown (`getNuclearPasswordFromModal`), and hydrate blanks it (settings-modal-logic.js:172-176), so the operator types the password they remember. `onSettingsFieldChange` excludes only the variables and live-audio panes, so the `input` event schedules `persistSettings` after 600 ms, which POSTs `ui.nuclearPassword`. The server hashes any non-empty value and replaces the stored hash (src/utils/nuclear-password.js:106-109), and `POST /api/settings` is not password-gated. Failing case: stored password `alpha`; the operator types `alpa` (typo) to reboot → the reboot call is refused with 403, then 600 ms later autosave stores `alpa` as the password. `alpha` stops working and `alpa` now unlocks nuclear actions. Fix: do not autosave `#set-nuclear-password` on input (save only on an explicit "Set password" action that also sends the current password), or send the typed value only as the confirmation `password` and never in the settings payload.
- `QUALITY` client/components/settings-modal.js:250-257 — every `input`/`change` anywhere in the modal triggers a full settings POST, including the Tailscale hostname box, the system-time date/time fields, the NTP and tailscale checkboxes and the DeckLink file picker. Scope the autosave to the panes that actually map to `buildSettingsPayload`.
- `QUALITY` client/components/settings-modal.js:237-246 — `persistSettings` ignores a response with `res.ok` false (no message), and the catch only shows "Save failed" without the reason. A rejected save looks like nothing happened.

## client/components/shader-controls-panel.js
- `OK`

## client/components/shader-fx-modal.js
- `BUG` client/components/shader-fx-modal.js:186-213 — `importFromShadertoy` replaces all the pass textareas (`renderPasses(cfg)`) but never calls `paramsPanel.rescan()`; only `fillForm` (line 142) and user `input` events (lines 236-241) do. The "Detected parameters" panel keeps the previous shader's controls. Failing case: edit shader A, import a Shadertoy link → the panel still lists A's params with A's spans; moving a slider calls `rewriteParamValues` on the new source with stale spans (throws → rescan, or rewrites the wrong literal) and `applyChange()` then auto-saves the result. Fix: `paramsPanel.rescan()` at the end of the import.
- `RISK` client/components/shader-fx-modal.js:274-284 — Delete has no confirm. One click deletes the shader from the library (`DELETE /api/shaders/:id`), and it may be live on air. Add a `window.confirm`.
- `QUALITY` client/components/shader-fx-modal.js:174 — `data-id="${s.id}"` is interpolated into `innerHTML` unescaped while `s.name` is escaped. Ids are slugs, so low risk; escape for consistency.

## client/components/shader-fx-params.js
- `QUALITY` client/components/shader-fx-params.js:17-30 — `toHex`/`fromHex` are copied here, in shader-live-rows.js:9 (`toHex`, exported and used by shader-controls-panel.js) and inline in shader-live-editor.js:258-262. Import the shared one. The paired `<input type="number">` fields (line 49) also miss the RULES.md maths/focus-select rules.

## client/components/shader-live-audition.js
- `OK`

## client/components/shader-live-editor.js
- `RISK` client/components/shader-live-editor.js:168-188 — `loadSelected` has no staleness guard. Switch the instance dropdown quickly (or let `onLiveChanged` follow a playlist hop) and a slower earlier `GET /api/shaders/:id` can resolve last and overwrite `shaderCfg`/`pristine` with the wrong shader; edits then CG UPDATE the selected instance with another shader's source. Compare `selectedKey` after the await.
- `RISK` client/components/shader-live-editor.js:354-375 — `applyBatch` returns from inside the per-pass loop on a rewrite exception after earlier passes were already written into `shaderCfg` (`setSource`). `dirty` stays false, `params` is not re-scanned and nothing is pushed, so the in-memory source and the air state diverge until the next edit.
- `RISK` client/components/shader-live-editor.js:446-460 — `setOpen(true)` when `.scenes-main` is absent (Scenes tab not mounted) never inserts the overlay but still sets `overlay.hidden=false`, the `shader-live-open` body class and the store subscription. The mascot then toggles a UI that is not on screen.
- `QUALITY` client/components/shader-live-editor.js:341-351 — `persistCfg` swallows a failed `POST /api/shaders` with `console.warn` only, so labels/presets/pins the operator just made are lost silently. Toast it.

## client/components/shader-live-rows.js
- `OK`
