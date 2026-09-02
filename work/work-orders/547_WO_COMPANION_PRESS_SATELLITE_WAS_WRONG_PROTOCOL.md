# WO-547 — The playhead's Companion press used a Satellite command that was never real

**Status: FIXED in repo (02.09.2026). 9 + 11 smokes across two files, suite 2322/2320/0/2 →
2328/2326/0/2. Owner QA still owed.**
**Priority:** Critical (on-air trigger feature, reported non-functional across this whole session)
**Source:** owner 02.09: *"the companion button does not get pressed from the timeline playhead
crossing the buttons flag. the test press from the inspector works so the connection is sound."*
That last sentence is what pointed at the actual cause.
**Related:** [WO-535](./535_WO_COMPANION_PLAYHEAD_PRESS_AND_STALE_PREVIEW.md) (introduced the bug
this WO removes, 08-14), [WO-543](./543_WO_COMPANION_PRESS_FLAG_SILENT_HTTP_FAILURE.md) (same
session, hours earlier — its logging is what caught this in `journalctl`), WO-24 (original,
correct design), WO-75 (explicitly considered and rejected Satellite for triggering)

---

## 1. Investigation

WO-543 (earlier the same session) added logging to `_fireCompanionPress` and confirmed via
`journalctl` that the crossing-detection and dispatch mechanism fired correctly: *"playhead crossed
companion_press flag ... sent via Satellite"* — no error, no warning. Yet the owner's re-test still
found nothing pressed, and pointed out the settings-modal "Test press" (pure HTTP) does work,
ruling out network/Companion-side connectivity as the cause.

That combination — dispatch succeeds, delivery method is Satellite, HTTP definitely works — meant
the Satellite *send* itself was the dead end. Checked this project's own architecture reference,
`docs/reference/companion-satellite-api.md`, written well before this session:

> HighAsCG uses Bitfocus Companion's Satellite API for **button preview bitmaps** (WO-75). Timeline
> **press/trigger** stays on the **HTTP Remote Control API** (WO-24).
> ...
> | Fire button from timeline | HTTP `POST /api/location/{page}/{row}/{column}/press` | 8000 |
> | Button preview / page picker | Satellite Button Subscriptions (`ADD-SUB`, `SUB-STATE`,
>   `REMOVE-SUB`) | 16622 |

And WO-75's own text: *"Companion Satellite API is not used for triggering ... Satellite `SUB-PRESS`
exists but adds connection state; HTTP is the established show trigger."* Satellite-based pressing
wasn't merely unbuilt — it was considered and explicitly rejected, years before this session.

WO-24's original, complete implementation (T24.1–T24.5, all done, its own smoke test passing) was a
direct `fetch(POST /api/location/.../press)` — nothing else. **WO-535 (08-14) added a Satellite
attempt in front of it**, sending a `KEY-STATE` line. `KEY-STATE` is not part of Companion's
documented Satellite trigger surface (the real one, `SUB-PRESS`, is the one WO-75 rejected) and
isn't part of this project's own documented Satellite feature set either (`ADD-SUB`/`SUB-STATE`/
`REMOVE-SUB`, preview-only). The TCP write succeeds — Companion doesn't error on an unrecognized
line, it just doesn't act on it — so `pressButton()` legitimately returns `true` (the write went
out), and the HTTP fallback WO-535 built as a safety net never ran, because Satellite is normally
connected (previews use it). WO-535 fixed a real asymmetry (silent failure vs. no fallback) but in
the wrong direction: it should have removed the Satellite attempt, not made it "safer."

## 2. What was done

`timeline-playback.js`'s `_fireCompanionPress`: removed the Satellite attempt entirely. Goes
straight to the HTTP POST, matching WO-24's original design byte-for-byte in intent (URL
construction unchanged — `resolveCompanionConfig` — and WO-543's status-checking/logging kept, since
that part of WO-543 remains correct and valuable regardless of transport).

`pressButton()` itself (`satellite-preview-client.js`) is untouched — nothing about the preview/
subscription path was ever wrong, only this one caller of it.

## 3. What was NOT done

Owner QA against the real Companion instance — verified by removing the Satellite code path and
confirming (by source assertion + the documented architecture) that only HTTP remains, not by
re-crossing a real flag and confirming Companion visibly reacts.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo543-companion-flag-fire-and-log.test.js` — its "WO-547" describe block (4
  tests): calling `_fireCompanionPress` never even loads `satellite-preview-client` into the module
  cache; the HTTP request hits the documented URL/method/headers; a non-ok response still warns
  (the WO-543 gap stays fixed); a network failure still warns.
- `tools/smoke/smoke-wo535-companion-press-and-preview.test.js` — updated: its own assertion that
  `timeline-playback.js` calls `pressButton`/`satelliteOk` (true before this fix) is now the
  opposite assertion (never references `pressButton`/`satelliteOk`/`getSatellitePreviewClient`,
  goes straight to `fetch`) — repointed, not weakened; `pressButton()`'s own unit tests (unrelated
  to this fix) still pass unchanged.
- Reverted `timeline-playback.js` and reran both files: 2 tests in the WO-543 file fail cleanly
  (module-cache check, URL/log-text check) and the updated WO-535 assertions fail against the
  pre-fix source, confirming both catch the regression.
- Full offline suite: 2328/2326 pass, 0 fail, 2 pre-existing skips. Lint: one pre-existing,
  unrelated warning (`setCellPosition` unused, confirmed present before this change too). 0 files
  over the 500-line limit.
