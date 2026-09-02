# WO-544 — A timeline clip's own opacity keyframes raced the take's crossfade

**Status: FIXED in repo (02.09.2026). 6 smokes (2 verified to fail without the fix), suite
2301/2299/0/2 → 2307/2305/0/2. Owner QA still owed on real PGM.**
**Priority:** High (on-air; reported live, right after WO-541 was deployed)
**Source:** owner 02.09, live QA of WO-541: *"playing from look does not work correctly, it goes
up in opacity then down, then when i play another look the timeline shows up."*
**Related:** [WO-541](./541_WO_TIMELINE_ONLY_LOOK_NEVER_FADES_IN.md) (fixed the plain-clip half of
this same report), [WO-528](./528_WO_TIMELINE_IN_LOOK_CUTS_AND_DESTABILISES.md) (the sibling guard
this one was missing), [WO-519](./..) (fail-dark class), [WO-537](./537_WO_TIMELINE_IN_A_LOOK_RESUMES_INSTEAD_OF_STARTING.md)
(why the look path can't use `playForTake`)

---

## 1. Investigation

WO-541 (committed 10:16 today) fixed a look whose incoming timeline consists of **plain clips** —
no opacity keyframes. The owner restarted the service (confirmed: `highascg` MainPID's start time
10:38:49, ~90s after the WO-543 commit) and re-tested within minutes, reporting a *different*
symptom than WO-541's ("nothing appeared at all"): the layer now visibly ramps opacity **up then
down**, then only becomes visible again when a **later, unrelated** look is taken.

This matches a mechanism identified but not yet fixed earlier in the same investigation session:
`startSceneTimelineLayer` (`timeline-take.js`) presets a MIX-branch timeline's physical layers to
`OPACITY 0 0`, then calls `eng.play(tlId, startPos, { takeFade: true, restart })` — deliberately
`play()`, never `playForTake()` (WO-537: the CUT branch has no orchestrator commit to receive an
uncommitted DEFER lead tween, the WO-519 fail-dark class). `startSceneTimelineLayer` then excludes
any layer whose clip has its own opacity keyframes from the list it returns for the *caller* to
fade in (`collectClipOpacityFadeLayers`), on the assumption that the clip's own keyframe tween will
own that layer's opacity instead.

That assumption is only true when the engine actually schedules the clip's own tween through
`scheduleLeadTween` — and `scheduleLeadTween` is set from `take` (`_syncAmcpLayers(id, ms, {
force, take, takeFade })`, `timeline-playback-amcp-send.js:92`), which `play()` NEVER sets (only
`playForTake()` does — `timeline-playback-runtime.js:132` vs `:82`). So on the look path,
`scheduleLeadTween` is always false, and the branch that WOULD fold the clip's own keyframe tween
into a coordinated write (`_applyKeyedMixerProp`, `timeline-playback-amcp-schedule.js:226-250`)
never fires. Control falls through to the `segChanged` branch (`:252-283`) — which, before this
fix, was **not gated by `takeFade` at all**, unlike its sibling steady-state branch a few lines
below (`:316`, the exact guard WO-528 added). It fired immediately and unconditionally, via its own
separate AMCP write, landing on the SAME physical layer that `startSceneTimelineLayer`'s caller
(the take orchestrator, carrying my WO-541 fix's own crossfade fade-in) was about to ramp — two
uncoordinated writers, last-writer-wins. Concretely: the clip's own keyframe curve (whatever
opacity animation is baked into it — commonly a fade-in-then-hold, or fade-in-then-out) ran
immediately and independently the moment `play()` was called, *before* the take's own crossfade
batch even sent its own ramp — "goes up then down" is the clip's own curve, not a bug in the
ramp's direction. The layer then settles at whatever the clip's curve last wrote (often not full
opacity) and stays there — invisible or dim — until an unrelated later take's `MIXER CLEAR` resets
opacity to 1 and reveals the still-running content: "when i play another look the timeline shows
up".

Confirmed this is real, not speculative, with a test harness driving the actual
`_applyKeyedMixerProp` (see §4) — reverting the fix reproduces exactly the collision: both an
instant `OPACITY 1-210 0.3 0` and a `OPACITY 1-210 1 25` (no DEFER, i.e. the legacy immediate path)
fire despite `takeFade: true` being set.

## 2. What was done

`timeline-playback-amcp-schedule.js`, `_applyKeyedMixerProp`'s `segChanged` branch: added the same
`if (extra.takeFade && !extra.isVolume) return false` guard the steady-state branch already had
(WO-528), moved to the top of the block before any computation.

**Deliberately does NOT record `_lastKfSegment`/`_lastKfValues`** on the suppressed call (unlike
the steady-state branch, which DOES record while suppressing — see its own comment on why). Reason
they differ: `takeFade` is only ever passed on the *initial* `play()` apply
(`timeline-playback-runtime.js:82`) — every subsequent tick (`_syncAmcpOnTimelineTick`) calls with
no `takeFade` at all. Leaving `prevSeg` unset means the very next real tick (~40ms later, `force`
irrelevant to this branch) re-evaluates fresh and issues the tween properly — a beat after the
take's own crossfade has started, instead of the alternative (recording state as if handled) which
would mean this tween **never fires at all**, reproducing WO-519's fail-dark class for keyframed
clips specifically. Fail-bright chosen deliberately, matching this codebase's established
philosophy at the sibling guard (WO-528/WO-519's own comment: *"uncertainty resolves toward
visible"*).

Not touched: `collectClipOpacityFadeLayers`'s exclusion logic in `timeline-take.js`. With this fix,
its assumption ("the clip's own fade owns MIXER OPACITY there") becomes true again — just delayed
by one tick instead of running at `play()`-time — so the exclusion is now correct rather than
requiring a companion change.

## 3. What was NOT done

Owner QA on real PGM — this was found and fixed from a live bug report but verified by direct unit
test against the real `_applyKeyedMixerProp`, not by re-taking a look with a keyframed timeline
clip on the actual box. The one-tick-later timing (clip's own tween starts ~40ms after the take's
crossfade rather than frame-locked with it) is a deliberate, accepted trade-off, not perfected —
worth watching for a sub-frame visual seam on the real output, though at 40ms it should read as
imperceptible.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo544-timeline-clip-keyframe-vs-take-fade.test.js` — 6 tests against the real
  `_applyKeyedMixerProp` (bound to the real `TimelineEngine.prototype._interpProp`/`_lerp` for
  genuine interpolation, not a stub) with a clip carrying real opacity keyframes (0→1 over 0-1000ms):
  the `takeFade` collision is suppressed entirely; the suppressed call records no segment/value
  state and the very next call (no `takeFade`) issues the tween properly; ordinary playback
  (no take involved) is unchanged; the CUT branch (`startSceneTimelineLayer`'s `{ restart: true }`
  call, no `takeFade` key at all) still gets the clip's own write — no WO-139 T139.1 regression;
  the Take-button path (`scheduleLeadTween: true`) is untouched, still its own early-return branch;
  VOLUME keyframes are never suppressed (opacity-only guard, matching WO-528's own scoping).
- Reverted the fix and reran: 2 of the 6 tests fail cleanly, reproducing the exact collision
  (`['OPACITY 1-210 0.3 0', 'OPACITY 1-210 1 25']` sent despite `takeFade: true`) and the
  state-recording check, confirming the smoke catches the regression rather than passing vacuously.
- Full offline suite: 2307/2305 pass, 0 fail, 2 pre-existing skips. Lint: the file's three
  unused-var warnings are pre-existing (confirmed present before this change too, at different line
  numbers). 0 files over the 500-line limit.
