# WO-794 — Global border inspector: layout that holds at the Inspector column's width

**Area:** godot-client
**Status: DONE (27.10, Xvfb render of the real client at 1920×1080 + Godot suite 21901 / 0 fail); owner QA on the
operator screen**

Owner, 27.10:
> the inspector of global border is very poorly done in case of scaling.

Parents: [WO-601](./601_WO_godot_port_inspector.md) (the Godot global-border inspector),
[WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md) (one Inspector column on the right).

## Investigation

- Rendered the real client headless (`xvfb-run … godot --rendering-driver opengl3 --resolution 1920x1080 --
  --tab=0 --probe-shot=<png> --border-screen=0`). The Inspector column was about 520 px wide.
- **Labels collapsed to one letter per line.** `global_border_panel.gd` builds two-column `GridContainer`s
  (`_grid()`), with `_muted()` labels on the left. `_muted()` turns on autowrap, and an autowrapping label has no
  minimum width. So the grid sized the label column to almost zero and the control column took the rest:
  "Flow (clockwise vs counter-clockwise around PIP)" became a tall stack of single letters. The parameter rows from
  `F.label_for(s)` (`_params`) were hit worst, because their labels are the longest. The same applied in
  `border_artnet_section.gd` (Protocol / Start channel / Universe, plus the patch table headers).
- **Area row overflowed.** `_area()` put a long label ("Area % (X Y W H — slices override)") and four plain
  `SpinBox`es in one `HBoxContainer`. Their minimum widths added up to more than the column, so the row pushed past
  the right edge. The slice rows (4 spins plus ×) had the same problem.
- **Checkboxes and the mirror text.** The "Mirror on PRV" checkbox text ("edit on PRV layer 997 (PGM unchanged until
  off)") set the control column's minimum width. Once the controls were set to expand, each checkbox stretched into a
  full-width bar.
- **Preset names** had a fixed 140 px label, so long names were cut off and short ones wasted space.

## What was done

- `godot/client/features/live/global_border_panel.gd`:
  - **`_pair(grid, text, control)`**:
    - The label gets `LABEL_W` (120 px) and wraps by word inside it.
    - The control expands to fill the rest. Checkboxes stay box-sized (`SHRINK_BEGIN`).
    - Both cells are centred vertically.
  - Used for Enabled / Type / Fade / Mirror and for every parameter row. `_params` keeps the label it returns, for
    `visibleWhen` gating.
  - **Mirror on PRV:** the checkbox text is now "Edit on PRV (layer 997)". The rest of the explanation moved to a
    tooltip.
  - **Area:**
    - The heading is on its own line: "Area (% of the screen; slices override it)".
    - Below it, X / Y / W / H spins (with a `%` suffix) share the row evenly. They come from the new `_spin_row()` and
      `_spin(prefix, max)`, which set a 60 px minimum and expand fill.
  - **Slice rows** use the same `_spin_row` / `_spin`, so 4 spins plus × fit the column.
  - **Preset name labels** fill the width, clip, and show the full name as a tooltip.
- `godot/client/features/live/border_artnet_section.gd`: grid labels use `_cell()`, a muted label with no wrap,
  centred vertically. These labels are short, so they keep their natural width.
- `godot/client/features/live/live_tab.gd`: dev flag `--border-screen=N` opens the global border page for screen N
  4 s after start, once the project has loaded. It is for render probes; the flag does nothing unless it is passed.

Why fixed label widths, not a scale factor: the Inspector column's width is set by the shell (WO-608). The rows have
to reflow inside it, not shrink.

## Verified

- Xvfb render of the real client, cropped to the Inspector column (x 1360–1920):
  - labels sit in one 120 px column and wrap by word ("Flow (clockwise vs / counter-clockwise / around PIP)");
  - the controls line up on the right;
  - Enabled, Glow Trail, Alternate colors and Rounded Tips are plain boxes;
  - the Area X / Y / W / H row and the three slice rows (each 4 spins plus ×) fit the column with no overflow;
  - no script errors in the probe log.
- `godot --headless --path godot/client --script res://tests/run_tests.gd`: **21901 passed, 0 failed**.
- **Owner QA:** the operator GUI was relaunched with the change. Open Live → border on a screen, then resize the
  window or the Inspector column.
