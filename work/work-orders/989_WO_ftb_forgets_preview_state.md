# WO-989 — FTB blacks PRV in Caspar but kept its look in the server state, so the next preview push stayed black
**Area:** engine
**Status: DONE (07.11.26, smoke 7/7 (the new test fails on the old code), proven on the box: FTB → state [] → preview-push mode `take` → PRV plays)**

Found during the WO-979 two-box run on 07.11, while I was putting this box's PGM/PRV back after the run.

## Investigation

- `POST /api/ftb {screenIdx:0}` fades and CLEARs **PGM and PRV** in Caspar: `resolveFtbChannels`
  (`src/api/routes-ftb.js:18-33`) returns both, and `runFadeToBlackAllLayers` clears every one of them.
- The live-scene state was cleared for the **program channels only** (old `routes-ftb.js:104-110`:
  `clearChannel(map.programCh(…))` / `map.programChannels`). So PRV's entry kept its look.
- `POST /api/scene/preview-push` with that same look then saw `staged.sceneId === sceneId`, so `decidePreviewPush`
  gave **`nudge`** (`src/api/routes-scene-preview-push.js:118-140`). It sent only MIXER lines to an empty channel.
- Observed on the box (07.11 ~10:05): FTB → `/api/scene/live` still listed ch3 = the neon loop → push answered
  `{"ok":true,"mode":"nudge"}` → `INFO 3` showed layers 10/11/90, all empty. The GUI and the server both
  believed PRV held the look while the output was black. A full `take-look target:preview` was needed to bring it back.

## What was done

- `src/api/routes-ftb.js`: after the fade, `clearChannel` runs for **every channel FTB blacked** (the same `channels`
  list it faded, PGM and PRV), awaited, then one `broadcastSceneLive`. This replaces two branches with one loop.
  Clearing the state is the right side to fix: Caspar's PRV really is empty after FTB, as the route's header says
  ("fade out program + preview layers, then clear").
- `tools/smoke/smoke-ftb-routes.test.js`: `handlePost: FTB forgets the PRV look as well as the PGM look`. It stubs
  `clearChannel` and `broadcastSceneLive` and uses a Proxy AMCP, then asserts both channels are forgotten.

## What was VERIFIED

- `node --test tools/smoke/smoke-ftb-routes.test.js`: **7/7**. With the old `routes-ftb.js` swapped back in, the new
  test fails (`both blacked channels are forgotten`) and the other 6 pass.
- On the box after a node restart (pid 1306803): FTB screen 0 → `/api/scene/live` channels `[]` → Caspar ch2 and ch3
  nothing playing → preview-push of the neon look answered `mode: take` → `INFO 3` shows layer 10 = ffmpeg. State ch3
  is the neon look again, so the box is as found (PGM empty, PRV = neon loop).

## Side note (not changed)

- `runFadeToBlackAllLayers` reads `parseInt(durationFrames) || 25`, so `durationFrames: 0` (a cut to black) can't be
  requested and becomes 25. Owner call whether a 0-frame FTB should exist.
