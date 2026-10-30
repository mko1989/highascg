# godot/client/features/devices (part 2) — sweep 29.10.2026 (batch 027)

Files: 28 · lines: 6646 · findings: 0 BUG-HIGH, 3 BUG, 2 DEAD, 3 RISK, 6 QUALITY

Method: every file read in full. Dead-code check = every `func` / `const` / `signal` / top-level `var` of the 28 files grepped
(`grep -rnw <name> godot --include=*.gd --include=*.tscn --include=*.tres`) with the definition line excluded, self / other-file / tests/
hits split; the few with only test or comment hits were re-grepped by hand. No unused function or const was found except the two DEAD
items below. Web parity was checked against `client/components/*` for the odd-looking spots; where the Godot code mirrors a web quirk
that is said in the finding.

## godot/client/features/devices/gpu_layout_flow.gd
- `OK`

## godot/client/features/devices/gpu_modeline_model.gd
- `OK`

## godot/client/features/devices/gpu_modeline_preview.gd
- `OK`

## godot/client/features/devices/gpu_output_controls.gd
- `BUG` godot/client/features/devices/gpu_output_controls.gd:25-26 (`INPUTS` pos_x / pos_y, decimals `-1`) → :249-251 `_entry("pos_x")`, :267-282 `_entry()` — the screen X / Y fields hold numbers but are plain text with no maths commit, which breaks RULES.md "Input fields" rule 2. The web page does attach it: `client/components/device-view-inspector-gpu.js:219-226` `attachMathInput(posXIn, { decimals: 0 })`. Failing case: type `1920/2` in X and press Enter → the field keeps `1920/2`, `_edit("pos_x", "1920/2")` → `gpu_output_model.gd:228` `_pos()` = `S._int("1920/2")` = prefix parse = 1920 → POSTs `screen_N_x: 1920` (rule says 960). `(1920-100)` would save 1920 as well. Fix: `"pos_x": ["X", -INF, 0]`, `"pos_y": ["Y", -INF, 0]` (min must be -INF, not 0, a screen offset can be negative) so `_entry` runs `MI.commit`.

## godot/client/features/devices/gpu_output_model.gd
- `OK`

## godot/client/features/devices/gpu_output_ui.gd
- `OK`

## godot/client/features/devices/host_channel_controls.gd
- `OK`

## godot/client/features/devices/host_channels.gd
- `OK`

## godot/client/features/devices/host_controls_base.gd
- `OK`

## godot/client/features/devices/host_input_controls.gd
- `RISK` godot/client/features/devices/host_input_controls.gd:73-76 and :82-87 — the FFT checkbox and the capture-device select return silently when `_busy` (shared with Start / Remove / the other control), but the widget has already changed. Case: change the capture device (post in flight, `sel.disabled`), then tick "Feed audio-reactive shaders" within that window → `_busy` is true → return; the box stays ticked, nothing is posted, no revert and no status. Same for the select if FFT was in flight (`sel` is only disabled by its own handler). Fix: on the `_busy` early-return call `fft.set_pressed_no_signal(not on)` / re-select `cur.device`, or disable both controls while either request runs.
- `QUALITY` godot/client/features/devices/host_input_controls.gd:119 `IS._stop(ch, layer)` (and :33 `IS._int`) — calls an underscore-private function of another script, and `_stop` is a byte-identical copy of `host_source_model.gd:355-356 stop_cmds`. Use `HS.stop_cmds` (already preloaded by the base as `HS`) and delete `input_slots_model._stop`.

## godot/client/features/devices/host_live_controls.gd
- `BUG` godot/client/features/devices/host_live_controls.gd:144-146 — the Browser source Width / Height / FPS fields are plain `_line()` fields, no maths commit (RULES.md "Input fields" rule 2: every field that holds a number). Failing case: Width `1920/2`, Enter → `HS.browser_request` (host_source_model.gd:189-194) → `_int_or("1920/2", 1152)` → `H.js_int` prefix = 1920 → POST `/api/host-live/browser` with `width: 1920`, not 960; FPS `50/2` posts 50. (The web inspector has no maths either, `inspector-browser-display.js`, but RULES.md applies to every client; the Add-live-input dialog already does it right for the same three fields: `live_input_dialog.gd:16` `NUMERIC`.) Fix: `NumericField.math_line(le, true, 160/120/1, INF)` for w / h / fps (min 160 / 120 / 1, fps max 60) before the handlers are connected.

## godot/client/features/devices/host_source_model.gd
- `OK`

## godot/client/features/devices/input_slots_model.gd
- `QUALITY` godot/client/features/devices/input_slots_model.gd:194-195 `_stop()` — exact duplicate of `host_source_model.gd:355-356 stop_cmds()`, and it is called from outside the file (`host_input_controls.gd:119`) although underscore-private. Delete it and use `HS.stop_cmds` in :174, :232 and in host_input_controls.

## godot/client/features/devices/live_input_dialog.gd
- `QUALITY` godot/client/features/devices/live_input_dialog.gd:36-40 `_Io._web()` — the same 5-line "HTTP %d: %s" wrapper is copy-pasted in four controllers: live_input_dialog.gd:36, mapping_controls.gd:36, server_controls.gd:34 (batch 028) and snapshot_dialogs.gd:40 (batch 028), each with its own `_Io` class. One static helper in `host_controls_base.gd` (or `core/devices_target.gd`) would cover all four, and a fix to the error text then lands once. snapshot_dialogs.gd:250-260 also re-implements `host_controls_base._confirm`.

## godot/client/features/devices/live_input_flow.gd
- `OK`

## godot/client/features/devices/live_input_model.gd
- `DEAD` godot/client/features/devices/live_input_model.gd:15 `WRAP` — only referenced by a golden test. grep: `grep -rnw WRAP godot --include=*.gd` (minus AUTOWRAP) → the definition and `tests/test_devices_live_input.gd:93` (`"shown": [M.WRAP[s.kind]]`). No production code, scene or tres reads it. Delete it together with that one test field, or move it into the test.
- `QUALITY` godot/client/features/devices/live_input_model.gd:256 `HOST_KINDS` — duplicate of `host_channels.gd:14 LIVE_HOST_KINDS` (same three strings); a third copy of the idea sits in `features/live/live_sources_model.gd:190`. Use `H.LIVE_HOST_KINDS`.
- `QUALITY` godot/client/features/devices/live_input_model.gd:37, :111, :154, :195, :262-269 (and host_input_controls.gd:33, mapping_graph.gd, gpu_modeline_preview.gd, …) — about 60 calls into underscore-private members of other scripts (`HS._str`, `HS._int_or`, `HS._truthy_or_null`, `HS._num`, `H._connector_slot`, `H._io_direction`, `H._num_eq`, `S._int`, `G._outputs`, `GM._int_or`). Works, but any rename of a "private" helper breaks distant files with a runtime error only. The shared coercions (`_str`, `_int_or`, `_num`, `_truthy_or_null`) deserve one public home.

## godot/client/features/devices/mapping_controls.gd
- `OK`

## godot/client/features/devices/mapping_flow.gd
- `OK`

## godot/client/features/devices/mapping_graph.gd
- `OK`

## godot/client/features/devices/mapping_page_model.gd
- `OK`

## godot/client/features/devices/mapping_panel.gd
- `OK`

## godot/client/features/devices/matrix_model.gd
- `OK`

## godot/client/features/devices/matrix_view.gd
- `OK`

## godot/client/features/devices/node_panel.gd
- `OK`

## godot/client/features/devices/node_view_model.gd
- `QUALITY` godot/client/features/devices/node_view_model.gd:19-21 `KIND_TITLE` / :125 `subtitle()` — the title table has no `decklink_io`, `stream_out` or `record_out`, so `kind_title()` falls back to the raw kind id. Visible effect: every DeckLink card without an inherited standard mode shows the literal text `decklink_io` as its status line (subtitle falls through to line 125), and the card tooltip in node_panel.gd:105 reads `"<label> — decklink_io"` (also `stream_out`, `record_out`). Web parity (`client/components/device-view-caspar-render-helpers.js:52-60 casparRearKindTitle` has the same gap), but it is an internal id shown to the operator. Add titles such as "DeckLink input / output", "Stream output", "Record output".

## godot/client/features/devices/output_port_controls.gd
- `RISK` godot/client/features/devices/output_port_controls.gd:238-239 `_write()` — an audio page change that arrives while another write is running is dropped without any message (`if _busy: return`), but every audio edit auto-saves (:158-159, :183, :190). Case: pick a device (POST + settings reload + `reload.emit` ≈ 100+ ms), change Layout / Monitor in that window → `_save_audio` → `_write` returns → the edit is never sent and the page is rebuilt from the server state a moment later, so the operator's second choice just snaps back. Fix: queue the newest `values` and post again when the running write ends (the pattern `gpu_output_controls.gd:311-327 _save` already uses).
- `RISK` godot/client/features/devices/output_port_controls.gd:89-93 `_fetch_live()` — on a Stream / Record / Virtual cam page the GET reply calls `_rebuild()`, which frees every control including the one being edited. Case: open a Stream page, click Video kbps and type `4500` before `/api/streaming-channel` answers (the default API timeout is 15 s on a loaded box): the math fields do not mirror into `ui` until commit (:149-150), so the typed text and the focus vanish. Fix: skip the rebuild when `page` holds the focus, or update only the log label.

## godot/client/features/devices/output_ports_model.gd
- `BUG` godot/client/features/devices/output_ports_model.gd:221-222, :228, :232, :237 `add_plan()` — the new row id is `"<prefix>_%d" % (cur.size() + 1)`, which collides after any non-last row was removed. Failing case: settings `streamOutputs = [str_1, str_2, str_3]`, remove `str_2` via `remove_plan` (:199 keeps str_1, str_3), press the rear panel "+" → `i = 3` → posts `[str_1, str_3, {id:"str_3", label:"Str3"}]` — two rows with id `str_3`. After that `saved_row` / `row_index` (:146-172) always hit the first one so the new output can never be edited or saved, the graph gets duplicate connector ids, and Remove drops both rows (the filter at :199 matches by id). Same for `rec_%d` and `audio_%d`. The web has the identical logic (`client/components/device-view-bands-render.js:333-350`), so it is an inherited bug, not a port slip. Fix: take `max(numeric suffix of existing ids) + 1`, or loop until the id is unused.

## godot/client/features/devices/port_icon.gd
- `DEAD` godot/client/features/devices/port_icon.gd:14 `dot_color` — never assigned anywhere, so the `draw_arc` colour at :62 is always `ThemeBuilder.TEXT_MUTED`. grep: `grep -rn dot_color godot --include=*.gd --include=*.tscn` → only the declaration and the read in `_draw`. Make it a constant or drop the variable.
