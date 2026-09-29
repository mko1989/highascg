**Status: DONE (2026-09-10, offline suite 2403/0/2, syntax-checked, prettier pre-existing-only)**

**Update 2026-09-10 (same day): border/outline around the timer characters, also added.**
`work/work-orders/todos10.09.26` follow-up: "timer font with border around characters." Same
extended-only gating as font/color. Added `timerBorderWidth` (px, default 0 = off — matches the
pre-existing look exactly) and `timerBorderColor` (default `#000000`) to `DEFAULT_CONFIG` and its
two client-side mirrors, applied in `countdown-engine.js`'s `render()` via
`-webkit-text-stroke: {width}px {color}` on `dom.timer` (CEF/Chromium renders the CasparCG HTML
producer, so the `-webkit-` prefix is safe here — this isn't the Firefox-kiosk operator UI).
Standard stroke-under-fill behavior applies (the fill, `color`/`currentColor`, paints over the
inner half of the stroke), which is the expected "text outline" look. Settings form gained a
`Border (px)` number input (0–20) + a `Border color` picker in the same `deps.extended` block as
the font/color fields added earlier today — while adding this, refactored the inline `colorField`
helper (previously closed over one hardcoded row) to take its target row as a parameter, since the
border color swatch needed to land in its own row next to the width input rather than the
Color/Amber/Red row. Verified: offline suite still 2403/0/2, file syntax-checked, settings form
now 316 lines (well under the 500-line cap).

## Investigation

`work/work-orders/todos10.09.26`: "in the timers settings add font and color settings so the
timer can be customized. only in the 'big' settings, the compact ones should stay as is."

Two UI surfaces share one settings form, `client/components/timer-control-panel-settings-form.js`
→ `buildTimerSettings()`:

- **"Big"** — [inspector-screen-timer.js](../../client/components/inspector-screen-timer.js), the
  full screen-timer Inspector opened via the ⏱ icon in the looks deck. WO-226 calls this "the full
  inspector...with all settings as well as size and position."
- **"Compact"** — [timer-control-panel.js](../../client/components/timer-control-panel.js), the
  docked bottom-right live controller. This is the owner's own term for it, quoted verbatim in that
  file's own header comment from a past session: *"there is remove button in the compact timer, not
  needed"* (WO-381).

The countdown template engine ([countdown-engine.js](../../template/countdown/countdown-engine.js))
already had `timerColor`/`amberColor`/`redColor`/`auxColor` in `DEFAULT_CONFIG` and already applies
them in `render()` (`currentColor()` picks by threshold) — the feature existed end-to-end except the
settings FORM never exposed inputs for them, so they were permanently stuck at their hardcoded
defaults. Font had no equivalent at all — only `timerFontSize` (a size, not a family) existed.

Not touched: `client/components/inspector-countdown.js` / `inspector-countdown-controller.js` — a
separate, older per-layer countdown inspector (pre-WO-226) with its own `DEFAULT_COUNTDOWN_CONFIG`
and its own hand-built form, unrelated to `buildTimerSettings`. The todo's "big"/"compact" wording
only matches the screen-timer overlay system, not this legacy path.

## What was done

Added a `deps.extended` flag to `buildTimerSettings()` — when true, it renders a Font select and
three color pickers (Timer / Amber / Red) after the existing Size field; when false/omitted the
form renders exactly as before. Only the Inspector call site opts in:

- [timer-control-panel-settings-form.js](../../client/components/timer-control-panel-settings-form.js):
  new `Font` `<select>` (curated web-safe stack: Default/Arial/Helvetica Neue/Verdana/Trebuchet
  MS/Georgia/Times New Roman/Courier New/Impact — a broadcast box has no font-installation story,
  so free text was skipped in favor of a safe fixed list) and three `<input type="color">` fields
  (`timerColor`, `amberColor`, `redColor` — the three states the engine already renders), all gated
  behind `if (deps?.extended)`. Wired into the existing Save handler's `newConfig` spread.
- [inspector-screen-timer.js](../../client/components/inspector-screen-timer.js): `buildTimerSettings(settingsEl, timer, { refreshTimerList, extended: true })`.
- `timer-control-panel.js` (the compact dock): **unchanged** — its call site still passes only
  `{ refreshTimerList }`, so it renders none of the new fields, per the owner's instruction.
- New `timerFontFamily` config field (default `''` = template's built-in Arial/Helvetica Neue
  stack, unchanged visual default) added to `countdown-engine.js`'s `render()` (applied to
  `dom.timer.style.fontFamily` only — aux lines are untouched, matching "so the TIMER can be
  customized") and to the two client-side mirrors of `DEFAULT_TIMER_CONFIG`
  ([scene-state-timers.js](../../client/lib/scene-state-timers.js),
  [timer-control-panel-display.js](../../client/components/timer-control-panel-display.js)) so a
  timer created before this change still resolves a sane default.

## What was verified

- `node tools/ci/run-offline-tests.js` — **2403 pass / 0 fail / 2 skip**, unchanged from the
  pre-change baseline; `smoke-wo226-timer-overlay.test.js` (the only smoke touching this form)
  only asserts `buildTimerSettings` is imported (not duplicated) and that `timerFontSize` is
  present — both still true, no assertion pinned the old field count.
- `node --check` on all four touched `.js` files + a `new Function()` parse of the template engine
  — all syntactically valid.
- `check-max-file-lines.js` — the settings form grew to 289 lines, well under the 500 cap; the
  one file over the cap (`scene-take-lbg.js`, 522) is pre-existing and unrelated.
- `prettier --check` warns on `timer-control-panel-settings-form.js` and `countdown-engine.js` —
  confirmed **pre-existing** by stashing this change and re-running (same two files warned before
  it), not introduced here.
- Not yet verified live: no client build / kiosk reload / service restart performed this session.
  Owner should `npm run build:client` + reload, then open a screen timer's Inspector (confirm
  Font/Color show up there and actually change the on-air digits) and the compact dock (confirm it
  still looks exactly as before).
