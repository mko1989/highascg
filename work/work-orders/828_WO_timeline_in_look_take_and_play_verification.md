# WO-828 — Timeline inside a look: does the take transition and play as the WOs say? (live verification + fixes)

**Status: IN PROGRESS (29.10) — spec compiled from 25 WOs, 13-step live test run on the box (AMCP wire + journal + state +
PGM luma probe); 8 deviations found, fixes in progress**
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

(in progress)

## 3. Owner decisions

- **D8:** at the end of a non-looping timeline inside a look — hold the last frame (like a media layer), or stop to
  black (today)?
- **D6:** one timeline per screen (needs per-screen engine playback) vs the current single air timeline.

## 4. Source map

Spec sources: WO-139, 152, 528, 537, 540, 541, 544, 545, 546, 548, 549, 550, 552 (551 DEPRECATED), 553, 554, 555, 556,
558, 559, 560, 561, 574, 618, 782, 814. Code: `src/api/routes-scene-take-look.js`, `src/api/routes-scene-take.js`,
`src/engine/scene-take-lbg*.js`, `src/engine/timeline-take.js`, `src/engine/timeline-playback*.js`,
`src/engine/scene-transition.js`, `src/caspar/caspar-tween.js`. Existing tests: 32 timeline smoke files, 168/168 pass —
none drives a timeline look through `routes-scene-take.js`; `smoke-scene-timeline-start`, `smoke-timeline-sendto`,
`smoke-timeline-keyframe-mixer` are in neither curated CI list.
