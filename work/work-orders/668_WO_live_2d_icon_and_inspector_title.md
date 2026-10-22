# WO-668 — Live 2D toggle icon reads "2D"; Inspector title white

**Status: DONE (22.10, Godot 20826/0; box screenshot of both)**

Owner, `next.md` 22.10:
- *"the toggle button for 2d/3d in standard live preview looks like a stop when on 2d, make the rectangle bit bigger
  and add 2d in the middle of it."*
- *"the Inspector title is blue indicating that its a link. make it white"*

## Investigation

- **The 2D icon was a plain square.** `assets/ui/icons/cube_face.svg` (WO-659) is one 14×14 square, so it reads as ■ stop.
  `live_tab.gd:225` `set_view` sets it at the default 16 px.
- **Godot's SVG loader (ThorVG) does not draw `<text>`.** So "2D" has to be drawn as strokes.
  - Rasterised with `Image.load_svg_from_buffer`: at 16 px the letters are about 5 px tall and barely legible; at 22 px
    they read clearly.
- **The Inspector title is blue on purpose in the code, not by link styling.** `app/inspector_panel.gd:30` sets
  `font_color` to `ThemeBuilder.ACCENT` (#58a6ff).
- No smoke test or Godot test pins either line.

## What was done

- **`cube_face.svg`:** the box grows to 20×18 (was 14×14), with "2" and "D" drawn as 1.7-wide strokes inside it.
- **`live_tab.gd`:** the 2D/3D toggle uses both icons at 22 px. The 3D cube grows with it so the button keeps its size
  when toggled.
- **`inspector_panel.gd`:** the title uses `ThemeBuilder.TEXT` (#e6edf3), the normal text white.
- **`assets/ui/icons/README.txt`:** describes the new icon.

## What was VERIFIED

- Godot `--test`: 20826 passed, 0 failed.
- On the box, the GUI was relaunched (0 script errors) and a screen grab cropped:
  - the Live toolbar shows a boxed "2D" next to the clock and Auto;
  - the "Inspector" title is white.
- Owner QA: switch to 3D and back; the button should not change size noticeably.
