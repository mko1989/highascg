# WO-384 — Companion: config would not save, preset captions/bus wrong, no timer buttons

**Status: 🟡 Implemented 29.07.26 (module tests 32/32, lint/format clean) — owner: restart Companion against the dev module and check**

Owner, 2026-07-29:
> "i cant save the config of the module, because i have nothing in the backup ip. even though i
> dont have a backup and dont want to use it now."
> "the looks presets use variable for the look, but not for the screen label."
> "the looks presets are set with undefined bus instead of pgm."
> "the timer doesnt have preset buttons"

All four in `~/companion-module-dev/companion-module-highpass-highascg`.

---

## 1. Investigation

### 1a. Config could not be saved

`backup_host` (`src/config-fields.js:118`) carried `regex: Regex.IP` with `default: ""`.
`isVisible: (cfg) => !!cfg.hot_backup_enabled` hides the field when Hot Backup is off — but
**hiding is not exempting**: Companion still validates the value, and `""` fails an IP regex. So the
whole config refused to save for anyone not using hot backup. Failover itself needs both the flag
and a non-empty host (`src/host-target.js:31-32`), so the regex was never the thing making it safe.

### 1b. "undefined bus"

`look_take` has a `target` option ("Bus", default `program`) — but the look presets built their
action with `{ look_id, screen_index, force_cut }` and no `target` (`src/presets.js:132`). A preset
supplies the button's stored options verbatim, so every button dragged out had **no** target value
and its action editor showed an empty/undefined Bus. (`allowCustom: true` on the dropdown kept it
from hard-failing, and the callback treats non-`preview` as program, so it still took PGM — it just
looked broken and could not be trusted.) `look-preview-linked-presets.js:220` already did this
correctly, which is why only the plain look buttons were affected.

### 1c. Screen half of the caption was frozen

WO-381 made the look NAME a variable but left `${scopeTag}` — `mainScopeShortLabel()`'s `Scr 2` —
baked into the text. Same defect as the name had: preset styles are copied onto the button, so a
screen renamed in HighAsCG (`channelMap.screenLabels`, WO-222) never reaches the button.

### 1d. No timer presets

WO-381 added screen-timer actions and variables but no preset buttons. Worth noting for anyone
extending them: a preset **cannot** put `$(conn:var)` into a dropdown option — Companion resolves
variables in button text, not in option values — so "the timer in slot N" had to become a real
option value.

## 2. What was done

- `config-fields.js` — `backup_host` uses an optional-IP regex (empty OR a valid IP). Companion's
  `Regex.*` constants are **strings** in `/…/` form, not RegExp objects; the first cut used
  `Regex.IP.source`, which silently yields `/^$|undefined/` — accepting only empty and rejecting
  every real IP. The test below caught it before it shipped.
- `presets.js` — look presets now pass `target: "program"` explicitly (also the manual
  "Take look" preset), and the caption's screen half reads
  `$(<connection>:highascg_screen_<n>_label)`; looks scoped to every screen keep the literal `All`.
- `look-vars.js` + `bridge/state-sync.js` — new `highascg_screen_<n>_label` variables (custom name,
  else `S<n>`, mirroring the web UI's `screenLabel()`), re-synced whenever the channel map's
  `screenLabels` change.
- `presets/screen-timer-presets.js` (new) — a "HighAsCG · Screen timers" section: per-slot display
  (name + live countdown), start/pause, reset and show/hide (fade 25), plus pick-the-timer buttons
  for start/pause/reset, set time, and ±1 minute. Every caption is a variable.
- `screen-timers.js` — the timer dropdown gained `slot:N` values ("whichever timer is in slot N"),
  resolved by `resolveTimer`. Preset buttons bind to the slot so the caption
  (`highascg_timer_N_*`) and the action always mean the same timer, and both survive a show
  rebuilt with new timer ids. Picking a specific timer by id still works.

## 3. What was VERIFIED

- `npm test` → **32/32** (`test/screen-timers.test.js` 19 + `test/presets-and-config.test.js` 13).
  The new file asserts: empty backup host valid / real IP valid / junk still rejected (and that the
  main host is still NOT optional); every `look_take` preset carries a bus that the action actually
  offers; the screen-scoped caption contains the screen variable and no `Scr 1`; all-scoped stays
  `All`; the timer section exists with its buttons; captions read variables; slot buttons carry
  `slot:1` and never `$(…)` in an option; and — a general guard — **every preset action id resolves
  to a real action**.
- Lint + prettier clean on every touched file.
- **Not verified**: anything inside a running Companion. The module is unpackaged in
  `companion-module-dev`; the owner must restart Companion against the dev module (WO-372 flow) to
  see the config save, the new captions, and the timer section.

## 4. Note

Buttons already placed from the old look presets keep their stored options — they will still show
the empty Bus until they are re-added from the preset (or their Bus is set by hand). The fix is to
the preset, which is what new buttons copy from.
