# WO-1013 — After Devices ▸ Apply & restart, put back what was on the screens: the test card, program looks, everything that was live
**Area:** engine, mapping
**Status: IN PROGRESS (09.11)**

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

## What was done

(in progress)

## What was verified

(in progress)
