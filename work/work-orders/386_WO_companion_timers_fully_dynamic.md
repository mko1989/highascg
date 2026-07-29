# WO-386 — Companion timers: no placeholder slots, everything dynamic

**Status: 🟡 Implemented 29.07.26 (module tests 34/34, lint clean on touched files) — owner: restart Companion against the dev module**

Owner, 2026-07-29:
> "also in companion i see there are placeholder 8 timers. come one???!!! no place holders.
> everything should be dynamic."

---

## 1. Investigation

WO-381 published timers as **8 fixed index slots** (`highascg_timer_1_*` … `_8_*`), always declared
whether or not a timer existed, and WO-384 added 4 fixed slot button sets on top. The reasoning was
that Companion variables must exist before a button can reference them — but definitions can be
re-registered at any time (`setVariableDefinitions`), which is exactly what the look-label variables
already do per look. The slots were unnecessary, and they filled the variable picker and the preset
list with rows for timers that do not exist.

## 2. What was done

- `src/screen-timers.js` — `TIMER_VARIABLE_SLOTS` and the `slot:N` option form are gone. Variables
  are keyed by the timer's own id (short form, as the web UI shows it):
  `timerVariableId(timer, field)` → `highascg_timer_5c12cb77_time`. `TIMER_VARIABLE_FIELDS` lists
  the ten fields; `screenTimerVariableDefinitions(timers)` and `screenTimerVariableValues(timers)`
  both take the live list, so declared and published sets are identical and contain nothing else.
  Each definition's NAME carries the timer's human name (`Timer "Timer S2": display time…`) so the
  picker stays readable. The dropdown lists the first-timer default plus the real timers.
- `src/bridge/screen-timer-poller.js` — when the set of timers changes it now re-registers actions,
  **variable definitions and presets**, and forces a value publish for the new ids.
- `src/variables.js` — the timer block is built per instance from `_screenTimers`, not from the
  static list.
- `src/presets/screen-timer-presets.js` — one button set per timer that exists (display,
  start/pause, reset, show/hide, set time), keyed and captioned by that timer. The
  choose-the-timer buttons stay, so the section is never empty and a page can be built before the
  show.

## 3. What was VERIFIED

- `npm test` → **34/34**. New coverage asserts the absence of placeholders as a property, not a
  spot check: definitions for two timers are exactly `1 + 2 × fields` entries, an empty list
  declares only `highascg_timer_count`, every declared variable has a value **and every published
  value has a definition**, ids derive from the timer id (reordering the list leaves the values
  identical), the dropdown offers no slot rows, presets contain no `screen_timer_<digits>_` keys,
  and with no timers only the `screen_timer_pick_*` buttons exist.
- Verified against the live box's model: one timer → one block
  (`highascg_timer_5c12cb77_name` = `Timer S2`, `_time` = `00:10:00`, `_screens` = `2`).
- **Not verified**: anything inside a running Companion — the module is unpackaged in
  `companion-module-dev`.

## 4. Note

Buttons built from the old slot presets referenced `highascg_timer_1_*` and `slot:1`; both are gone,
so those buttons need re-adding from the new presets. Nothing was published to a running Companion,
so this only matters once the dev module is loaded.
