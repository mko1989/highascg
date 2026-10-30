# client/components — sweep 29.10.2026 (batch 007)

Files: 31 · lines: 6637 · findings: 0 BUG-HIGH, 6 BUG, 9 DEAD, 5 RISK, 17 QUALITY

Notes on method: every file read in full. Dead-code claims were grepped over `client src tools` (excluding the generated `client/assets/map-data.json`), plus `scripts/`, `index.js`, `package.json`, `.github` where relevant. Event-name claims were grepped repo-wide excluding `work/ docs/ dist* node_modules`. `tools/ci/unwired-exports-baseline.json` already lists `inspector-panel-routing.js: renderInspectorSelection`, `inspector-webpage-host.js: resolveWebpageHostSource` and `led-test-modal.js: saveLedTestSettings` as known unwired exports (not re-reported below except where a bigger point follows).

## client/components/inspector-layer-playlist.js
- `QUALITY` inspector-layer-playlist.js:324,335 — `#playlist-timeless-secs` is a number field that never gets `attachMathInput` (the duration input at :247 and the frames input at :407 do). RULES.md input rule 2 ("every field that holds a number evaluates + - * /"): typing `60*2` here leaves the field unevaluated (a `type=number` field rejects it). Fix: `attachMathInput(timelessSecs, { decimals: 0 })`.
- `QUALITY` inspector-layer-playlist.js:337,340 — `const isTimeless = isTimelessItem` is a pointless alias; `if (!secs) return` at :340 is unreachable because `Math.max(1, …)` on :339 is always >= 1. `_idx` at :142 is unused.

## client/components/inspector-live-audio-input.js
- `RISK` inspector-live-audio-input.js:124-138 and :140-161 — the FFT-source toggle and the capture-device select both call `POST /api/audio/live-inputs/apply`. `src/api/routes-audio.js:399-401` says that route "re-PLAYs every configured slot and would glitch inputs that are still on air" (that is why Start uses the per-input route, :178-201 here). Failing case: slot 2 is on air, the operator ticks "Feed audio-reactive shaders" on slot 1 → slot 2 is re-PLAYed. The device change is probably unavoidable; the FFT toggle may not be. Needs an owner decision, no wrong output proven.
- `QUALITY` inspector-live-audio-input.js:208 — Stop does `api.post(...).catch(() => {})`; a failed STOP gives the operator no feedback, while Start/device/FFT all toast errors.

## client/components/inspector-live-audio-source.js
- `OK`

## client/components/inspector-lower-third-roster.js
- `DEAD` inspector-lower-third-roster.js:219 `getRoster` — returned from `appendLowerThirdRoster` but never called. grep: `rg -n "getRoster\b" client src tools` → only the definition; the sole caller (`inspector-lower-third.js:97`) uses `cloneRosterForPersist` only.
- `QUALITY` inspector-lower-third-roster.js:151-175 — every roster row is rendered as a `<tr>` on every filter keystroke / row pick (no cap), and each row calls `roster.rows.indexOf(row)` (:152), O(n²) for the visible set. A 5000-row sheet means ~25M comparisons plus 5000 DOM rows per keystroke. Fix: have `filterRosterRows` return indices, and cap or virtualise the list.

## client/components/inspector-lower-third-templates.js
- `OK`

## client/components/inspector-lower-third.js
- `DEAD` inspector-lower-third.js:214,310,345,354,366 — five dispatches of `highascg-lower-third-state` that nothing listens to. grep: `rg -n "lower-third-state" . --glob '!client/assets/map-data.json' --glob '!work/**' --glob '!dist*'` → only `dispatchEvent` sites (these five plus `client/lib/app-ws-handlers.js:215`); no `addEventListener`. Either remove the dispatches or wire the consumer that was intended.
- `QUALITY` inspector-lower-third.js:154-156,261-263 — `readNum(raw, cfg.titleFontSize)` can fall back to `undefined` when the stored config has no value yet; `onFieldChange({ titleFontSize: undefined })` then does `Object.assign(cfg, …)` and clears the stored size. Only reachable by emptying the field on a layer with no stored size, so low impact.

## client/components/inspector-media-file-library.js
- `BUG` inspector-media-file-library.js:52 — `host.querySelector('.media-insp__msg')` returns the wrong element. `mountMediaFileVersions` (:50) fills the nested `.media-insp__versions` div with its own `<div class="media-insp__msg">` (inspector-media-file-versions.js:43), and that div precedes the library's own `.media-insp__msg` (:49) in document order. Failing case: type `abc` in the In field → "Use seconds or m:ss.ff" is written into the Versions block's msg line, and the library's msg div stays empty. The same applies to "Could not save", "Rename failed", "Delete failed". The versions code also clears that same line (`msg.textContent = ''`, versions.js:73,103) so a library error is wiped by the next version action. Fix: query `:scope > .media-insp__msg`, or give the two elements different classes.
- `BUG` inspector-media-file-library.js:13-19 vs inspector-media-file-wave.js:10-18 — the time format round trip disagrees. `formatMediaTimecode` shows `m:ss.ff` where `ff` is a FRAME number, and the placeholder/error text says "m:ss.ff". `parseTimeInput("1:02.12")` parses `02.12` as seconds, i.e. 62.12 s. Failing case at 25 fps: a stored 62.5 s trim shows as `1:02.12`; the operator edits the minute to `2:02.12` → saved as 122.12 s (122120 ms), not 122.48 s, and the field redisplays `2:02.03`. Fix: parse the `.ff` part as frames (`/fps`) when there is a `:`, keep decimal seconds only for the bare-number form, and pass `fps` into the parser.
- `QUALITY` inspector-media-file-library.js:23 — `opts.durationSec` is documented/passed (inspector-media-file.js:83) but never read here.

## client/components/inspector-media-file-versions.js
- `QUALITY` inspector-media-file-versions.js:74-80,85 — the progress bar's inner width is never reset to 0 before an upload. After the first upload it stays at `100%`, so the next upload shows a full bar until the first progress event.

## client/components/inspector-media-file-wave.js
- `OK`

## client/components/inspector-media-file.js
- `DEAD` inspector-media-file.js:74-78 — the `.media-insp__tc` branch of `onDuration` is dead: nothing creates that element (the template at :53-61 has none). grep: `rg -n "media-insp__tc" client` → only this `querySelector` and a CSS rule (`client/styles/05e-inspector-media-file.css:76`). Also dead: `state.pos` (:66) is never written, so the playhead `progress` passed to `drawMediaWaveform` (:69) is always 0 and the playhead branch (wave.js:61-64) never draws; `state.playing/channel/layer` (:66) are never read. Left over from the removed preview transport.
- `QUALITY` inspector-media-file.js:16 — stale comment: "Only the newest mount owns the Caspar preview layer"; this file no longer touches a Caspar preview layer, `currentToken` now only guards async results.

## client/components/inspector-media-transport.js
- `RISK` inspector-media-transport.js:81-84,93-104,293 — the SEEK frame is `ms * t.fps / 1000`, but `fps` comes from `resolveFpsForMain`, which prefers `programResolutions[main].fps` even when the target is the PRV channel (`bus: 'prv'`, :101-103). The server builds `previewResolutions` per channel from INFO CONFIG (`src/config/channel-map-from-ctx.js:39`), so program and preview fps can differ. Memory note: SEEK n = seconds × the CHANNEL's fps. A preview channel at a different rate lands on the wrong frame. Not proven on this box (usually both are the same rate). Fix: pick `previewResolutions` when `bus === 'prv'`.
- `QUALITY` inspector-media-transport.js:99,103 — `resolvePhysicalTarget` returns `bus`, which no caller reads (only matters for the fix above).

## client/components/inspector-mixer.js
- `OK`

## client/components/inspector-ndi-host.js
- `QUALITY` inspector-ndi-host.js:62-65 — `source` is the object found by reference in `stateStore.getState().extraLiveSources`, and the code mutates it (`source.ndiName = …`, `source.label = …`) without a store notification. `applyNdiHostApiResult(r)` (:61) already pushes the authoritative list in, so the mutation is redundant at best. Same pattern in inspector-webpage-host.js:143-147.

## client/components/inspector-panel-live-source-events.js
- `OK`

## client/components/inspector-panel-mode-storage.js
- `OK`

## client/components/inspector-panel-presets-modes.js
- `QUALITY` inspector-panel-presets-modes.js:261-265 and :366-372 — two click listeners on the same card. The first selects the card and re-renders the list; the second (still bound to the now-detached card) fires a `LOOK_PRESET_RECALL_PRV` recall. So selecting a card in the Library also recalls the look to PRV. If that is the intent, merge them into one handler. If not, the second one is a bug.
- `QUALITY` inspector-panel-presets-modes.js:83,206 — the button text exposes an API path to the operator ("Import from server (GET /api/state)").

## client/components/inspector-panel-routing.js
- `DEAD` inspector-panel-routing.js:1-173 (whole file) — a stale copy of `renderSelectionInspector`, which now lives in `inspector-panel.js:100-204`. grep: `rg -n "inspector-panel-routing|renderInspectorSelection" . --glob '!work/**' --glob '!dist*'` → only the definition and `tools/ci/unwired-exports-baseline.json:34`. No smoke test reads it as text. It has already diverged: it lacks the `screenTimer` and `mediaFile` branches, and its second `inspectorSelectionKey` (:145) lacks those cases too. Delete the file, then drop the baseline entry.

## client/components/inspector-panel-selection-key.js
- `OK`

## client/components/inspector-panel-timeline-clip.js
- `QUALITY` inspector-panel-timeline-clip.js:403,412,419,426 — the render mixes the `clip` argument and `freshClip()`. The effects group and the keyframes group use the argument, everything else uses `freshClip()`. Today every redraw passes a fresh clip, so nothing is wrong, but `liveApplyContext.clip` (:426) is a snapshot. Prefer `const c = freshClip()` once at the top.

## client/components/inspector-panel-timeline-flag.js
- `BUG` inspector-panel-timeline-flag.js:154 — the "Or jump to flag" options are built with `innerHTML` and unescaped text: `` `<option value="${f.id}">${(f.label || f.type || 'flag') + ' - ' + fmtHms(f.timeMs)}</option>` ``. Failing case: another flag labelled `R&D <intro>` → the option shows `R&D ` (the tag is dropped by the HTML parser); a label such as `<img src=x onerror=…>` from an imported project can execute in browsers that parse markup inside `<option>` (customizable select). Fix: build options with `createElement`/`textContent`, or `escapeHtml`.
- `BUG` inspector-panel-timeline-flag.js:275 — the invalid-input revert uses `coords`, captured at render time, not the current binding. `applyCoords` (:249) mutates the flag and updates `boundCoords` (:231), but `coords` stays. Failing case: change the location from `1 0 2` to `2 0 3` (applied), then type `garbage` in the location field → the field reverts to `1 0 2` while the flag is bound to `2 0 3`, so the display lies. Fix: use `boundCoords` (:225) at :275. (:313 `flag[propName]` is fine: `timelineState.updateFlag` mutates in place, timeline-state.js:136-145.)
- `QUALITY` inspector-panel-timeline-flag.js:288-332 — `makeCoordField` returns `fi`, and the caller appends `fi.parentElement`, which is the `<label>` (`fl`), not the `.inspector-field` div `fw`. The `fw` wrapper is created and discarded, so Page/Row/Column rows lose the `.inspector-field` container class that the location row has. `_allowNegative` (:288) is unused.
- `QUALITY` inspector-panel-timeline-flag.js:327-329 — Page/Row/Column are number fields parsed with `parseInt` (`companion-location-parse.js:42`), so `1+1` is read as `1` instead of being evaluated. RULES.md input rule 2 says an expression such as `2*3` evaluates, and the parser only does `parseInt`.

## client/components/inspector-panel-timeline-shared.js
- `RISK` inspector-panel-timeline-shared.js:55-63 — `syncTimelineToServer()` takes no id and always PUTs `timelineState.getActive()`, yet it is called by the clip and flag inspectors, which edit `timelineId` (e.g. clip.js:66,91,112,171). If a clip or flag of a non-active timeline is ever the selection (the flag inspector's own WO-450 comment says that case existed), the edit stays unsaved and the wrong timeline is pushed. In the normal flow the editor only selects from the active timeline, so no failing case is shown. Also `catch {}` on the POST fallback (:61) hides a total save failure from the operator.

## client/components/inspector-panel-timeline.js
- `DEAD` inspector-panel-timeline.js:2 — the re-export of `appendTimelineInspectorPosition` is unused. grep: `rg -n "appendTimelineInspectorPosition" client` → clip.js and flag.js import it from `-shared` directly; the only importers of this barrel (`inspector-panel.js:15`, `inspector-panel-routing.js:11`) take `syncTimelineToServer`, `renderTimelineFlagInspector`, `renderTimelineClipInspector`.

## client/components/inspector-panel-views.js
- `DEAD` inspector-panel-views.js:8 — the re-export of `getResolutionForScreen` is unused. grep: `rg -n "inspector-panel-views" client tools` → importers are `inspector-panel.js:16` and `inspector-panel-routing.js:17`, and neither takes it (`inspector-scene-layer.js:16` imports from `inspector-channel-resolution.js` directly). Note this name also exists with a different signature in `scenes-editor-logic.js:7`.

## client/components/inspector-panel.js
- `DEAD` inspector-panel.js:368 — `document.addEventListener('multiview-select', onMultiviewSelect, true)` never fires. The only dispatcher (`multiview-editor.js:180,181`) dispatches on `window`, and a window-targeted event never travels through `document`. grep: `rg -n "multiview-select" client tools` → no `document.dispatchEvent`. The window listener at :367 does all the work.
- `DEAD` inspector-panel.js:194-200 — the `highascg-inspector-render-external` hook ("detachable optional modules") has no listener anywhere. grep: `rg -n "inspector-render-external" . --glob '!work/**' --glob '!dist*' --glob '!client/assets/map-data.json'` → only the two dispatch sites (this file and the dead routing file). The fall-through can only ever call `renderEmpty()`.
- `RISK` inspector-panel.js:436-459 — `settingsState.subscribe(() => refreshInspectorAfterAudioSettings())` rebuilds the scene-layer / timeline-clip inspector on every settings notification, with neither the `input:focus` guard the sceneState handlers use (:416,428) nor `renderPreservingFocus`. Failing case (not reproduced): a settings save/load notify (32 `settingsState.load()` call sites in `client/`) while the operator is typing in a layer field rebuilds the inspector under the cursor.

## client/components/inspector-pip-overlay.js
- `BUG` inspector-pip-overlay.js:357-364 and :400-403 — param edits are built from stale closures. `renderPipOverlayCard` emits `{ ...overlay.params, [key]: newVal }` where `overlay` is the object from render time, and `renderPipOverlayGroup` does `updated = [...list]` from the render-time `list`. Param-only edits deliberately do not re-render (comment at inspector-scene-layer.js:251 and :345 here), and the `shownParams` map that tracks current values is only used for show/hide gating. Failing case: in one card, change "Width" (stored via `patchLayer`), then change "Opacity" without anything re-rendering the inspector (the sceneState refresh at inspector-panel.js:416 skips while an input has focus) → the second emit starts from the original params, so Width reverts. The same applies across cards: edit overlay 0, then overlay 1 → overlay 0's edit is lost. Fix: emit from `{ ...shownParams }` and keep a mutable `current` list updated on every emit.
- `BUG` inspector-pip-overlay.js:112-118 — removing the last overlay of an on-air look does nothing after a page reload. `pushLivePipOverlaysToProgram` only posts `/api/pip-overlay/remove` when `prevShape && prevShape.len > 0`; `_pipLiveShape` (:24) is an in-memory map that is empty after a reload, so the first push for a layer that has overlays on air from a Take sees `prevShape === undefined`, skips the remove, and records `len: 0`. The overlay stays on air until the next Take. The non-empty case is fine (:134 removes unconditionally). Fix: when `list.length === 0` and no shape is known, still post the (idempotent) remove.
- `QUALITY` inspector-pip-overlay.js:24,148 — `_pipLiveShape`/`_pipLiveTimers` are keyed `sceneId:layerIndex`; `layerIndex` shifts on layer reorder/delete, so a stale shape can apply to a different layer. Low.

## client/components/inspector-scene-layer.js
- `OK`

## client/components/inspector-screen-timer.js
- `OK`

## client/components/inspector-source-label.js
- `QUALITY` inspector-source-label.js:133-136,139-143 — blur always calls `save()` with no dirty check. Focusing and leaving the field without a change sends `POST /api/sources/label` and runs `onSaved` (a payload re-fetch). Escape (:139-143) reverts the field, then `input.blur()` posts the reverted value anyway. Harmless data-wise (same value), wasteful. Fix: compare against the value at focus.

## client/components/inspector-v4l2-input.js
- `OK`

## client/components/inspector-webpage-host.js
- `RISK` inspector-webpage-host.js:51,53,122 — the template URL is hard-coded to `http://127.0.0.1:4200/template/`. The HTTP port is configurable (`src/config/defaults-core.js:66` `httpPort: 4200`). On a box with another port, "Template" mode builds a URL Caspar's CEF cannot reach, and a saved template URL is no longer recognised as a template (:51). Use the configured port, or a server-side template token.
- `DEAD` inspector-webpage-host.js:39 — `webpage-host-changed` is dispatched but nothing listens. grep: `rg -n "webpage-host-changed" . --glob '!work/**' --glob '!dist*' --glob '!client/assets/map-data.json'` → only this dispatch.

## client/components/led-test-modal.js
- `OK`
