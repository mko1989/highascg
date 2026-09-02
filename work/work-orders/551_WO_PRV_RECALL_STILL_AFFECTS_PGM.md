# WO-551 — Sending a look to PRV still appears to affect PGM despite WO-550 — DEPRECATED

**Status: DEPRECATED — superseded by [WO-552](./552_WO_TIMELINE_STOP_ROUTE_NEVER_AFFECTS_PROGRAM.md).
The stack-trace diagnostic this WO added named the real caller on the very next reproduction: not
the take-orchestration guard this WO (and WO-546/548/549/550) had been chasing at all, but a
client-side `stopActiveTimelineOnServer()` call that runs on every look preview/take by design. Both
diagnostic additions (this WO's) were removed once WO-552's actual fix landed. Kept for the
investigation trail — the "everywhere else was checked and came up empty" reasoning here is what
justified adding the diagnostic that found it.**
**Priority:** Critical (owner: "very very wrong")
**Source:** owner 02.09, after WO-550: *"sending a look to prv when the timeline look is on pgm
results in sending the look to pgm, which is very very wrong. the reltionship between prv pgm and
timeline in looks needs to be fixed and hardend."*
**Related:** [WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md),
[WO-548](./548_WO_RETAKE_SAME_TIMELINE_LOOK_KILLED_ITSELF.md),
[WO-549](./549_WO_PREVIEW_ONLY_TIMELINE_ROUTING.md),
[WO-550](./550_WO_PREVIEW_ONLY_CALL_NEVER_KILLS_PROGRAM.md) (the fix this report says is not enough)

---

## 1. What was found

Read the wire log for the take matching the report — a `[scene-take] preview-only path prv=2`
event (11:53:04) sending a plain, timeline-free look ("Look 4") to the preview bus while a timeline
was live on program (taken at 11:53:00). The AMCP trace:

```
STOP 2-210, STOP 1-210, STOP 2-211, STOP 1-211, STOP 2-212, STOP 1-212     <- BOTH channels' timeline layers stopped
LOADBG 2-10 .../3825579625-PREVIEW ...                                      <- new content correctly loaded to channel 2 only
PLAY 2-10
```

Two things worth separating: the new look's own content DID land on channel 2 (preview) only, not
channel 1 — WO-549's routing fix is holding. But the timeline's PROGRAM layers were still STOPped —
exactly the WO-550 class of fault, on code that should have been protected by WO-550's fix
(deployed and confirmed present in the running process before this reproduction).

**The owner's "results in sending the look to pgm" is very likely their read of the visual effect**
(program goes dark/changes when the timeline's layers are stopped and whatever is now visible is
misattributed to the PRV action) rather than a literal AMCP misroute — the wire log shows the actual
routing was correct. The underlying mechanism (an unwanted `timelineEngine.stop()` reaching
program) is the same class WO-546/548/550 have each fixed one instance of; this is evidence of at
least one more.

## 2. Why this is not fixed yet

Traced every code path that could produce a paired `STOP <ch1>` / `STOP <ch2>` for the timeline
band from this specific call (`previewOnly && bus1 != null`, `routes-scene-take.js`):

- `startSceneTimelineLayer` / `eng.play()` / `eng.seek()` (which each have their own unprotected
  `_stopAll` when switching to a *different* air timeline) require the timeline layer type to
  appear in `incomingSorted` — this call's incoming scene ("Look 4") has no timeline layer, so none
  of these should run.
- `eng.setSendTo()`'s own `routingChanged` STOP logic is only reached from inside
  `startSceneTimelineLayer`, which (per above) shouldn't run either.
- `runSceneTakeLbgTeardown`'s `timelineEngine.stop(activeTimelineIdToFadeOut)` is the one WO-550
  protects — `resolveActiveTimelineIdToFadeOut`'s logic reads correctly for the state as understood
  (`previewOnlyCall: true`, and `pbNow.sendTo.program` should be `true` at this point, since the
  prior real PGM take at 11:53:00 set it and nothing else touched it in between).

Nothing in a static read of the code explains the observed STOP. Rather than guess further, added
temporary diagnostic logging (`scene-take-lbg.js`) that records, every time a call finds a timeline
currently on air: the timeline id, this call's channel, `restrictTimelineToPreview`,
`protectedTimelineId`, the live `sendTo` at decision time, and the final result. This will show
directly whether `activeTimelineIdToFadeOut` is being (incorrectly) set by this exact call, or
whether the STOP is coming from a path not yet identified (a leading theory, unconfirmed: AMCP
commands are serialized through one send queue per channel context — under rapid successive takes,
as the operator was doing while testing, a `stop()` decided by an earlier, correctly-unprotected
take could execute later than expected; the timestamps observed do not obviously support this, but
it has not been ruled out either).

## 3. Next step

**Owner: reproduce once, deliberately** — take the timeline look to program, wait a couple of
seconds for it to settle, then send a different look to preview as a single isolated action (not
rapid successive clicks). Then check `journalctl -u highascg | grep 'tl-fade-out'` for the decision
line logged at that moment. It will show either `result=<timeline-id>` (meaning the guard failed to
suppress it — a real bug in the WO-550 logic, fixable directly) or `result=null` (meaning the
teardown path is not the source at all, and the STOP is coming from somewhere not yet found).

## 4. What was VERIFIED

- Diagnostic logging only — no behavior change. Full offline suite unaffected: 2344/2342 pass, 0
  fail, 2 pre-existing skips. Lint clean, 0 files over the 500-line limit.
- Not verified: the actual fix, because the actual cause is not yet confirmed.
