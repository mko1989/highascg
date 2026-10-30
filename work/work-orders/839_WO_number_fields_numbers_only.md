# WO-839 — Number fields take only numbers: gibberish reverts, never salvaged

**Status: OPEN (30.10)**
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
