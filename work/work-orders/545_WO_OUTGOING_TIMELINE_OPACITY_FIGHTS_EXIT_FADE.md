# WO-545 — An exiting timeline's own ticking could still fight the take's fade-out during the teardown wait

**Status: FIXED in repo (02.09.2026). 7 smokes (6 verified to fail without the fix), suite
2307/2305/0/2 → 2314/2312/0/2. Owner QA still owed on real PGM.**
**Priority:** High (on-air; second distinct root cause found for the same "cut instead of mix"
report in one session)
**Source:** owner 02.09: *"going back to a look from timeline does a cut instead of mix"* —
re-reported after WO-540 §6 (the declared-vs-actual framerate fix) was deployed, so that fix alone
did not close it.
**Related:** [WO-544](./544_WO_TIMELINE_CLIP_KEYFRAME_VS_TAKE_FADE_RACE.md) (the sibling bug on the
INCOMING side, found first — this is the same class of collision on the OUTGOING side),
[WO-540](./540_WO_CH1_HALF_RATE_TEARS_DOWN_EVERY_FADE_AT_50_PERCENT.md) (a different, also-real
cause for the same symptom), [WO-528](./528_WO_TIMELINE_IN_LOOK_CUTS_AND_DESTABILISES.md)

---

## 1. Investigation

While fixing WO-544 (a clip's own opacity keyframes fighting the INCOMING crossfade), the same
mechanism was checked for the OUTGOING side, since it's the more literal match for "going back to
a look from timeline."

`activeTimelineIdToFadeOut` (computed in both `scene-take-lbg.js` and `scene-take-pgm-only.js`)
builds a `MIXER ... OPACITY 0 <fadeDur> DEFER` line per physical layer for the exiting timeline,
committed together with the take. But the timeline itself stays `_airTimelineId` — still ticking
via its own `setInterval` (`TICK_MS = 40`) — right up until `self.timelineEngine.stop(...)` runs,
which in `scene-take-lbg.js` happens at line 371, **after** `runSceneTakeLbgTeardown`'s wait
(`teardownWait`, and since today's WO-540 §6 fix, potentially the extra opacity-verify poll too —
up to `2 * fadeMs` from `fadeClockStart`).

`_applyKeyedMixerProp`'s steady-state branch is already quiet mid-tween-span by design
(`shouldSendInstantKeyframeMixer`: `!opts.inTweenSpan` — it trusts Caspar's own DEFER to carry an
in-progress segment, so it does not keep re-sending every tick). The real collision is
`segChanged`: if the exiting clip's opacity keyframes have a segment BOUNDARY inside the wait
window (any clip with more than two opacity keyframes, or the wait spanning into the next clip on
that layer), the engine's own regular tick (`_syncAmcpOnTimelineTick` → `_syncAmcpLayers(id, ms, {
force: false })` — **never** carries `takeFade`, unlike the one-time `play()`/`playForTake()` apply)
fires a fresh, uncoordinated instant+DEFER write on that boundary — fighting the take's own
fade-out ramp. Same class of bug as WO-528/WO-544, just reachable at any point during a wait that
can now last up to `2 * fadeMs`, not only at entry.

Confirmed with a direct test: a clip with keyframes at 0/400/5000ms, playing from 350ms
(mid-first-segment), ticking to 450ms (crossing the 400ms boundary) — without a hold, this
genuinely emits `MIXER ...OPACITY 0.49... 0` + `MIXER ...OPACITY 0 115 linear DEFER`, an
uncoordinated write exactly where the take's own fade-out is trying to own that layer.

### 1a. A side discovery: `scene-take-pgm-only.js` is dead code

While tracing WO-540's earlier scoping note ("screen 1 has no preview bus... goes through
scene-take-pgm-only.js"), found this file's own header: *"LEGACY since WO-160b: pgm-only takes now
run through the LBG bank pipeline instead of this engine... runSceneTakePgmOnly is no longer
invoked."* Confirmed by grep: zero callers outside its own test files
(`tools/smoke/smoke-wo160b-pgm-only-lbg.test.js` even asserts the delegation line was removed).
**This means WO-540's original screen-1/pgm-only carve-out was based on stale information** — every
take, including a pgm-only screen, now runs through `scene-take-lbg.js`. The fix here (and WO-544's)
is applied to the file that actually matters for every screen. `scene-take-pgm-only.js` still got
the same `setOpacityExitHold` call for consistency/safety should it ever be reactivated, but it is
not load-bearing for the reported bug.

## 2. What was done

`timeline-engine.js`: new `_opacityExitHoldId` instance field.

`timeline-playback-runtime.js`: `setOpacityExitHold(id)` sets it (`null` releases); `stop(id)`
clears it automatically whenever it matches the timeline being stopped, so a hold can never outlive
its timeline.

`timeline-playback-amcp-send.js`: `_syncAmcpLayers` now computes `takeFade = !!opts.takeFade ||
this._opacityExitHoldId === id` — folding the hold into the SAME suppression `_applyKeyedMixerProp`
already has (WO-528 + today's WO-544 fix covers both the steady-state and segChanged branches), for
every tick of the held timeline, not just a one-time apply.

`scene-take-lbg.js` / `scene-take-pgm-only.js`: call `setOpacityExitHold(activeTimelineIdToFadeOut)`
under the exact same gate (`activeTimelineIdToFadeOut && fadeDur > 0 && !forceCut`) that builds the
fade-out DEFER line, so the hold and the fade it protects always agree on when they apply.

## 3. What was NOT done

Owner QA on real PGM — verified by direct unit test against the real engine (a clip with a
keyframe boundary landing inside the wait window), not by re-taking a look away from a live
timeline with such a clip on the actual box.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo545-opacity-exit-hold.test.js` — 7 tests against the real `TimelineEngine`:
  a held boundary crossing writes nothing; the identical crossing without a hold does write
  (proving the collision is real, not hypothetical); a held crossing records no segment state, so
  releasing the hold still re-arms the write (fail-bright, matching WO-544's philosophy); `stop()`
  clears the hold automatically; a hold on one timeline does not suppress a different one; and
  source-level assertions that both take orchestrators wire the hold under the identical gate that
  builds their fade-out DEFER.
- Reverted the engine + both orchestrator changes and reran: 6 of 7 tests fail cleanly (the 7th,
  "without a hold DOES write", is unaffected by this fix by design — it pins the pre-existing
  collision baseline), confirming the smoke catches the regression.
- Full offline suite: 2314/2312 pass, 0 fail, 2 pre-existing skips. Lint: the one warning in
  `scene-take-pgm-only.js` is pre-existing (confirmed present before this change). 0 files over the
  500-line limit.
