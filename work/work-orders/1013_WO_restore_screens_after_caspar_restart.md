# WO-1013 — After Devices ▸ Apply & restart, put back what was on the screens: the test card, program looks, everything that was live
**Area:** engine, mapping
**Status: DONE (09.11, live Devices ▸ Apply & restart on the box: look re-taken + test card back on ch2 0.4 s after INFO CONFIG; 17/17 smoke)**

Owner, 09.11 (verbatim):
> when a test card is on and i hit apply and restart in devices, the test card should turn it self on as soon as caspar
> is ready. kind of goes for anything that was already on screens.

## Investigation

Lead notes (09.11), from reading the code (no live repro yet):

- **Apply & restart path.** `src/api/routes-caspar-config.js` → `src/utils/full-config-apply.js` →
  `reloadCasparAfterConfigWrite` (`src/utils/caspar-restart.js:249` waits for AMCP). Node stays up, so in-memory state
  survives the restart.
- **On every (re)connect**, `src/bootstrap/fetch-server-info-config.js:49` runs `runStartupLedTestPatternIfNeeded`
  (boot splash, once per boot: `DONE_KEY`). Then `onAfterInfoConfigReady` (`src/bootstrap/caspar-info-ready.js`) runs
  in this order:
  1. routing setup;
  2. live-scene reconcile;
  3. preview look re-stage (`restagePersistedPreviewLooks`, `src/config/routing-setup.js:250`, uses
     `handleSceneTake(..., target: 'preview', forceCut: true)`);
  4. screen-consumer placement;
  5. template CG orphan sweep;
  6. screen timers restore.
- **Test card.** The master on-state is `ctx._ledTestPatternActive` (`src/api/routes-led-test-card.js:25`). It stays
  `true` across the restart, because node does not restart. But nothing re-paints layer 999 on the fresh Caspar, so the
  GUI says the card is on while the screens show something else. Its settings and the picked channels persist
  (`src/engine/led-test-card-control.js`, key `ledTestCard`; `applyCard(ctx, true)` re-plans the targets).
  - Also check the per-channel "known clear" cache `ctx._ledTest999KnownClear`
    (`src/bootstrap/led-test-layer-999.js`). It survives the restart and may make a later "off" skip a channel.
- **Program looks.** The live-scene reconcile (`src/state/live-scene-reconcile.js` ~200–235) compares the persisted
  live look per program channel with Caspar's foreground. A freshly restarted Caspar is **empty**, which counts as a
  "mismatch", so it **clears the persisted live look** (`liveSceneState.clearChannel(ch)`). PGM therefore stays black
  and the state forgets what was live. That is the opposite of what the owner wants.
- **Already restored on reconnect:** preview looks (above), multiview (WO-156), audio routes (WO-312), operator holes
  (WO-410), the Visuals send (WO-914), screen timers (WO-210).

Agent A additions (09.11), checked against the code before fixing:

- **The lead's reading holds, with three corrections.**
  1. **The reconcile runs twice per connect, and the second one is the one that clears.** `onAfterInfoConfigReady` runs
     800 ms after connect (`index.js:377`). But `runConnectionQueryCycle` REPLACES `appCtx.gatheredInfo` with an empty
     `channelXml: {}` at connect (`src/utils/query-cycle.js:209`). So the info-ready reconcile usually sees no XML and
     skips. The clear comes from `finishConnectionGather` (`query-cycle.js:335–345`). It runs its own `setupAllRouting`
     + `reconcileAfterInfoGather` once every channel's INFO is in. A fix keyed on the info-ready ordering alone would
     have missed it, so the empty-channel rule lives in `reconcileAfterInfoGather` itself (both callers).
  2. **Routing setup was not sequenced before anything.** `setupAllRouting` was fire-and-forget beside the reconcile →
     preview re-stage chain (`caspar-info-ready.js` old :15).
  3. **The reconcile only ever cleared file/template/media looks.** It skipped any look with a route/colour/shm/timeline
     layer (`shouldSkipSceneReconcile`, `live-scene-reconcile.js`). For those, the persisted look survived a restart
     while PGM stayed black, so state and screen disagreed silently.
- **The test card route never told the WO-492 cache.** The manual card route (`src/api/routes-led-test-card.js:40`)
  never called `markLedTestLayerPainted`. Only the boot splash did (`startup-led-test-pattern.js:261,442`). So
  `ctx._ledTest999KnownClear` could say "provably empty" for a channel the operator had since painted.
  - The cache is only consulted while `_ledTestPatternActive` is false (`src/engine/multiview-apply.js:171`).
  - It is never reset on a Caspar connect.
- **Telling the boot splash from the operator card.** Both set `_ledTestPatternActive`. The splash also leaves
  `_startupLedTestChannelIndices` (its own channels: screen/DeckLink outputs except the operator GUI). Nothing recorded
  that the operator switched the card on later.
- **A reconnect is not always a Caspar restart.** An AMCP socket drop reconnects to a Caspar that still shows
  everything. So "re-take" must key on what Caspar actually shows (look bands 10–99 / 110–199 empty), not on the
  reconnect alone.
- **Global border.** It goes on air inside the look take (`scene-take-lbg.js:286`, `incoming.globalBorder`), so a
  re-take brings it back. But `global-border-live.js` caches the border template type per channel. The border route
  then sends NOTHING for an update of the same type (`routes-scene-border.js:86–88`), which is stale after a restart.
- **Found live, not caused by this WO:** a node restart (not a Caspar restart) loses `_ledTestPatternActive`. After
  `kill -TERM` of node, `GET /api/led-test-card/settings` answered `active: false` while INFO 2 still showed
  `layer_999 html`. The GUI says "off" while the card is on air.

## What was done

Agent A, 09.11:

- **`src/engine/restore-on-screens.js` (new, 222 lines).** Every Caspar call is injectable through `deps`.
  - **`restoreProgramLooks(ctx, { reconnect })`.** For each program channel with a persisted live look, a fresh
    `INFO <ch>` decides:
    - The look bands hold a real producer → `kept`. A different look is the reconcile's job, which still clears it.
    - **Empty on a reconnect** → re-take through `handleSceneTake`, the same program path as an operator take, with
      `{ incomingScene: persisted scene, useServerLive: false, currentScene: { id, layers: [] }, forceCut: true,
      previewExchange: false }`. The empty "current" stub with the same id makes every layer play: nothing counts as
      "unchanged" (WO-956 `keepRelativeLayers`). It also makes `recallFixtureLook` skip (same look id), so the rig
      does not snap. `previewExchange: false` leaves PRV to the preview re-stage.
    - **Empty on the first connect of this node process** (box boot) → cleared, exactly as the old reconcile would
      have. This is deliberate: we were not there for what that Caspar showed. The owner's ask is about Apply &
      restart, and restoring a look on its own at power-on is a separate decision.
    - Timeline looks are skipped and logged. Their engine state lives in node, and a re-take would restart them.
    - Unreadable INFO → nothing is touched.
    - Every program channel's border-type cache is dropped (`clearCasparBorderType`).
  - **`restoreLedTestCard(ctx)`.** It always drops the WO-492 cache first (`markLedTestLayerPainted`). Then, if
    `_ledTestPatternActive`:
    - The operator's card → `applyCard(ctx, true)`, which re-plans the targets from the stored settings and picks.
    - The boot splash (no operator switch since boot) → `POST /api/led-test-card` with the splash body
      (`splashCardBody`) on each `_startupLedTestChannelIndices` channel. I chose this over re-running
      `runStartupLedTestPatternIfNeeded`, which would mean deleting its persisted once-per-boot key.
    - It drops the cache again after painting.
- **`src/bootstrap/caspar-info-ready.js`.**
  - Counts connects (`_casparInfoReadyCount`; >1 = reconnect).
  - Keeps the routing promise and awaits it before the restore, capped at 20 s with an unref'd timer.
  - The order is now: reconcile → routing done → program looks → preview re-stage → test card (reconnect only; the
    first connect's card is the splash `fetch-server-info-config.js:49` just painted) → thumbnail warm.
  - The card goes last so layer 999 is painted after everything it must sit on.
- **`src/state/live-scene-reconcile.js`.**
  - New `lookBandsEmpty(types)`: no producer other than `''`/`empty` in 10–99 or 110–199.
  - New `opts.deferEmpty` on `reconcileLiveSceneFromGatheredXml`: an empty program channel is skipped (debug line
    "left to restore-on-screens (WO-1013)") instead of counting as a mismatch.
  - `reconcileAfterInfoGather`, the connect-time entry used by both the gather finish and info-ready, passes it. The
    periodic sync reconcile (`periodic-sync.js:396`) does not, so its behaviour is unchanged.
  - `shouldSkipSceneReconcile` is exported for the first-connect rule.
- **`src/engine/led-test-card-control.js`.** A successful `applyCard(ctx, true)` sets
  `ctx._ledTestCardSource = 'control'` and calls `markLedTestLayerPainted`, which closes the stale-cache hole for
  operator paints. Master-off resets the source to null.
- **`tools/smoke/smoke-wo1013-restore-on-screens.test.js` (new, 17 tests).** Look bands; re-take eligibility. Program
  looks: empty + reconnect → one cut re-take with the exact body; different content → kept, no clear; empty + first
  connect → cleared + broadcast; timeline → skipped; INFO failure → untouched; failed take → reported; border cache
  dropped for 2 and 4; PRV entries ignored. The real reconcile with test-isolated persistence: empty on connect →
  survives; different content → cleared; periodic (no `deferEmpty`) + empty → cleared. Test card: operator card →
  `applyCard(true)`; off → nothing painted; splash → per-channel splash bodies; the cache is dropped in every case;
  `applyCard` sets and clears the source. `caspar-info-ready` order with patched module exports: boot = `reconcile,
  routing, program:false, preview, thumbs`; reconnect = `reconcile, routing, program:true, preview, card, thumbs`.

**Still open (not restored by node after a Caspar restart):**
- Timeline looks on PGM. They are skipped on purpose; they need a "rejoin at the current position" from the
  timeline engine.
- Overlay looks (`scene.liveOverlay`, WO-860) and audio-only looks (`scene.liveAudioOnly`, WO-572). Both have their
  own live maps and are not re-taken.
- The node-restart loss of `_ledTestPatternActive` (Investigation above). Persisting it would need a decision on what
  a node restart with Caspar down should do.
- A Caspar restart through the web/Companion paths behaves the same, because the restore keys on the connect, not on
  the apply route. Only the Devices apply was tested live.

## What was verified

Agent A, 09.11.

**Offline:**
- `node --test tools/smoke/smoke-wo1013-restore-on-screens.test.js` → 17/17 pass.
- The smokes that read the touched files (`smoke-wo629-led-test-control`, `smoke-wo235-osc-compat`,
  `smoke-wo918-server-fixes`, `smoke-screen-consumer-placement`) → 52/52 pass.
- `node tools/ci/run-offline-tests.js` → 5580 tests, 5573 pass, 0 fail (the rest are todo/skip). The new smoke is not
  in the curated list yet.
- `npm run -s lint` → 0 errors. `check-unwired-exports` → no orphan from these files (the 6 listed belong to Zoom
  stages C/D). `check-max-file-lines` → 0 over 500.

**Live on the box** (full dev mode; the real Devices route, `POST /api/caspar-config/apply {"force":true}`, as
`cable_gesture.gd:420`):

1. **Before.**
   - The card was ON: `active: true`, picks `{2}`, pattern `led-builder`, full grid on ch2.
   - INFO 2 = `layer_999 html` only. `scene.live` = `{}`. INFO 3 and INFO 4 = no layers.
2. **Load the code.**
   - Node restarted at 12:53:08 to load the code.
   - Card switched on via `POST /api/led-test-card/master {"enabled":true}` → `{"ok":true,"targets":[2]}`.
   - A test look was taken on ch2 (`BRIDGE/M_CZWARTEK_GLOWKI FRN26_28` still, cut) → INFO 2 =
     `layer_110 image, layer_999 html`.
3. **Apply & restart at 12:53:59.**
   - The response had `restartSent:true, reconnected:true`. The Caspar processes' start time is 12:54:00.
   - Journal (`journalctl -u highascg --since "2026-11-09 12:53:59"`):
     ```
     12:53:59.639 [Full apply] Step 4 — reload Caspar (RESTART + fast kill if hung)
     12:54:01.931 Live scene reconcile: channel 2 look bands empty on Caspar — left to restore-on-screens (WO-1013).
     12:54:02.101 [Caspar] INFO CONFIG loaded — channel resolutions match running server
     12:54:02.103 Live scene reconcile: channel 2 look bands empty on Caspar — left to restore-on-screens (WO-1013).
     12:54:02.117 [scene-take] scene=wo1013-test (WO-1013 test look) scope=0 ch=2 main=1 bus1=3 bus2=n/a forceCut=true
     12:54:02.489 [scene-take-lbg] timing ch2: phaseA-done=292ms play-acked=372ms jobs=1
     12:54:02.508 [restore-on-screens] ch2: Caspar was empty — re-took live look WO-1013 test look (cut)
     12:54:02.511 Preview re-stage: no valid persisted look for prv 3 — skipped
     12:54:02.551 [restore-on-screens] test card (card) re-applied on ch 2
     ```
   - The card and the look were back about 2.9 s after the RESTART command and 0.45 s after INFO CONFIG.
   - No `[warn]`/`[error]` lines in the journal since the apply.
4. **After.**
   - INFO 2 = `layer_110 image` (the look, bank B) + `layer_999 html` (card on top). INFO 3 = no layers (no PRV look
     was persisted).
   - `tools/test-agent/caspar print 2` = the full grid card with its builder animation restarted (print 398).
   - An x11grab of DP-2 (`:0+2048,0`, 3072x1024) shows the same card on the monitor.
5. **Card off after the restart.**
   - Master off → `targets [2,4]`, INFO 2 = `layer_110 image` only, no 999. Nothing was skipped by a stale cache.
   - Print 399 shows the restored look (the "WIDZIMY SIĘ O 21:00" still) underneath.
6. **Left as found.**
   - FTB screen 1 (`POST /api/ftb {"screenIdx":0}`), then card master on.
   - Now INFO 2 = `layer_999 html` only, `scene.live` = `{}`, `ledTestPatternActive: true`, INFO 3 = no layers.

**Not proven live:**
- The boot-splash branch, the timeline skip and the first-connect clear are covered by the smoke only. The box had no
  splash up and no timeline look, and the first-connect case needs a box boot.
