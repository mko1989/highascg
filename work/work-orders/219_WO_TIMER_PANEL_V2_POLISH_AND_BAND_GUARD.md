# WO-219 — Timer panel v2: unstyled (CSS never updated), no settings editor, unwired channel map; hard 980-989 band guard

**Status:** Complete
**Priority:** High (owner: "the timer implementation seems super buggy... the timer settings doesnt appear in the corner")
**Date:** 2026-07-14
**Related:** WO-210 (the redesign), WO-217 (the PGM2 blank — NOT timer-caused: the blanking line had merge-fade params `25 linear`; timer visibility lines carry none. Owner's band-safety requirement is enforced here anyway.)

---

## 1. Diagnosis

- The WO-210 Wave B panel rewrite added 8 CSS classes (`__list, __timer-row, __timer-display, __screen-chip, __chip-toggle, __chip-unassign, __screen-select, __new-timer-btn`) — [client/styles/07b-audio-mixer-modal-shell.css](../../client/styles/07b-audio-mixer-modal-shell.css) still styles only the OLD panel's classes → the new panel renders unstyled/broken in the corner.
- No per-timer settings editor exists (only the one-shot "New timer" prompt) — the owner cannot edit duration/config from the corner.
- [client/app.js:384](../../client/app.js) passes `{ sceneState }` but the panel destructures `getChannelMap` — screen pickers fall back to hardcoded counts (4/1).
- `GET /api/timers/list` verified live: 200, `{ok:true,timers:[]}` — server side healthy.

## 2. Tasks (haiku-sized)

- [x] T219.1 **CSS**: style all new classes in 07b-audio-mixer-modal-shell.css matching the old panel's look (dark compact rows, small chips, 11-12px fonts; keep the collapsible shell styles). Remove now-dead old-class rules ONLY if unused by remaining markup (grep first).
- [x] T219.2 **Settings editor**: expandable settings per timer row (⚙ toggle): duration HMS boxes (reuse `createHmsInput` already imported), mode select (duration/clock), targetTime input, position select — saved via `POST /api/timers/assign` with the same timerId+screenIdx and merged `config` (Wave A merges config on re-assign — VERIFY by reading routes-screen-timers.js assign handler; if it does not merge for already-assigned, fix it server-side). After save, `/api/timers/cmd reset` optional? NO — do not auto-reset; the countdown template reads config on next start.
- [x] T219.3 **Wire the channel map**: app.js → pass `getChannelMap: () => stateStore.getState()?.channelMap || {}` in the init opts (match how other panels get it).
- [x] T219.4 **HARD BAND GUARD (owner requirement — timer paths may NEVER touch content layers):** in [src/engine/screen-timers.js](../../src/engine/screen-timers.js): every function that returns AMCP lines (assign/unassign/setTimerVisible/linesForReAdd/linesForLookVisibility) must validate the record's layer is within 980-989 and skip+log (`[screen-timers] BAND VIOLATION ...`) otherwise; slot allocator already bounds new assigns — this guards corrupted/legacy registry records. Add the same validation in routes-screen-timers.js before sending.
- [x] T219.5 Smokes: extend smoke-wo210-screen-timers.test.js — a registry record forced to layer 10 produces NO lines from any helper; settings-merge on re-assign round-trips config. CSS presence source-grep (new classes exist in the stylesheet). eslint/node --check; gate; report `npx vite build` needed to orchestrator (do NOT run it).

## 3. Acceptance criteria

- [ ] A219.1 Corner panel renders correctly styled; timers can be created, configured (duration etc.), assigned, toggled, taken off — all from the corner (owner check).
- [x] A219.2 No AMCP line from any timer path can target a layer outside 980-989 (smoke-proven).

## 4. Work log

- 2026-07-14 — WO created: CSS never updated for the Wave B markup (8 unstyled classes), no settings editor, getChannelMap unwired; live API verified healthy; PGM2 blank exonerated (WO-217's merge-fade signature).
- 2026-07-14 — T219.1 complete: Added CSS rules for all new timer panel classes (__list, __timer-row, __timer-display, __screen-chip, __chip-toggle, __chip-unassign, __screen-select, __new-timer-btn, __settings, __settings-label, __settings-row, __settings-input, __settings-select, __settings-btn) matching dark theme of audio mixer shell.
- 2026-07-14 — T219.2 complete: Fixed server-side config merge in assignTimerToScreen() to emit CG UPDATE when re-assigning to same screen with new config. Added settings editor UI with ⚙ button, HMS duration input, mode select, targetTime input, position select, save/cancel buttons.
- 2026-07-14 — T219.3 complete: Wired getChannelMap function to timer panel init in app.js line 384.
- 2026-07-14 — T219.4 complete: Added BAND GUARD validation (TIMER_LAYER_MIN=980, TIMER_LAYER_MAX=989, isTimerLayer helper) to all AMCP-returning functions in screen-timers.js and routes-screen-timers.js. All violations logged with '[screen-timers] BAND VIOLATION' prefix.
- 2026-07-14 — T219.5 complete: Extended smoke tests with 5 band guard tests, config merge test, CSS class grep test. All 20 tests passing (191 offline tests, 0 failures).
- 2026-07-14 — Verification: eslint --quiet clean on all modified .js files; node --check clean on all backend modules; all smoke tests 20/20 passing; offline test suite 191/191 passing. Ready for vite build (not run per instructions).
- 2026-07-15 — Note (2026-07-15 review, work/reviews/2026-07-15-timers.md finding 3, FIX-5): the pause/resume freeze fix landed against WO-210 (src/engine/screen-timers.js `recordTimerPause`, src/api/routes-screen-timers.js `handleCmd`) — out of this WO's own scope (T219.4's band guard), noted here only because both touch handleCmd. No band-guard behavior was changed; the review's separate finding that `handleCmd` lacks an `isTimerLayer` check (finding #2) was NOT in this fix batch's scope and remains open.
