# WO-1032 — Timeline cues: fire on program only, and never drop one
**Area:** engine, companion, lighting
**Status: DONE (11.11)**

Owner, 11.11: *"When I create a timeline and for instance put companion or lighting cues inside, then play that
timeline from a look does all those cues fire correctly?"* — then: *"3 should have a guard 'is on program'. And make
sure the rest is fixed too."*

## Found (engine in isolation, Companion + console stubbed)

A look taken to program (cut or fade) starts its timeline at 0 and fires each `companion_press` / `light` flag as the
playhead crosses it; loops and retakes fire again. Five faults:

1. **Two cues on the same time: one fired.** `_processTimelineFlags` handled one flag per 40 ms tick and returned;
   the rest were behind `_lastTickPositionMs` for good. Cues 10 ms apart lost the second in 1 of 4 runs; a late tick
   does the same to cues further apart.
2. **A cue at exactly 0 never fired** — first play and loop wrap (`prevMs < t` with `prevMs = 0`). Same for a seek /
   jump landing exactly on a cue.
3. **Cues fired from preview.** The only guard was "is the air timeline": a look taken to PRV pressed real buttons.
4. **A pause flag on the same time swallowed the cue** (first flag in id order won).
5. Found while testing 3: a preview take kept a *stored* `sendTo.program: true` (saved after an earlier Take) of a
   timeline that was not on air → the timeline played on program from a PRV take.

## Changed

- `timeline-playback.js` `_processTimelineFlags`: every crossed cue fires; cues fire only when the timeline's
  `sendTo.program` is on (debug line otherwise); of the transport flags (pause / play / jump) the first crossed one
  runs, after the cues. `_armFlagStart` + `_flagStartAt`: a start not reached by ticking (fresh play, restart, loop
  wrap, take, seek) includes a cue exactly on the start position; a Play from where the playhead stands arms nothing
  (no double fire after a pause). Transport flags keep the strict crossing — a jump onto a pause flag still does not
  pause.
- `timeline-playback-runtime.js`: the four arm calls (play, playForTake, both seek branches).
- `timeline-take.js` `startSceneTimelineLayer`: a preview-restricted call keeps a program claim only of a timeline
  that is on air.

**Consequence to know:** the Timeline tab playing with only PRV ticked no longer fires cues either — tick PGM or Take.
**Not changed on purpose:** a seek / jump *over* a cue does not fire it (a scrub would spray cues).

## Verified

`tools/smoke/smoke-wo1032-timeline-cues.test.js` (10 cases, in the curated CI list); WO-543 / WO-837 smokes repointed
(their timelines are now routed to program by id).
