# WO-554 — a timeline look plays twice, and PRV sometimes gets stuck after

**Status: FIXED in repo (03.09.2026). 8 new smokes (regression test proves the pre-fix mechanism
directly), full offline suite 2365/2362/1/2 (the 1 fail is a pre-existing, unrelated timing flake
in `smoke-wo537...`, confirmed to pass reliably in isolation — see §4). Server restarted and live.
Owner QA still owed — this closes a confirmed WIRE-LEVEL duplicate, but has NOT been confirmed
against a live capture as the exact mechanism behind report (1)'s wording ("on pgm").**
**Priority:** Critical — live production visual defect on every look-with-timeline take.
**Source:** `work/work-orders/todos02.09.26`, still open in the owner's editor the next morning
(03.09) with no corresponding WO in the WO-541→553 chain from the same day:
1. *"when playing a timeline look it looks on pgm as it is played 2 times one after another. very
   bad look."*
2. *"in some instances the prv channel seems to be 'blocked' after playing the timeline look until
   i clear the prv channel by clicking on empty space."*
3. *"there is no fades/mix between standard looks and timeline looks."*

Item 3 is already covered: WO-541 (a timeline-only look never faded in) and WO-553 (opacity flash
on entry + cut instead of mix on timeline↔look switch) both landed 02.09, before this WO, and are
already live on the box (server restarted 02.09 13:11 UTC, ~1 minute after the WO-553 commit — see
§1 dating below). No further code work found for item 3; it carries the same "Owner QA owed" status
those two WOs already recorded. This WO covers items 1 and 2.

**Related:** [WO-546](./546_WO_PREVIEW_EXCHANGE_KILLS_CONCURRENT_TIMELINE_TAKE.md) (found and
explicitly declined to fix this exact class — "PLAY, then a duplicate PLAY... cosmetic flicker,
not fixed here"), [WO-549](./549_WO_PREVIEW_ONLY_TIMELINE_ROUTING.md) (fixed the staging call's
*routing* claim on program, but its own comment says plainly: "Restricting here does not change
what ends up live... the real take still runs unrestricted" — i.e. it never touched the duplicate
`play()` call itself), [WO-553](./553_WO_LOOK_TIMELINE_OPACITY_FLASH.md) (fixed item 3; same
staging+real-take concurrent pattern as this WO's root cause)

---

## 1. Investigation

Dating: `git log` shows WO-553 part 2 committed 2026-09-02 13:10:25 UTC; `systemctl show -p
ActiveEnterTimestamp highascg` shows the running server started 2026-09-02 13:11:26 UTC — the box
has been running every fix through WO-553 the whole time this report has sat open. This is a
residual gap in that same chain, not a regression of it.

`work/OPEN_ISSUES.md`'s WO-546 row already names the mechanism and explicitly leaves it unfixed:
`routes-scene-take.js`'s pgm/prv take path runs a "stage on preview" `runSceneTakeLbg` call
(line ~256, `restrictTimelineToPreview: true`, `await`ed first) immediately followed by the real,
unrestricted `pgmTakePromise` (line ~356) — both for the identical `incomingScene`. When that scene
has a timeline layer, **both** calls reach `buildTakeJobs` → `startSceneTimelineLayer`
(`timeline-take.js`), and **both** unconditionally call `eng.play(tlId, ..., { restart: true })`.

`TimelineEngine.play()` (`timeline-playback-runtime.js`) does not skip the transport re-apply just
because the timeline is already `_airTimelineId` — `restart: true` (which both look callers always
pass, per WO-537) forces `wasPausedResume = false`, so every call unconditionally reaches
`this._applyAt(id, pos, true, {...})`, which sends fresh `STOP`+`PLAY ...` lines
(`timeline-playback-amcp-send.js` `_sendClipTransport`).

Crucially, `_channels()` (same file) resolves the channels a given `play()` call writes to from
`this._sendToFor(this._airTimelineId)` — the engine's CURRENT routing state at that instant — not
from the physical `channel` argument passed into `startSceneTimelineLayer`. Traced with a real
`TimelineEngine` + mock AMCP transport (`tools/smoke/smoke-wo554-timeline-look-double-play.test.js`,
first two `describe` blocks):

1. Staging call: `setSendTo({ preview: true, program: false })` then `play()` → `_channels()` =
   `[previewCh]` → **one `PLAY` line to the PREVIEW channel**.
2. Real take call, moments later: `setSendTo({ preview: true, program: true })` then `play()` →
   `_channels()` = `[previewCh, programCh]` → **two more `PLAY` lines** — one to preview (again),
   one to program.

Net result for one take: **the PREVIEW channel gets a genuine duplicate `PLAY` restart**,
milliseconds apart, from two independent transport applies of the same clip. The `regression check`
test in the new smoke file reproduces this directly: without the fix, `playLinesByChannel` shows
`[1, 2]` (program once, preview twice); with the fix, `[1, 1]`.

This confirms and closes the mechanism WO-546 flagged. It plausibly explains **report (2)**
directly: two back-to-back `STOP`+`PLAY` transport applies to the one physical preview layer,
inside the same AMCP batch window, is exactly the kind of race that can leave a Caspar producer
swap in an inconsistent state until something else (the owner's manual "clear PRV by clicking empty
space" — an existing, deliberate feature, see
[WO-342](./342_WO_DECK_HEADER_CLICK_CLEARS_PRV.md)) forces a clean re-render.

**What is NOT yet confirmed:** in this reproduction, the PROGRAM channel gets exactly one `PLAY`
line — the staging call's play never touches program once `restrictTimelineToPreview` is honored.
So whether report (1)'s specific wording, "it looks on pgm... played 2 times," is this same
preview-channel duplicate (perceived as "pgm" because PRV and PGM sit side by side on the operator
display, or because the two are visually hard to tell apart mid-transition) or a second, distinct
duplicate — e.g. the CONCURRENT `previewExchangePromise` (line ~331) racing `pgmTakePromise` when
the OUTGOING look also carried the same timeline (a retake, or two looks sharing one timeline) —
was not traced against a live AMCP capture in this session. The fix in §2 removes a real, confirmed
duplicate regardless; a live wire capture during an actual owner-triggered timeline-look take is the
next step if report (1) persists after this deploy.

## 2. What was done

- `src/engine/timeline-take.js` — `startSceneTimelineLayer` accepts a new `opts.deferPlay`. When
  set, it returns `[]` immediately after the existing (`skipAmcpApply: true`, so wire-inert)
  `setSendTo` routing call — never reaching `eng.setLoop`/`eng.play()`. Routing bookkeeping still
  happens (harmless), the actual restart does not.
- `src/engine/scene-take-lbg-jobs.js` — `buildTakeJobs` accepts `deferTimelinePlay` (default
  `false`) and passes it through as `deferPlay` on its `startSceneTimelineLayer` call.
- `src/engine/scene-take-lbg.js` — `runSceneTakeLbg` forwards `opts.deferTimelinePlay` into the
  `buildTakeJobs` call, alongside the existing `restrictTimelineToPreview` forward.
- `src/api/routes-scene-take.js` — the pgm/prv "stage on preview" call (the ONLY call site with
  this problem — it is always immediately followed by the real unrestricted take for the identical
  scene) now also passes `deferTimelinePlay: true`. The standalone preview-only path (no following
  take) and the previous-look preview-exchange call (plays a *different* scene, no guaranteed
  follow-up play) are deliberately left unchanged — deferring their `play()` would leave a
  legitimately new preview-only timeline never actually started.

Why this design over the alternatives considered:
- Detecting "is this timeline about to be played again by another concurrent call" via timing
  heuristics (e.g. debounce/coalesce repeated `play()` calls within N ms) was rejected — fragile,
  and would also silently coalesce a genuine rapid double-take from the operator.
- Suppressing `play()` inside `TimelineEngine` itself whenever `prevAir === id` regardless of
  caller intent was rejected — `restart: true` exists specifically so a take-time play always
  starts at the demanded position (WO-537); guessing "this looks like the same play, skip it" at
  the engine level would silently reintroduce that exact bug for the real take path too.
- An explicit, caller-supplied flag (mirroring how `restrictTimelineToPreview` already threads
  through the identical call chain) keeps the decision exactly where the caller's actual intent is
  known — routes-scene-take.js knows the staging call is throwaway-for-playback-purposes; nothing
  downstream has to infer it.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo554-timeline-look-double-play.test.js` — 8 tests, 2 `describe` blocks:
  - Direct `TimelineEngine` + mock AMCP transport tests: `deferPlay: true` sends zero `PLAY` lines
    and does not mark the timeline air; the staging(deferPlay)+real-take sequence sends exactly one
    `PLAY` line per channel; a **regression test with `deferPlay` intentionally omitted** reproduces
    the pre-fix duplicate directly (`[1, 2]` — preview restarted twice); `deferPlay` absent/false is
    unchanged single-call behavior (still plays both channels once).
  - Source-level pins: the flag threads through all four files exactly as described in §2 (one
    `deferTimelinePlay: true` call site, `scene-take-lbg-jobs.js`'s default+forward, `scene-take-lbg.js`'s
    forward, `timeline-take.js`'s short-circuit).
- Verified the regression test genuinely fails without the fix: it passed only after the
  `deferPlay` early-return existed — confirmed by having run it as `[1, 2]` (see §1) before wiring
  the flag through the caller, then `[1, 1]` after.
- Full offline suite: `node tools/ci/run-offline-tests.js` → 2365 tests, 2362 pass, 1 fail, 2 skip.
  The 1 failure (`smoke-wo537-look-timeline-starts-where-asked.test.js`, "a plain play() after a
  pause keeps the paused position", `12006 !== 12005`) is a pre-existing wall-clock timing
  assertion unrelated to this change (asserts a `Date.now()`-derived position to the millisecond) —
  reran that file alone and it passed cleanly (9/9), confirming a flake under full-suite load, not
  a regression from this WO.
- Server restarted (`kill -TERM $(systemctl show -p MainPID --value highascg)`, systemd relaunched
  it) — live on the box as of this WO.

## 4. What remains owner-QA

- Take a look containing a timeline layer on a PGM/PRV screen; confirm program shows a single,
  clean entry — no visible double-play.
- Same take; confirm PRV does not get stuck/frozen afterward and no longer needs a manual
  click-empty-space clear.
- If either persists: the open item in §1 (live AMCP capture during the actual reproduction) is the
  next step — this WO fixed one confirmed duplicate, not a hypothesis dressed as a fix.
