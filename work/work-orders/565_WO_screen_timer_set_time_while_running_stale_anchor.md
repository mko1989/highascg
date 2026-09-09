# WO-565 — Screen timer "Set time" has no effect while running (stale start anchor)

**Status: DONE (2026-09-09, verified via isolated repro + offline smoke suite — service restart / kiosk reload NOT yet applied, owner to schedule)**

**Source:** owner, 2026-09-09, via Companion module session: "focus on timers that are available
on screens in highascg and their corresponding actions in companion. right now i cant change the
countdown time to anything other than 5 minutes. in companion the preset button that is made for
displaying the countdowns time and starting/pausing the countdown has a weird display when
running, like 02:05:03 even though its set to only 5mins."

---

## 1. Investigation

Scope: the WO-210 "screen timers" panel-owned registry (`/api/timers/*`), which is what the
Companion module's `screen_timer_*` actions/presets talk to — NOT the older per-layer
`/api/countdown/*` surface (`countdown_*` actions in the module), which is unrelated to "timers on
screens" and untouched by this WO.

**Root cause, in `src/engine/screen-timers.js`'s `assignTimerToScreen()` (the function behind
`POST /api/timers/assign`, i.e. the module's `screen_timer_set_time` action):** the "re-assign to
same screen" branch (used for every Set Time / adjust call once a timer already has a slot) only
ever touched `record.name` and `record.config` (lines 121-125, pre-fix):

```js
if (name !== undefined) record.name = name
if (config !== undefined) {
	record.config = { ...record.config, ...config }
}
```

It never touched `record.lastCmd`, `record.cmdAt`, or `record.remainingSec` — the fields that
anchor a *running* countdown. Both the CasparCG template (`template/countdown/countdown-engine.js`)
and the Companion module's mirrored display (`companion-module-highpass-highascg/src/screen-timers.js`
`computeDisplaySeconds`) compute the live remaining time the same way while `lastCmd === 'start'`:

```
remaining = basis − (now − cmdAt) / 1000        // basis = remainingSec ?? durationSec
```

Changing `config.durationSec` via Set Time updates `basis` for the *next* Start, but if the timer
is currently running (or already ran past zero, unnoticed), `cmdAt` still points at the *old*
Start press. The new short `durationSec` minus a large stale elapsed time goes deeply negative,
which is exactly the garbage the owner saw mirrored in Companion (`02:05:03` — i.e. `-02:05:03`,
matching the sign-swallowed magnitude of `newDuration − staleElapsed`). And because nothing about
the running anchor changed, the actual on-air overlay (the template) doesn't visibly react to Set
Time either — hence "can't change the countdown time to anything other than 5 minutes" whenever
the timer had already been started once and never explicitly Reset.

Reproduced in isolation (scratch `HIGHASCG_STATE_FILE`, not the live registry — see §3): assign a
duration timer at 300s, start it, let 7503s of (simulated) elapsed time pass, then call
`assignTimerToScreen` again with `durationSec: 300` (a Set Time to the same "5:00"). Pre-fix, the
mirrored formula returns `300 − 7503 = −7203` → `-02:00:03`-shaped garbage. Post-fix it returns
`~300` immediately.

A parallel bug exists in the template itself, independent of the registry: `applyConfig()` in
`countdown-engine.js` only refreshes `remainingSec`/`endEpochMs` on an explicit `cmd`
(`start`/`pause`/`reset`); a bare config merge (what Set Time sends — no `cmd`) fell through to
`render()`, which for a running timer recomputes from the *existing* `endEpochMs` — i.e. the new
`durationSec` never reaches the on-air overlay's live anchor either, only a future fresh Start.
(`doStart()` can't be reused to fix this in place — it no-ops when `state === 'running'`, by
design, to avoid double-starting on a duplicate `cmd: 'start'`.)

## 2. What was done

- **`src/engine/screen-timers.js`** (`assignTimerToScreen`, re-assign branch): when the incoming
  `config` patch includes `durationSec` and the timer is in `duration` mode, refresh the running
  anchor so the new value takes effect now instead of only seeding the next Start:
  - `lastCmd === 'start'` → `cmdAt = Date.now()`, `remainingSec = null` (countdown restarts at the
    new duration from now).
  - `lastCmd === 'pause'` → `remainingSec = <new durationSec>` (a later Resume uses the new value
    instead of the frozen old one).
  - Any other state (never started / just reset) — untouched; the template already reads
    `config.durationSec` fresh on the next Start.
- **`template/countdown/countdown-engine.js`** (`applyConfig`): a config merge with no `cmd` that
  changes `durationSec` in `duration` mode now refreshes `remainingSec` immediately, and — if the
  timer is currently running — recomputes `endEpochMs` from `Date.now()` too, so the on-air overlay
  snaps to the new duration instantly instead of only on the next Reset/Start.
- Trimmed the added registry comment to keep `screen-timers.js` at 499 lines (was 489; the CI
  500-line cap would otherwise have tripped — `tools/ci/check-max-file-lines.js`).

Not changed: the Companion module (`companion-module-highpass-highascg`) — its
`computeDisplaySeconds` already faithfully mirrors the server's `{lastCmd, cmdAt, remainingSec}`
fields; once those fields stop going stale, its display is correct with no module-side change.

## 3. What was VERIFIED

- `node --check` on both edited files: clean.
- `npx eslint` on both: no new errors (one pre-existing unrelated warning on each file: unused
  `isNewRecord` in `screen-timers.js`, and `countdown-engine.js` is eslint-ignored entirely —
  browser template, checked via `node --check` instead).
- `tools/ci/check-max-file-lines.js`: `screen-timers.js` back under the 500-line cap (499); the
  one file still over (`scene-take-lbg.js`, 522) is pre-existing and untouched by this WO.
- `node --test` on the full screen-timer/countdown smoke set — **58/58 pass**, no regressions:
  `smoke-wo210-screen-timers`, `smoke-wo210-screen-timers-persistence-and-guards`,
  `smoke-wo226-timer-overlay`, `smoke-timer-clock-jitter`, `smoke-wo196-countdown-lifecycle`,
  `smoke-countdown-routes`.
- **Isolated reproduction of the fix**, run with `HIGHASCG_STATE_FILE` pointed at a scratch path
  (never the live `.highascg-state.json`): assign timer1 at 300s duration → start it → simulate
  7503s elapsed → call `assignTimerToScreen` again with `durationSec: 300` (the fixed code path) →
  registry now shows `cmdAt` refreshed to "now" and `remainingSec: null` → the mirrored-display
  formula (same one Companion uses) returns `~300s`, not `-7203s`. Confirms both the registry fix
  and that Companion's display self-corrects with no module change once the registry is correct.

**Not verified — needs the owner:**
- The template fix (`countdown-engine.js`) runs inside a live CasparCG HTML producer; its pure
  time-math is exported for Node smokes but `applyConfig`'s DOM-adjacent path isn't exercised by
  the existing smoke suite. No new smoke was added for it in this pass (scope: fix the reported
  behavior, verified by direct reading + the registry-side repro, which shares the identical
  before/after math).
- **The server process needs restarting** (`kill -TERM $(systemctl show -p MainPID --value
  highascg)`) for `screen-timers.js` to take effect, and the running countdown template instances
  need a fresh `CG ADD` (re-assign, or a look/scene change that recreates the layer) to pick up
  the new `countdown-engine.js` — a currently-running producer already has the old JS loaded.
  Neither was done in this pass: this is a live on-air box and a restart/reload was not requested
  or confirmed by the owner mid-session. On-air acceptance: set a duration timer running, Set Time
  to a different value while it's still counting, confirm both the on-air overlay and the
  Companion `time_short` variable jump to the new value immediately instead of continuing the old
  countdown (or showing overflow garbage once it's run past zero).

## 4. Notable but out of scope

- `companion-module-highpass-highascg`'s `screen_timer_pick_*`/`_set_time` preset button hard-codes
  its Set Time action option to `"05:00"` (the default text shown when the preset is dragged onto
  a button) — editable per-button afterward in Companion, so not itself a bug, but worth the owner
  knowing: a freshly-dragged "set time" button will always fire literally 5:00 until its own
  action option is edited. Not changed here since it doesn't affect the underlying defect.
