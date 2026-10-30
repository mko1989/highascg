# src/engine (part 2: project-*, scene-*) — sweep 29.10.2026 (batch 080)

Files: 29 · lines: 6953 · findings: 1 BUG-HIGH, 10 BUG, 17 DEAD, 12 RISK, 12 QUALITY

Method notes: every file read in full. Repros below were run against the real modules with a stub `amcp` (scratchpad scripts, no AMCP sent to Caspar, no
repo writes). Context that matters for severity: every production caller of `runSceneTakeLbg` (routes-scene-take.js:202/278/364/392/422,
mirror-apply.js:122) passes `skipLayerVisualEquality: true`; only `routes-project.js:114` (sync-push, `currentScene: null`, forceCut) omits it.
Dead-export greps covered `src tools client scripts index.js godot`; `tools/ci/unwired-exports-baseline.json` already lists several of them.

## src/engine/project-stream-credentials.js
- `BUG` src/engine/project-stream-credentials.js:273 — `moveKey` decides "project already holds it" with `projectHasCredential`, which is also true when the project holds only an `srtPassphrase`. Failing case: project `streaming.credentials.streamingChannel = { srtPassphrase: 'p' }`, config `streamingChannel = { rtmpServerUrl: 'rtmp://x', streamKey: 'K' }` → `migrateConfigCredentialsIntoProject` leaves the project with only the passphrase (no url/key), returns `streamingChannel: { rtmpServerUrl: '', streamKey: '' }` so the caller blanks the config copy, and logs "purged duplicate config credential (project already holds it)". The stream key is lost for good (reproduced). Fix: test url/key only (`projectHasStreamKey || rtmpServerUrl`), or merge field by field and keep the passphrase.
- `DEAD` src/engine/project-stream-credentials.js:332,336 `STREAMING_CHANNEL_KEY`, `projectHasCredential`, `configStreamOutputIds` — exported but never imported elsewhere (own-file use only); `getCredentialsMap`, `projectHasSrtPassphrase`, `readConfigCredential` are imported only by tools/smoke/smoke-wo261-project-stream-credentials.test.js. grep: `grep -rlw <name> src tools client scripts index.js godot`.
- `QUALITY` src/engine/project-stream-credentials.js:274 — the migrated entry is written without `srtPassphrase`, while every other writer uses the full three-field shape (`withProjectCredential:111`). Harmless today, inconsistent shape.

## src/engine/project-volume-sync.js
- `BUG` src/engine/project-volume-sync.js:304 — `copyIfSrcNewer` skips only when `dst.mtime >= src.mtime AND dst.size >= src.size`, so an OLDER but BIGGER source overwrites a NEWER but smaller destination, despite the name/doc "when source is newer". Failing case: stick copy 100 bytes mtime T-1h, local 50 bytes mtime T (operator deleted layers) → `copyIfSrcNewer(stick, local)` returns true and local becomes the stale 100-byte file (reproduced). Reached on project load via `pullProjectSlugFromUsbIfNewer` / `pullAutosaveSlugFromVolumesIfNewer` (project-store.js:202/270) whenever saves happened while the stick/bridge was not mounted. Fix: compare mtimes only (with the exFAT 2 s window); use size only to repair a truncated dst when mtimes are equal.
- `RISK` src/engine/project-volume-sync.js:179 — `scanProjectsDir` renames a project file to `.corrupt-<ts>` as a side effect of a LIST (also on the stick/bridge). A half-copied or momentarily unreadable file on a mount is moved out of the catalog by merely opening the load dialog. No failing case shown (copies are synchronous in-process; Syncthing uses temp names), but a read path that mutates volumes is fragile.
- `DEAD` src/engine/project-volume-sync.js:416 `PROJECTS_SUBDIR` — exported, no importer outside the file.

## src/engine/projects-root.js
- `OK`

## src/engine/scene-exit-layers.js
- `BUG` src/engine/scene-exit-layers.js:278 — `chunkSize = Math.floor(resolveMaxBatchCommands(...) / 3)` is 0 when `amcp_max_batch_commands` is 1 or 2 (both accepted: amcp-batch.js MAX_BATCH_ABS_MIN = 1, `HIGHASCG_AMCP_MAX_BATCH=1` accepted by bootstrap/config.js:39). The `for (i = 0; …; i += chunkSize)` loop then never advances and the `continue` on the empty chunk spins forever, freezing the whole Node event loop. Failing case: `clearSceneProgramLookStackLayers(amcp{_context:{config:{amcp_max_batch_commands:2}}}, 1, {config:{}})` never returns (reproduced: killed by `timeout 5`). Fix: `Math.max(1, Math.floor(max / 3))`.
- `QUALITY` src/engine/scene-exit-layers.js:34 — third copy of a `layerHasContent` with a third meaning (scene-transition.js, scene-look-kind.js:78 and here all differ: this one needs `source.value`, look-kind also counts `template`/`cgData`/placeholders). Same name, three semantics.
- `QUALITY` src/engine/scene-exit-layers.js:270,380 — `catch (_) {}` around the PIP-overlay layer collection and `catch {}` around the whole exit STOP/CLEAR timer swallow every failure silently; a failed exit teardown leaves layers on air with no log line.
- `DEAD` src/engine/scene-exit-layers.js:392,396,403 — `fadeExitLayerOpacities`, `runExitLayersStopAndClear`, `collectOccupiedLookLayersOnChannel`, `physicalLookLayerBank` are exported but used only inside this file (`runExitLayers` is the one external entry, via scene-transition.js:254). `isLookPhysicalLayer` is a pass-through re-export of look-layer-ranges.

## src/engine/scene-layer-rotation-amcp.js
- `OK`

## src/engine/scene-live-main-sync.js
- `RISK` src/engine/scene-live-main-sync.js:37 — `syncMainSlotsFromSceneLive` `continue`s when a main has no separate PRV channel and leaves the previous `previewSceneIdByMain[idx]` untouched, whereas `resolveBusLookIdsForMain` (same file, :74) returns `prvLookId = null` for the same topology. After a PRV channel is removed from the channel map the stored preview id stays stale (state diverges from the resolver). No concrete caller-visible failure shown.

## src/engine/scene-look-kind.js
- `QUALITY` src/engine/scene-look-kind.js:78 — exports a `layerHasContent` that disagrees with the same-named helpers in scene-transition.js and scene-exit-layers.js (see scene-exit-layers.js:34); easy to import the wrong one.

## src/engine/scene-native-fill.js
- `DEAD` src/engine/scene-native-fill.js:63 `nativeFillNorm()` — `grep -rnw nativeFillNorm src tools client godot scripts` → only the definition and the export (also listed in tools/ci/unwired-exports-baseline.json:396).
- `RISK` src/engine/scene-native-fill.js:287 — `probeResolutionFromDisk` awaits `probeMedia` (ffprobe, local-media-ffmpeg.js:14) with no timeout, and `tried.add` happens only after it returns. A file on a stalled mount blocks `getResolvedFillForSceneLayer` → `buildTakeJobs` → the whole take on a sequential per-layer await; a missing file (`!fp`, :286) is never marked tried and is re-resolved on every take.

## src/engine/scene-play-seek.js
- `DEAD` src/engine/scene-play-seek.js:156 `elapsedFramesFromPlayback()` — exported, zero users (grep `elapsedFramesFromPlayback` over the repo → definition + export + unwired-exports-baseline.json:397). `getLastPlayFrame`, `getActiveTimelineForTake`, `seekFramesFromTimelineClip` are exported but used only in this file.
- `QUALITY` src/engine/scene-play-seek.js:14 — `logicalLayerFromPhysical` maps every physical layer > 100 to `n - 100`, so a timeline layer 210 becomes "logical 110" (used by `resolveTimelineClipFrame:337` for `rememberLastPlayFrame`). No look uses logical 110+, so no collision today, but the key space is shared with look layers.

## src/engine/scene-relative-seek-lead.js
- `OK`

## src/engine/scene-route-deps.js
- `BUG` src/engine/scene-route-deps.js:260 — `while (remaining.length > 0 && guard++ <= remaining.length + 8)`: `remaining` shrinks every iteration while `guard` grows, so the loop stops after about `(N+7)/2` iterations and the unplaced routes are silently dropped (the `break`-with-append path is only taken on "no progress"). Failing case: a source layer plus N same-channel `route://<ch>-<L>` layers → N = 11 returns 10 jobs, N = 16 returns 13, N = 20 returns 15 (reproduced with `orderRouteJobsByDependency`). The dropped route layers are never PLAYed by `sendStaggeredTakePlays` (both the two-phase and staggered path use `orderedRoutes`). Fix: bound the loop by the original length (`guard < total + 8`) or just loop `while (remaining.length)` since the no-progress branch already terminates.
- `QUALITY` src/engine/scene-route-deps.js:118 — `findCrossChannelRouteCycles` finds 2-hop cycles only and is warn-only by owner decision (WO-156); the doc says "multi-hop". Comment drift only.
- `DEAD` src/engine/scene-route-deps.js:452 `resolveRoutePlayDelays` — exported, used only inside the file.

## src/engine/scene-take-lbg-amcp-pipeline-batch.js
- `OK`

## src/engine/scene-take-lbg-amcp-pipeline-fade.js
- `OK`

## src/engine/scene-take-lbg-amcp-pipeline.js
- `BUG` src/engine/scene-take-lbg-amcp-pipeline.js:364-374 — a Phase B failure (PLAY/crossfade batch rejects: dropped socket, ack timeout) is caught and only logged; `runSceneTakeLbg` carries on. Failing case (stub amcp whose `batchSendChunked` throws on the PLAY batch, CUT take over a live look): the log shows "take Phase B … failed … fadeClockStarted=false", then the teardown sends `CG 1-10 CLEAR / STOP 1-10 / MIXER 1-10 CLEAR` (outgoing look removed, incoming never PLAYed → black PGM), `programLayerBankByChannel` flips `a → b`, and the function returns `{ ok: true }`, so the route sets `scene.live` to the new look (reproduced). State then claims the new look is on air while Caspar shows black or the bank-B BG. Fix: rethrow after logging (before teardown/bank flip), or skip the teardown + flip and return `ok:false`.
- `RISK` src/engine/scene-take-lbg-amcp-pipeline.js:187 — the whole block that builds `crossfadeLines` (outgoing exit fades, global-border fade-in/out, timeline fade-in) is gated on `takeJobs.length > 0 || mergeMixerExtras.length > 0 || (shouldRunBankCrossfade && timelineFadeInPhys.length > 0)`. With zero takeJobs and no timeline, a MIX take sends no exit fade and no border fade. Repro 1 (current `{10:A, 11:B}`, incoming `{10:A}`, MIX 25 f, `skipLayerVisualEquality` unset): layer 11 gets `CG/STOP/MIXER CLEAR` at once — a hard cut instead of a fade. Repro 2 (same layers, incoming adds an enabled `globalBorder`): `MIXER 1-998 OPACITY 0 0` + CG ADD is sent and nothing ever fades it in — the border stays at opacity 0 (both reproduced via `runSceneTakeLbg`). Latent only: every production caller sets `skipLayerVisualEquality: true`, which turns every non-timeline content layer into a takeJob; becomes live as soon as a caller drops that flag (the WO-218 equality skip is the one thing that empties `takeJobs`). Fix: also enter the block when `exitMedia.length > 0 || gbWillFadeIn || gbWillFadeOut`.
- `QUALITY` src/engine/scene-take-lbg-amcp-pipeline.js:216 — `(shouldRunBankCrossfade || !job.hasLoadTransition)` is always true inside `if (shouldRunBankCrossfade)`; dead condition.
- `QUALITY` src/engine/scene-take-lbg-amcp-pipeline.js:467 — `recordTemplateHostAdded` is documented as the missing wiring, but `buildSceneTemplateCgAmcpLines` already records the host at build time (scene-template-cg.js:169); the second call is redundant, and the comment is stale.

## src/engine/scene-take-lbg-bank-finalize.js
- `DEAD` src/engine/scene-take-lbg-bank-finalize.js:44-62,72-89 — the WO-218 SWAP/`MIXER CLEAR` of `skippedVisuallyEqualLayers` can never run in production: the list is filled only when `skipLayerVisualEquality` is false (scene-take-lbg-jobs.js:150-164) and every route/mirror caller passes `true` (routes-scene-take.js:202,278,364,392,422; mirror-apply.js:122); `routes-project.js:114` has `currentScene: null`, so `hasOutgoingOnAir` is false. grep: `grep -rn skipLayerVisualEquality src` → all `true`. Only smoke tests (wo218, wo259) exercise it. Either keep it as a documented option or delete the equality-skip machinery in jobs/lbg/finalize.

## src/engine/scene-take-lbg-exit-fade.js
- `QUALITY` src/engine/scene-take-lbg-exit-fade.js:81-86 — `try { batchSendChunked; mixerCommit } catch (_) {}` swallows a failed fade send with no log, then still sets `newFadeClockStart` and calls `notifyProgramTransitionStarted()`; the teardown will wait the fade window and then pop the layer. Log the failure.

## src/engine/scene-take-lbg-helpers.js
- `BUG` src/engine/scene-take-lbg-helpers.js:27-47 — `buildEffectAmcpLines` interpolates effect params into AMCP lines with no escaping or numeric coercion; `stripAmcpLineBreaks` exists but is not applied, and the TCP layer does not strip CR/LF (tcp-client.js:134 only appends CRLF). Failing case: `buildEffectAmcpLines('brightness', { value: '1\r\nKILL' }, '1-10')` → `["MIXER 1-10 BRIGHTNESS 1\r\nKILL 0"]`; `blend_mode` `mode: 'x\nkill'` likewise (reproduced). `validateBatchLine` only checks the first word. A second AMCP command is injected into the stream from a look's `effects[].params` (client-supplied take payload / stored project). Fix: `Number(x)` + `Number.isFinite` for numeric params, and `param()`/allow-list for `mode`/`key`.
- `RISK` src/engine/scene-take-lbg-helpers.js:48-49 — the `rotation` effect emits `ANCHOR 0.5 0.5` + `ROTATION` (via `sceneLayerRotationMixerLines`) but, unlike `layer.rotation` (jobs.js:308 `fillForSceneLayerRotationAnchor`), does not shift FILL by half the layer size, so a layer with a `rotation` effect and no `layer.rotation` would jump by (scaleX/2, scaleY/2). `client/lib/effect-registry.js:209` offers this effect type. Not verified on air.
- `DEAD` src/engine/scene-take-lbg-helpers.js:10,101 `STILL_IMAGE_LOADBG_NO_TRANSITION_EXT` — defined and exported, zero users anywhere (unwired-exports-baseline.json:402). `STRAIGHT_ALPHA_VIDEO_EXT` is exported but used only inside the file.

## src/engine/scene-take-lbg-jobs.js
- `BUG` src/engine/scene-take-lbg-jobs.js:331 — `MIXER ${cl} OPACITY ${layer.opacity ?? 1} 0` uses the raw payload value, while the same function computes the coerced `targetOpacity = Number(...)` three lines later. A string opacity such as `"1\r\nKILL"` goes straight into the batch (same injection class as helpers.js:27; the line is later DEFER-wrapped). Fix: use `targetOpacity` (and guard NaN).
- `RISK` src/engine/scene-take-lbg-jobs.js:166-175 — the manual-playlist index is advanced as soon as the job is built, before any AMCP is sent; if the take then fails (Phase A throws), the operator's next "Next" is one item ahead of what is on air. Not reproduced.
- `DEAD` src/engine/scene-take-lbg-jobs.js:150-165 — see scene-take-lbg-bank-finalize.js: with `skipLayerVisualEquality` always `true` in production, the `layerVisuallyEqual` skip and `skippedVisuallyEqualLayers` are unreachable outside tests.

## src/engine/scene-take-lbg-merge.js
- `BUG-HIGH` src/engine/scene-take-lbg-merge.js:45 — the +Animate exit fade targets `${channel}-${ln}` (the LOGICAL layer = bank-A physical), but the layer is on air at `phys(ln, activeBank)`. The function even computes `pL = phys(ln, activeBank)` at :39 for its guard and then does not use it. Merge takes do not flip the bank pointer, and any earlier plain/CUT take leaves `activeBank = 'b'`. Failing case: bank `b` active, current `{10:A, 11:B}`, incoming `{10:A2}` with `MIX + ANIMATE` 25 f → the take sends `MIXER 1-11 OPACITY 0 25 linear DEFER` (empty bank-A slot) while layer 11 is on air at 1-111; the teardown after the fade window then does `CG/STOP/MIXER CLEAR` on 1-11, 1-111 (reproduced). The removed layer stays at full opacity for the whole transition and then pops: a fade becomes a cut. Same applies to the PIP-overlay fade lines in :53 (`ln` instead of `pL`). Fix: build `cl` from `pL`, pass `pL` to `buildPipOverlayOpacityFadeDeferLines`.
- `DEAD` src/engine/scene-take-lbg-merge.js:139 `buildMergeOutgoingOpacityDeferLines` — exported, used only by `buildMergeMixerExtrasForTake` in this file.

## src/engine/scene-take-lbg-playlist.js
- `RISK` src/engine/scene-take-lbg-playlist.js:317 — `durationMs = (item.duration ?? 5) * 1000`: a playlist item with `duration: 0` (or a non-numeric string → NaN → 1 ms) arms a ~0 ms timer; with `playlistLoop !== false` the list then hops at tight-loop speed. Clamp to a sane minimum.
- `RISK` src/engine/scene-take-lbg-playlist.js:72 / scene-take-lbg.js:448 — `clearChannelPlaylistState` (the "every take wipes the channel's playlist state" rule) runs inside `setupLayerPlaylists`, which `runSceneTakeLbg` only calls when `takeJobs.length > 0`. A timeline-only take over a look with a running image-playlist timer does not clear it; only the `liveNow.scene.id` check at :331 prevents a stray hop when the timer fires. Not reproduced end to end.
- `QUALITY` src/engine/scene-take-lbg-playlist.js:291,361 — `layer.playlistTransition.tween` (stored with every playlist, scene-take-payload.js:77) is never put into `loadOpts`, so playlist hops always use the default tween; jobs.js:275 does pass `tween` for ordinary takes.
- `DEAD` src/engine/scene-take-lbg-playlist.js:454 `clearChannelPlaylistState` — exported, used only inside the file.

## src/engine/scene-take-lbg-teardown.js
- `BUG` src/engine/scene-take-lbg-teardown.js:127-133 — the WO-540 opacity verification polls `phys(exitMedia[0].layerNumber, activeBank)` for target 0, but on a bank-A→B crossfade the outgoing bank-A layer of a REPLACED layer is deliberately never faded (the incoming bank-B layer ramps up on top; scene-take-lbg-amcp-pipeline.js:216-221). `exitMedia[0]` is a replaced layer whenever the look has no pure-exit layer (plain look→look). The poll therefore waits out the whole `verifyBudgetMs = 2*fadeMs - elapsed`. Failing case: current `{10:A}`, incoming `{10:A2}`, MIX 25 f @ 50 fps, bank `a`, Caspar answering `MIXER 1-10 OPACITY` with 1 → `STOP 1-10` is sent at t = 1201 ms instead of ≈ 700 ms; 14 polls of `MIXER 1-10 OPACITY` (reproduced with a stub that reports the queried value). Every bank-A→B replacing take returns ≈ `fadeMs` late (scene.live/UI update after `await pgmTakePromise`), and any part of the outgoing not covered by the incoming stays on air that much longer. Same wrong reference in the timeline branch (:124-126): `TIMELINE_LAYER_BASE` (210) with target 0 is polled even when 210 is in `timelineFadeInPhys` (a different timeline entering on the same band, scene-take-lbg.js:340), where it ramps UP to 1. Fix: pick the reference from the lines actually sent (an exit-only layer faded to 0, or a fade-in layer with target 1), skip verification when none exists.
- `QUALITY` src/engine/scene-take-lbg-teardown.js:252-258 — the final `sendPipOverlayLinesSerial(teardownLines)` and `mixerCommit` swallow errors with empty `catch`; a failed teardown leaves the outgoing look on air (under the new one) with no log.

## src/engine/scene-take-lbg-timeline-guard.js
- `OK`

## src/engine/scene-take-lbg.js
- `RISK` src/engine/scene-take-lbg.js:158 — `setOpacityExitHold(activeTimelineIdToFadeOut)` is set before `buildTakeJobs`/the pipeline; if any later step throws (fill resolve, Phase A batch, teardown), nothing clears it. The WO-545 comment says `stop()` clears it, but a failed take does not stop the timeline, so the still-playing timeline keeps its per-tick opacity writes suppressed (`timeline-playback-amcp-send.js:123`). Wrap in try/catch and call `setOpacityExitHold(null)` on failure.
- `RISK` src/engine/scene-take-lbg.js:241 — `collectOrphanLookLogicalLayers(self, channel, incoming, inactiveBank)` passes the INACTIVE bank, but a +Animate (merge) take loads into the ACTIVE bank (`routeRemapBank` two lines up exists for exactly that). For merge takes the orphan scan therefore inspects the off-air bank and misses stale layers on the bank that is actually on air. Only matters when live JSON already matches the incoming look but Caspar still carries extra layers.
- `DEAD` src/engine/scene-take-lbg.js:464 — `resolveActiveTimelineIdToFadeOut` is re-exported; all importers use scene-take-lbg-timeline-guard.js directly (grep `require('.*scene-take-lbg')` → only `runSceneTakeLbg`/`sceneTakeLbg.run…`).

## src/engine/scene-take-payload.js
- `BUG` src/engine/scene-take-payload.js:43-103 — `buildLayerRow`/`buildServerIncomingScene` build an explicit whitelist and drop `layer.contentZoom` and the scene-level `timersVisibility`. The take engine reads both (`scene-take-lbg-jobs.js:313` WO-326B zoom, `scene-take-lbg-bank-finalize.js:116` / pgm-only WO-210 timer visibility). Failing case: `buildServerIncomingScene({ id:'x', timersVisibility:{t1:{0:true}}, layers:[{layerNumber:10, source:{type:'media',value:'a'}, contentZoom:2}] }, …)` → output has no `contentZoom` and no `timersVisibility` (reproduced). A take sent with `incomingScene` (web `buildIncomingScenePayload`, client/components/scenes-shared.js:276-340, has the same whitelist) or built here for Godot/Companion silently loses the content zoom and per-look timer on/off state; only the `sceneId`-only route path (routes-scene-take.js:70-75, stored scene copied whole) keeps them. The WO-598 parity test pins "same as web", so both builders drop them together. Fix: add both fields to both builders (and the parity test).
- `QUALITY` src/engine/scene-take-payload.js:29 — `helpersPromise` caches a rejected `import()` forever (a transient failure leaves every later server-built take failing until restart). Reset it in a `.catch`.
- `DEAD` src/engine/scene-take-payload.js:153 `canvasForMain`, `loadClientHelpers` — exported, used only in this file.

## src/engine/scene-take-pgm-only.js
- `DEAD` src/engine/scene-take-pgm-only.js:114 `runSceneTakePgmOnly` (the whole 482-line file) — the header itself says it is legacy since WO-160b. grep `runSceneTakePgmOnly` over `src client tools scripts index.js` → only tools/smoke/smoke-scene-take-pgm-only.test.js, smoke-wo160b-pgm-only-lbg.test.js (asserts the delegation is gone) and the definition. `normalizeTransitionForPgmOnly` (:51) has no server caller (the client has its own copy, client/lib/transition-presets.js:53); `pgmOnlyMixerAnimTail` (:73) has none at all. Several source-pinning smokes (wo537, wo590, live-input-audio-policy) read this file as text, so deleting it means repointing/removing those asserts. It carries its own copies of the timersVisibility, template-CG and teardown logic, which will drift from the LBG path.
- `RISK` src/engine/scene-take-pgm-only.js:445-447 — (dead code, but kept in the test suite) calls `timelineEngine.stop()` unconditionally while the LBG path uses `releaseOrStopOutgoingTimeline` (WO-828 D5); if anyone revives it, it reintroduces the PRV-copy kill that D5 fixed.

## src/engine/scene-take-playlist-start.js
- `OK`

## src/engine/scene-take-program-start.js
- `OK`
- `DEAD` src/engine/scene-take-program-start.js:54 `announceProgramTakeToReplication` — exported, used only inside the file.

## src/engine/scene-take-teardown-opacity-wait.js
- `OK`
- `DEAD` src/engine/scene-take-teardown-opacity-wait.js:62 `OPACITY_SETTLED_EPSILON` — exported, no importer.

## src/engine/scene-template-cg.js
- `BUG` src/engine/scene-template-cg.js:165 — the template name from `layer.source.value` is put on the wire as `"${cgName}"` without escaping: `tpl = cgName.includes('/') ? \`"${cgName}"\` : cgName`. `resolveCgTemplateName` only trims/lowercases. Failing cases (reproduced): value `x/y\r\nKILL\r\nz` → line `CG 1-700 ADD 0 "x/y\r\nkill\r\nz" 1 {}` (CR/LF starts new AMCP commands; nothing downstream strips them); value `my tpl` (a space, no slash) → `CG 1-10 ADD 0 my tpl 1 {}` (Caspar reads `tpl` as the play-on-load flag, ADD fails); a `"` in a name breaks the quoting. The data argument is escaped with `param()`; the template name should be too. Fix: `clipParamForPlay`-style always-quote with `\`/`"` escaping and CR/LF stripped.
- `RISK` src/engine/scene-template-cg.js:169 — the host is recorded in `_trackedTemplateHostsByChannel` while the lines are BUILT, not after they are sent. If `sendPipOverlayLinesSerial` then fails (pipeline's outer catch at scene-take-lbg-amcp-pipeline.js:473), the host stays "tracked" with nothing on air, and the next take of the same template does the WO-196 UPDATE-only path against an empty layer (403, nothing visible; the very case WO-268 meant to prevent).
- `DEAD` src/engine/scene-template-cg.js:439 `getAllTrackedTemplateHosts` — exported, zero users (WO-207 T207.3 startup sweep never wired; unwired-exports-baseline.json:405).
