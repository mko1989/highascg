# WO-1075 — A cut on a PGM-only screen went to black before the new look played

**Area:** engine
**Status: IN PROGRESS (14.11.26 — fixed and pinned offline; NOT run on the box: the show was on, no restart, no screen tests)**

Owner, 14.11: "Yes [fix the ~180 ms of black on normal cuts on PGM-only screens], but no restarts and tests on screen,
it's back on show."

## Investigation

- Seen in the WO-1073 box test (14.11, pgm2 = ch 4, PGM-only): a normal cut sent `CG 4-10 CLEAR / STOP 4-10 /
  MIXER 4-10 CLEAR` before `PLAY 4-110`; the journal showed the play acked ≈ 180 ms after the take started.
- Cause: the PGM-only take call passes `currentScene: null` (src/api/routes-scene-take.js:146, used at :434 unless
  `editOnAir`). `currentMap` is then empty, so the WO-814 exemption for the on-air look's layers protects nothing, and
  the WO-160b sweep (`shouldClearOrphans`, src/engine/scene-take-lbg.js) clears every occupied look layer that is not a
  take target — the whole look on air — ahead of the LOADBG / PLAY batches.
- Reproduced offline with a recording AMCP (look L1 on bank A, cut to L2): `STOP 1-10`, `STOP 1-11` came 20+ lines
  before `LOADBG 1-110` and `PLAY 1-110`.
- Why not simply pass the live `currentScene` (as the edit path does): that turns on the bank crossfade, exit
  candidates and the WO-956 keep for every PGM-only take — a much wider behaviour change than can be shipped without a
  screen test.

## What was done

- src/engine/scene-take-lbg.js: on a PGM-only **cut** (`opts.pgmOnly && fadeDur === 0 && !isMergeTransition &&
  !banklessTake`) the stale layers of the **active bank** (the look on air) are taken out of the pre-LOADBG sweep and
  cleared with the same `clearPhysicalLookLayers` right after the PLAY pipeline returns. Stale layers on the incoming
  bank are still swept first, as before.
- The deferred sweep sits after the phase-B abort check: a take whose PLAY failed now keeps the old look on air
  (before, it had already been cleared).
- The new look plays on the other bank, so no layer number is shared between the two.

## Verified

- New smoke `tools/smoke/smoke-wo1075-pgm-only-cut-no-gap.test.js` (5 tests): old look on bank A and on bank B is
  stopped/cleared only after the new PLAY; a second cut in a row; a fade take keeps the old order; source pins.
  The same trace before the fix showed the clears first.
- Offline suite and gates: see the commit.
- **Not verified:** nothing was run on the box. The running server still has the old code until its next restart.
  Wanted then: a cut on pgm2 with the journal open — `PLAY 4-1xx` must come before `STOP 4-xx` — and eyes on the wall.

## Open

- When the old look is on bank B (110+) and the new one plays on bank A (10+), the new look is under the old one until
  the sweep lands (same tick, a few ms after the PLAY) — no black, but the cut is at the sweep, not the PLAY.
- A take **with a fade** on a PGM-only screen still clears the old look first and fades in from black (unchanged here).
