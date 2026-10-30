# WO-828 — Timeline inside a look: does the take transition and play as the WOs say? (live verification + fixes)

**Status: DONE (30.10, live wire + PGM luma probe + offline suite) — D1, D2, D3, D4, D5, D7, D9 fixed and verified (§5;
coordinator re-runs §5.1 and §5.3). Normal → normal CUT wire byte-identical (golden smoke). Offline suite 3666 tests /
3664 pass / 0 fail / 2 skipped. Owner decisions left, not defects of the spec: D6 (one air timeline across screens) and
D8 (end of a non-looping timeline: hold last frame or black), §3. Not probed on glass: the Proj (ch3) picture — wire only.**
**Source:** owner 29.10: "find either a work order or a note that explains a proper timeline transition and playing a
timeline from inside a look and run full tests to see if it's transitioning and playing exactly as explained."
**Related:** WO-139, 152, 528, 537, 540, 541, 544–561, 574, 618, 782, 814 (sources of the spec below).

---

## 1. Investigation

### 1.1 The written spec (what the WOs promise)

No single WO describes the behaviour; it is spread over the timeline-take WOs (all "Done in repo, owner QA owed" in
OPEN_ISSUES). Compiled, numbered (full source map with file:line in §4):

- **S0** A look timeline plays on physical layers 210+ (above both look banks, A 10–99 / B 110–199); one timeline is
  on air in the engine at a time; timeline→timeline is a CUT (WO-139 T139.4).
- **S1 normal look → look with a timeline (MIX d):** route to program only (WO-559/553A), preset `OPACITY 0 0`
  (WO-152), play from 0 — never a resume (WO-537), no instant `OPACITY 1` while the take fades (WO-528/544), fade the
  timeline layers in with the take (`OPACITY 1 d tween`, WO-541 also for a timeline-only look), outgoing layers exited,
  teardown waits for the real opacity (WO-540), PGM first then the PGM→PRV exchange (WO-814).
- **S2 mixed look:** normal layers follow the A/B bank crossfade, the timeline follows S1.
- **S3 timeline look → normal look:** the timeline fades out in the take batch (`OPACITY 0 d DEFER`), no ticks during
  the exit hold (WO-545), incoming staged at full (no double ramp, WO-553B), stopped after teardown.
- **S4 PRV:** a preview-only take is a CUT restricted to preview and **never stops or restarts the timeline on
  program** (WO-549/550/552/555); the exchange call routes but does not play (WO-554/556).
- **S5 retake of the same look:** the timeline is not faded out or stopped; WO-548 §3: "confirm it **stays lit
  throughout**".
- **S6 position/loop/end:** a look take starts at 0; loop comes from the look layer; at the end: loop → restart, no
  loop → stop; Timeline-editor Stop needs `force` while on program (WO-552 → 409).
- **S7 transitions:** CUT = duration 0 (WO-814), tween names easeboth→`easeinoutquad` etc. (WO-618), duration in
  channel frames.
- **S8 multi-screen:** the timeline is routed to the screen of the program channel; the take-group barrier (WO-574).

The system's own crossfade rule, measured as reference (§1.3 R0): a normal → normal MIX **holds the outgoing look at
full and fades the incoming bank in on top** — a monotonic luma ramp, no dip.

### 1.2 Test setup

- Box: Dioda PGM ch1 / PRV ch2 (3840×1792@50), Proj PGM ch3 / PRV ch4 (1080p50). Server PID started 21:00 runs HEAD.
- No look in "mhp harder" held a timeline, so three test looks were added through the live deck (WS `scene_deck_sync`,
  the path the clients use; an autosave alone is overwritten by the live deck, `enrichProjectScenesFromLiveDeck`):
  `WO-828 TL only` (scope 0, layer 10 = timeline), `WO-828 TL + layer` (KV LOOP.mov on 10 + timeline on 11),
  `WO-828 TL proj` (scope 1). Test timeline `wo828tl` (engine PUT): one clip KV LOOP 2.mov (HAP), 15 s then 20 s.
- Takes through the real route `POST /api/scene/take-look {sceneId, mainIdx, target?, transitionOverride?}`.
- Evidence per step: the AMCP wire (`log/caspar_2026-10-29.log` "Received message"), `journalctl -u highascg`
  (`[scene-take*]`), `GET /api/state` (`timeline.playback`, sendTo, `scene.live`), and a **PGM luma probe** reading
  the `highascg-pgm1` shm frames every frame (mean luma on a 16-px grid; 0.0 = a black frame).
- Harness + raw captures: session scratchpad `wo828/` (take.sh, lumaprobe.py, decksync.js, sNN_*.txt, luma-*.tsv).

### 1.3 Results (29.10, 21:51–21:56)

| Step | Case | Result |
|---|---|---|
| R0 | reference normal→normal MIX 12 | outgoing 1-10 held, `1-110 OPACITY 1 12` on top; luma 121→105 monotonic ✅ |
| 2 | normal → TL-only look, MIX 25 | wire exactly S1: `1-210 OPACITY 0 0`, `STOP/PLAY 1-210 … SEEK 0`, no `OPACITY 1 0`, `1-210 OPACITY 1 25 linear` + COMMIT, teardown after 510 ms with the opacity poll, PRV `CLEAR 2` + outgoing look, no `PLAY 2-210` ✅ — **but** the outgoing layers are faded out in the same batch: **luma 130 → 95 → 125, a 27 % dip** ❌ D4 |
| 3 | normal → mixed look | normal layer via bank B on top of the held outgoing, timeline fades in, no dip ✅ (teardown polls the held layer's opacity for its full 1 s budget — harmless) |
| 4 | retake the same TL look | `1-210 OPACITY 0 0` + `STOP/PLAY … SEEK 0` + 0.5 s fade-up: **black, then fade up from 0** ❌ D3 (WO-548 "stays lit") |
| 5 | TL look → normal look | `1-210 OPACITY 0 12 DEFER` in the take batch, incoming staged at full, STOP after the poll ✅ — **PRV:** `CLEAR 2`, `PLAY 2-210 … SEEK 0`, 193 ms later `STOP 2-210` → PRV empty while `scene.live[2]` says the TL look ❌ D5 |
| 6 | PRV-only take of another look while the TL is on PGM | no ch1 line at all ✅ |
| 7 | PRV-only take of the TL look while it is on PGM | **`STOP 1-210` / `PLAY 1-210 … SEEK 0` on PROGRAM: a black PGM frame (luma 0.0 at 21:55:01.074) and the show timeline jumps to 0** ❌ D1 |
| 8 | take after the timeline was elsewhere/scrubbed | always `SEEK 0`, position restarts ✅ |
| 9 | tween easeboth | `OPACITY 1 25 easeinoutquad`, no Caspar error ✅ |
| 10 | CUT | `OPACITY 1 0`, `STOP/PLAY`, no preset/fade ✅ |
| 11a | TL look on Proj (ch3) while the TL look is on Dioda | `STOP 1-210`, `STOP 2-210`: **Dioda PGM goes black** while `scene.live[1]` still says the TL look ❌ D6 |
| 11b | normal look on Proj after 11a | `STOP 3-210` 47 ms into a 240 ms fade (**cut on Proj**), then `STOP/PLAY 1-210` + `2-210 … SEEK 0`: **the Proj timeline plays on Dioda PGM for 270 ms** ❌ D7 |
| 12a | end, no loop (15 s) | `STOP 1-210`/`2-210` at the end → **PGM black**, `scene.live` still names the look ❌? D8 (owner decision, §3) |
| 12b | loop wrap (look layer loop) | `STOP` + `PLAY … SEEK 0` → **8 black frames (~160 ms) on PGM at every wrap** ❌ D2 |
| 13 | `POST /api/timelines/:id/stop` without force while on PGM | 409 ✅ |

### 1.4 Root causes (code)

- **D1** `src/api/routes-scene-take.js` preview-only path calls the timeline start without `deferTimelinePlay`;
  `startSceneTimelineLayer` → `eng.play(id, 0, {restart:true})` and the same-id replay re-sends STOP/PLAY to every
  routed channel, program included (`timeline-playback-runtime.js` same-id branch).
- **D2** `timeline-playback-runtime.js` wrap: loop → `play(id, 0)` = STOP + PLAY of every clip layer.
- **D3** `src/engine/timeline-take.js` `startSceneTimelineLayer` always presets `OPACITY 0 0` and restarts, also when
  the same timeline is already on air on that program channel.
- **D4** `scene-take-lbg-amcp-pipeline.js` crossfade batch fades the outgoing media out while a timeline-only look fades
  in (WO-541 test 2 pins the fade-out) — unlike every other take, which holds the outgoing look under the incoming.
- **D5** the exchange call adds the preview claim (sendTo preview+program), the next tick PLAYs 2-210, and the
  teardown `stop(id)` stops both buses; the WO-556 comment in routes-scene-take.js is stale since WO-559.
- **D6** one air timeline in the engine (`_airTimelineId`): a timeline look on another screen steals it with STOPs.
- **D7** `programChannelToScreenIdx` (`scene-transition.js`) falls back to screen 0 for preview channels (ch4 → 0), so
  the exchange call on ch4 routes the timeline to Dioda {1,2}; setSendTo STOPs ch3 early.
- **D8** `stop()` at the end of a non-looping timeline STOPs the layers; the look's own media would hold its last
  frame (Caspar), so the two disagree.

## 2. What was done

Fixed in priority order D1, D2, D7, D5, D3, D4. D6 and D8 were left alone on purpose (§3).

- **`src/engine/timeline-playback-runtime.js`**
  - `play()` takes a new `seamless` option (≈ l.77). It applies only when the same timeline is already on air. It keeps
    the old `_prevKey` transport cache while `_applyAt` runs, so `_sendClipTransport` knows which layers already hold the
    same clip.
  - The loop wrap in `_tick` (l.395) now calls `play(airId, 0, { seamless: true })` (D2).
  - New method `joinChannels(id, channels)` (l.353, D1/D5). It drops the cache for the joined channels only and runs a
    forced `_syncAmcpLayers` limited to those channels (`onlyChannels`) at the current position. The channels already
    playing are left untouched.
  - Why `joinChannels` and not a tick-join: an implicit join through the next tick resolves the clip `atEntry` with
    startBehaviour `beginning`, which lands at SEEK 0. The explicit forced sync seeks to the playhead.
- **`src/engine/timeline-playback-amcp-send.js`**
  - `_syncAmcpLayers` accepts `onlyChannels` (l.124).
  - `_sendClipTransport` (l.312–351) skips the `STOP` when the layer already plays the same clip (`seamless`), on both
    the normal branch and the loopAlways branch. PLAY with a clip is LOADBG + swap in Caspar, so the old frame stays on
    screen until the new one is ready. The STOP was what opened the black gap.
  - Why D2 is option (a), PLAY without STOP: it measured 0 black frames (§5), so LOADBG-ahead and a native LOOP were not
    needed. A native LOOP would also lose the timeline's own clip/keyframe semantics.
- **`src/engine/scene-transition.js` `programChannelToScreenIdx`** (l.46–50, D7): a preview channel now maps to its own
  screen (`previewChannels[i] → i`); an unknown channel still falls back to 0.
- **`src/engine/timeline-take.js` `startSceneTimelineLayer`** (l.300–345):
  - **D1/D5 join.** A preview-scoped call (`restrictToPreview`) for a timeline that is on air with a program claim
    (`joinsRunning`) only adds the preview claim and calls `joinChannels`. It never calls `play(restart)`, which STOPped
    and re-PLAYed program at 0. If the timeline already plays on that preview channel (`alreadyOnCh`), nothing is sent,
    so a second exchange does not re-PLAY PRV. The deferred PGM→PRV exchange call takes the same path. This is what puts
    an outgoing timeline look on PRV.
  - **D3 retake.** An unrestricted take of a timeline already on air on this program channel (`retakeOnAir`) sends no
    `OPACITY 0 0` preset and no fade-up. It calls `play(0, { restart, seamless })` (no STOP), and with
    `startAtCurrentPosition` it does nothing at all. It returns `[]`, so the pipeline has nothing to ramp.
  - **Race fix (found live in step 11a).** The `OPACITY 0 0` preset now goes out before `setSendTo`. Before, the preset's
    await sat between the routing change and `play()`. A timeline already playing on PRV only got a regular tick in that
    gap, and the tick sent a full unprotected transport (`OPACITY 1 0` + STOP/PLAY) to program: a cut instead of a fade.
    D5 makes "playing on PRV only" a normal state, so the old ordering would bite often.
- **`src/engine/scene-take-lbg-amcp-pipeline.js`** (l.231–234, D4): when a look is timeline-only (`takeJobs.length === 0`
  with timeline layers to fade in), the outgoing exit layers are not ramped. The timeline (band 210+) fades in over the
  held outgoing look, the same rule as normal→normal and `runTimelineDirectTake`. A mixed look keeps the normal exit
  rule. The `onProgramPlayCommitted()` result (the PGM→PRV exchange promise) is stored in `fadeClockRef.programPlayHook`
  (l.380).
- **`src/engine/scene-take-lbg-teardown.js`** (l.119–132, D4): when the take is timeline-only, the opacity poll waits for
  the incoming timeline layer to reach 1 instead of the held outgoing layer to reach 0. The outgoing look is held at
  full, so polling it for 0 would always burn the whole budget.
- **`src/engine/scene-take-lbg.js`** (l.421–429, D5/D7): passes `timelineFadeInRefLayer` to the teardown. After the
  teardown it awaits the exchange (`programPlayHook`), then calls `releaseOrStopOutgoingTimeline` instead of a blind
  `eng.stop()`.
- **`src/engine/scene-take-lbg-timeline-guard.js`**, new `releaseOrStopOutgoingTimeline` (l.111–131, D5): if the
  outgoing timeline is on both buses (the exchange joined PRV), it drops only the program claim (`setSendTo` with
  `skipAmcpApply`, so only the program channel gets the differential STOP) and clears the WO-545 exit hold. Otherwise it
  stops the timeline as before.
  - Why release and not stop: PRV must show what `scene.live[prv]` names. Stopping both buses left PRV empty (D5).
    Restarting on PRV would jump to 0.
- **`src/api/routes-scene-take.js`** (l.348–356): rewrote the stale WO-556 comment on the exchange call. It now describes
  the program-only claim, the join and the release-only teardown. No code change; `deferTimelinePlay` stays.
- **Tests**
  - `smoke-wo541-timeline-only-look-crossfade.test.js`: test 2 changed (see §3). Added a test that a mixed look still
    fades its exit-only layers.
  - `smoke-wo556-preview-flash-and-exit-restart.test.js`: Bug B now asserts "no program line, PRV joins at the playhead".
    The mock position is advanced to 5 s, so a restart (SEEK 0) and a join are distinguishable.
  - New `smoke-wo828-timeline-look-take-deviations.test.js` (16 tests), registered in `tools/ci/offline-test-files-2.js`.
    It covers:
    - D7 mapping;
    - `joinChannels`: seeks to the playhead, sends nothing to program, refuses unrouted or off-air, no re-join;
    - the D2 seamless wrap on both clip branches, plus a check that a plain restart still STOPs;
    - the D3 retake: no preset, no STOP, SEEK 0, `[]`;
    - the 11a race: a tick injected during the preset await; this check fails with the old ordering, verified with a
      scratch script;
    - D5 release vs stop;
    - the source pins for the hook await and the teardown reference.

- **D9 (30.10)**: a CUT over an on-air look holds that look until the timeline's PLAY is acked, plus 5 channel frames
  (first 2; raised to 5 by the coordinator, see below).
  - `src/engine/timeline-playback-amcp-send.js` l.327, l.415: `_sendClipTransport` pushes the promise of its transport
    send (the batch, or the loopAlways `raw` PLAY) onto `this._transportAcks` while a caller collects them.
  - `src/engine/timeline-take.js` l.22 (`holdForTransportAcks`) and l.370–383 (CUT branch): with `opts.cutHoldMs > 0`,
    the branch collects around `eng.play()`, awaits the acks (capped at 1 s, so a lost reply cannot stall a take), then
    waits `cutHoldMs`.
  - `src/engine/scene-take-lbg-jobs.js` l.66: `cutHoldMs = 5 frames` only when `fadeDur === 0`, not a merge transition,
    and there is an on-air look (`currentMap.size > 0`). A fade take, a merge, an empty channel and the D3 retake (which
    returns earlier) are untouched.
  - Why this works: `buildTakeJobs` awaits `startSceneTimelineLayer`, and the teardown that clears the outgoing look runs
    after `buildTakeJobs`. Holding inside the call delays the clear without a new code path. The normal → normal CUT never
    reaches this code (no timeline layer).
  - Why not LOADBG-ahead: it would need a new LOADBG/PLAY split in the engine transport, a much larger change for the
    same result here.
  - Measured on the box: Caspar answers `202 PLAY OK` about 11 ms after receiving the PLAY, before the first frame is
    decoded. The ack alone is not the guard; the frames after it are. The observed clear lands about 95–100 ms after the
    PLAY (ack, plus 2 frames, plus the take's own awaits). In the D9 failure the first timeline frame reached Caspar
    about 40 ms after the PLAY, so there is about 50 ms of margin for this 3840×1792 HAP clip. A clip that is slower to
    open (long-GOP H.264 with a deep SEEK) could still show a frame of black; raise the margin in
    `scene-take-lbg-jobs.js` if that is ever measured.
  - **Coordinator change: 2 → 5 frames.** The timeline plays on 210+, above the held outgoing look, so a longer hold is
    invisible for a full-frame timeline: it only delays the clear of a look that is already covered. 2 frames left about
    35–50 ms of spare time on one 4K HAP clip; 5 frames (100 ms at 50 fps) covers slower-opening clips at no visible cost.
    The one case where it shows is a timeline with transparent areas, where the outgoing look stays visible under it
    for about 100 ms longer, the same as the D4 caveat. Smoke pin and timing assertion updated (ack + 95 ms).
  - Tests:
    - New `tools/smoke/smoke-wo828-d9-cut-timeline-hold.test.js` (5 tests), registered in
      `tools/ci/offline-test-files-2.js`. It drives the real `handleSceneTake` against a recording stub (as smoke-wo814).
    - Normal → normal CUT, both `forceCut` and a look whose transition is CUT, with and without a timeline engine, equals
      a golden wire captured from the pre-D9 tree (HEAD 2346492d, `git archive` copy); the HEAD and working-tree captures
      were also compared byte for byte.
    - Normal → TL CUT: the outgoing `CG/STOP 1-10` comes ≥ ack + 95 ms after the stub's delayed PLAY ack.
    - `cutHoldMs` is opt-in and ignored on a fade take.
    - A source pin on the jobs condition.
    - The hold tests fail on the HEAD tree (checked), and the golden tests pass on both.
    - `smoke-wo528-take-opacity-not-slammed.test.js`: the CUT-branch pin is repointed to the first `eng.play` inside the
      branch, because the play is now wrapped in try/finally. Its guarantee (no `takeFade` on CUT) is unchanged.

## 3. Decisions

- **D3 (taken here, from WO-537 + WO-548).** A retake of the timeline look already on air on that PGM restarts the
  timeline at 0 (WO-537: "a look take starts at 0"), at full opacity, with no preset, no fade and no STOP (WO-548: "stays
  lit throughout"). The picture jumps to frame 0 of the clip with no dip. With `startAtCurrentPosition` the retake leaves
  playback running. If the owner would rather a retake keep running from the current position, it is a one-line change
  (the `retakeOnAir` branch).
- **D4: rule change to smoke-wo541 test 2, not a silent weakening.** That test pinned the outgoing layer fading out in
  the same batch. Measured live, that double ramp was the 27 % dip (§1.3 step 2). The test now pins the opposite: the
  outgoing layer is held, and the reason is written in the test. A mixed look keeps the old exit rule (new test).
  - **Caveat:** a timeline that does not fill the frame (or has transparent areas) shows the held outgoing look around
    or under it until the teardown clears it, about 0.5 s after the fade. This is the same visual as normal→normal. If
    the owner wants the outgoing look gone during the fade for such timelines, that needs a coverage-aware rule.
- **WO-556 test change.** "The exchange call sends no PLAY" became "sends nothing to program; PRV joins at the playhead".
  The WO-556 fault (a program restart at 0 mid-crossfade) stays pinned. The old regression test still documents the
  `play(restart)` behaviour.
- **D6 (owner decision, not fixed):** one timeline per screen (needs per-screen engine playback) vs the current single air
  timeline.
- **D8 (owner decision, not fixed):** at the end of a non-looping timeline inside a look, hold the last frame (like a
  media layer), or stop to black (today)? Seen again in this run: the mixed test look (timeline layer without loop) went to
  its normal layer only after 20 s, while `scene.live` still names the look.
- **Observed edge case, open.** After a node restart the engine has no timelines (the test timeline is engine-only and
  must be re-PUT). The PGM→PRV exchange then still records a timeline look in `scene.live[prv]` whose timeline is not on
  air, so PRV shows nothing for it (seen 30.10: `scene.live[4] = wo828-tl-proj`, playback null). Engine timelines in
  real projects are loaded from the project, so this may only affect hand-made test timelines.
- **D9 (found 29.10, fixed 30.10, §2 / §5.2).** A CUT from a normal look to a timeline look showed 3 black PGM frames
  (22:30:41.839–.880). The CUT path sent `STOP/PLAY 1-210` and `STOP 1-110` in the same millisecond, before the timeline
  clip's first frame was decoded, and nothing was LOADBG'd ahead. A normal CUT holds the outgoing look until the LOADBG'd
  PLAY is acked (reference: 0 black). Fix as the coordinator scoped it: CUT takes into a timeline look only, ack + 2
  frames. Caveat: the margin, not the ack, is the guard (§2).
- **Mixed look (step 3), noted.** The mixed look still uses the normal A/B rule for its normal layer. When the incoming
  normal layer lands on the lower bank, the outgoing one fades out under the fading-in timeline. Luma goes 129 → 120.8 →
  124.8, a shallow 6 % U (math: 0.75·K2 + 0.25·L1 at mid-fade), not a black frame. This is unchanged by WO-828. Holding
  the outgoing look here too would need the bank-order rule to know about the timeline band.

## 5. Verified (29–30.10)

**Offline:**
- `node tools/ci/run-offline-tests.js`: 3661 tests, 3659 pass, 0 fail, 2 skipped. In one run,
  `smoke-wo570-look-media-transport` failed once on a wall-clock tolerance while the box was loaded (5113 ms vs ≤ 5050).
  It is unrelated to this diff, passed 3/3 when re-run alone, and passed in the clean full re-run.
- The 45 timeline smoke files: 247/247 (the pre-change baseline was 229/229 across 44 files).
- `check-max-file-lines`: 0 files over 500 lines. `npx eslint` on every touched or new file: clean.

**Live.** Server restarted on the final code (PID 1851396) and `wo828tl` re-PUT. Evidence:
- AMCP wire from `log/caspar_2026-10-29.log`.
- `GET /api/state`.
- The `pgm1` luma probe, which covers Dioda ch1 only (no shm tap on ch3).

Raw captures are in the session scratchpad `wo828/`: `x*`/`w*`/`f*` `.txt` + `.tsv`.

| Fix | Step | Wire | Luma (pgm1) |
|---|---|---|---|
| D4 | Loop1 → TL-only, MIX 25 (x02) | `1-210 OPACITY 0 0`, `STOP/PLAY 1-210 … SEEK 0`, `1-210 OPACITY 1 25 linear`; **no outgoing ramp line**; poll `MIXER 1-210 OPACITY` (target 1), then `CG/STOP 1-10` 510 ms after the fade start | 104.7 → 124.8 strictly monotonic over 25 frames (0 down-steps > 0.2), 0 black |
| D2 | loop wrap (w02, 22:25:54.995) | only `PLAY 1-210 … SEEK 0`, no STOP | 75 frames around the wrap 124.6–126.1, no frame-counter gap, 0 black (and 0/0 at 2 earlier wraps, 22:14:09 / 22:14:29) |
| D3 | retake TL-only (w04) | `MIXER 1-210 OPACITY 1 0` + `PLAY 1-210 … SEEK 0` only — no `OPACITY 0 0`, no STOP, no fade-up | 120.9 → 122.3, min 119.7 (clip content range), 0 black |
| D3 (CUT) | retake TL-only with CUT (x10_cut_retake) | `OPACITY 1 0` + `PLAY 1-210 … SEEK 0`, no STOP | 0 black |
| D1 | PRV take of TL-only while on PGM (w07, x07) | **0 ch1 lines**; `STOP/PLAY 2-210 … SEEK 64` / `SEEK 706` (the playhead); sendTo {preview, program} | 0 black, max reversal 0.03–0.07 |
| D5 | TL-only → KV LOOP 2 (x05, PRV already showing the TL look) | `1-210 OPACITY 0 12 DEFER` in the take batch; **no 2-210 line at all**; poll then `STOP 1-210` 477 ms after the fade start; end: playback playing, sendTo {preview:true, program:false}, `scene.live[2] = wo828-tl-only` | 0 black, no dip |
| D5 | same, PRV not yet showing it (w05, before the `alreadyOnCh` refinement) | exchange `PLAY 2-210 … SEEK 770` (join at the playhead), `STOP 1-210` after the poll, no STOP 2-210; `INFO 2-210` = KV LOOP 2 playing at 18.38 s | 0 black |
| race | TL proj playing on PRV ch4 only → PGM take on ch3 (f11a) | first ch3 line `MIXER 3-210 OPACITY 0 0`, then `STOP/PLAY 3-210`, `3-210 OPACITY 1 25`; **no `OPACITY 1 0`**; outgoing 3-10 held, cleared after the poll | (ch3: no probe) |
| D7 | TL proj → KV LOOP projekcja on ch3 (f11b) | **0 ch1/ch2 lines**; `3-210 OPACITY 0 12` at 14.728, poll at 15.136, `STOP 3-210` at 15.138 (after the 240 ms fade); PRV ch4 joins: `PLAY 4-210 … SEEK 796` | (ch3: no probe) |

Regression steps:
- 6 (PRV take of an unrelated look while the TL is on PGM): 0 ch1 lines; only `STOP 2-210` (preview claim released); 0
  black.
- 3 (mixed): timeline preset/fade as S1; normal layer via the bank rule; 0 black (the shallow U in §3).
- 9 (easeboth): `1-210 OPACITY 1 25 easeinoutquad`, no Caspar error, eased monotonic ramp 104 → 124.
- 10 (CUT normal → TL): `OPACITY 1 0`, STOP/PLAY, no preset/fade. As before, but the probe shows **3 black frames**
  (D9, §3; fixed in §5.2). A reference CUT normal → normal shows 0.
- 13: `POST /api/timelines/wo828tl/stop` without force while on PGM returns **409**.
- End state: Dioda ch1 = KV LOOP 2 (layer 10), Proj ch3 = KV LOOP projekcja (`INFO`); playback null.

Not proven: D7 and the race on the Proj PGM picture itself, because there is no luma tap on ch3. The wire shows the
fade-then-STOP order. Owner QA on the glass is still useful for multi-screen.

### 5.1 Coordinator re-run (30.10, 05:59–06:01, node started 22:28:37 on the final code)

Independent of the fix agent, same harness (`take.sh` + `lumaprobe.py pgm1`):
- KV LOOP 2 → TL-only (MIX): `1-210 OPACITY 0 0`, `STOP/PLAY 1-210 … SEEK 0`; teardown as §5.
- PRV-only take of the TL look while it is on PGM: **0 lines to ch1** (only `2-210` lines).
- Loop wraps at 05:59:56.543, 06:00:16.544, 06:00:36.578, 06:00:56.581: each is a bare `PLAY 1-210 … SEEK 0` with no STOP.
  Probe over 45 s (2250 samples, two wraps inside): **0 black**, min 118.9 (clip content), max frame-to-frame reversal 0.16.
- TL-only → KV LOOP 2 (MIX 12): `1-210 OPACITY 0 12 linear DEFER`, poll, `STOP 1-210` 415 ms later; **no 2-210 line**;
  end: playback playing with sendTo {preview:true, program:false}, `scene.live[2] = wo828-tl-only`; luma 121.6 → 121.7,
  0 black, dip 0.2.
- Gates: `npm run lint` equivalent (`eslint . --max-warnings 216`, the git-ignored `godot/export/` web build excluded as in
  CI): 0 errors, 215 warnings; `prettier --check tools/ci …`: clean; `check-max-file-lines`: 0 over.
- Cleanup: the three test looks removed from the live deck (`scene_deck_sync`), `DELETE /api/timelines/wo828tl` → 200,
  and the `wo828tl` entry that an earlier test autosave had put into `projects/mhp_harder.json` removed via
  `POST /api/project/autosave` (rev 333 → 334); `grep wo828 projects/` → none. Dioda PGM/PRV = KV LOOP 2,
  Proj = KV LOOP projekcja.

### 5.2 D9 verified (30.10, 06:06–06:08, node restarted on the D9 code, PID 2441936)

The fixtures were re-created (`decksync.js add`, PUT `tl.json`) and removed afterwards (`decksync.js remove`, `DELETE
/api/timelines/wo828tl` → 200, `grep wo828 projects/` → none). Captures: scratchpad `wo828/y_*.txt|tsv`.

| Case | Wire (ch1) | Luma (pgm1) |
|---|---|---|
| CUT Loop1 → TL-only, run 1 | `PLAY 1-210 … SEEK 0` at 30.126 (`202 PLAY OK` at .127), `CG 1-110 CLEAR` at .220, `STOP 1-110` at .225 | **0 black**, 104.6 → 123.5 |
| run 2 | PLAY 54.374, `CG 1-10 CLEAR` 54.475 (+101 ms) | **0 black** |
| run 3 | PLAY 01.108 (ack .119), `CG 1-110 CLEAR` 01.208 (+100 ms) | **0 black** |
| run 4 | PLAY 07.836, `CG 1-10 CLEAR` 07.929 (+93 ms) | **0 black** |
| CUT retake of TL-only | `OPACITY 1 0` + `PLAY 1-210 … SEEK 0`, no STOP (D3 path, no hold) | 0 black, no dip |
| CUT TL-only → KV LOOP 2 | `LOADBG 1-110`, `PLAY 1-110`, then `STOP 1-210` (+73 ms); PRV keeps the timeline (D5) | 0 black, 120.4 → 124.6 |
| MIX Loop1 → TL-only (regression) | preset, `STOP/PLAY 1-210`, `OPACITY 1 25` 76 ms after the PLAY (same as §5 x02), poll, then clear | 0 black, 105.5 → 123.5 |
| MIX TL-only → KV LOOP 2 (regression) | `1-210 OPACITY 0 12 DEFER`, `PLAY 1-110`, poll, `STOP 1-210` | 0 black |

Before the fix (29.10, x10_cut): `STOP 1-110` 2 ms after `PLAY 1-210`, then **3 black frames**.

Gates:
- `node tools/ci/run-offline-tests.js`: 3666 tests, 3664 pass, 0 fail, 2 skipped.
- Timeline smoke set: 252/252 across 46 files.
- `npx eslint . --max-warnings 216 --ignore-pattern 'godot/export/**'`: 0 errors, 215 warnings (exit 0).
- `check-max-file-lines`: 0 over. `prettier --check tools/ci`: clean.

End state: Dioda PGM ch1 and PRV ch2 = KV LOOP 2 (`scene.live[1]` = `[2]` = 7daf9777…, `INFO`). Proj ch3 = KV LOOP
projekcja, untouched. Playback null.

### 5.3 Coordinator re-run with the 5-frame margin (30.10, 06:15, node restarted on the final code)

Fixtures re-created and removed again (deck, engine, `grep wo828 projects/` → none). `take.sh` + `lumaprobe.py pgm1`:

| Case | Wire (ch1) | Luma |
|---|---|---|
| CUT KV LOOP 2 → TL-only, run 1 | `PLAY 1-210 … SEEK 0` 36.377, `CG 1-110 CLEAR` 36.532 (+155 ms), `STOP 1-110` .539 | 0 black (150 frames), min 119.2 |
| CUT TL-only → KV LOOP 2 | — | 0 black, min 120.8 |
| CUT KV LOOP 2 → TL-only, run 2 | `PLAY 1-210` 43.763, `CG 1-10 CLEAR` 43.925 (+162 ms) | 0 black, min 121.6 |
| CUT TL-only → KV LOOP 2 | — | 0 black, min 120.8 |

Gates on the final tree: offline suite 3666 / 3664 pass / 0 fail / 2 skipped (one earlier full run under load from the
parallel code sweep had 1 timing flake; the clean re-run passed); eslint 0 errors / 215 warnings; check-max-file-lines
0 over; prettier (CI scope) clean. End state: Dioda PGM/PRV = KV LOOP 2, Proj = KV LOOP projekcja, playback null.

## 4. Source map

Spec sources: WO-139, 152, 528, 537, 540, 541, 544, 545, 546, 548, 549, 550, 552 (551 DEPRECATED), 553, 554, 555, 556,
558, 559, 560, 561, 574, 618, 782, 814. Code: `src/api/routes-scene-take-look.js`, `src/api/routes-scene-take.js`,
`src/engine/scene-take-lbg*.js`, `src/engine/timeline-take.js`, `src/engine/timeline-playback*.js`,
`src/engine/scene-transition.js`, `src/caspar/caspar-tween.js`. Existing tests: 32 timeline smoke files, 168/168 pass —
none drives a timeline look through `routes-scene-take.js`; `smoke-scene-timeline-start`, `smoke-timeline-sendto`,
`smoke-timeline-keyframe-mixer` are in neither curated CI list.
