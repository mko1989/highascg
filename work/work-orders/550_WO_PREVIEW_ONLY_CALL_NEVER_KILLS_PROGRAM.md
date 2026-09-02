# WO-550 — Previewing an unrelated look on PRV could still kill a timeline live on PGM

**Status: FIXED in repo (02.09.2026). 7 smokes (2 verified to fail without the fix), suite
2337/2335/0/2 → 2344/2342/0/2. Owner QA still owed.**
**Priority:** Critical (fourth root cause in this session's timeline/look symptom family)
**Source:** owner 02.09, after WO-549: *"its better but there are still issue coming from
recalling to prv probably."*
**Related:** [WO-549](./549_WO_PREVIEW_ONLY_TIMELINE_ROUTING.md) (added the flag this WO reuses),
[WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md),
[WO-548](./548_WO_RETAKE_SAME_TIMELINE_LOOK_KILLED_ITSELF.md) (same guard function, third
independent reason added to it)

---

## 1. Investigation

Read the wire log for the take immediately after WO-549 deployed rather than wait for further
detail on "recalling to prv" — found a `[scene-take] preview-only path prv=2` event (the standalone
branch in `routes-scene-take.js` used when an operator previews a look on PRV without taking it to
program) that produced, at the AMCP level:

```
STOP 2-210, STOP 1-210, STOP 2-211, STOP 1-211, STOP 2-212, STOP 1-212
```

— both channels, no replay on either. At that moment a timeline (from an earlier take) was live on
**program**. This call's own incoming scene was a different, timeline-free look destined for
**preview only**.

WO-549 added `restrictTimelineToPreview` so a PRV-only call's own incoming timeline, if it has one,
only ever gets *routed* to preview. It did not address a call whose incoming scene has no timeline
at all, encountering an *existing* one already on air: `resolveActiveTimelineIdToFadeOut`'s
`isPlayingOnThisChannel` check only asks "is the current air timeline routed to this channel?" —
true, since an earlier real take had legitimately routed it to both program and preview — and
neither of WO-548's or WO-546's protections apply here (this call's incoming scene doesn't want the
timeline, so WO-548 doesn't fire; there's no concurrent sibling take with a `protectedTimelineId` to
share, so WO-546 doesn't fire either). The call correctly concludes, from its own narrow point of
view, that the timeline isn't part of its content — and calls `timelineEngine.stop()`, which kills a
timeline **everywhere at once**, since the engine has no "remove from preview only" primitive. A
call that only ever meant to affect the preview bus ends up taking program off the air.

## 2. What was done

`scene-take-lbg-timeline-guard.js`: `resolveActiveTimelineIdToFadeOut` gained a third independent
suppression reason, `previewOnlyCall` — if set and the currently-air timeline is *also* currently
routed to program, it is never flagged as exiting, regardless of what `isPlayingOnThisChannel`/
`diffExit` would otherwise conclude. Deliberately narrow: it does NOT protect a timeline that is
only on preview (not program) — replacing preview-only content from a preview-only call is exactly
the correct, harmless case, and stays fixable via the normal path.

`scene-take-lbg.js`: passes `!!opts.restrictTimelineToPreview` as this new argument — the exact same
flag WO-549 already threads to every PRV-only call site, so no new wiring was needed in
`routes-scene-take.js` at all. `protectedTimelineId` (WO-546, deterministic, keyed to a specific
concurrent take's incoming id) and this new check (WO-550, based on live routing state, catches ANY
program-routed timeline regardless of which take put it there) are independent and complementary —
neither can reintroduce the other's gap (tested explicitly).

## 3. What was NOT done

Owner QA on real PGM: preview an unrelated look on PRV while a timeline is live on program, confirm
program stays lit — verified here by direct unit test of the extracted decision function against
the exact scenario measured on the wire, not by reproducing the operator action against the real
box.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo550-preview-only-call-never-kills-program.test.js` — 7 tests: the exact
  measured scenario (timeline on both channels, this call's own channel among them, no protected id,
  `previewOnlyCall: true`) resolves to `null`; the identical inputs with `previewOnlyCall: false`
  still correctly flag it (a real take's teardown logic is untouched); `previewOnlyCall` does NOT
  protect a timeline that's only on preview (the harmless case stays fixable); composes correctly
  with WO-548 (still-wanted wins independently) and WO-546 (`protectedTimelineId` and
  `previewOnlyCall` each suppress alone); a genuinely different, preview-only exiting timeline still
  fades out normally from a preview-only call. Plus a source assertion that `scene-take-lbg.js`
  threads `restrictTimelineToPreview` into the new parameter.
- Reverted `scene-take-lbg-timeline-guard.js` and `scene-take-lbg.js`, reran: 2 tests fail cleanly
  (the real-bug reproduction and the WO-546 composition check), confirming the smoke catches the
  regression.
- Full offline suite: 2344/2342 pass, 0 fail, 2 pre-existing skips. Lint clean. 0 files over the
  500-line limit.
