# WO-543 — A companion_press flag's HTTP fallback could fail silently; the crossing itself was never observable

**Status: PARTIALLY FIXED / INSTRUMENTED (02.09.2026). 9 smokes (3 verified to fail without the
fix), suite 2292/2290/0/2 → 2301/2299/0/2. The crossing-detection + dispatch mechanism was verified
correct in every scenario tested — see §1. Owner QA still needed to confirm this against the real
Companion Satellite/HTTP path; the new logging is there specifically to make that verification
possible from `journalctl` instead of guessing.**
**Priority:** High (reported bug, on-air workflow)
**Source:** owner 02.09, mid-QA of WO-535/536/537/541/542: *"timeline playhead passing thru the
companion button flag does not trigger that companion button press."*
**Related:** [WO-535](./535_WO_COMPANION_PLAYHEAD_PRESS_AND_STALE_PREVIEW.md) (the prior fix to this
exact symptom class — "the test press goes thru but the playhead does not trigger a press")

---

## 1. Investigation

Could not reproduce the failure through code reading or isolated engine testing — every
constructed scenario fired correctly:

- Direct call: `eng._processTimelineFlags(tlId, prevMs, ms)` with a companion_press flag inside
  `(prevMs, ms]` → dispatches to `_fireCompanionPress` via `setImmediate`, confirmed with the real
  `TimelineEngine`.
- The REAL `setInterval` ticker (`TICK_MS = 40`, `timeline-playback-helpers.js`) over real wall-
  clock time: play from 0, flag at 120ms, waited 400ms real time — fired once, correctly.
- Resume from a pause parked before the flag: paused at ~80ms (flag at 250ms), resumed with no
  explicit `fromMs` (the paused-resume shortcut path, `_canResumePlayback`) — still fired once the
  playhead reached the flag.
- A looping timeline (150ms duration, flag at 60ms): fired on multiple loop passes, confirming
  `_lastTickPositionMs` correctly resets on each `this.play(airId, 0)` loop restart (verified
  `_canResumePlayback` returns false here since `cell.playing` is still true at that call site, so
  the loop restart takes the normal reset path, not the resume shortcut).

No test existed for `_processTimelineFlags` anywhere in the suite before this WO — this exact
mechanism (as opposed to `_fireCompanionPress`'s Satellite/HTTP delivery, which WO-535 tested) had
zero coverage. §4 below closes that gap for the scenarios above.

### 1a. Two real gaps found by diffing against the Test-press route

`_fireCompanionPress`'s HTTP fallback and the settings modal's "Test press" route
(`src/api/routes-companion-preview.js:169-198`, confirmed working by the owner) build the
IDENTICAL URL (`http://${host}:${port}/api/location/${page}/${row}/${col}/press`), same method,
same headers, same body — so if Test press really works, the flag's fallback should reach the same
endpoint with the same result, UNLESS one of these:

1. **The response was never checked.** Test-press does `const r = await fetch(url, ...); return {
   ok: r.ok, status: r.status }`. The flag's fallback did only `fetch(url, ...).catch(err => log
   warn)` — `fetch()` does NOT reject on a non-2xx HTTP response, only on network-level failure. A
   real Companion-side error (wrong location, Companion busy, an auth requirement) would land here
   as a completely silent, unlogged "success". Fixed: now awaits the response and warns with the
   status code when `!res.ok`, matching Test-press's own check.

2. **A stale-timeline drop had zero trace.** `_processTimelineFlags` dispatches the fire via
   `setImmediate` and guards it with `this._airTimelineId === capturedId` — because this engine
   only ever has ONE timeline "on air" at a time (`play()` explicitly stops the previous
   timeline's ticker AND its AMCP output the moment a different timeline is played — this is by
   design, not a bug, per the constructor's own comment: *"Timeline id currently driving AMCP +
   ticker (only one on air at a time)"*). If a different timeline took over between the crossing
   being detected and the deferred callback running, the press was dropped with **no log at all**.
   Fixed: now warns naming which timeline took over.

Also added: a debug log at the moment a companion_press crossing is detected (before dispatch), and
at successful delivery via either Satellite or HTTP — previously NOTHING was logged on the success
path, so there was no way to distinguish "never crossed" from "crossed, dispatch guard dropped it"
from "crossed, dispatched, Satellite/HTTP actually failed" purely from the log.

## 2. What was done

`src/engine/timeline-playback.js`:
- `_processTimelineFlags`: logs the crossing at debug before scheduling the `setImmediate`; the
  staleness-guard's else-branch now warns instead of doing nothing.
- `_fireCompanionPress`: restructured with an early return on satellite success (was implicit via
  `if (!satelliteOk)`, now explicit and logged). The HTTP fallback now `await`s the response,
  distinguishes `res.ok` (debug log with status) from a non-ok status (warn log with status —
  **the actual fixed gap**) from a network-level throw (warn log, unchanged from before).

## 3. What was NOT done

The underlying "does it actually work end-to-end against the real Companion instance" question is
unresolved — this WO instruments the path so the next real attempt is diagnosable, it does not
itself prove the on-air behavior is fixed (no code defect was confirmed as *the* cause; the
response-status gap is real and worth fixing regardless, but may or may not be what the owner hit).
No `journalctl` evidence of a companion_press flag firing was found for today's session (checked
`journalctl -u highascg --since today | grep -i companion` — only the `companion.hello` WS
handshake lines from the 09:45 restart, no press attempts), so this specific report was not caught
live; it's a recollection from prior use, not something reproduced fresh this session.

**Owner: next time you test this, `journalctl -u highascg -f | grep -i "Timeline\] Companion\|Timeline\] playhead"`
while the playhead crosses the flag.** One of these should appear:
- Nothing at all → the crossing genuinely isn't being detected (contradicts every test in §1 —
  worth telling me the exact setup: is the timeline playing inside a look, or from its own editor?
  Is it looping? Was it paused/resumed first?).
- `playhead crossed companion_press flag` but nothing after it → the staleness guard dropped it
  (another timeline took over) — the warn line will name which one.
- `sent via Satellite` or `HTTP fallback (status 200)` but Companion still didn't act → the press
  genuinely reached Companion (or Satellite claimed it did) and the fault is on the Companion side
  or in the stored page/row/column not matching the intended button.
- `HTTP fallback got status <code>` → the confirmed-fixed gap; the code is now visible.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo543-companion-flag-fire-and-log.test.js` — 9 tests: the 4 crossing scenarios
  from §1 (direct window, real ticker, resume-then-cross, loop re-arm) plus the stale-timeline-drop
  warning, all against the real `TimelineEngine`; and 4 tests on `_fireCompanionPress` (satellite
  success skips HTTP entirely, HTTP success logs the status, **HTTP non-ok status now warns instead
  of silently succeeding**, HTTP network failure still warns) using a mocked `require.cache` entry
  for `satellite-preview-client` and a stubbed `global.fetch` (restored via `after()`).
- Reverted the `timeline-playback.js` change and reran: 3 of the 9 tests fail cleanly (the crossing
  log assertion, the HTTP-success debug log, and — the one that matters — the non-ok-status warning
  test), confirming the smoke catches the fixed gap rather than passing vacuously.
- Full offline suite: 2301/2299 pass, 0 fail, 2 pre-existing skips. Lint: the file's one warning
  (`setCellPosition` unused) is pre-existing, confirmed unrelated to this change (present before it
  too). 0 files over the 500-line limit.
