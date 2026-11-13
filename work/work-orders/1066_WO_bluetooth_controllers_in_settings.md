# WO-1066 — Pair Bluetooth game controllers from Settings

**Area:** godot-client, devices-config
**Status: IN PROGRESS (13.11 — a DualShock 4 paired from the pane and plays as js0; the owner's off-brand pad not found yet)**

Owner, 13.11: *"add the pairing to settings in the gui"* (PS4 controllers for the game window, WO-1065; `bluez` was
installed by the owner the same day).

## Investigation

- Box: adapter `hci0` (F0:20:FF:00:2E:5D), `bluetooth.service` active, powered. `bluetoothctl` works from a shell AND
  from the node service (system D-Bus, no user session needed — checked through `GET /api/bluetooth`).
- A scan in the warehouse lists ~10 devices, most without a name (phones / beacons with private addresses), none a
  controller: the pane must not show that list as is.
- BlueZ forgets an unpaired device shortly after discovery stops, so pairing has to happen while a scan runs.
- A DualShock 4 needs no PIN; `trust` is what lets its PS button reconnect it later.

## What was done

- `src/bluetooth/bluetooth-pads.js`: `bluetoothctl` wrapper (execFile, address validated) — status (controllers only:
  BlueZ icon `input-gaming`, a controller-like name, or any paired input device; nameless devices are skipped without
  an `info` call), a timed scan (default 30 s, max 60), `pair` = pair + trust + connect with the failing step named,
  connect / disconnect / forget / power.
- `src/api/routes-bluetooth.js`: `GET /api/bluetooth`, `POST /api/bluetooth/{scan,pair,connect,disconnect,forget,power}`
  (contract docs regenerated).
- Godot `Settings ▸ Controllers` (`controllers_pane.gd`, `controllers_model.gd`): status line, "Scan for controllers",
  one row per controller with its state and Pair / Connect / Disconnect / Forget; polls every 2 s while shown and
  keeps the rows when the list did not change.

## Verified

- `tools/smoke/smoke-wo1066-bluetooth-controllers.test.js` (7, fake bluetoothctl); Godot suite 28394 / 0 with
  `test_controllers_model.gd`; `run-client.sh --check` boot OK.
- Running server: `GET /api/bluetooth` → available, powered, no controllers; `POST …/scan {seconds: 10}` → scanning,
  status shows it; `POST …/pair` for an address not in range → 409 "not in range — put it in pairing mode and scan again".
- NOT verified: pairing a real controller (none in pairing mode), and the pane on the owner's screen (needs a GUI
  restart).

## Round 2 (owner 13.11: an off-brand PS4 controller "isnt recognized in the controller scan")

- By then one controller WAS paired through the pane: `1C:A0:B8:F6:4E:22` "Wireless Controller", class 0x002508, icon
  `input-gaming`, paired / trusted / connected; kernel `playstation … Registered DualShock4 controller`, `/dev/input/js0`.
  So scan → Pair works end to end on a real pad.
- Two further scans (12 s, 25 s) listed no other classic-Bluetooth input device at all (only TVs, a camera, LE
  beacons): the off-brand pad was not advertising — not a filter problem at that moment.
- The list WAS too strict all the same: nameless devices were skipped unasked, and classic Bluetooth reports a new
  device's address + class before its name. Now every device is asked (named first, ≤ 60), a gamepad / joystick
  device class counts whatever the name, and `GET /api/bluetooth?all=1` + the pane's "Show every Bluetooth device"
  list every named or classed device ("Not a known controller" rows can still be paired).
- Smoke now 9 tests; Godot suite 28395 / 0.
- Open: the off-brand pad itself (its pairing combination, or a first connection by USB cable).
