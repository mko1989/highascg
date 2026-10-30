# godot/client/features/devices (part 3) — sweep 29.10.2026 (batch 028)

Files: 11 · lines: 2610 · findings: 0 BUG-HIGH, 2 BUG, 3 DEAD, 1 RISK, 5 QUALITY

Method: every file read in full. Dead-code check = every `func` / `const` / `signal` / top-level `var` of the 11 files grepped
(`grep -rnw <name> godot --include=*.gd --include=*.tscn --include=*.tres`) with the definition line excluded and hits split into own
file / other files / tests; candidates re-grepped by hand. Server reply shapes were checked in `src/api/routes-replication-post.js`
and the web counterparts in `client/components/`.

## godot/client/features/devices/rear_panel.gd
- `OK`

## godot/client/features/devices/replication_format.gd
- `OK`

## godot/client/features/devices/sender_picker.gd
- `RISK` godot/client/features/devices/sender_picker.gd:36 — `Ws.on("server:senders", func(d): _show(d))` registers a lambda that captures `self` and is never removed (`core/ws.gd:41-44 on()` has no `off`, `_dispatch` at :136-138 calls every handler unchecked). The three current owners create one picker for the life of their page (ptz_section.gd:50, follow_output.gd:37, border_artnet_section.gd:31), so nothing fires today. Failing case once a host page is rebuilt or freed (e.g. a tab or project reload that frees the section and builds a new one): the freed picker's lambda is still in `Ws._handlers`, and the next `server:senders` push calls it on a freed capture → script error spam for every later push, plus one more leaked handler per rebuild. Fix: connect to a signal the picker owns, or guard with `if not is_instance_valid(self): return` and add a `Ws.off`.

## godot/client/features/devices/server_controls.gd
- `BUG` godot/client/features/devices/server_controls.gd:104 (`if items == _shown: return`) with :164-172 and server_flow.gd:81-88 / :102-111 — a failed CEF-GPU or auto-accept save leaves the checkbox showing the wrong state. Failing case: tick "Enable GPU in CEF templates" while `POST /api/settings` fails (box busy / 503) → the CheckBox is now pressed; `set_cef` reverts `s.cef = not on` and calls `io.changed()` → `_render()` builds the same items as `_shown` (cef unchanged) → early return, nothing is rebuilt → the box stays ticked while the status line says "Save failed" and the server value is off. The 3 s poll never repairs it for the same reason. `set_auto_accept` is the same and does not even call `io.changed()` after the revert (:85). Fix: on failure rebuild unconditionally (`_shown = []` before `_render()`), or set the widget back with `set_pressed_no_signal`.
- `DEAD` godot/client/features/devices/server_controls.gd:173-185 (`"radio"` and `"input"` item branches), :219-220 (`"Apply network"` press) — unreachable in production: the only production call `M.items(flow.s, flow.clock.call(), true)` (:103) passes `network_panel = true`, and with it `server_page_model.items` emits `{"t": "network"}` instead of the radio / input / iface-select / "Apply network" items (server_page_model.gd:216-230). grep: `grep -rn "M.items(\|SP.items(" godot/client` → only :103 here plus `tests/test_devices_server_page.gd:156,188,237,247` (golden replay of the web page, which uses the default `false`). Also the `ButtonGroup` at :114 is only used by those radios. Exercised by golden tests only.

## godot/client/features/devices/server_flow.gd
- `DEAD` godot/client/features/devices/server_flow.gd:114-125 `apply_network()` — production-dead for the same reason: the "Apply network" button is never built (see server_controls.gd above); the real Network panel (`features/settings/network_pane.gd`) does its own requests. grep: `apply_network` → `server_controls.gd:220` (dead branch), `tests/test_devices_server_page.gd:123`. Its only helper `server_page_model.network_body` goes with it.
- `QUALITY` godot/client/features/devices/server_flow.gd:50 + :64-70 `refresh_network()` — `start()` still GETs `/api/system/network` on every page open, but the result (`s.net_text`, `s.iface_opts`, `s.iface`, `s.net_mode`) is only read by the dead non-panel items and `network_body`. One wasted request per open; drop the call with the dead code (keep it only for the golden replay).
- `QUALITY` godot/client/features/devices/server_flow.gd:81-88 `set_auto_accept()` — no `io.changed()` after the failure revert (compare `set_cef`, :108); see the BUG in server_controls.gd.

## godot/client/features/devices/server_page_model.gd
- `DEAD` godot/client/features/devices/server_page_model.gd:76-96 `apply_network()`, :100-105 `network_body()`, :220-230 (the `network_panel == false` branch of `items`) and the state keys they feed (`iface`, `iface_opts`, `net_mode`, `net_text`, `ip`, `prefix`, `gateway`, `dns` in `init_state`, :63-70) — see server_controls.gd: the only production call of `items` uses `network_panel = true`. Only the golden web replay (`tests/test_devices_server_page.gd`) reaches this code. Decide: delete it and the replay cases, or keep it as the web-parity oracle and say so in the header.
- `QUALITY` godot/client/features/devices/server_page_model.gd:29-50 `normalize_fps()` / `resolve_project_fps()` — second implementation of `cable_seed.gd:23 normalize_fps` and `:41 project_fps` (same `[23.98 … 60]` list, `cable_seed.gd:13 PROJECT_FPS` vs `STANDARD_FPS` here). They differ in details (prefix parse vs `is_valid_float`, tie-break start value), so the two can in principle pick a different rate for the same stored value. Use one (`S.normalize_fps` / `S.project_fps`).

## godot/client/features/devices/snapshot_dialogs.gd
- `QUALITY` godot/client/features/devices/snapshot_dialogs.gd:40-44 `_Io._web()` and :250-260 `_confirm()` — copy of the helper in three other controllers (see live_input_dialog.gd in part 2) and of `host_controls_base.gd:50-64 _confirm`, including its single shared `_decided` signal; two overlapping confirms (the dialog stays modal, so not reachable today) would resolve each other. Share the base helpers.

## godot/client/features/devices/snapshot_flow.gd
- `OK`

## godot/client/features/devices/snapshot_model.gd
- `OK`

## godot/client/features/devices/stream_record_model.gd
- `BUG` godot/client/features/devices/stream_record_model.gd:90 (`_in("srt_latency", …)`) + output_ports_model.gd:15 (`MATH["stream_out"]` has only vbitrate / abitrate) — the SRT latency (ms) field holds a number but gets no maths commit, which breaks RULES.md "Input fields" rule 2. Failing case: SRT stream, latency `1000/2`, Enter → `ui.srt_latency = "1000/2"` → `stream_save` :131 `_clamp_int(…)` → `O.int_or("1000/2", 120)` = prefix 1000 → saves `srtLatencyMs: 1000` (rule: 500). Fix: add `"srt_latency": [20.0, 8000.0]` to `O.MATH["stream_out"]` (the commit path in output_port_controls.gd:148-155 then handles it) and use `O.math_initial` in `stream_state` :60.
- `QUALITY` godot/client/features/devices/stream_record_model.gd:17 / :127 / :155-156 — "UDP" is offered in the type select (TYPES, and the URL field shows `udp://host:port`), but `stream_save` stores the URL only for SRT (`srtUrl`, :127) and RTMP (credentials call, :141), so a UDP URL is silently dropped on Save and the field is empty on the next open; Start then answers "Start for UDP is not wired yet". Web parity (`client/components/device-view-inspector-stream.js:38,208`), but Godot could at least hide the type or say so in the page.

## godot/client/features/devices/vcam_audio_model.gd
- `OK`
