# WO-548 — Re-taking a look whose timeline was already on air killed its own incoming content

**Status: FIXED in repo (02.09.2026). Found live, minutes after WO-546 deployed, by re-checking the
wire log rather than assuming the fix was complete. 5 smokes (2 verified to fail without the fix),
suite 2322/2320/0/2 → 2328/2326/0/2 (combined with WO-547 in the same verification pass). Owner QA
still owed.**
**Priority:** Critical (same symptom class as WO-546, different trigger)
**Source:** found by the author while re-verifying WO-546's deploy against fresh wire evidence, not
a new owner report — the owner's "still exactly the same issues" after WO-546 was still accurate at
the time, this is why.
**Related:** [WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md) (same function,
different reason for the same fault), [WO-541](./541_WO_TIMELINE_ONLY_LOOK_NEVER_FADES_IN.md)

---

## 1. Investigation

WO-546 fixed one route to `timelineEngine.stop()` being called on a timeline that was actually the
legitimate incoming content of a concurrent take. After deploying it, re-checked the wire log for
fresh evidence rather than assuming the report was resolved (the owner had not replied yet). Found
the operator retaking the identical look twice in a row — `scene=14040240... (Look 5)` at 11:17:00
and again at 11:17:05, no other look involved between them. Between those two operator actions, a
bare `STOP 1-210/1-211/1-212` (the timeline's physical layers) fired at 11:17:01.818 with no PLAY
following — the same fault signature as WO-546, but WO-546's `protectedTimelineId` could not have
been the cause here: there is no concurrent preview-exchange call disagreeing with anything, and
`protectedTimelineId` is only ever set on that one call site.

Traced `resolveActiveTimelineIdToFadeOut` (the function WO-546 split out) for this specific case:
`diff.exit` is empty (comparing the look to itself removes nothing), but `isPlayingOnThisChannel`
is still `true` — correctly so, the timeline legitimately stayed on air across the retake — and the
function's `exitingTimeline || isPlayingOnThisChannel` OR-condition treats that alone as enough to
mark it exiting. The bug is structural: `isPlayingOnThisChannel` only asks "is the engine's global
air timeline routed to this channel," a pure routing-state question with no awareness of what this
specific call's own incoming scene actually wants. It was never wrong on its own terms — it is
answering a different question than "is this timeline exiting `runSceneTakeLbg` cares about," and
nothing in the function reconciled the two.

## 2. What was done

`scene-take-lbg-timeline-guard.js`: `resolveActiveTimelineIdToFadeOut` gained a new parameter,
`incomingLayers` — the layers of the specific call's own incoming scene. Before consulting
`isPlayingOnThisChannel` or `diffExit` at all, it now checks whether the exact same timeline is
still present in `incomingLayers`; if so, it is continuing, not exiting, full stop. This is a
general property of the decision (unlike `protectedTimelineId`, which requires an outside caller
with knowledge of a sibling concurrent take) — every caller gets it automatically.

`scene-take-lbg.js`: passes `incoming.layers` (already computed earlier in `runSceneTakeLbg`, after
route remapping) into the call.

Both reasons — "still wanted by this call's own incoming scene" (this WO) and "protected by an
explicit caller" (WO-546) — are independent OR-conditions in the same function; neither reintroduces
a gap the other already closed (tested explicitly, see §4).

## 3. What was NOT done

Owner QA on real PGM: retake the same timeline-only look twice in a row and confirm it stays lit
throughout — verified here by direct unit test of the extracted decision function against the exact
inputs measured on the wire, not by reproducing the operator action against the real box.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo548-retake-same-timeline-look.test.js` — 5 tests: the exact real-world
  inputs (empty `diff.exit`, timeline present in `incomingLayers`) resolve to `null`, not exiting; a
  hand-written pre-fix reconstruction of the old OR-condition confirms it WOULD have flagged it
  (pins the actual regression, not just the new API shape); a look bringing in a genuinely
  *different* timeline still correctly exits the old one; an incoming scene with no timeline at all
  still exits the currently-air one normally (the new check doesn't overreach); and WO-546's
  `protectedTimelineId` and this WO's `incomingLayers` check compose independently — either reason
  alone suppresses the fade-out.
- Temporarily removed the `incomingLayers` early-return and reran: the core reproduction test and
  the composition test both fail cleanly, confirming the smoke catches the regression.
- Full offline suite (verified together with WO-547 in the same pass): 2328/2326 pass, 0 fail, 2
  pre-existing skips. Lint clean. 0 files over the 500-line limit.
