# godot/client/core — sweep 29.10.2026 (batch 023)

Files: 25 · lines: 2632 · findings: 0 BUG-HIGH, 0 BUG, 1 DEAD, 8 RISK, 2 QUALITY

Method: every file read in full. Server behaviour behind the client assumptions was checked in src/ (`routes-data-project-handlers.js` save/autosave replies and `project_sync` broadcast, `routes-data-project-sync.js` 150 ms debounce, `support/redact-settings.js` recursion into arrays). Checked against RULES.md: the Linked-servers rules hold in this batch (Config has no cluster-follow path left, DevicesTarget reaches a linked server only through `/api/cluster/peers/:id/relay`, `Config.forget_cluster` erases the old `[cluster]` section); input-field rule 1 is met by `NumericField.install` and rule 2 by `NumericField.resolve` (but see math_input.gd). Public functions with a single use were each opened and confirmed live (`put_json` → timeline_transport.gd:201, `refresh_state` → devices_tab.gd:279, `save_demo` → settings_panes.gd:101, `host_of` → header_project.gd:45, `start_dir` → file_pick.gd:27, `peer_origin` → cluster_panel.gd:201).

## godot/client/core/api.gd
- `OK`

## godot/client/core/api_timeouts.gd
- `OK`

## godot/client/core/auth_model.gd
- `OK`

## godot/client/core/auth_prompt.gd
- `OK`

## godot/client/core/client_prefs.gd
- `OK`

## godot/client/core/config.gd
- `RISK` godot/client/core/config.gd:125-130 (+114-121) — the shared API password is written in clear text into `user://ui.cfg` `[auth] passwords` by `set_password()`, and `adopt_local_password()` copies the node's own `.private/api-token` there. The node keeps that file 0600 (auth_model.gd:7-8); `ConfigFile.save()` uses the process umask, so on a machine with a 022 umask the same secret becomes group/world readable under the user data dir. Failing case: any other local user (or a backup of the Godot user dir) reads the password the owner chose to protect. Fix: `FileAccess`-chmod ui.cfg to 0600 after save, or store only for non-local origins and re-read the node file on the box.

## godot/client/core/connection_profiles_model.gd
- `OK`

## godot/client/core/demo/demo_extras.gd
- `OK`

## godot/client/core/demo/demo_scene.gd
- `OK`

## godot/client/core/demo/demo_server.gd
- `OK`

## godot/client/core/devices_target.gd
- `QUALITY` godot/client/core/devices_target.gd:12,45-54 — `signal resolved` / `is_resolved` / `wait()` are vestigial since WO-802: `_ready()` sets `is_resolved = true` and emits `resolved` immediately, so `await DevicesTarget.wait()` (boot_question.gd:16, shell.gd:130, and inside `refresh_state`) can never block, and nothing listens to `resolved`. grep: `grep -rn "\.resolved\b\|resolved\.connect" godot` → only the emit at line 47. Harmless, but the call sites suggest an async step that no longer exists.

## godot/client/core/devices_target_model.gd
- `OK`

## godot/client/core/math_input.gd
- `RISK` godot/client/core/math_input.gd:99-107 (+111-132) — `parse()` falls back to parseFloat's numeric PREFIX when the text is not a valid expression, so `commit("12abc", …)` commits `12` and `"1920x"` commits `1920`. RULES.md input rule 2 says input that is not a valid expression leaves the previous value in place. The generic path (`NumericField.resolve`, numeric_field.gd:23-30) is strict and does keep the previous value, so the two number-field paths disagree. `MI.commit` / `MI.parse` are what the Devices inspectors use (output_ports_model.gd:95-105, mapping_page_model.gd:103-131, gpu_output_controls.gd:275) and tests/golden/math_input.json pins the web behaviour. Failing case: type `1920x` into a Devices width field and press Enter → 1920 is committed instead of reverting. Owner decision: keep web parity, or make the prefix fallback return NaN and regenerate the golden.

## godot/client/core/net_util.gd
- `OK`

## godot/client/core/numeric_field.gd
- `OK`

## godot/client/core/platform.gd
- `OK`

## godot/client/core/project_sync.gd
- `RISK` godot/client/core/project_sync.gd:116-150 (+174-179) — an in-flight autosave outlives `reset()`. Sequence: autosave POST for project A is awaiting its reply; the operator picks project B in Load → `header_project._adopt()` runs `ProjectSync.reset()` (clears the latch, `pending`, timer — but not `in_flight`) and `Store.set_project(B)`; A's reply `{rev: 41, changed: true}` then arrives in the still-running `flush()` loop and executes `Store.project["rev"] = verdict.rev` (line 131) on B's document and `_skip_next_sync = true` (line 133). B's next autosave posts A's revision (the 409 stale-rev retry path repairs it at most 3 times), and the latch makes `accept_remote_sync()` drop the next genuine `project_sync` from another editor. Fix: capture `var doc := Store.project` before the await and only apply rev / latch when `is_same(Store.project, doc)`, or let `reset()` bump a generation counter that `flush()` compares.
- `RISK` godot/client/core/project_sync.gd:132-133,108-113 — the "skip exactly one echo" latch is a bool that is only cleared by the echo itself. If the WebSocket is down when an autosave succeeds with `changed: true` (autosave goes over HTTP; the server's 150 ms-debounced `project_sync` broadcast goes only to connected sockets, `routes-data-project-sync.js:44-50`), the echo never arrives, and the latch survives the reconnect (main.gd `_on_ws_connect` re-pulls the project but does not call `ProjectSync.reset()`). The first real `project_sync` from a web editor after the reconnect is then silently dropped. Fix: clear `_skip_next_sync` on `Ws.disconnected` / in `_on_ws_connect`.

## godot/client/core/project_sync_policy.gd
- `OK`

## godot/client/core/project_undo.gd
- `DEAD` godot/client/core/project_undo.gd:11,68 `signal applied(what)` — emitted by `_restore()`, never connected. grep: `grep -rn "ProjectUndo.applied\|ProjectUndo\.\(applied\)" godot tools` → none; the only `.applied.connect` in the repo (devices_tab.gd:91) is `snapshots.applied`, a different object. No test connects it either (tests/test_project_undo*.gd).
- `RISK` godot/client/core/project_undo.gd:36-42 (+ project_undo_model.gd:15-25) — every edit takes a whole-document snapshot: `snapshot()` is two `JSON.stringify` calls and one `JSON.parse_string` of the entire show (`canon()`), run on every `edited` (each `mark_dirty` / `deck_changed`, i.e. on each drag/spin step), and up to `MAX = 100` full copies are kept as strings. For a show with a few MB of looks that is tens of ms per edit on the UI thread and ~100× the document size in RAM. No failing case at today's project sizes, but it scales with the project; consider hashing first (skip if `str(hash)` unchanged), coalescing before stringifying, or diffing.

## godot/client/core/project_undo_model.gd
- `OK`

## godot/client/core/settings_payload.gd
- `RISK` godot/client/core/settings_payload.gd:27-39 — `strip()` removes `"[REDACTED]"` / truncated strings from strings and nested Dictionaries but returns an Array untouched. The server's redactor recurses into arrays (`src/support/redact-settings.js:34`: `Array.isArray(value) → value.map(...)` with the element's key path), so a sensitive-named field inside an array element (e.g. `streamOutputs[i].authToken`, any `*password*` / `*secret*` / `auth*` key in a list of objects) reads `"[REDACTED]"` on GET and is echoed back verbatim by the next save of that section, overwriting the stored secret with the placeholder. Failing case: settings key whose value is a list of objects with such a field; change anything in that section → the stored value becomes the literal `[REDACTED]`. No current default setting in `defaults-core.js` has that shape (only `nuclearPassword*` / `enforceAuth`, which are handled), hence RISK. Fix: recurse into Arrays in `strip()`, dropping redacted members (or the whole element and let the server merge).

## godot/client/core/settings_state.gd
- `OK`

## godot/client/core/state_store.gd
- `QUALITY` godot/client/core/state_store.gd:71 — `var _listeners := {}` is declared between two functions in the middle of the file (after `note_scene_live_seq`), away from the other vars at the top. Move it up.

## godot/client/core/stream_upload.gd
- `RISK` godot/client/core/stream_upload.gd:104-111 — `StreamPeerTCP.put_data()` blocks until the whole 1 MiB chunk is accepted by the socket, and the loop only yields (`await tree.process_frame`) between chunks. On localhost that is instant, but for an off-box client (laptop → box, WO-686/688) over Wi-Fi each chunk can block the main thread for 100 ms-1 s, so the GUI stutters for the full length of a multi-GB upload. Use `put_partial_data` with `get_available`-style pacing, or a worker thread.

## godot/client/core/ws.gd
- `RISK` godot/client/core/ws.gd:41-45 — `Ws.on()` has no way to unregister (`_handlers` only grows). `Store.on()` returns an unsubscribe Callable, `Ws.on()` does not. Handlers registered from nodes that can be freed leave a lambda capturing a dead instance in the autoload; the next message of that type then calls into a freed object ("Lambda capture … was freed"). All 21 current callers (grep `Ws.on(`) are long-lived tabs/panels, except the per-section `SenderPicker.make(...)` widgets (sender_picker.gd:36, created by ptz_section / follow_output / border_artnet_section), which accumulate one handler per instance. No failing case today; add an `off()` / return a Callable like `Store.on`.
