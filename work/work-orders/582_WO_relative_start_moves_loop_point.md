**Status: IN PROGRESS (2026-09-28): parts 1 and 2 deployed. Offline suite 2528 / 0 fail / 2 skip. Waiting for the owner's on-air takes, with the OSC sampler measuring the crossfade frame offset.**

Follow-up to [WO-576](576_WO_look_clip_start_point_two_options.md), which made "Relative to the clip
playing on this layer" persist but never checked what Caspar does with the `SEEK` it produces.

## Investigation

Owner 28.09: looks **main** and **main lista** share the same looping bg clip on layer 10
(`4. Tło 4 - delikatne fale.mp4`, 3000 frames @ 50), both set to relative start. Result: "it does not
work in that case".

- `config/.highascg-state.json` (19:07) still showed `startBehaviour: 'beginning'` on both, but the
  live server (`/api/project`, `/api/scene/live`) showed `relativeToPrevious`. The state file was
  stale, not the setting.
- Journal 19:19:16, main → main lista: `LOADBG 1-110 "…DELIKATNE FALE" LOOP SEEK 264`. So the
  playhead was read correctly: 264 frames ≈ the 5.5 s that main had been on air. Caspar then logged
  the producer as `0.0000/54.7200` instead of `/60`, which shows the clip had been shortened.
- Root cause is in the Caspar build this box runs (`~/caspar-build/src-tree`, which WO-536 showed
  matches `bin/casparcg`), `modules/ffmpeg/producer/ffmpeg_producer.cpp:301-302`:
  `seek = get_param(L"SEEK", …, 0); in = get_param(L"IN", params, seek);`. **IN defaults to SEEK.**
  `in != 0` becomes `start`, and the EOF wrap in `av_producer.cpp:881-883` seeks back to `start`.
  So a relative take's bare `LOOP SEEK n` makes frame n the new loop point. Each switch between the
  two looks re-seeks to the current position and moves the loop point later again. The bg ends up
  looping a shrinking tail, which jumps at every wrap.
- WO-536 already found the same aliasing for timelines and avoided it there with `CALL … SEEK`.
  The scene-take path (`scene-take-lbg-jobs.js`, `scene-take-pgm-only.js`) was never fixed.
- Live proof on the box: the same clip on a hidden (opacity 0) layer, PRV ch2 layer 900, sampled
  every 0.5 s through OSC `file.elapsed`:
  - `PLAY … LOOP SEEK 2900` gave `58.5, 59.1, 59.6, 58.1, 58.7, 59.2, 59.8, 58.3`. The loop is the last 2 s only.
  - `PLAY … LOOP IN 0 SEEK 2900` gave `58.5, 59.1, 59.6, 0.06, 0.5, 1.1, 1.6, 2.2`. It wraps to 0.

## What was done

- `src/caspar/amcp-command-plan.js`: the clip serializer accepts `opts.in` and emits `IN n` before
  `SEEK`. It is dropped on a bare `PLAY` swap, like SEEK and LENGTH are.
- `src/caspar/amcp-layer-diff-plan.js`: passes `nextUp.in` through to the LOADBG plan.
- `src/engine/scene-play-seek.js`: new `resolvePlayInFramesForSceneLayer(layer, fps)` returns the
  WO-570 trim-in or 0. The 'beginning' branch now reuses it instead of an inline copy.
- `src/engine/scene-take-lbg-jobs.js`: every take that sends a SEEK now also sends `IN` = trim-in/0.
  WO-570's trim-out `LENGTH` is now measured from IN, because Caspar computes `out = in + LENGTH`. It
  used to be measured from the seek frame, which was only right while IN was implicitly equal to
  SEEK. The "no LENGTH when trim-out ≤ start" guard is kept.
- `src/engine/scene-take-pgm-only.js`: sends the same explicit IN next to its SEEK.
- An explicit IN was chosen over WO-536's separate `CALL … SEEK`. It keeps the pre-rolled LOADBG
  atomic (WO-574 relies on the bare PLAY of a pre-rolled producer) and adds no extra AMCP round trip.
- Not changed: `amcp-basic.js` typed-library path. `_buildTypedClipParams` reads `plan.seek` /
  `plan.length` off the plan wrapper, where they are always undefined, so that path already drops
  SEEK. It is off on this box (`useLibraryTyped` is not set) and outside this WO's scope.

## Verified

- New `tools/smoke/smoke-scene-relative-seek-in-point.test.js` (registered in
  `run-offline-tests.js`), 4 tests: serializer order, relative take → `LOADBG 1-110 BG LOOP IN 0 SEEK 264`,
  trim-in kept as the loop point with LENGTH measured from IN, and no LENGTH before the start point.
  The existing WO-570 LENGTH expectations still pass unchanged.
- Full offline suite: 2524 tests / 2522 pass / 0 fail / 2 skip. `check-max-file-lines`: 0 over 500.
- Caspar semantics proven live (probe above). Server restarted with the fix and `/api/scene/live` returns 200.
- **Owner QA still to do:** take main, wait past the middle of the clip, take main lista, then take
  main again. The bg must continue without a jump and still loop from the clip start. The journal
  should show `LOADBG 1-1x10 … LOOP IN 0 SEEK n`.

## Part 2 (owner 28.09 after part 1): "works only one way" + "the couple frames of difference are quite visible"

### Investigation

- Journal, 19:32:04–19:32:31, alternating takes. Main always lands on bank B (1-110) and main lista
  on bank A (1-10). Taking **main** sent `SEEK 180 / 124 / 169`. Taking **main lista** always sent `SEEK 0`.
- Cause: the client sends `playSeekFrames` in the take body, and the server returned it **before**
  doing its own live read (`scene-play-seek.js`, playSeekFrames branch above the live branch). The
  client's `getLiveLayerPlayheadFrames` (`client/lib/layer-playhead-resolve.js`) reads OSC
  `layers[layerNumber]`, the logical layer, and uses the bank only in variable-name heuristics.
  Leaving a bank-B look it read the empty or stale bank-A layer, and
  `playSeekFramesForRelativeToPrevious` turned `null` into 0.
- Lag, measured from Caspar receive timestamps in the working direction:

  | take | client seek | outgoing frame at PLAY | behind |
  |---|---|---|---|
  | 19:32:13 | 180 | 208 | 28 f |
  | 19:32:21 | 124 | 166 | 42 f |
  | 19:32:28 | 169 | 198 | 29 f |

  There are two sources. The client reading is already 7–17 f stale when the take arrives. Then the
  pipeline's prebuffer sleep (`scene-take-lbg-amcp-pipeline.js`, 180 ms for a crossfade) plus AMCP
  round trips make LOADBG→PLAY 222–266 ms (7 samples).

### What was done

- `src/engine/scene-relative-seek-lead.js` (new): `projectRelativeSeekFrames` takes the server OSC
  elapsed of the **on-air physical layer**, adds the OSC sample age (`_lastOscAt`) and the expected
  resolve→PLAY lead, and wraps for loop / clamps for a one-shot. The lead defaults to 250 ms and is
  recalibrated per channel (EMA 0.5) by `settleRelativeSeekLead`. Samples over 2 s are ignored,
  because a pgm-only path never settles its stamp.
- `scene-play-seek.js`: for relative starts that are not forceCut, the server projection now wins
  over the client's `playSeekFrames`. The client value is only a fallback when OSC has no playhead.
  forceCut (PRV staging) is unchanged and never reads program OSC.
- `scene-take-lbg-amcp-pipeline.js`: after Phase B it calls `settleRelativeSeekLead` and logs
  `[scene-take-lbg] relative seek lead chN: Xms`.
- The client was not changed. Its bank-blind read is now irrelevant whenever server OSC is live, and
  fixing it would need a client rebuild that bundles other uncommitted client work.

### Verified

- 4 new tests in `smoke-scene-relative-seek-in-point.test.js` (8 in total): bank-B read ignores the
  client's 0, projection + age + wrap/clamp, lead calibration and rejection, and forceCut falling back
  to the client value. A first version of the projection test flaked when a millisecond ticked between two
  `Date.now()` calls. The clock is now pinned, and the test passed 5/5 in isolation and 3/3 full-suite runs.
- Full offline suite: 2528 / 2526 pass / 0 fail / 2 skip. Line limit clean. Server restarted.
- On air: still to be measured (sampler polling OSC for 1-10 vs 1-110 during the crossfades).

### Part 2b: fixed PLAY deadline instead of a predicted lead (28.09, after the first on-air round)

- On air with the averaged prediction (sampler polled OSC 1-10 vs 1-110 during 8 crossfades): both
  directions now continue (`SEEK 1560, 1732, 1872, …`, no more `SEEK 0`), but the incoming layer
  landed between 5 frames behind and 7 frames ahead.
- Cause: resolve→PLAY was 134–300 ms and flipped with bank parity. Incoming on bank B starts hidden
  and gets a 180 ms prebuffer; incoming on bank A gets 80 ms. An average can't follow a value that
  alternates every take. Example: 19:49:25 predicted about 330 ms, the real time was 182 ms, and
  the incoming clip landed 7 f ahead.
- Change: the lead is fixed (`TARGET_LEAD_MS` = 350, env `HIGHASCG_RELATIVE_SEEK_LEAD_MS`). The
  pipeline's pre-PLAY sleep becomes `relativeSeekPlayWaitMs`: it waits until resolve + lead − send
  overhead (15 ms, env `HIGHASCG_RELATIVE_SEEK_SEND_MS`) and never less than the prebuffer. Relative
  takes get up to about 200 ms slower to start, and the seek and the PLAY now agree by construction.
  The averaging was removed.
- Verified: 8 smoke tests, including a deadline test covering both prebuffers, prep overrun, another
  channel, a settled stamp and a stale stamp. Full suite 2528 / 0 fail. Server restarted. The on-air
  sampler is running again.

### Part 2c: constant Caspar-side offset (28.09, 20:05 on-air round)

- With the fixed deadline, 4 takes landed 2, 2, 1 and 2 frames **behind**, in both directions. The
  last round spread from −5 to +7, so the variance is gone. PLAY reached Caspar 335–347 ms after
  resolve, on the 350 ms target. Take 3 also wrapped past the clip end correctly (`SEEK 46`).
- What's left is a constant of about 1.75 f, and it comes from Caspar: the pre-rolled producer shows
  its seek frame on the tick after PLAY while the outgoing keeps advancing.
  `CASPAR_PLAY_PIPE_MS` = 35 (env `HIGHASCG_RELATIVE_SEEK_PIPE_MS`) is added to the projection only.
- Verified: 8 smoke tests (3/3 runs), full suite 2528 / 0 fail, server restarted, sampler rerunning.
