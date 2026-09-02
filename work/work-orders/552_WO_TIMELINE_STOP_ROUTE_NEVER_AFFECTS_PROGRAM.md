# WO-552 — The generic timeline stop route could take PROGRAM off air as an incidental side effect

**Status: FIXED in repo (02.09.2026). Root cause found via a stack-trace diagnostic (WO-551,
removed once this landed), not by continuing to guess at the server take-orchestration path.
7 smokes (2 verified to fail without the fix), suite 2344/2342/0/2 → 2351/2349/0/2. Owner QA still
owed.**
**Priority:** Critical — owner: *"PRV cant have an effect on pgm!!!!"*
**Source:** owner 02.09, after WO-546/548/549/550 (all real fixes, none of them this): *"same
issue"*, following up on *"sending a look to prv when the timeline look is on pgm results in
sending the look to pgm, which is very very wrong. the reltionship between prv pgm and timeline in
looks needs to be fixed and hardend."*
**Related:** [WO-551](./551_WO_PRV_RECALL_STILL_AFFECTS_PGM.md) (deprecated — the diagnostic step
that found this), WO-546/548/549/550 (the server-side guard this WO's whole investigation had been
aimed at — confirmed innocent throughout)

---

## 1. Investigation — the diagnostic that actually worked

Four work orders (WO-546/548/549/550) had progressively hardened
`resolveActiveTimelineIdToFadeOut`, the decision inside `runSceneTakeLbg`'s teardown that decides
whether an on-air timeline should be faded out. The owner's continued "same issue" reports meant
that guard was STILL not the whole story — but temporary logging of every one of its decisions
(WO-551 §1) showed `result=null` for every single take in the reproduction window: the guard was
correctly never asking the engine to stop the timeline, and yet the timeline still went dark. This
was checked directly against `/api/state` — `timeline.playback: null` minutes after a take had put
it on program — with no corresponding decision logged at all.

So the actual `stop()` call was not coming through the path four work orders had been hardening.
Rather than enumerate the remaining static call sites and guess again, added a stack trace to
`TimelineEngine.stop()` itself (WO-551 §2) and asked for one more reproduction. It named the caller
immediately and unambiguously:

```
at TimelineEngine.stop (timeline-playback-runtime.js:179:18)
at handleTimelineRoutes (routes-timeline.js:102:9)
at Object.handle (routes-timeline.js:141:9)
```

`routes-timeline.js`'s generic `POST /api/timelines/:id/stop` route — nothing to do with
`runSceneTakeLbg`, `scene-take-lbg.js`, or any take-orchestration code at all.

### 1a. The actual client-side cause

`client/components/scenes-editor-preview-actions.js`:

```js
async function stopActiveTimelineOnServer() {
	const tl = timelineState.getActive()
	if (!tl?.id) return
	await api.post(`/api/timelines/${encodeURIComponent(tl.id)}/stop`).catch(() => {})
}

async function sendSceneToPreviewWithTimelineClear(sceneId, opts) {
	await stopActiveTimelineOnServer()
	previewRuntime.sendSceneToPreviewCard(sceneId, opts)
}
```

`timelineState.getActive()` is a purely **client-side, per-operator** notion — whichever timeline
happens to be open in *this* operator's Timeline Editor tab — with no relationship to what the
*server* actually has live on program. `stopActiveTimelineOnServer()` is called unconditionally
from `sendSceneToPreviewWithTimelineClear` (every look preview) **and** from `createTakeSceneToProgram`
in `scenes-editor-support.js` (every look take) — this is fully deliberate, documented behavior, not
an oversight: a comment already in `scenes-editor.js` reads *"Timeline is stopped only when
previewing a look ... or when taking a look to program."* It was designed to clean up a timeline
left open in the editor for scrubbing/testing so it doesn't linger — and never considered the case
where the "active" editor timeline is the exact same one that is, right now, the actual program
output. Taking or previewing *any other* look then stops it as an unintended side effect, killing
live program content over an action that never should have touched it.

## 2. What was done

Hardened at the layer that has the truth — the server, not any individual client call site.
`routes-timeline.js`'s `stop` action now checks the engine's actual current air state
(`eng.getPlayback()` with **no** id, which reflects `_airTimelineId` and its live `sendTo` — not
the specific requested id's own possibly-stale stored `sendTo`, which could still read
`program: true` after a *different* timeline has since taken over air). If the timeline being asked
to stop is the current air timeline **and** is currently routed to program, the request is refused
(`409`, `{ onProgram: true }`) unless the caller passes `force: true`.

Two client call sites, two different answers:
- `timeline-transport.js`'s `doStop()` — the Timeline Editor's own explicit Stop button, a
  deliberate operator action — now passes `{ force: true }`. It should still work even on a
  program-live timeline; that is the operator's call to make, not an incidental side effect to
  block.
- `scenes-editor-preview-actions.js`'s `stopActiveTimelineOnServer()` — deliberately left without
  `force`. The existing `.catch(() => {})` already swallows the resulting `409` exactly like any
  other network failure, so the fix required no client-side error handling changes: an incidental
  cleanup call now silently no-ops precisely when it would have taken PGM off air, and still works
  normally for the common case (an editor-open timeline that genuinely isn't on program).

## 3. What was NOT done

Owner QA on real PGM: send a look to preview while a timeline is live on program, confirm program
is unaffected — verified here by direct unit test of the route handler and source-level assertions
on both client call sites, not by reproducing the operator action against the real box.

Not audited: whether `sendSceneToPreviewWithTimelineClear`'s underlying intent (cleaning up an
editor-left-open timeline) has any other gaps now that its own stop call can be silently refused —
this WO only guarantees program safety, it does not attempt to also guarantee PRV always ends up in
some particular state when the refusal happens.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo552-timeline-stop-never-affects-program.test.js` — 7 tests against the real
  `handleTimelineRoutes`: a program-live timeline is refused without `force` (`409`, `eng.stop`
  never called); the identical request with `force: true` is allowed; a timeline that is not on
  program is stopped normally regardless of `force`; a timeline that is not even the current air
  timeline is stopped normally; and — the subtle case — a timeline whose OWN stored `sendTo` is
  stale (`program: true` left over from when it was previously air, but a *different* timeline is
  air now) is NOT wrongly refused, because the check reads the engine's actual current state, not
  the specific id's own history. Plus source assertions that the Stop button passes `force: true`
  and the incidental cleanup call does not.
- Reverted all three changed files and reran: 2 tests fail cleanly (the core refusal-without-force
  case, and the Stop-button wiring), confirming the smoke catches the regression.
- Full offline suite: 2351/2349 pass, 0 fail, 2 pre-existing skips (one known pre-existing
  real-clock timing flake in `smoke-wo537-...`, confirmed unrelated via rerun — passes cleanly on
  its own). Lint clean (one pre-existing, unrelated warning in `timeline-transport.js`, confirmed
  present before this change too). 0 files over the 500-line limit.
- WO-551's two temporary diagnostics (the per-decision log in `scene-take-lbg.js`, the stack-trace
  log in `timeline-playback-runtime.js`) were removed once this fix was confirmed — they served
  their purpose.
