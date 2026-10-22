# WO-688 — Godot client on the Mac: the layout overflows the window; "Link a server" dialog draws garbage

**Status: IN PROGRESS — window fit DONE (22.10, Godot tests + a 1440×860 off-box window on the box); dialog garbage OPEN (owner test of the Vulkan driver)**

Owner, 22.10 (release `2026-10-22_214247` client on a Mac, screenshot): *"first it seems the gui not scaling to the
window. second this is the modal for adding a server from devices tab. unless there is another way to connect the
client to the server"*

## Investigation (22.10)

- **Connecting:** "Link a server" (Devices → Servers +, `features/devices/cluster_panel.gd:272`) links *servers* to each
  other (WO-670 cluster). The client's own server is set in the connection menu: right-click the connection eye, top
  right (`app/shell.gd:177` → `app/connection_menu.gd`, A/B hosts), or `-- --server=http://<box>:4200`. On the Mac
  the eye was cut off by the overflow below, so it could not be found.
- **Overflow:** `app/main.gd` `_apply_window_args` → `Placement.ui_scale` (`app/window_placement.gd:43`) sizes the UI
  from the *screen* (1080p baseline) and clamps at `MIN_SCALE` 1.0. The layout needs ≈1920 logical px; a laptop
  window narrower than that (here ≈1630) gets the right edge cut (eye, inspector) and the bottom pushed out.
- **Dialog garbage:** the "Link a server" ConfirmationDialog shows its Godot title bar fine and noise where the content
  should be (text faintly inside). An embedded Window renders to its own viewport texture; the noise looks like an
  uncleared render target. The same dialog draws correctly on the box (Vulkan). macOS defaults to Metal
  (`rendering/rendering_device/driver.macos = metal`, `fallback_to_vulkan = true` in 4.7.2), so suspected a Metal-path
  issue; not reproducible here.

## What was done (22.10)

- `app/window_placement.gd` `fit(w, on_box, override)`: on the box unchanged (`content_scale_factor` from
  `ui_scale`). Off-box: `content_scale_mode = CANVAS_ITEMS`, aspect `EXPAND`, size 1920×1080, factor = the operator's
  UI-scale choice or 1.0. Godot then fits the 1080p layout to any window (shrinks below 1080p, grows on Retina / 4K)
  and follows window resizes. `apply_scale` (Settings → UI scale) goes through `fit` too (stretch mode on = off-box).
- `app/main.gd`: `Placement.fit(w, Platform.is_local_origin(Config.origin), override)`.

## What was VERIFIED (22.10)

- Godot `tests/run_tests.gd` 21062 passed, 0 failed (+7 in `test_off_box_window_fits_the_layout`); `--check` OK.
- Box: a client with `--server=http://192.168.0.23:4200` in a 1440×860 window — the whole layout is inside the window
  (connection eye and inspector edge visible), screenshot checked.
- Not verified: on the Mac itself (needs a new client build), and the dialog.

## Owner test (dialog)

The released build can run on Vulkan (MoltenVK) instead of Metal, and take the server and a smaller UI on the command
line (`--ui-scale` below 1 already works in that build):

    "<where it was unzipped>/HighAsCG Operator.app/Contents/MacOS/HighAsCG Operator" --rendering-driver vulkan -- --server=http://192.168.0.23:4200 --ui-scale=0.85

If the dialog draws correctly on Vulkan, the macOS preset / project gets `driver.macos = vulkan`.
