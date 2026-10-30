# src/engine (part 1) — sweep 29.10.2026 (batch 079)

Files: 37 · lines: 6686 · findings: 0 BUG-HIGH, 6 BUG, 5 DEAD, 14 RISK, 23 QUALITY (14 files OK)

Method: every file read in full. Pure functions were run (pip-overlay, ftb, global-border-control, new-project starter config,
multiview apply against a stub amcp) to confirm the BUG items. Dead-code greps covered `src client/lib client/components index.js
godot/client scripts tools` plus `tools/ci/unwired-exports-baseline.json` (the WO-367 ratchet already lists several of the orphans below).
Nothing in this batch is `BUG-HIGH`: no wrong on-air output on a normal path was found. WO-828 (timeline take path) touches no file here.

## src/engine/audio-only-look.js
- `RISK` src/engine/audio-only-look.js:90-97 — advance timer race. `_clearAdvanceTimer` only clears a *pending* timer. When the timer has already fired, `playIndex(idx+1)` is awaiting `amcp.play`, and a new `takeAudioOnlyLook` / `stopAudioOnlyLook` arrives in that window, the stale `playIndex` resumes and arms a fresh timer in `_advanceTimers` (line 97). Failing case: STOP of an audio-only playlist at the instant the timer fires → the in-flight PLAY lands after the STOP/CLEAR and the audio comes back, then keeps advancing every `item.duration`. Window is the AMCP round trip (a few ms), so rare. Fix: a per-channel generation counter checked after the `await`.
- `QUALITY` src/engine/audio-only-look.js:83-84 — a playlist item with an empty `value` makes `playIndex` return without arming the next timer, so the whole audio playlist silently stops at that item (no log). Skip to the next valid item or log.

## src/engine/audio-route.js
- `OK`

## src/engine/caspar-channel-clear.js
- `DEAD` src/engine/caspar-channel-clear.js:23 `isMultiviewCasparChannel()` — unused. grep: `grep -rIn isMultiviewCasparChannel src client tools godot scripts index.js` → only the definition and the export line (own file refs = 2).
- `RISK` src/engine/caspar-channel-clear.js:45-51 — `clearCasparChannel` swallows a failure of both `amcp.clear` and the raw `CLEAR` fallback and returns `undefined`. Its caller `runFadeToBlackAllLayers` therefore reports success, and `routes-ftb.js` goes on to `liveSceneState.clearChannel(...)` → `scene.live` says black while Caspar may still hold the look. Fix: return/throw a failure flag and let FTB skip the `scene.live` clear for that channel.

## src/engine/cg-routing.js
- `RISK` src/engine/cg-routing.js:7-8,43-47 — template-CG overlay band 700–899 lies inside the PIP overlay band 260–979 (pip-overlay-utils.js:55-59). Concrete: `resolveTemplateCgHostLayer(10,'lower-thirds/x')` = 700 and `overlayLayerSlot(130,0)` = 700 (bank-B look layer 130 = the 21st layer of a look; PIP stack 0). A look with ≥21 layers on bank B that has a PIP overlay on its 21st layer shares `CG ch-700` with the lower third, and the PIP clear/ADD (`CG 1-700 CLEAR`, `MIXER 1-700 CLEAR`) removes the lower third. Needs a very large look; not in `look-layer-ranges.js`' band table (see that file).
- `QUALITY` src/engine/cg-routing.js:41,54-59 — `isSceneTemplateCgName` is true for any non-empty name that is `[a-z0-9_-]+`, contains `/` or ends with `.html`; i.e. every template name. `useOverlay` therefore reduces to "not shaders/…" and the `isLowerThirdCgName` test on line 41 is redundant. Name and docs overstate its selectivity.

## src/engine/clip-end-fade.js
- `RISK` src/engine/clip-end-fade.js:209-212 — after `await amcp.mixerOpacity/mixerCommit` the code re-reads `this._pending.get(key)` and attaches the STOP/CLEAR `cleanupTimer` to whatever entry is there. If a new `schedule()` for the same `channel-layer` ran during that await (new take on the same layer), the old fade attaches its cleanup to the NEW entry and, `fadeDurationMs+50` later, STOPs the new clip. Window is a few ms around the fade firing, so very unlikely. Fix: capture the entry (or a token) before the await and compare after.

## src/engine/ftb-pgm-prv.js
- `BUG` src/engine/ftb-pgm-prv.js:85 — `parseInt(String(opts?.durationFrames ?? '25'), 10) || 25` turns an explicit `0` (a hard cut to black) into 25 frames. The `durationFrames > 0` guards on lines 93/99 show 0 was meant to be supported. Failing case run: `runFadeToBlackAllLayers(amcp,[1],{durationFrames:0},self)` → sent `MIXER 1-10 OPACITY 0 25 linear`, returned `durationFrames: 25`, took ~700 ms before `CLEAR 1`. Web and Godot always send ≥1 (`round(0.5*fps)`), so only API/Companion callers hit it. Fix: `Number.isFinite(n) ? n : 25`.
- `RISK` src/engine/ftb-pgm-prv.js:114 — `await amcp.mixerCommit(ch)` sits outside any try. One channel that rejects (e.g. a PRV channel that does not exist yet) throws out of the fade loop, so no channel gets its final `CLEAR` and `routes-ftb.js` answers 502 with layers left at opacity 0 and nothing cleared.
- `DEAD` src/engine/ftb-pgm-prv.js:130 re-export `TIMELINE_LAYER_BASE` — importers of this module (`routes-ftb.js:11`, `routes-scene-look-preset.js:140`) take only `runFadeToBlackAllLayers` / `collectLayersToFadeOnChannel`. grep: `grep -rn "ftb-pgm-prv" src tools` → those two only.
- `QUALITY` src/engine/ftb-pgm-prv.js:16-18 — `mapTween` is a one-line wrapper over `toCasparTween`.

## src/engine/global-border-control.js
- `BUG` src/engine/global-border-control.js:181 — turning the PRV mirror off restores the PGM snapshot (lines 126-137, `enabled: !!snap.enabled`), but line 181 `else if (!preset) next.enabled = wasEnabled` then overwrites it whenever the request has no `enabled` key. The web equivalent (`client/lib/scene-state-global-border.js:238-248`, `turningPrvOff`) keeps `snap.enabled`. Failing cases run: stored `{enabled:true,type:'glow',mirrorBorderOnPrv:true,pgmAirSnapshot:{enabled:false,type:'border'}}` + `{mirrorBorderOnPrv:false}` → `next.enabled=true` (PGM had no border: an UPDATE with `isUpdate=true` goes to an empty layer and the slot claims "on"); and stored `{enabled:false,…,pgmAirSnapshot:{enabled:true}}` → `next.enabled=false`, nothing is sent while the PGM border is still on air (slot says off, air says on). Fix: skip the `wasEnabled` fallback when `restoredPgm`, and base `wasEnabled`/`isUpdate` on the PGM snapshot in that case.

## src/engine/global-border-live.js
- `QUALITY` src/engine/global-border-live.js:35 — the atomic write goes through `global-border-live-N.json.tmp` (up to ~60 writes/s during DMX). `.gitignore:59` lists the `.json.tmp`, `.stignore:50` only lists `template/global-border-live-*.json`, so Syncthing can pick up the transient tmp file. Add the `.json.tmp` line to `.stignore`.

## src/engine/global-border.js
- `BUG` src/engine/global-border.js:100,130 — AMCP data string is escaped with `data.replace(/"/g, '\\"')` only. The repo's own `param()` (src/caspar/amcp-utils.js:18) also escapes backslashes and folds CR/LF. JSON from `JSON.stringify` already contains `\"` / `\\` for any param value holding a quote or backslash, and the bare replace turns `\"` into `\\"`, which ends the AMCP string early. Failing case run (same code shape as pip-overlay, see that file): colour `red"x` → `…\"color\":\"red\\"x\"…`. Border params are normally colour-picker values, so only free text triggers it. Fix: use `param(data)` (or escape `\` first).
- `QUALITY` src/engine/global-border.js:14-21,28-33 — `mergeScreenSlicesIntoBorder` (called from `scene-take-lbg.js:285` on every take whose look has a `globalBorder`) → `readGlobalBorderSlot` → `loadProjectScenes()` → `loadFullProject()`: two synchronous JSON reads/parses of the project + autosave (+ the USB pull check inside `readProjectFile`) on the take path. Cache the envelope per take or pass `project` in.
- `QUALITY` src/engine/global-border.js:90,177 — `appCtx` parameter of `buildGlobalBorderAmcpLines` / `buildGlobalBorderPresetCrossfadeLines` is never used.
- `DEAD` src/engine/global-border.js:208 export `readGlobalBorderSlot` — only used inside this file (baselined in `tools/ci/unwired-exports-baseline.json:377`).

## src/engine/layer-crop.js
- `QUALITY` src/engine/layer-crop.js:56,96-143 — server-side mirror functions `cropAdjustedRect`, `layerRectFromVisibleRect`, `layerRectFromVisibleRectForLayer`, `visibleRectForLayer`, `alignFillForCrop`, `alignFillForLayer` have no production consumer (production uses only `cropAdjustedFillForLayer`; grep `src` → `scene-take-pgm-only.js`, `scene-take-lbg-amcp-pipeline-batch.js`, `routes-scene-preview-pip.js`). They are kept alive by the ESM/CJS parity smoke `tools/smoke/smoke-layer-crop.test.js`, so counted live; just 6 exports of unused server code.

## src/engine/led-test-card-control.js
- `OK`

## src/engine/live-input-audio-policy.js
- `OK`

## src/engine/live-input-route-reassert.js
- `RISK` src/engine/live-input-route-reassert.js:44-46 — `pgmDestLayerForInput(kind, slot)` ignores `kind`. A DeckLink slot 1 and a V4L2 slot 1 that both target program channel 3 are both replayed onto `3-321`; the second `STOP/MIXER CLEAR/PLAY` (lines 120-125) kills the first. The client mirror (`client/lib/live-audio-routing.js:101-103`) has the same formula, so the pair is consistent, but the collision is real for mixed rigs.
- `RISK` src/engine/live-input-route-reassert.js:35 — destination layers 321–328 on program channels sit inside the PIP overlay band: `overlayLayerSlot(25,1)` = 321, `overlayLayerSlot(27,0)` = 328 (checked). A take that removes a PIP overlay on look layer 25–27 emits `MIXER 3-321 CLEAR` (`buildPipOverlayRemoveLines(3,25)`), which resets the audio-only route's `OPACITY 0` and makes the input picture visible full-frame on PGM. Needs a ≥16-layer look with stacked PIP overlays, so unlikely, but it is a wrong-output path. See `look-layer-ranges.js`.

## src/engine/look-air-compose-channel.js
- `QUALITY` src/engine/look-air-compose-channel.js:16 `resolveLookAirComposeChannel` — no production consumer in `src/`. grep: `grep -rn "look-air-compose-channel" src index.js` → only the comment in this file; `client/components/scenes-editor-deck-thumb.js:10` imports the client twin. Only `tools/smoke/smoke-look-air-compose-channel.test.js` requires this server copy. Candidate for removal with the smoke, or keep deliberately as the parity reference.

## src/engine/look-layer-ranges.js
- `QUALITY` src/engine/look-layer-ranges.js:3-18 — the "single source of truth" band table is incomplete and overlaps real users: live-input audio route layers `320+slot` (321–328) and template-CG overlay layers 700–899 (cg-routing.js:7-8) both lie inside the "PIP overlays 260–979" row; the PRV border mirror layer 997 (global-border-control.js:14) is not listed (table says "996 / 998"). The collisions are shown concretely under `live-input-route-reassert.js` and `cg-routing.js`. Either move those bands outside 260–979 or document and guard them.

## src/engine/loop-restart-watchdog.js
- `OK`

## src/engine/multiview-apply-overlay.js
- `QUALITY` src/engine/multiview-apply-overlay.js:118 — `parseInt(RegExp.$1, 10)` relies on the legacy static `RegExp.$1` set by a `match()` inside the same conditional expression. It works, but breaks silently if anything between the match and the use runs a regex. Use the match result.
- `QUALITY` src/engine/multiview-apply-overlay.js:35-75,77-132 — `overlayType()` and the pgm/prv index inference are computed twice per cell (once for `cells`, once for `keyed`). Fold into one pass.

## src/engine/multiview-apply.js
- `QUALITY` src/engine/multiview-apply.js:19-20 — unused imports `inferPgmScreen`, `inferPrvScreen` (each occurs once in the file; the overlay file imports its own copies).
- `QUALITY` src/engine/multiview-apply.js:328-348 — `cell._calc = {...}` mutates the caller's `layout` cells. `routes-multiview.js:59-63` then stores that same `body` object in `ctx._multiviewLayouts[n]` and `persistence.set('multiviewLayout…')`, so derived `_calc` geometry is persisted (and copied into `project.hardwareConfig.multiviewLayout`). Run against a stub amcp: the layout cell `{id:'pgm',x:0,…}` came back with `_calc:{vx:0.001563,…}`. It is recomputed on every apply so harmless today, but it is persisted derived state. Fix: work on a copy.
- `RISK` src/engine/multiview-apply.js:263-264 — fallback `PLAY [html] color_bg` + `CALL ch-L "update('<json>')"` puts raw JSON (with `"`) inside an AMCP double-quoted string: line becomes `CALL 3-10 "update('{"color":"#000000"}')"`. Only backslash and `'` are escaped, not `"` (compare `param()`), so by AMCP quoting the string ends at the first `"`. Only reached when `CG ADD color_bg` throws; I could not test it against Caspar. Same pattern in multiview-layout-helper.js:231-232, where the payload has user-typed labels (spaces) as well.
- `RISK` src/engine/multiview-apply.js:31,200-203 — cell layers are `11 .. 11+layout.length-1`; with ≥50 cells the cell layers run into `OVERLAY_LAYER = 60`, and the overlay CG replaces cell 50. `MAX_MV_LAYERS = 48` is exported but never enforced on the incoming layout (grep: only used in the broad-clear range on line 218).
- `QUALITY` src/engine/multiview-apply.js:28,218-220 — comment "Layers 1–9: DeckLink inputs (when inputsOnMvr)" is stale: `routing-map.js:293` fixes `inputsOnMvr = false`. In the no-INFO branch `layersToClear` is filled with ~60 numbers only to log a count and pass the `length > 0` test before a whole-channel `CLEAR`.
- `QUALITY` src/engine/multiview-apply.js:128-137 — the JSDoc of `_doApplyMultiviewLayout` sits above `clampMultiviewTimerScale` (detached docblock).

## src/engine/multiview-layout-helper.js
- `RISK` src/engine/multiview-layout-helper.js:231-232 — same under-escaped `CALL … "update('…')"` fallback as multiview-apply.js:263-264; here the payload contains cell labels with spaces, so even by Caspar's tokenizer the quotes cannot be assumed to survive. Fallback only (CG ADD of `multiview_master` / `multiview_overlay` failed). Use `param()` or `CG ADD/UPDATE` only.

## src/engine/multiview-reapply.js
- `OK`

## src/engine/new-project.js
- `BUG` src/engine/new-project.js:41-50 (via src/engine/project-hardware-config.js:75) — New project carries the OLD project's multiview layout. `buildStarterHardwareConfig(persistence)` calls `buildHardwareConfigFromConfig(factoryConfig, persistence)`, which sets `multiviewLayout: persistence.get('multiviewLayout') ?? null`. Run: with a fake persistence holding `{n:1,layout:[{id:'pgm'}]}`, `buildStarterHardwareConfig(...).hardwareConfig.multiviewLayout` = that layout. Consequences: (1) `applyHardwareConfigToCtx` (project-hardware-config.js:172-184) re-persists it and fires `applyMultiviewLayout` on it against the new channel map; (2) `buildNewUntitledProject(hardwareConfig)` (line 193) writes it into the new Untitled project, so `clearPersistedMultiviewLayout(ctx)` (line 205) wipes the persisted copy but the project file still holds the old grid, and a later load with `applyHardware` replays it. Fix: set `hardwareConfig.multiviewLayout = null` in `buildStarterHardwareConfig`.
- `RISK` src/engine/new-project.js:4,167-211 — header says "Atomic", but it is a sequence of independent side effects (config save, persistence removes, deck persist, project write). A throw in `persistProject` (line 210) leaves the hardware config reset and the old project still active with an empty deck mirror. `applyHardwareConfigToCtx` also returns `false` with no cause (swallowed catch, project-hardware-config.js:188), which becomes the unspecific "Failed to apply starter hardware configuration".

## src/engine/pip-overlay-utils.js
- `RISK` src/engine/pip-overlay-utils.js:55-59 — PIP slots `260 + idx*4 + stack` (up to 979) overlap two other fixed users: live-input audio route layers 321–328 and template-CG overlay layers 700–899. Verified: `overlayLayerSlot(25,1)=321`, `overlayLayerSlot(130,0)=700`. See live-input-route-reassert.js and cg-routing.js for the failing sequences; the bank-A/B layout of 4 slots × 180 layers is far larger than any real look uses, so the tail of the band (e.g. ≥ 620) could be handed to the other users instead.
- `RISK` src/engine/pip-overlay-utils.js:36-44 — `pipOverlayContentIndex` clamps out-of-band input silently, so any caller passing a layer outside 10–199 aliases a real slot. Checked: `buildPipOverlayRemoveLines(1,5)` → slot 260 (look layer 10's), `buildPipOverlayRemoveLines(1,210)` → slot 976-979 (bank-B layer 199's). Today's callers (look takes, `clip-end-fade.js:222`) pass look layers only, so latent.
- `QUALITY` src/engine/pip-overlay-utils.js:61-70,97-105 — the `nextContentLayer` parameter is documented "ignored" (WO-160) but is still threaded through ~10 signatures plus `nextPipContentLayerInScene` / `nextPipContentLayerInTake` (10000 sentinel) whose only purpose is to produce that ignored value.
- `DEAD` src/engine/pip-overlay-utils.js:338 `sumOutsideOutsetPx()` is used only by `computePipRouterPlacement` (itself reachable only from the dead router builders in pip-overlay.js) and `tools/smoke/smoke-pip-overlay-placement.test.js`.

## src/engine/pip-overlay.js
- `BUG` src/engine/pip-overlay.js:88,90,189,226,228,267 — same under-escaped AMCP string as global-border.js: `data.replace(/"/g, '\\"')` without escaping `\`. Failing case run: `buildPipOverlayAmcpLines({type:'border',params:{color:'red"x',width:4}},1,10,…)` →
  `CG 1-260 ADD 0 "pip_border" 1 "{\"width\":4,\"color\":\"red\\"x\",…}"` — the `\\"` closes the string; `param(JSON.stringify(...))` gives `…\"red\\\"x\"…`. Overlay `params` are operator-editable per layer. Fix: use `param(data)` in all six places.
- `DEAD` src/engine/pip-overlay.js:195-268 `buildPipOverlayRouterAmcpLines`, `buildPipOverlayRouterUpdateLines` — no caller. grep: `grep -rn "buildPipOverlayRouter" src client tools godot scripts` → definitions, exports, and `tools/ci/unwired-exports-baseline.json:381-382` only. (`computePipRouterPlacement` in utils is exercised only by `smoke-pip-overlay-crop-border.test.js`.)

## src/engine/playlist-edit.js
- `OK`

## src/engine/playlist-empty.js
- `OK`

## src/engine/playlist-fade-out.js
- `OK`

## src/engine/playlist-path-match.js
- `OK`

## src/engine/program-layer-bank.js
- `OK`

## src/engine/project-activate.js
- `QUALITY` src/engine/project-activate.js:11-19 — header cites `file:line` references that no longer match (`project-scenes.js:208-217`, `project-scenes-transform.js:71/126`, `new-project.js:79`, `project-scenes-load.js:64/119`); the claims are still correct but the pointers are stale.

## src/engine/project-client-slices.js
- `OK`

## src/engine/project-events.js
- `OK`

## src/engine/project-hardware-config.js
- `QUALITY` src/engine/project-hardware-config.js:188-190 — `applyHardwareConfigToCtx` swallows every exception (`catch { return false }`): a failed `cm.save`, a bad snapshot or a throw in the snapshot apply gives no log line, only a boolean the callers turn into a generic message.
- `QUALITY` src/engine/project-hardware-config.js:75,172-184 — a project carries only the persisted `multiviewLayout` (multiviewer 1); `multiviewLayout_2…` are never captured or restored with the show. Also the `void applyMultiviewLayout(...).catch(() => {})` on project load hides a failed apply entirely (the next reconnect re-apply is the only retry).

## src/engine/project-hardware-hold.js
- `OK`

## src/engine/project-scenes-load.js
- `QUALITY` src/engine/project-scenes-load.js:57-81,105-111 — `loadFullProject()`/`loadProjectScenes()` re-read and parse both project files synchronously on every call (no cache); callers on the take path are `global-border.js` (see above) and `resolveSceneById` (project-scenes-transform.js:210-216, sceneId-only takes). Each call also runs the USB pull check in `readProjectFile`/`readAutosaveFile`.
- `QUALITY` src/engine/project-scenes-load.js:83 — the JSDoc `@param fromPersist/fromAutosave` is attached to `projectSceneCount(project)`; belongs to `pickNewerFullProject`.

## src/engine/project-scenes-transform.js
- `OK`

## src/engine/project-scenes.js
- `BUG` src/engine/project-scenes.js:311-317 — `applyDeckSyncToProject` treats `sceneSnapshots: []` the same as "absent" (`Array.isArray(snapRaw) && snapRaw.length ? … : envelope.scenes`), so a deck sync that removes the LAST look never reaches disk. The web client sends exactly that (`client/lib/app-scene-deck.js:5-16` → `sceneSnapshots: scenes.map(…)`; empty list for no looks). Flow by code reading (not executed here: a repro needs project-file writes): `mergeDeckSyncIntoProject` builds `project` with the old scenes, `validateIncomingProject` passes (same set), `applyLiveSceneDeckToCtx(ctx,data)` empties the in-memory deck, `scheduleDeckSyncPersist` persists the old scenes → `buildSceneDeckForApi` falls back to the project and returns the deleted look; after a restart it is back. Deleting the second-to-last look works (non-empty snapshots). Fix: use `Array.isArray(snapRaw)` and rely on `validateIncomingProject`/`allowReplace` for the empty-over-non-empty guard.
- `RISK` src/engine/project-scenes.js:38-60,69 — `flushDeckSyncPersist` runs from a `setTimeout` with no try/catch around `persistProject`. `persistProject` throws on `writeProjectFile` errors (disk full, EACCES). `src/bootstrap/process-guards.js:21-28` turns any uncaught exception into `process.exit(1)`, so a disk error during a debounced deck sync restarts the whole node server mid-show (Caspar keeps playing). Wrap the flush in try/catch and log.
- `QUALITY` src/engine/project-scenes.js:191-213,300-305 — the big `persistProject` JSDoc (WO-261/329) is separated from the function by `projectContentEquals`; the `mergeDeckSyncIntoProject` JSDoc sits above `applyDeckSyncToProject`.

## src/engine/project-store.js
- `QUALITY` src/engine/project-store.js:216-228 — the JSDoc above `autosaveFilePath` is a leftover (`@param {object} project`); and `autosaveFilePath` creates `_autosave/` as a side effect, so `readAutosaveFile` mkdirs on a pure read.
