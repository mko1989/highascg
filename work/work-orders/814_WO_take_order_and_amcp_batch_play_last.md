# WO-814 — Take order: new look straight to PGM, PRV copy after the PGM PLAY; PLAY last in the batch

**Status: DONE (29.10, offline suite + live PRV/PGM takes on ch 1/2, see Verified) — owner QA: a real show take**

Builds on WO-259 (two-phase BEGIN…COMMIT take, `take_two_phase_batch`), WO-574/WO-782 (multi-screen PLAY in one
merged batch), WO-150 B150.1 (PRV flip-flop). Does not repeat them.

## Owner (29.10, verbatim)

"also again we need to work on the amcp commands creation and sending to casparcg, as it is lacking very much in speed
of recalling etc. the commands need to be separated and sent as batch..commit commands in a right sequence where play
(multiple channels layers in most cases) is the last one. also there is a wrong path for playing a look, where it first
gets sent to prv then to pgm. with loadbg inside caspar it doesnt make sense. we only need the look that was on the
screen pre transition gets into prv after the pgm take is settled."

## Investigation (before the fix)

### Current order of a PGM take on a PGM/PRV screen (`POST /api/scene/take`, `src/api/routes-scene-take.js`)

1. `stageOnPreview = b.stageOnPreview !== false` (`routes-scene-take.js:246`) — default **on**. The incoming look is
   first taken onto **PRV** with a full `runSceneTakeLbg` (`:268-279`) and **awaited**: PRV Phase A batch, prebuffer
   sleep (80 ms), `MIXER 2 COMMIT`, PRV PLAY, `MIXER 2 COMMIT` ×2. This is the "first PRV then PGM" path the owner sees.
   LOADBG on PGM already prebuffers, so the PRV pass buys nothing and costs ~100-140 ms before any PGM command.
2. `pgmTakePromise = runSceneTakeLbg(PGM…)` (`:386`), then **immediately** `startPreviewExchange()` (`:400`) — the
   old PGM look onto PRV runs **concurrently** with the PGM take (comment `:396-399`: done for WO-150 B150.1 because
   the staged incoming look sat on PRV for the whole fade). Both share one AMCP connection / send queue, so the
   exchange's `CLEAR 2` (`:319` → `clearSceneProgramLookStackLayers`) and its PRV Phase A + PRV PLAY
   (`:358`) are queued **in between** the PGM Phase A and the PGM PLAY. That is why "pgm->prv exchange done" prints at
   the end but the PRV commands hit Caspar first.
3. Inside each `runSceneTakeLbg` (`src/engine/scene-take-lbg-amcp-pipeline.js`): Phase A one BEGIN…COMMIT
   (`:186` → `scene-take-lbg-amcp-pipeline-batch.js:21-79`: MIXER CLEAR + LOADBG + pre-PLAY opacity + deferred MIXER +
   border/PIP CG), prebuffer sleep 80/180 ms (`:282-288`), then Phase B via `sendStaggeredTakePlays`
   (`src/engine/scene-route-deps.js:317-353`): `MIXER ch COMMIT` → one BEGIN…COMMIT → `MIXER ch COMMIT`.
4. Teardown after the fade (`scene-take-lbg-teardown.js:248`): `CG CLEAR / STOP / MIXER CLEAR` per exiting layer,
   one round trip each (serial on purpose: a CG CLEAR on a media layer fails harmlessly, inside a batch it would be
   reported to the operator as an AMCP failure, WO-360). After the transition, not on the recall path.

### Order inside the PLAY batch

`scene-route-deps.js:329-333`: `[...sourceLines, ...suffixAfterSources, ...routeLines]`. For a crossfade take
`sourceLines` interleave `PLAY 1-110 | MIXER 1-110 OPACITY 0 0 | PLAY 1-111 | …` and the crossfade tweens
(`MIXER 1-11x OPACITY 1 12 linear`) follow, so **PLAY is not the last command of the batch**. Multi-screen
(`take-sync-barrier.js:44-56`) concatenates each screen's block, so screen 1's PLAYs precede screen 2's mixer lines.

### Batch flag

`take_two_phase_batch` (`src/caspar/amcp-batch.js:94`, default true; `src/config/defaults-core.js:20`; live
`config/general.json` = true). It covers Phase A + Phase B of every `runSceneTakeLbg` (PGM, PRV staging, exchange,
preview-only takes); `false` restores the WO-259 legacy one-command-at-a-time path. The global `amcp_batch` stays
false (other flows). So the take already batches by default; a single-command Phase B (one-layer cut) goes out as a
plain line (`AmcpBatch#batchSend` needs ≥ 2 lines, `amcp-batch.js:395`) — still one round trip.

### Round trips, 3-layer MIX take, PGM 1 / PRV 2 (offline harness driving the real handler, 1 ms per round trip)

32 AMCP round trips per take. The PGM PLAY batch is round trip **14**; **11 PRV round trips go before it** (staging 5,
`CLEAR 2`, exchange 5). PGM PLAY at 309 ms after the request (the stub's 1 ms RT; the rest is the prebuffer sleeps).

### Live evidence (29.10, node journal + `log/caspar_2026-10-29.log`, 1-layer look, PGM 1 / PRV 2)

| take | request | PRV staging PLAY | PRV exchange PLAY | PGM PLAY | request → PGM PLAY |
|---|---|---|---|---|---|
| 14:30:10 | 10.641 | 10.765 | 11.004 | 10.922 | 281 ms |
| 14:30:41 | 41.154 | 41.268 | **41.509** | 41.535 | 381 ms |

At 14:30:41 the exchange's PRV PLAY reached Caspar **before** the PGM PLAY. In both takes the incoming look was first
loaded + played on PRV (`LOADBG 2-10 …`, `PLAY 2-10`) before `LOADBG 1-110`.

## Also found while measuring

- **Cut takes blacked PGM out before the PLAY.** `scene-take-lbg.js:210-229` (orphan sweep, runs on every cut and every
  pgm-only take) collected the on-air look's own layers (live JSON, `collectOccupiedLookLayersOnChannel`) as "stale" and
  sent `CG CLEAR / STOP / MIXER CLEAR` on them **before** the new LOADBG. Live before: `STOP 1-10` at +292 ms, new
  `PLAY` at +554 ms → ~260 ms of black on every PGM cut. Those layers are exit candidates anyway (`extraExitCandidates`,
  `scene-take-lbg-jobs.js:181`), so the teardown clears them right after the PLAY.
- A node event-loop stall of ~6.4 s at 14:56:46-52 (Caspar acked the PRV batch at 46.096, node read it at 52.548,
  next to `[project] pushed mhp_harder.json → bridge` / `[follow] patch`). Not take code; the PGM PLAY was already out.
  Worth its own look if it recurs.
- Not changed (follow-ups): the teardown after the fade is one round trip per line (serial on purpose, see above); the
  prebuffer sleep (80 ms, 180 ms when the incoming layer fades in) is now the largest part of request → PLAY; non-shader
  template CG and browser CG still go out after the PLAY batch (`scene-take-lbg-amcp-pipeline.js` after Phase B, WO-196
  continuity); on bank-less PRV takes `clearStaleInactiveBankLookLayers` stops PRV's exiting layers before the PRV PLAY.

## What was done

- `src/api/routes-scene-take.js` — the incoming look is no longer staged on PRV: `stageOnPreview` is a legacy opt-in
  (`stageOnPreview: true`). The PGM→PRV exchange (old PGM look onto PRV) is started by a new `onProgramPlayCommitted`
  hook of the PGM take, i.e. after the PGM PLAY batch and its `MIXER ch COMMIT` were acked (fallback: after the take,
  for takes without a PLAY batch). With no previous look, PRV is cleared when it was showing the look now on air.
- `src/engine/scene-take-lbg.js` / `scene-take-lbg-amcp-pipeline.js` — the hook is called right after Phase B; one
  timing line per take: `[scene-take-lbg] timing chN: phaseA-done=… play-acked=… jobs=…`. The orphan sweep keeps the
  on-air look's layers (teardown clears them after the PLAY).
- `src/engine/scene-route-deps.js` (`playLinesLast`) + `take-sync-barrier.js` — inside the PLAY batch every non-PLAY
  line (opacity holds, crossfade tweens) goes first and all PLAYs last, in their order (routes still after their
  sources); multi-screen merged batches the same, so PLAY is the last command of the last batch. Mixer state is per
  layer and the incoming layer is already at opacity 0 from Phase A, so moving the tweens ahead of the PLAYs changes
  nothing visible.
- `take_two_phase_batch` stays as it was (default true; `false` = legacy one-command-at-a-time path, still covered).

## Verified

- New `tools/smoke/smoke-wo814-take-order-play-last.test.js` (6 tests, in `offline-test-files-2.js`): real
  `/api/scene/take` handler + recording AMCP: 3-layer MIX and CUT on PGM 1/PRV 2 — one LOADBG batch, one PLAY batch with
  PLAYs last, trailing commit, no PRV command before the PGM PLAY batch, PRV gets the previous look, the incoming look
  never goes to PRV, cut stops the old layers only after the PLAY; two screens in one take group — one merged PLAY
  batch, both PRVs after; empty previous → PRV cleared after the PLAY; `stageOnPreview: true` and
  `take_two_phase_batch: false` still reachable. `smoke-wo574` expected order updated to PLAYs-last.
- Offline suite: 3561 tests, 3559 pass, 0 fail, 2 skipped. No file over 500 lines. eslint clean on touched files.
- Offline harness (1 ms per round trip, 3-layer MIX): PGM PLAY at round trip 14 → 3, 32 → 27 round trips per take.
- Live, node restarted 14:55:20 (dev mode), test look = 3 layers (KV LOOP 2, Cały Czas dioda, BUMPER), times from the
  Caspar log relative to the HTTP request, round trips = commands on ch 1/2 (a BEGIN…COMMIT = 1):

| test | before | after |
|---|---|---|
| PRV-only take (target preview), PLAY | 107 / 111 ms, 5 RT | 102 ms, 5 RT (path unchanged) |
| PGM MIX over a 1-layer look: PGM PLAY | 620 ms, RT #25 of 40, first PRV cmd at 26 ms | 219 ms, RT #3 of 29, first PRV cmd at 281 ms (after PLAY ack 262) |
| PGM CUT: PGM PLAY / old layer STOP | 554 ms / STOP at 292 ms (~260 ms black) | 119 ms / STOP at 257 ms (after the PLAY) |

  PLAY batch on the wire (14:56:19.503): `MIXER 1-110/111/112 OPACITY 0 12 linear`, then `PLAY 1-10`, `1-11`, `1-12`.
  PGM/PRV were returned to what they showed before the test (`Look 1` on both; its PNG LOADBG 404s, as before).
- Owner QA: a show take on PGM with real looks (MIX and CUT, a multi-screen recall) — PRV now shows the previous look
  only after the PGM transition has started.
