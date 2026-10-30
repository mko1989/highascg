# WO-839 — Number fields take only numbers: gibberish reverts, never salvaged

**Status: DONE (30.10) — awaiting coordinator commit + client rebuild**
**Source:** owner 30.10, answering the "100+" question from the 29.10 sweep (REPORT §7c): *"any number input box should
"allow" only numbers. changing to either correct version or back to what it was when giberish is typed."*
RULES.md "Input fields" rule 3.
**Related:** RULES.md rules 1–2, WO-806, the RULES-2 sweep finding (plain LineEdits that miss `math_line()`).

## 1. Investigation (from the sweep)

- Web `client/lib/math-input.js` `parseNumberInput` salvages the leading number: `"100+"`→100, `"1920/"`→1920,
  `"12abc"`→12, `"1920/0"`→1920. `tools/smoke/smoke-math-input.test.js:71` pins `'42px'`→42.
- Godot `NumericField.install()` gives SpinBoxes select-all and maths; plain LineEdits need `math_line()`, and these
  miss it: countdown position px, gpu_output_controls X/Y, host_live_controls:144, stream_record_model:90, decklink
  buffer depth, timeline_math.parse_tc, timeline_flags.parse_hms.

## 2. What was done (30.10)

**Rule:** a commit gives a plain number or a COMPLETE expression (then clamped / rounded, RULES 2) or the previous value.
No prefix salvage, no 0 / min substitute, blank reverts unless the field explicitly means "blank = unset" (then blank
stays blank but gibberish still reverts).

Web
- `client/lib/math-input.js`: `parseNumberInput` is expression-only (the `parseFloat` tail fallback is gone); the
  tokenizer rejects `1.2.3`; `createMathInput` keeps a `lastGood` (gibberish / blank → previous, was min/0) and
  resyncs it on focus; `allowMath:false` uses a strict plain-number parse; `attachMathInput({allowBlank:true})` for
  "blank = preset" fields (blank kept, gibberish over a blank stays blank).
- Callers that turned gibberish into 0/1 now revert: `timeline-transport.js` (take duration), `scenes-shared.js`
  (look transition duration), `inspector-fill-timeline.js` (keyframe rows put the stored value back; the Add-keyframe
  button adds nothing when time / X / Y / value is not a number), `companion-button-picker-modal.js` (page).
- Number fields that parsed `type=number` text with `parseInt` and no math input now use `attachMathInput`:
  `timer-control-panel-settings-form.js` (size, border, posX/posY with `allowBlank`), `inspector-browser-display.js`
  (w/h/fps), `playlist-control-panel.js` (timeless secs).
- `tools/smoke/smoke-math-input.test.js`: `42px` pin repointed (rejected) + a gibberish table; new
  `tools/smoke/smoke-wo839-number-fields-numbers-only.test.js` (parse, commit, `attachMathInput` incl. `allowBlank`,
  against a fake DOM).

Godot
- `core/numeric_field.gd`: `resolve()` now `evaluate()`-only (rejects `1e3`, which web rejects too) and blank reverts
  unless `blank_ok`; `math_line(..., blank_ok)`; `_sanitize` (SpinBox) always goes through `evaluate`. Verified first:
  SpinBox `install()` already reverted `100+`, `abc`, `""`, `12abc`, `42px` (probe), so no SpinBox behaviour change.
- `core/math_input.gd`: `parse()` = `evaluate()` (no prefix salvage), `1.2.3` rejected; golden
  `tests/golden/math_input.json` regenerated from the JS (`parse` / `commit` rows that used to salvage now revert).
- Plain LineEdits: countdown posX/posY (`countdown_section.gd`: commit on Enter/focus-out via `math_line` blank_ok, was
  per-keystroke `to_float`), `screen_timer_settings.gd` (blank_ok), GPU output X/Y (`gpu_output_controls.gd` INPUTS: now
  math commit, decimals 0, no min), host browser w/h/fps (`host_live_controls.gd`, 160–3840 / 120–2160 / 1–60),
  DeckLink buffer depth (`decklink_port_controls.gd`: rewrite first, save the result — the raw text no longer goes out),
  stream SRT latency (`output_port_controls.gd`, 20–8000). `timeline_math.parse_tc`, `timeline_flags.parse_hms`,
  `clip_trim_model.parse_tc`: groups are digits only (`TM.is_digits`; `1:-5`, `+3` no longer parse); callers already
  revert on null / NAN.
- New test `godot/client/tests/test_wo839_number_fields.gd`; `test_numeric_field.gd` updated (blank reverts, gibberish
  table, blank_ok).

## 3. Verified

- `node --test` on all smokes referencing the touched files: 173/173; `node tools/ci/check-max-file-lines.js` clean;
  eslint 0 errors on touched JS.
- Godot: `godot --headless --path godot/client --script res://tests/run_tests.gd` — 0 failed. Touched widget scripts
  load with the real autoloads (probe scene), host browser w/h/fps probed live: `1920/2`→960, `12abc`→960 (reverted),
  `10`→160 (clamped), blank fps→25.
- Not touched (already numbers-only): SpinBoxes, `timers_dock_model.parse_time_text` (strict regex), web `type=number`
  fields that already go through `attachMathInput`/`createMathInput`/`inspector-common`.
- Web client needs `npm run build:client` before the kiosk/web UI shows it.
