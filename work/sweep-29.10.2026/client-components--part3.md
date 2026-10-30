# client/components (part 3) — sweep 29.10.2026 (batch 006)

Files: 34 · lines: 6770 · findings: 0 BUG-HIGH, 5 BUG, 3 DEAD, 7 RISK, 21 QUALITY

Cross-cutting note (RULES.md input rules): the web client has no generic "focus selects the value" handler (`rg "addEventListener\('focus'"` over client/ finds only inspector-source-label.js, inspector-clip-trim.js and math-input.js's own bookkeeping). `attachMathInput` does not select on focus either. So rule 1 is unmet in every inspector listed below that builds text/number fields by hand; it is noted once here instead of per file. Rule 2 (maths in number fields) is met wherever `attachMathInput` / `parseNumberInput` is used; the exceptions are listed per file.

## client/components/device-view-inspector-virtual-cam.js
- `QUALITY` device-view-inspector-virtual-cam.js:23,103,166 — fps default is inconsistent: `savedVirtualCamera()` falls back to 25, the input then uses `saved.fps ?? caspar.fps ?? 50` (the `50` is unreachable), `parsePatch()` falls back to 50 and the "+ Virtual cam" button (device-view-matrix.js:74) creates it at 50. Pick one default.
- `QUALITY` device-view-inspector-virtual-cam.js:160 — the `WxH` text field splits on lowercase `x` only. "1280X720" → width 1280, height NaN → 1080 (silently 1280x1080). Split on /[x×*]/i.

## client/components/device-view-inspectors.js
- `QUALITY` device-view-inspectors.js:42,60,70 — `isGpu` is computed at 42 but the decklink/gpu kind tests are repeated inline at 60 and 70 (`isDecklinkPort` is also available). Use the two constants in the if/else chain. Stray trailing whitespace on line 41.

## client/components/device-view-live-sources-render.js
- `OK`

## client/components/device-view-mappings-render.js
- `OK`

## client/components/device-view-matrix.js
- `BUG` device-view-matrix.js:26-28 (same at 39-41) — new stream/record output id is `str_${cur.length+1}` / `rec_${cur.length+1}`. After removing an earlier output the next add collides. Failing case: `streamOutputs = [str_1, str_2]`, remove `str_1` via the inspector (`removeStreamOutputConnector` filters by id, no renumbering) → `[str_2]`; click "+ Stream" in the matrix toolbar → pushes a second `{id:'str_2', label:'Str2'}`. `settings-post.js:271` keeps `x.id` as given, so two outputs share an id and every id-keyed lookup (live status, remove filter, cable edges, header badges) hits both. The same pattern is in device-view-bands-render.js:333-352. Fix: pick the lowest unused index (`while (ids.has('str_'+n)) n++`), ideally in one shared helper used by both toolbars.
- `QUALITY` device-view-matrix.js:19,31,44,50 — `+ Destination` and `+ Pixel Map` do `Actions.x().then(...)` with no `.catch` (unhandled rejection, no operator feedback); `+ Stream` / `+ Record` / `+ Virtual cam` use `catch {}` / `catch { /* ignore */ }`, so a failed save looks like a dead button. The bands toolbar (device-view-bands-render.js:331-355) at least calls `setStatus`. The record entry here (`type:'h264'`, no `source`/`crf`) also differs from the bands one (`source:'program_1', crf:26`).

## client/components/device-view-render.js
- `QUALITY` device-view-render.js:1,7 — `connectorById` is imported from './device-view-helpers.js' in a second import statement although line 1 already imports four names from the same module. Merge.

## client/components/device-view-selection.js
- `BUG` device-view-selection.js:244 — `ctx.setStatus?.(ctx.statusEl, 'DeckLink input removed', true)` can never run. `ctx` is created in device-view.js:47 as `{ refs, state, wrap, gHost }`; nothing assigns `ctx.setStatus` or `ctx.statusEl` (`rg "ctx\.(setStatus|statusEl) *="` over client/ → no hit; the status element is `refs.statusEl`, `setStatus` lives in device-view-ui-utils.js). Failing case: remove a DeckLink host input → the inspector shows "DeckLink input removed." but the bottom status line never reports it (optional-call swallows the missing function). Fix: `setStatus(refs.statusEl, 'DeckLink input removed', true)` with the import.

## client/components/device-view-snapshot-modals.js
- `RISK` device-view-snapshot-modals.js:127,199,211 — the load modal's Apply button is enabled by a successful Preview, but changing the Apply-mode select afterwards does not disable it again. Preview "Full", switch to "Device graph only" (or the reverse), Apply → applies a mode that was never previewed. The confirm() text does name the mode, so the damage is limited; reset `applyBtn.disabled = true` on `modeSel` change.

## client/components/device-view-toolbar.js
- `RISK` device-view-toolbar.js:102,224 — `window.localStorage.getItem/setItem` are not wrapped in try/catch (every other localStorage use in this batch, e.g. device-view-render.js:236, is). With site data blocked, `getItem` throws a SecurityError inside `buildDeviceViewShell`, so the whole Devices tab fails to build, and `setItem` throws from the toggle handlers. Wrap both.

## client/components/device-view-ui-utils.js
- `RISK` device-view-ui-utils.js:206-234 (`renderPreservingFocus`) — the focused control is re-found by index + tag name only; `matched.value = activeDesc.value` is then copied into whatever control sits at that index, whether or not it is the same field. When the inspector is re-rendered for a different entity while an input still has focus, the old entity's text lands in the new entity's field at the same position (visible only; not committed until `change`). Compare `type`/`placeholder`/a data key before copying the value.
- `QUALITY` device-view-ui-utils.js:220-222 — the third fallback (`newInputs.find((el, idx) => same tag && idx === activeDesc.index)`) is the same test the first branch (208-212) already made; it can never match anything new. Remove.
- `QUALITY` device-view-ui-utils.js:105 — `findNearestConnectorId` is exported but only called from `connectorIdFromEvent` in the same file (`rg -w findNearestConnectorId client src tools` → this file + tools/ci/unwired-exports-baseline.json:28). Already on the unwired baseline; drop the `export`.

## client/components/device-view.js
- `OK`

## client/components/fixture-inspector.js
- `QUALITY` fixture-inspector.js:34-51,86-98 — text fields (Name, Destination, Color order) get no focus-select (see cross-cutting note). The rename handler also mutates `f.id` in place and re-spreads `dmxState.fixtures` instead of going through a dmxState method, so anything keyed by the old id outside `fixtures` (selection is handled; groups/links, if any) is not migrated.

## client/components/header-bar-audio.js
- `QUALITY` header-bar-audio.js:139-144 — the server-monitor buttons call raw `fetch('/api/audio/monitor-source', …)` instead of `api.post` (client/lib/api-client.js). It therefore ignores `getApiBase()` (split UI/server origin), skips the WO-811 `noteUnauthorized()` sign-in path, never checks `res.ok` (a 400 "Invalid source" / 503 "Caspar not connected" is silent) and only logs thrown network errors. Use `api.post` and toast the error.

## client/components/header-bar-config-strip.js
- `OK`

## client/components/header-bar-led-test.js
- `OK`

## client/components/header-bar-replication.js
- `OK`

## client/components/header-bar-streaming.js
- `QUALITY` header-bar-streaming.js:99-105,111-116 — `destroy()` unsubscribes only the two store subscriptions; the `highascg-streaming-changed` and `visibilitychange` document listeners are never removed. Today it is harmless because header-bar.js:267 ignores the return value (`destroy` is never called), but then the returned object is dead API. Either remove the dead `destroy` or make it complete.

## client/components/header-bar.js
- `DEAD` header-bar.js:233-237 — `updateSyncVisibility(_cfg)` has an empty body ("Buttons removed as requested") yet is subscribed to `settingsState` and called once. grep: `rg -n "updateSyncVisibility" client src tools` → only these lines. Delete function + both call sites.
- `QUALITY` header-bar.js:105-122 — `showHeaderToast` is a private copy of the toast helper that `showAppToast` (imported at line 30 and used in `startFreshProject`) already provides, so two toast stacks with different styling coexist in the header. Use `showAppToast` throughout.
- `QUALITY` header-bar.js:85,193 and 98,207 — `saveBtn.title` and `loadBtn.title` are each assigned twice; the first (longer) text is dead. Also `loadFromFile` (182) reports every failure, including import/network errors after a successful parse, as "Invalid project file: …".
- `RISK` header-bar.js:139-151 — Shift+click "download JSON" exports `fetchProjectFileContentById(slug)` (the server-stored copy) whenever a slug exists, and only falls back to `projectState.exportProject(...)` when there is no slug or the fetch returns nothing. Edits since the last autosave/save are therefore missing from the downloaded file although the tooltip says "Save … download JSON file". Intentional? If not, export the live state.

## client/components/inspector-browser-display.js
- `DEAD` inspector-browser-display.js:187-247 `renderBrowserDisplayInspector()` — the standalone browser-source inspector has no caller. grep: `rg -n renderBrowserDisplayInspector client src tools godot` → definition + tools/ci/unwired-exports-baseline.json:29 only. Its only trigger was the `browser-display-select` window event, which is dispatched in sources-panel-live-render.js:290, sources-panel-live-render-actions.js:183,202 and here at 241, but `rg browser-display-select` over the whole repo finds no listener. Likewise `browser-display-changed` (line 34) has no listener. Once the function goes, `resolveBrowserDisplaySource` (14-28; baseline:30) is dead too, and so are the three `browser-display-*` dispatches. `mountBrowserDisplayControls` / `mountBrowserDisplayInteractToggle` stay (used by device-view-destinations-inspector-host-channel.js:77,85).
- `QUALITY` inspector-browser-display.js:55,59,63 — Width/Height/FPS are `type="number"` with the `inspector-math-input` class but no `attachMathInput` (that class is only a style hook; math-input.js wires nothing by class). RULES.md rule 2 is not met: `1920/2` cannot even be typed into a number input. Max is also not enforced in `runApply` (min only; `max="3840"` is an attribute, typed 99999 passes). Use `attachMathInput` and clamp both ends.
- `QUALITY` inspector-browser-display.js:41,70 — the destructured `_hostOperatorFullscreen` option is never read (no caller passes it either), and the help text hard-codes "1920x648 on this box".
- `RISK` inspector-browser-display.js:146,165 — the interact toggle always renders as "Move to operator monitor" and only flips its own label after a click; after any re-render of a window that is already on the operator monitor it shows the wrong state. It needs the current state from the source.

## client/components/inspector-channel-resolution.js
- `QUALITY` inspector-channel-resolution.js:11 — `getResolutionForScreen(stateStore, screenIdx)` shares its name with `getResolutionForScreen(screenIdx, sceneState, stateStore)` in scenes-editor-logic.js:7 (reversed argument order). Both are live; WO-532's smoke pins this signature (smoke-wo532-…:90), so rename only together with that test. Note the re-export at inspector-panel-views.js:8 has no importer (`rg getResolutionForScreen` → inspector-panel*.js only that line).

## client/components/inspector-clip-trim.js
- `OK`

## client/components/inspector-common.js
- `QUALITY` inspector-common.js:12-146 — `createDragInput` and `createMathInput` (lib/math-input.js:156-285) are two near-identical drag/wheel/slider number inputs (same class names, same drag threshold, same slider code) with slightly different commit rules (`createDragInput` restores last value on garbage, `createMathInput` falls back to `min`/0). Behaviour already drifts (drag step scaling for step<1 exists only in `createMathInput`; garbage-input handling differs). Consolidate onto one.

## client/components/inspector-countdown-controller.js
- `BUG` inspector-countdown-controller.js:61-80 — `getCurrentConfig()` lists only 17 keys and omits `posX`, `posY`, `timerFontFamily`, `timerBorderWidth`, `timerBorderColor`. `persistLocalConfig` (90-107) builds `nextConfig = getCurrentConfig()` and then (a) replaces `layer.source.countdownConfig` and `layer.cgData` wholesale with it, (b) replaces `timer.config = {...nextConfig}` (102), (c) pushes it to every bound layer, and `flushCgUpdate` (160) posts the same object to `/api/countdown/set`. Failing case 1: in the layer's Countdown inspector type X=100, Y=200 in "Position px" (inspector-countdown.js:266-280, WO-320A) → `onFieldChange({posX,posY})` assigns them to `cfg`, but `getCurrentConfig()` drops them, so neither the stored layer config nor the CG UPDATE ever contains posX/posY (the template engine merges config, countdown-engine.js:275, so the previous preset position stays); on the next re-render the inputs read `cfg.posX` from the stored config and are empty again. Failing case 2: set font family / outline width in the timer control panel (timer-control-panel-settings-form.js:285-289 writes them to the timer config), then edit any field of a layer bound to that timer → `timer.config` is overwritten without them and propagated to all bound layers. Fix: start from `{ ...cfg }` (or the stored config) and overlay the DOM-derived keys.
- `QUALITY` inspector-countdown-controller.js:64 — `grp.querySelector('#cd-duration')` matches nothing (no element with that id exists in client/; duration is a `createHmsInput`). It works only because `persistLocalConfig` runs `Object.assign(cfg, partial)` first and `readNum` falls back to `cfg.durationSec`. Remove the dead selector and read from `cfg` explicitly. `readNum` is also duplicated in inspector-countdown.js:24.

## client/components/inspector-countdown.js
- `DEAD` inspector-countdown.js:21 — `export { COUNTDOWN_CG_UPDATE_DEBOUNCE_MS }` re-export has no importer. grep: `rg -w COUNTDOWN_CG_UPDATE_DEBOUNCE_MS client src tools godot` → controller (definition + 2 uses), this import + re-export, and a Godot comment only. (`isCountdownSource` / `DEFAULT_COUNTDOWN_CONFIG` exports are internal-only too; the first is on unwired-exports-baseline.json:31.)
- `QUALITY` inspector-countdown.js:24-27,29-47 — `readNum` duplicates the private copy in the controller, and `DEFAULT_COUNTDOWN_CONFIG` is duplicated by `DEFAULT_TIMER_CONFIG` in lib/scene-state-timers.js (comment line 14 says "mirrors"; the two already differ: the timer copy has `timerFontFamily`/`timerBorderWidth`, this one does not — the root of the BUG above). One shared constant.
- `QUALITY` inspector-countdown.js:266-267 — Position px X/Y are `type="number"` with no `attachMathInput` (RULES.md rule 2).

## client/components/inspector-decklink-host.js
- `OK`

## client/components/inspector-effects.js
- `QUALITY` inspector-effects.js:120 — `renderEffectParamBlock(container, def, …)`: `def` is never used inside the function. Also `renderEffectEditor` is exported but only used internally (baseline :32).

## client/components/inspector-fill-timeline.js
- `BUG` inspector-fill-timeline.js:89-92 — in `applyPos`, when exactly one of X/Y parses (the other is garbage/NaN) the fallback branch writes `pixelsToNormalized(xPx, W)` and ignores the coordinate-origin conversion used by the main branch (`storedNormFromDisplayPx`, 86). Failing case: centre-origin mode (`isCenterOrigin()` true; title says "center offset px"), clear the Y field (or type text) and change X to 100 → fill_x is stored as 100/W, i.e. a top-left pixel, not "100 px right of centre", and the keyframe jumps; fill_y is left untouched. Fix: reject the edit (restore both fields) when either value is invalid.

## client/components/inspector-fill.js
- `QUALITY` inspector-fill.js:218-224,268-275 — "Scale %" and "Zoom %" are plain `type="number"` inputs without `attachMathInput` (RULES.md rule 2) and, for Scale, the value only commits on Enter / Apply (blur discards it silently).

## client/components/inspector-global-border-artnet.js
- `RISK` inspector-global-border-artnet.js:136-137,149 — Universe is capped at 16 via `max` (read by `attachMathInput` → real clamp). The server accepts 0..32767 (global-border-control.js:147) and the Art-Net low nibble is 0..15, so 16 is off by one for Art-Net and far too low for sACN (universes 1..63999) when the protocol select above is on sACN. Typing universe 20 for an sACN border snaps to 16.

## client/components/inspector-global-border-effect.js
- `OK`

## client/components/inspector-global-border-events.js
- `OK`

## client/components/inspector-global-border-slices.js
- `BUG` inspector-global-border-slices.js:20 — `getResolutionForScreen(stateStore)` is called with no screen, so slice X/Y/W/H (px ↔ stored 0..1) are scaled by the active screen's resolution, not the border's screen. `renderGlobalBorderInspector(root, screenIndex, …)` is opened by `global-border-select` from the column header (scene-list-column.js:184), which does not call `ensureMainForColumn`/`switchScreen`, so the two can differ. Failing case: screen 1 = 1920x1080 (active), screen 2 = 3840x2160; click "Global Border" on column 2 and add a slice → fields show `x/1920`, and typing X=1920 stores 1.0 (clamped) instead of 0.5. WO-532 §3 left this file "unchanged" on the assumption that it describes the selection; that assumption is false for this entry path. Fix: pass `screenIndex` from the caller (`appendGlobalBorderSlicesSection(root, screenIndex, …)` → `getResolutionForScreen(stateStore, screenIndex)`).

## client/components/inspector-global-border.js
- `OK`

## client/components/inspector-html-template.js
- `RISK` inspector-html-template.js:207 — `reloadHtmlTemplateLayers` picks the preview/program channel from `sceneState.activeScreenIndex`, whereas the sibling countdown inspector (inspector-countdown-controller.js:47) and WO-532 use `resolveMainIndexForScene(scene, sceneState)`. If the selected look belongs to a different screen than the active one (an `'all'` look, or the inspector kept open after a screen switch), CALL RELOAD goes to the other screen's channel and may reload an unrelated HTML layer with the same layer number. Resolve the look's own main as the other inspectors do.
