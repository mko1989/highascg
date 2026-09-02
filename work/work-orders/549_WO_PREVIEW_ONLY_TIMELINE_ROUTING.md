# WO-549 — Putting the previous look on preview silently re-took its timeline onto program

**Status: FIXED in repo (02.09.2026). 9 smokes (7 verified to fail without the fix), suite
2328/2326/0/2 → 2337/2335/0/2. Owner QA still owed.**
**Priority:** Critical (same session, third distinct root cause for the timeline/look symptom
class — this is the one blocking "going back to another look" specifically)
**Source:** owner 02.09, after WO-546/548 fixed the timeline going dark: *"playing the timeline
from inside a look works correctly. but going back to another look results in retaking the
timeline look instead of playing the new look."*
**Related:** [WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md) (flagged this
exact mechanism as "duplicate PLAY... cosmetic flicker, not fixed here" — it wasn't cosmetic in
this direction), [WO-548](./548_WO_RETAKE_SAME_TIMELINE_LOOK_KILLED_ITSELF.md)

---

## 1. Investigation

WO-546 documented, but deliberately did not fix, a side effect of `startSceneTimelineLayer`
(`timeline-take.js`) always calling `eng.setSendTo({ preview: true, program: true, screenIdx })` —
every call claims BOTH the program and preview channel of its screen, regardless of which single
channel the calling context actually intends to affect. WO-546 called the resulting redundant
restart "cosmetic" because, in the case it was fixing, both concurrent callers wanted the exact
same content on program — the duplicate claim was wasteful but not wrong.

This report is the case where that assumption breaks: `routes-scene-take.js`'s pgm/prv
preview-exchange call puts `previousPgmScene` — the look that was JUST replaced — onto the preview
bus, for operator reference. If `previousPgmScene` itself contained a timeline (exactly the
scenario the owner had just gotten working: taking a timeline-only look, then taking a *different*
look afterward), `startSceneTimelineLayer`'s unconditional both-channels claim routed that OLD
timeline back onto **program** — silently overriding whatever the real, concurrent PGM take
(`pgmTakePromise`, bringing up the genuinely new look) was putting there. Since the preview-exchange
call runs after/alongside the PGM take (WO-546: deliberately concurrent), depending on ordering the
old timeline's routing could win, and the operator sees the timeline again instead of the new look.

The staging call (`stageOnPreview`) and the standalone preview-only take path
(`previewOnly && bus1 != null`) have the identical structural problem for the same reason — both
exist solely to affect the preview bus.

## 2. What was done

`timeline-take.js`'s `startSceneTimelineLayer`: new `opts.restrictToPreview`. When set,
`eng.setSendTo(...)` is called with `program: false` instead of the unconditional `true` — applies
on both the CUT and MIX branch (the `setSendTo` call sits above the branch split).

Threaded through as `restrictTimelineToPreview`: `scene-take-lbg-jobs.js`'s `buildTakeJobs`
destructures it (default `false`) and passes it as `startSceneTimelineLayer`'s `restrictToPreview`;
`scene-take-lbg.js`'s `runSceneTakeLbg` forwards `opts.restrictTimelineToPreview` into
`buildTakeJobs`.

`routes-scene-take.js` sets `restrictTimelineToPreview: true` on all three call sites whose whole
job is the preview bus: the staging call, the preview-exchange call, and the standalone
preview-only take path. The real PGM take (`pgmTakePromise`) is deliberately left unset — it still
needs, and still gets, the normal both-channel routing every other timeline-in-a-look caller
relies on (an operator watching preview should see what's about to go/just went to program).

Applying this to the staging call too (not strictly required to fix the reported bug, but the same
reasoning applies) has a secondary benefit: it removes one of the two redundant PLAY/STOP cycles
WO-546 measured on the wire as "duplicate PLAY" — the staging call no longer claims program early,
so only the real PGM take's own claim remains.

## 3. What was NOT done

Owner QA on real PGM: take a timeline-only look, then take a different look, and confirm the new
look's content is what's actually live (not the timeline again) — verified here by direct unit test
of `startSceneTimelineLayer`'s routing decision and source-level wiring assertions, not by
reproducing the operator action against the real box.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo549-preview-only-timeline-routing.test.js` — 9 tests: `restrictToPreview:
  true` routes `program: false` (both the CUT and MIX branch, tested separately); its absence
  (undefined, `{}`, or explicit `false`) keeps the normal both-channel routing unchanged; source
  assertions that `buildTakeJobs`/`runSceneTakeLbg` thread the flag through; and source assertions
  that all three PRV-only call sites in `routes-scene-take.js` set it while the real PGM take does
  not.
- **Caught and fixed a test-harness bug during verification**, not a source bug: the initial
  harness never set `self.timelineEngine = eng`, so `startSceneTimelineLayer`'s `const eng =
  self?.timelineEngine` was `undefined` and the function silently no-opped on every call — the
  routing tests were passing vacuously (the untouched engine's own `_sendToFor` fallback happened
  to match what was being asserted). Confirmed with a standalone repro script showing the real,
  correctly-wired call producing the right `{preview, program, screenIdx}` in both cases before
  fixing the test file.
- Reverted the four changed files and reran: 7 of 9 tests fail cleanly, confirming the smoke
  catches the regression once the harness itself was fixed.
- Full offline suite: 2337/2335 pass, 0 fail, 2 pre-existing skips (plus one known pre-existing
  real-clock timing flake in `smoke-wo537-...` unrelated to this change — confirmed via 3
  consecutive clean reruns in isolation). Lint clean. 0 files over the 500-line limit.
