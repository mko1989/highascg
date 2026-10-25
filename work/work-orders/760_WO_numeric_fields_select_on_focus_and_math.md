# WO-760 — Fields select their value on focus; number fields evaluate + - * /

**Status: IN PROGRESS (25.10) — built + headless-verified; owner GUI relaunch + QA pending**

Owner 25.10: "i type in width, then tab to height and the current value should be selected so when i type in something
else it changes. also ... does input boxes with number values support math (+ - * /) ? because they should." Both are
now project rules (`RULES.md`, Input fields 1 and 2).

## Investigation

- No LineEdit or SpinBox set `select_all_on_focus`, so Tab into the height field put the caret at the end: typing
  appended to the old digits.
- Maths: the Devices fields (destination W/H/fps, GPU outputs, mapping, DeckLink) already committed through
  `core/math_input.gd` (`MI.commit`). The roughly 49 SpinBox sites relied on Godot 4.7.2's built-in SpinBox expression,
  which was measured headless to be wrong: `1/3` gives 0 (integer division); `abc`, `7 +` and blank give 0 instead of
  keeping the value; `randi()` is executed; and on Enter SpinBox is handed the original string, so pre-rewriting the
  text does nothing.
- Plain number LineEdits (screen-timer posX/posY, live-input browser W/H/fps and v4l2 fps) used `to_float()`:
  `1920/2` silently became 1920.

## What was done

- `godot/client/core/numeric_field.gd` (new). `install(tree)` covers every existing and future LineEdit and SpinBox via
  `node_added`: one place instead of about 60 per-site edits.
  - All of them get `select_all_on_focus`.
  - SpinBoxes go through `spin()`. Enter becomes sanitise (the `math_input.gd` evaluator: digits, `+ - * / ( ) .`
    only) then `apply()`. Focus-out sanitises ahead of SpinBox's own handler. An invalid expression puts the previous
    value back, then SpinBox clamps and snaps as for a typed number.
  - `math_line()` gives plain number LineEdits the same maths.
- `app/shell.gd`: one `install(get_tree())` call (`main.gd` is at the 500-line limit).
- `features/live/screen_timer_panel.gd` posX/posY and `features/devices/live_input_dialog.gd` numeric fields:
  `math_line`. The live-input result is pushed into the flow state, because `text_changed` doesn't fire for code edits.
- Behaviour change: `spin()` turns off `update_on_text_changed`. Eight previs SpinBoxes had it on (follow_section,
  stage_panel, dmx_monitor_window, zones_section, detect_section, follow_output, tracking_page, ptz_section) and now
  commit on Enter or focus-out. Left on, half-typed `1920/` would apply as 0.
- Left alone: timecode and time fields (SMPTE / m:ss syntax and `++500` nudges) are not number fields for maths. IPs,
  paths and names only get select-on-focus.
- The implementation was done by a subagent, then reviewed and verified here. No site connects its own handler to a
  SpinBox's inner LineEdit (grep `get_line_edit()`: only `has_focus` reads and the e2e typer, which submits with Enter),
  so `spin()` replacing those connections loses nothing.

## What was VERIFIED

- `tests/test_numeric_field.gd`, about 70 assertions:
  - the evaluator: precedence, parentheses, no integer division, and rejection of garbage, `1/0`, `randi()`, `1e3`,
    `0x10`, `2**3`;
  - clamp and round;
  - SpinBox Enter and focus-out paths;
  - suffix handling;
  - `math_line`.
- Godot suite 21744 / 0, `run-client.sh --check` boot OK, `check-max-file-lines` 0 over the limit,
  `smoke-wo601-screen-timer-reassign` 2 / 2.
- Independent headless check (two SpinBoxes in a real SceneTree with `install`):
  - focus selected "1920";
  - `1000*2+48` + Enter gave 2048;
  - `(1000+24)*3` + focus-out gave 3072;
  - the Tab target had "1080" selected;
  - `abc` + focus-out kept 1080.
- Not verified: real Tab and mouse clicks in the owner's GUI (needs a relaunch to load `shell.gd`). Owner QA.
