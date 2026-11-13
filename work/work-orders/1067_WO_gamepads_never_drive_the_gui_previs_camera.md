# WO-1067 — Game controllers moved the GUI focus; they belong to the games and the Previs camera

**Area:** godot-client
**Status: IN PROGRESS (13.11 — built; Godot suite 28418 / 0, compile boot OK; the owner's GUI needs a restart to show it)**

Owner, 13.11: *"somehow the controllers are still 'in' the gui instead of the game window when launched. i can see
focus change on gui elements when moving analog. should be able to be used only in games and previs as camera. not to
control the parameters of the gui..."*

## Investigation

- Godot's built-in `ui_*` actions (focus left / right / up / down, accept, cancel, …) each carry a gamepad binding.
  With a pad connected (first time on this box, WO-1066) the Operator window's focus followed the stick and
  `ui_accept` pressed whatever it stood on. Nothing in the client asks for that.
- Gamepads are not bound to a window: every Godot process reads them, focused or not. So the game window
  (godot/retro) gets the pad whether or not the GUI also reacts — the fix is to make the GUI deaf, not to "route" pads.
- The client's only wanted pad use so far: Previs ▸ Markers mode drives a marker with the stick
  (`tracking/marker_driver.gd`, reads `Input.get_joy_axis` directly — no action involved).
- Box, headless probe: Godot lists `0 PS4 Controller` (Bluetooth, 054C:09CC) and `1 PS4 Controller` (USB, 054C:05C4),
  both with a known layout.

## What was done

- `app/pad_guard.gd` `strip()` — at start-up (`main.gd`) every joypad button / stick event is removed from every
  action. Keyboard bindings stay. Direct reads (game window, marker driver, the camera below) are unaffected.
- `features/previs/pad_camera.gd` + `previs_stage.gd` `_process`: the first pad flies the orbit camera while the 3D
  stage is on screen — left stick move (level with the floor), right stick look, L2 / R2 further / closer, L1 / R1
  down / up; dead zone 0.18, squared response; a moving stick cancels a preset's fly-to.
- `previs_tab.gd`: while Markers mode drives a marker with the pad the camera does not read it (one job per stick).

## Verified

- `tests/test_pad_camera.gd`: no action keeps a gamepad binding after `strip()` (keyboard ones stay); dead zone,
  intent, orbit limits, move speeds. Suite 28418 / 0; `run-client.sh --check` boot OK.
- NOT verified on screen: the focus staying put with a pad in hand, the camera feel (speeds are a first guess), and a
  game played with the pad — all need the owner's GUI restarted and a pad in hand.
