# WO-1014 — Header "Test card" tick button shows an extra blue border inside the button
**Area:** godot-client
**Status: DONE (09.11, after-screenshot of the relaunched GUI shows one frame)**

Owner, 09.11 (verbatim):
> when working with the test card, there is a weird additional blue border inside the button.

The button is the WO-959 `TickButton` (`godot/client/app/tick_button.gd`), built in `godot/client/app/header_tools.gd:49`
(tick = master switch, label = options). It is the same widget as the Border tick button.

## Investigation

Screenshot of :0 with the owner's GUI as it was (Test card ticked): `/tmp/claude-1000/-home-casparcg/f090f1fe-27a9-499e-9de3-49634b7e60e6/scratchpad/b1014-full.png`,
header crop 6x `.../b1014-before-testcard.png`. It shows the outer accent frame of the panel plus a SECOND rounded accent
frame hugging the tick (CheckBox) inside it.

Cause: `godot/client/app/theme_builder.gd:41-44` sets `normal/hover/pressed/focus` on the theme type `Button` with
1px ACCENT borders (hover, pressed, focus). `CheckBox` and `Button` both inherit those (no `CheckBox` styleboxes in the
theme), so the inner tick (`tick_button.gd:21`, a CheckBox) draws the accent `pressed` box when ticked, and the
`flat` label Button (`tick_button.gd:29`; `flat` only hides `normal`) draws accent `hover`/`pressed` boxes. The outer
PanelContainer frame (`_style`, tick_button.gd) is the intended single one. `focus_mode = FOCUS_NONE` on both, so
the `focus` box never shows and no keyboard focus is lost by the fix. Same widget serves the Border button.

## What was done

- `godot/client/app/tick_button.gd`: new `_no_frame(b)` overrides normal/hover/pressed/hover_pressed/disabled/focus
  with `StyleBoxEmpty` on both inner controls. Hover feedback on the label moved to `font_hover_color` (set in
  `_style`, accent-lightened), so the button still reacts without a second frame.
- `godot/client/tests/test_wo959_tick_screens.gd`: `test_tick_button_has_one_frame` asserts all six states are
  `StyleBoxEmpty` on tick and label and the outer panel stays a `StyleBoxFlat`.

## What was verified

- `GODOT=~/.local/opt/godot/godot ./run-client.sh --test`: 26482 passed, 0 failed. `--check`: boot OK.
- Live (09.11 13:39, GUI relaunched from the live tree, Test card ticked): header crop 6x `/tmp/claude-1000/-home-casparcg/f090f1fe-27a9-499e-9de3-49634b7e60e6/scratchpad/r1-testcard.png` shows only the outer accent frame; the second rounded frame around the tick is gone.
