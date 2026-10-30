# WO-733 — Live deck: a line between screens; header bunny resampled to its real size

**Area:** godot-client
**Status: DONE (24.10.26) — Godot 21492/0 + `--check`; live on this box's kiosk (screenshots before/after).**

Owner, 24.10: *"there is no visible divider between looks cards of different destinations."* and *"the highascg logo
bunny in top left corner looks like its not scaled properly. anything we can do to make it better"*

## Investigation

- **Divider.** `deck_view.gd rebuild()` puts one column per main screen into an `HBoxContainer` with 12 px separation
  and nothing between them. Each column's cards flow left to right (`HFlowContainer`), so a wide first column runs
  straight into the next screen's cards. Kiosk screenshot: "PGM/PRV 1" and "PGM/PRV 2" read as one deck.
- **Logo.** `shell.gd _build_header`: `assets/ui/logo.png` is 72×96 (README: the web logo scaled to 96 px tall),
  drawn in a 26×32 box with keep-aspect, so ~24×32 at UI scale 1. The texture comes from `ConnectionEye.load_png`
  (`ImageTexture`, no mipmaps), and the canvas filter is plain linear. A 3× shrink through a bilinear sample reads
  only some source pixels, so the bunny's 1–2 px white outline broke into dots. Zoomed kiosk crop: speckled outline.

## What was done

- `godot/client/app/theme_builder.gd`: `vline()`, a 2 px full-height `BORDER` line (ignores the mouse).
- `godot/client/features/live/deck_view.gd`: a `vline()` before every screen column but the first.
- `godot/client/app/shell.gd`: the logo image is resampled once with Lanczos to the exact pixels its box covers,
  times the window's `content_scale_factor` (`sized_logo`). It is redone on the control's `resized` and on the window's
  `size_changed`, because the UI scale is applied after the header is built (`main.gd _apply_window_args`, the
  operator screen picker).
  - Why not mipmaps: trilinear between the 48 and 24 px levels is softer than one Lanczos pass to the real size, and a
    texture made for one scale still needs remaking for another.

## What was VERIFIED

- Godot unit tests 21492 passed, 0 failed; `--check` boot OK (no script errors).
- Live, this box: kiosk client restarted twice (exact PID, relaunched as the openbox menu does).
  - Deck: a line between "PGM/PRV 1" and "PGM/PRV 2".
  - Logo: the zoomed crop shows a continuous white outline (it was dotted before).
- Not checked: a 4K / UI scale 2 screen (the code path is the same, with `k` = 2).
