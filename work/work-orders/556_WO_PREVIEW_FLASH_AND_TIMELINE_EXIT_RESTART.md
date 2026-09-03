# WO-556 — previewing another look flashed PGM; leaving a timeline look restarted it mid-transition

**Status: FIXED in repo (03.09.2026), two bugs found in WO-555's own live QA. 19 new smokes (7 in
this WO, all regression-proven by removing each fix and confirming the load-bearing test fails).
Full offline suite 2384/2382/0/2, all green — the only red seen during verification was the
pre-existing `smoke-wo537` wall-clock flake (confirmed unrelated, passes reliably in isolation, same
class already noted in WO-554/555). Server restarted and live. Owner QA owed.**
**Priority:** Critical — both bugs are live-production visual defects on the exact PGM/PRV
interactions this whole session has been chasing.
**Source:** owner, live QA of WO-555 the same morning (03.09): *"first click to prv of another look
while timeline look is playying blinks that look on the pgm channel. when switching back to a
normal look, the timeline restarts during the transition."*
**Related:** [WO-553](./553_WO_LOOK_TIMELINE_OPACITY_FLASH.md) (the flash mechanism Bug A repeats —
an unprotected `setSendTo` reapply), [WO-554](./554_WO_TIMELINE_LOOK_DOUBLE_PLAY_AND_STUCK_PRV.md)
(the `deferTimelinePlay` mechanism Bug B's fix reuses), [WO-555](./555_WO_TIMELINE_PREVIEW_ROUTING_CORRUPTION.md)
(today's prior fix — both bugs here were introduced or exposed by it, found within the hour by the
owner actually testing it)

---

## 1. Investigation

### Bug A — previewing an unrelated look flashes PGM

WO-555's `resolveTimelineIdToReleaseFromPreview` fix added, in `scene-take-lbg.js`:
```js
self.timelineEngine.setSendTo({ preview: false, program: true, screenIdx }, releaseId)
```
without a third `opts` argument. `TimelineEngine.setSendTo` (`timeline-playback-runtime.js`) treats
a missing `opts` the same as `{ skipAmcpApply: false }` — its routing-change reapply block:
```js
if (routingChanged && tl && !opts?.skipAmcpApply) {
    ...
    this._applyAt(tid, pos, true) // force:true, no takeFade
}
```
ran unconditionally. This is the exact WO-553 flash mechanism repeated: an unprotected, instant
reapply of the timeline's current clip state (raw OPACITY/FILL/VOLUME/effects-neutral block) against
its NEW channel set — now program-only, since preview was just dropped. Every OTHER timeline
`setSendTo` call site in this codebase (`runTimelineDirectTake`, `startSceneTimelineLayer`) already
passes `skipAmcpApply: true` for exactly this reason; this new WO-555 call site was the one place
that didn't follow the established pattern.

Note the STOP-of-dropped-channels half of `setSendTo` (added by WO-555 itself, differential — only
`removedCh`) is a SEPARATE code block, not gated by `skipAmcpApply` at all — so PRV's stale layers
still get correctly cleared regardless of this bug. Only the redundant program-side reapply was the
problem.

### Bug B — the timeline restarts when leaving its look

`routes-scene-take.js`'s pgm/prv `previewExchangePromise` call puts `previousPgmScene` (whatever WAS
on program) onto the preview bus for operator reference during a transition. When switching AWAY
from a timeline-containing look, `previousPgmScene` IS that look — so `buildTakeJobs` reaches
`startSceneTimelineLayer` for the SAME timeline that is, at that exact moment, either mid exit-fade
(run concurrently by `pgmTakePromise`'s own `activeTimelineIdToFadeOut` handling) or already
stopped. `startSceneTimelineLayer` unconditionally calls `eng.play(tlId, 0, { restart: true })` —
there was no signal telling it "this timeline is not new, do not touch its transport." The result:
a genuine transport restart to position 0, stomped into the middle of what should be a smooth
crossfade-out — read by the owner as "the timeline restarts during the transition".

This call's own preview *routing* for the timeline was never the problem — it was already correct
(untouched since the earlier take put the timeline on both buses; even with WO-555's Bug-A-fixed
`skipAmcpApply`, routing itself doesn't change here since preview was already `true`). The `play()`
call was the only consequential, and harmful, part of what this function did.

## 2. What was done

1. **`scene-take-lbg.js`** — the WO-555 release-from-preview `setSendTo` call now passes
   `{ skipAmcpApply: true }`, matching every other timeline routing call in the codebase.
2. **`routes-scene-take.js`** — the `previewExchangePromise` call now also sets
   `deferTimelinePlay: true` (WO-554's existing, already-tested mechanism — this is its second call
   site). Its own reasoning differs from WO-554's staging call: there, a redundant real take follows
   moments later; here, nothing should ever (re)play this timeline from this call — it is either
   correctly mid-exit already or correctly already gone, and this call's only legitimate job re: the
   timeline is (now inert) routing bookkeeping.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo556-preview-flash-and-exit-restart.test.js` — 7 tests: Bug A's fix (no
  reapply lines sent with `skipAmcpApply`, a regression test proving the pre-fix call DOES send
  them, and a check that the STOP-of-dropped-channels behavior survives the fix unaffected); Bug B's
  fix (`deferPlay` + `restrictToPreview` on an already-on-program timeline sends zero `PLAY` lines
  and still ends up correctly routed to both buses, plus a regression test proving the pre-fix call
  DOES send a `PLAY`); two source-level wiring pins.
- Ran the new tests, confirmed the regression checks demonstrate the pre-fix mechanism directly
  (not tautological — same technique as WO-554/555: the "without the fix" test asserts the OLD,
  buggy outcome using the exact same call shape the real code used before this WO).
- Updated two now-stale assertions from prior WOs that this change legitimately invalidated:
  WO-554's smoke pinned "exactly one `deferTimelinePlay: true` call site" — now two, both
  legitimate, so relaxed to "at least the staging call site still has it"; WO-555's smoke pinned the
  release `setSendTo` call's exact single-line text — now split across three lines by the added
  `opts` argument, relaxed to a substring match spanning both.
- Full offline suite: `node tools/ci/run-offline-tests.js` → 2384 tests, 2382 pass, 0 fail, 2 skip.
  Reran `smoke-wo537-look-timeline-starts-where-asked.test.js` alone after seeing it flake twice
  during full-suite runs (different sub-tests each time, always a 1ms `Date.now()`-derived
  off-by-one) — 9/9 clean in isolation both times, confirming an existing load-dependent flake
  unrelated to this change (already flagged in WO-554 and WO-555's own write-ups).
- Server restarted (`kill -TERM $(systemctl show -p MainPID --value highascg)`) — live on the box.

## 4. What remains owner-QA

- Preview a different, timeline-free look while a timeline look is live on program — confirm PGM
  stays clean with no flash.
- Switch from a timeline-containing look to a normal look — confirm the timeline fades out smoothly
  with no visible restart/position-reset mid-transition.
- The header warning-triangle question from WO-555 §5 remains open; unrelated to this WO.
