# WO-1065 — Game window: up to four gamepads as players 1–4

**Area:** godot-client
**Status: IN PROGRESS (13.11 — built; assignment + compile tested headless; no gamepad was connected to the box)**

Owner, 13.11: PS4 controllers for the games input — *"yes, up to 4 players"*.

## Investigation

- `godot/retro/retro_window.gd` `_poll_pad()` read only `Input.get_connected_joypads()[0]` and wrote it to port 0,
  next to the keyboard. A second pad did nothing.
- The host already carries four ports: `RetroHost::set_button(port 0..3, …)`, `buttons_[4]`, `on_input` answers per
  port (`godot/extensions/hshm/src/retro/retro_host.cpp`). No native change needed.
- Box: kernel has `hid-playstation`; the user is in `input`; no `/dev/input/js*` (nothing plugged in); an adapter
  `hci0` exists but `bluez` is not installed (wireless pairing needs `sudo apt install bluez`).

## What was done

- `retro_keys.gd` `assign_ports(slots, connected)`: a pad keeps its port while it stays connected, a new pad takes the
  lowest free port, a fifth waits for one.
- `retro_window.gd`: every port polls its own pad; the keyboard stays player 1 (shared with pad 1); the window's
  status label shows "Gamepads: P1 · P2 · – · –" for 4 s when a pad comes or goes (operator window only, not the ring).

## Verified

- `godot --headless --path godot/retro -s res://tests/test_keys.gd`: 9 cases, 0 failed (incl. the window compiling).
- `tools/smoke/smoke-wo1065-retro-four-gamepads.test.js` (3).
- NOT verified: real controllers (button layout on a DualShock 4, two or more at once), and whether each core takes
  players 3 / 4 without its own multitap option.
