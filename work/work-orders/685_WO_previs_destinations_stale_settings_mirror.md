# WO-685 — Previs "No screen destination" while one exists: the Godot Settings mirror went stale

**Status: DONE (22.10, Godot `--test` 21044/0 + boot check; GUI relaunched on the box). Owner QA: add a destination, map a wall without restarting the GUI.**

Owner, 22.10: *"I tried mapping a led wall in previs to a screen destination that has no consumers, but initializes
and is visible in the Godot preview and it says in the drop down that there are no screen destinations."*

## Investigation (22.10)

- The live config had the destination: `config/screen_destinations.json` (written 20:12) holds `dst_operator_gui`
  (`operator_gui`, filtered out on purpose) and `dst_mvjz5wlw_1` "PGM/PRV 1", `pgm_prv`, 3072×1024. `GET /api/settings`
  returned both. So "no consumers" was not the cause; the list the dropdown read was.
- `godot/client/features/previs/mvr_screens.gd` `_fill_dests` (and `stage_panel.gd` `_load_dests`, Stage → Add ▾ →
  "Sized from a screen destination") read `Settings.get_setting("screenDestinations")`, the client's in-memory copy
  of `/api/settings` (`core/settings_state.gd`).
- That copy reloads only at startup, after a Settings save, and from a few Devices paths. Destinations are added,
  changed and removed through `POST /api/device-view` (`destinations_panel.gd` `add` / `_patch` / `_remove`). Of
  those, only `add` reloads Settings, and only when a fresh screen needs consumer seeding. The Devices tab itself
  re-reads `/api/device-view`, so the new card showed there (and its channel in the preview) while Settings still
  had the old list.
- On the box: the Godot client had been running since 17:41 (pid 227694). The ISO builds reset `config/` to the
  factory set (only the operator GUI destination) at ~19:20; the owner added PGM/PRV 1 at 20:12. The mirror never
  saw it, so the filter left an empty list.

## What was done (22.10)

- `features/devices/devices_tab.gd`: after any destination change (`_dests.changed`: add, update, remove, Matrix
  "+ Destination"), `Settings.load_from_server()` runs before the device-view refresh. This also keeps the other
  Settings readers of `screenDestinations` (`cable_gesture.gd`, `audio_rows.gd`) current.
- `features/previs/mvr_screens.gd`: the first wall clicked (selection was empty) reloads Settings; the dropdown
  refills on `Settings.changed` while its row is shown. This covers destinations added from the web UI too.
- `features/previs/stage_panel.gd`: Settings reload when the panel becomes visible, so the Add menu's
  "Sized from a screen destination" list is fresh.
- Why reload rather than reading `/api/device-view` in previs: the Settings mirror is what every other Godot reader
  of destinations uses; one source, refreshed at the points where it can change.

## What was VERIFIED (22.10)

- Godot `tests/run_tests.gd`: 21044 passed, 0 failed. `--check` boot: settings / state / project ok, no script
  errors in the edited files.
- Box: the stale client (pid 227694) stopped, GUI relaunched (pid 688983, `settings ok`). The relaunch alone loads
  the 20:12 destination, so the owner's case works now.
- Not probed live: the reload paths themselves (they need clicks in the GUI). Owner QA: Devices → add a destination →
  Previs → click a wall → the new destination is in the dropdown without restarting the GUI.
