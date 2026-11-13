# WO-1068 — A look's timeline played on preview (PGM went black) when taken right after a server restart

**Area:** engine
**Status: DONE (13.11 — reproduced from the logs, fixed, re-taken on PGM 1 after a restart: plays and fades in on program)**

Owner, 13.11: *"intro timeline didnt fire correctly from its look. xcheck why"*

## Investigation

Take of look "Intro timeline" (4f8d67ab…) to PGM 1 (ch 2) at 16:07:22, `log/caspar_2026-11-13.log` + journal:

```
16:07:22.435 [Timeline] tmw3xnh86os9 loaded from the stored project
16:07:22.454 PLAY 3-211 "PROJECTS/NARVIL/IDE INTRO" SEEK 0      ← channel 3 = PRV 1, not program
16:07:22.525 MIXER 2-10 OPACITY 0 25 linear                     ← the outgoing look fades out on PGM
16:07:22.532 CLEAR 3                                            ← the PGM→PRV exchange clears PRV: the intro is gone
16:07:23.036 STOP 2-10 …                                        ← PGM is empty: black
```

- The server had been restarted a few minutes earlier (this session's deploys). After a restart the engine holds no
  timeline until a client pushes one; WO-949 loads it from the stored project inside `play()`.
- `startSceneTimelineLayer` (`src/engine/timeline-take.js`) does its work BEFORE that `play()`: it reads the timeline
  (`eng.get`) for the layers to preset to opacity 0, and calls `eng.setSendTo({ program: true, preview: false })`.
  With no timeline in the engine both were no-ops — `setSendTo` only wrote `if (tl)`.
- `play()` then loaded the timeline with its STORED routing: `{ preview: true, program: false }`, what the Timeline
  tab last saved. So it played on PRV only, and the exchange cleared it.
- Not caused by WO-1061 (the commit ordering): the wrong channel was chosen before any mixer line was built.

## What was done

- `startSceneTimelineLayer` loads the timeline first (`eng.ensure(tlId)`).
- `setSendTo` loads a timeline it does not hold instead of dropping the routing (same failure for any other caller).
- Regression test in `tools/smoke/smoke-wo949-timeline-hydrate.test.js`: empty engine, stored routing preview-only,
  look take → routing is program, PLAY on the program channel only, the opacity preset reaches the timeline layer.
  Fails on the old code ("the take claims program"), passes on the fix.

## Verified

- Offline suite 6208 pass.
- Box: server restarted (engine timelines `[]`), look taken to PGM 1 → `MIXER 2-21x OPACITY 0 0`, `PLAY 2-211
  "PROJECTS/NARVIL/IDE INTRO" SEEK 0`, `OPACITY 1 25 linear`, commit; engine state `sendTo { program: true,
  preview: false }`, playing; `PRINT 2` shows the intro. Timeline stopped afterwards.
