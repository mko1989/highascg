# godot/client/features/devices — part 1 — sweep 29.10.2026 (batch 026)

Files: 26 · lines: 6739 · findings: 0 BUG-HIGH, 2 BUG, 3 DEAD, 3 RISK, 3 QUALITY

Context checked: `devices_tab` passes the settings-merged payload (`H.merge_settings`, host_channels.gd:456) to `Model.build`, the panels and the pages, so the
`payload._settings` reads in gpu_layout.gd:153 / host_channels.gd are live there; `Config`/`DevicesTarget` signals (`target_changed`, `resolved`) take no arguments, matching
`reload`/lambda connects; the `req.size() < 4` "soft" request convention is produced by `host_source_model.gd` / `input_slots_model.gd`; WO-802 rule (client never connects to
another node) holds for cluster_panel.gd (`edit_peer(id, name, peer_origin)` only passes the origin for Caspar-side URLs, relay by id). Rules 1/2 of RULES.md (focus selects,
maths in number fields) are installed globally by `NumericField.install` (app/shell.gd:49) and the destination page's `_line` uses `MI.commit`.

## godot/client/features/devices/cable_gesture.gd
- `BUG` godot/client/features/devices/cable_gesture.gd:342 — `undo()` pops the snapshot (`_undo.pop_back()`) before the restore is posted and never pushes it back on failure. Failing case: Ctrl+Z while `POST /api/settings` fails (server restarting, network blip) → the status line shows the error, `r.ok` is false, the snapshot is gone, and the second Ctrl+Z undoes the step before it (or says "Nothing to undo"), skipping the failed one. Fix: `_undo.append(snap)` in the `not r.ok` branch (line 346-348), or pop only after success.
- `QUALITY` godot/client/features/devices/cable_gesture.gd:265 — "Cable move failed — original connection restored" is printed whenever `err != ""`, also when the rollback `addEdge` itself failed (line 252-255: `back.ok == false`) or `rollback` was empty. Failing case: `removeEdge` OK, new `addEdge` rejected, rollback `addEdge` times out → the edge is gone but the message claims it is restored (the following reload shows the truth). Fix: only say "restored" when `back.ok`, else "…and the original could not be restored".

## godot/client/features/devices/cable_layer.gd
- `RISK` godot/client/features/devices/cable_layer.gd:84 — `c is Control and is_instance_valid(c)`: the validity check comes after the `is` test. GDScript raises "Left operand of 'is' is a previously freed instance" for a freed object on the left of `is`, so an anchor that was freed (card/rear-panel rebuilt, `queue_free`d) but is still in `anchors` before the next `set_cables()` logs an error every `_process` frame instead of returning null. `show_model` replaces the map in the same call today, so no failing sequence found. Fix: `is_instance_valid(c) and c is Control and …`.

## godot/client/features/devices/cable_model.gd
- `DEAD` godot/client/features/devices/cable_model.gd:64 `build()` + `_relax()` (:166-218) + `GRAVITY` (:21), `ITERS` (:22), `SUBSTEPS` (:23) — the one-shot Verlet solve is not used in production since WO-672: cable_layer.gd draws `cable_rope.gd` (rear panel) or `simple_curve`/`bezier` (Node view); rope only calls `CableModel.path`, `loop_specs`, `srand`, `BOOT_DROP`. grep: `grep -rn "CableModel\.build\|M\.build\|CM\.build" godot` → only `tests/test_devices_cable.gd:12` (the golden test against the web file). About 60 lines kept alive by a test; the header comment (:1-5) and cable_layer.gd's "the view caches build() results" still describe it as the live path. Fix: delete with its golden test, or mark it explicitly as a test-only reference.

## godot/client/features/devices/cable_rope.gd
- `OK`

## godot/client/features/devices/cable_rules.gd
- `OK`

## godot/client/features/devices/cable_seed.gd
- `OK`

## godot/client/features/devices/cables_list.gd
- `OK`

## godot/client/features/devices/cluster_model.gd
- `OK`

## godot/client/features/devices/cluster_panel.gd
- `RISK` godot/client/features/devices/cluster_panel.gd:344 — the "Linked servers may press here" checkbox fires `post_json("/api/server/duties", …)` and ignores the answer. If the server refuses or is unreachable the box stays in the new state, and `_render()` returns early on an unchanged snapshot (`sig == _sig`, :130), so nothing ever puts it back. Failing case: untick it while the node answers 500 → the UI shows "refuses" while the server still accepts remote presses. Fix: await the reply and on `not r.ok` reset with `set_pressed_no_signal` and show the error.

## godot/client/features/devices/decklink_drop_flow.gd
- `QUALITY` godot/client/features/devices/decklink_drop_flow.gd:139-148 — `_run()` is a copy of `host_controls_base.gd:24-33`, minus the `dirty` result. Its "soft" branch (`req.size() < 4`) cannot trigger here: the only plans it runs are `DI.add_prepare` / `DI.add_finish`, whose requests are always 3 elements (decklink_input_model.gd:85,107,135,144). A change to the shared request convention has to be made in both. Fix: move the runner to a shared static helper that both use.

## godot/client/features/devices/decklink_drop_io.gd
- `OK`

## godot/client/features/devices/decklink_input_model.gd
- `OK`

## godot/client/features/devices/decklink_order.gd
- `OK`

## godot/client/features/devices/decklink_order_editor.gd
- `DEAD` godot/client/features/devices/decklink_order_editor.gd:17,81 `var _rows` — appended to in `_row()` and never read. grep: `grep -n "_rows" godot/client/features/devices/decklink_order_editor.gd` → declaration and the `append`. Fix: delete both.

## godot/client/features/devices/decklink_port_controls.gd
- `BUG` godot/client/features/devices/decklink_port_controls.gd:129-136 (with decklink_port_model.gd:199) — Buffer depth stores the value of the *raw* text, not of the evaluated expression, contradicting RULES.md 2 ("the result is then clamped and rounded like a typed number"). `commit` sets `ui.depth = le.text` and saves, and only afterwards rewrites the field with `MI.commit(...)`. `consumer_patch` then reads `H.js_int("1+1")` = `parseInt` → 1. Failing case: type `1+1` + Enter in "Buffer depth" → POST stores `decklinkBufferDepth: 1`, the field is rewritten to `2`, and the reload that follows `_write` redraws it as `1`. (`3-1` stores 3, `4/2` stores 3 while the field shows 2: the leading integer, clamped.) The comment in the function says this is the web's order, but the owner rule overrides the web quirk. Fix: evaluate first (`MI.commit`), then set `ui.depth` and save.

## godot/client/features/devices/decklink_port_model.gd
- `OK` (the depth bug above is in the pair decklink_port_controls.gd / decklink_port_model.gd:199; the model itself is a faithful port)

## godot/client/features/devices/destination_inspector.gd
- `OK`

## godot/client/features/devices/destinations_model.gd
- `OK`

## godot/client/features/devices/destinations_panel.gd
- `OK`

## godot/client/features/devices/devices_model.gd
- `OK`

## godot/client/features/devices/devices_tab.gd
- `DEAD` godot/client/features/devices/devices_tab.gd:24 `const PortIcon` — unused preload; no `PortIcon.` in the file. grep: `grep -n "PortIcon" godot/client/features/devices/devices_tab.gd` → the const line only. Fix: delete.
- `RISK` godot/client/features/devices/devices_tab.gd:295 — `_gesture.payload = r.data` is the raw GET, while the tab/panels use the settings-merged `payload` (:298). Every `payload.get("_settings")` fallback in the gesture path therefore sees null: cable_rules.gd:99 (synthetic `gpu_pN` connector topology), cable_seed.gd:170 and :177 (`_feed` → `default_video_mode(null)` = `1080p5000` instead of the project fps). No failing case found because the server always fills `videoMode` (src/config/screen-destinations.js:~111) and the gesture passes settings explicitly to `Seed.preflight`/`gpu_sink_writes`, but a destination without `videoMode` would be seeded to 50 fps regardless of `machineProfile.defaultProjectFps`. Fix: assign the merged payload (`_gesture.payload = payload`) after :298.
- `QUALITY` godot/client/features/devices/devices_tab.gd:259-261 — the doc comment of `refresh()` ("GET /api/device-view (+ settings once …) A reload asked for while one is in flight runs again after it …") sits above `inspect_destination()` (:262), glued to that function's WO-604 comment; `refresh()` (:274) itself has none. Fix: move the first two lines down to `refresh()`.

## godot/client/features/devices/devices_toolbar.gd
- `OK`

## godot/client/features/devices/file_pick.gd
- `OK`

## godot/client/features/devices/gpu_entries.gd
- `OK`

## godot/client/features/devices/gpu_layout.gd
- `OK`

## godot/client/features/devices/gpu_layout_editor.gd
- `OK`
