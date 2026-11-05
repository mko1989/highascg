# WO-964 — A header record / stream badge opens its own Inspector page instead of switching to the Devices tab

**Area:** godot-client, video-io
**Status: DONE (05.11.26 — GUI e2e 19 3/3 in the sandbox, screenshot; owner QA)**

Owner 05.11: *"clicking on a record banner (or whatever the round indicator is called in the top bar should bring up
its inspector, not move to devices tab."*

Related: [WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md) (the header's round badges; the one Inspector column),
[WO-605](./605_WO_godot_port_device_view.md) (the Stream / Record output pages), [WO-947](./947_WO_record_stream_output_checks.md).

## 1. Investigation

- The round badges right of FTB come from `app/header_badges.gd`. There is one per enabled stream or record output
  (`S1`, `R1`, …, from `header_badges_model.gd` `stream_badges`), plus the hot-backup letter L / F.
- Every badge emitted `devices_requested`, and `app/shell.gd` answered it with `show_tab(devices)`. So the operator
  left the Live tab and still had to find and click the output on the rear panel.
- The output's page already exists: `features/devices/output_port_controls.gd` (stream_out / record_out / …), opened
  by `devices_tab.gd` `_open_port(id)` into the shared Inspector column (`InspectorPanel.current.present`).
  - That column is shared by every tab, so the page can show while Live stays on screen.
- The badge id is the settings row id (`recordOutputs[].id`, e.g. `rec_1`). The record / stream connector of the device
  view uses the same id (`stream_record_model.gd` `record_state`: `O.saved_row(settings, "recordOutputs", conn.id)`).
- `devices_tab.gd` is at the 500-line cap, and its device-view payload loads only after its first `refresh()`.

## 2. What was done

- **`app/header_badges.gd`**: a stream / record badge emits `output_requested(id)`; the replication letter emits
  `server_requested`. `devices_requested` is gone.
- **`app/shell.gd`**:
  - `output_requested` → `_open_output(id)`: the Devices tab's `_open_port(id)` puts that output's page in the
    Inspector, and the current tab stays.
  - If the device view has not loaded yet, it refreshes it once and retries. Only an id the device view does not know
    falls back to showing the Devices tab.
  - `server_requested` → `devices._open_server()` (the Caspar server page, where the replication settings live).
  - The private calls are deliberate: `devices_tab.gd` has no room for a public wrapper.

## 3. Verified

- **GUI e2e** `19_wo964_badge_opens_inspector` (sandbox server, hidden Xvfb): 3/3.
  - `recordOutputs: [{id: rec_1}]` → the `R1` badge appears.
  - On Live, a click on `R1` → the record output page (`rec_1`) shows in the Inspector, and the current tab is still
    Live.
  - Screenshot: the Rec page (file name, CRF, codec, Start / Stop record) beside the Live deck.
- Godot suite 25946 passed, 0 failed; `run-client.sh --check` boot OK.

Owner QA: click R1 on the box while on Live / Timeline.
