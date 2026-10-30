# godot/client/app — sweep 29.10.2026 (batch 022)

Files: 39 · lines: 4967 · findings: 0 BUG-HIGH, 2 BUG, 3 DEAD, 2 RISK, 8 QUALITY

Method: every file read in full. Probe scripts (`deck_blank_probe`, `docks_probe`, `fixture_shot_probe`, `preset_e2_probe`, `perf_probe`) were checked against the private members they reach into (`_columns`, `_fx`, `_last`, `_pitch`, `_dist`, `session_open`, `LookPresetPage.save/recall/true_buses/_commit`, `LiveTab._set_shown`, `Destinations.set_only/selected`) and all exist. main.gd's inline probes: every private member they touch (`_on_fit`, `_apply_layer`, `_add_timer`, `_btn_named`, `show_media`, `save_fixture_to`, …) still exists under features/. Signals `Ws.disconnected`, `Ws.message`, `Ws.connected` exist in core/ws.gd. A scan for `const X := preload(...)` with no other use in the batch found only the one below.

## godot/client/app/boot_question.gd
- `OK`

## godot/client/app/connection_eye.gd
- `BUG` godot/client/app/connection_eye.gd:61-69 (+94) — the "celebration" after AMCP connects (random open/left/right frames for 5 s, documented in the header comment) never runs. `set_state()` calls `_celebrate()` at line 66 BEFORE it assigns `connected = is_connected` at line 67. `_celebrate()` is `while connected and _now() < _celebrate_until:` and `connected` is still `false` on that first evaluation, so the loop exits at once, sets `_frame = 0` and returns. Failing case: eye goes red → green (Caspar connects) → expected 5 s of randomised blinking, actual: nothing; the only surviving effect is that `_celebrate_until` suppresses the 30 s blink for 5 s. The next `set_state` calls see `connected == true` so the branch is never re-entered. Fix: set `connected = is_connected` before calling `_celebrate()` (and `await`-free is fine, it is a coroutine).

## godot/client/app/connection_menu.gd
- `RISK` godot/client/app/connection_menu.gd:75-81 — `switch_to()` calls `Config.save_profiles(p)` (which flips the stored active side) BEFORE it checks `HIGHASCG_SERVER`. With that env var set: right-click → "Connect to B" → confirm → the dialog says "unset it to switch" and the client stays on the env server, but ui.cfg now says `active = B`. The eye tooltip (shell.gd:240 `Profiles.label(Config.profiles())`) then names "Host B (…)" while `Config.origin` is the env server, and a later start without the env var goes to B. Fix: test the env var first, save the profile only when the restart will happen.

## godot/client/app/deck_blank_probe.gd
- `OK`

## godot/client/app/docks_probe.gd
- `OK`

## godot/client/app/fixture_shot_probe.gd
- `OK`

## godot/client/app/hardware_reconcile.gd
- `OK`

## godot/client/app/hardware_reconcile_model.gd
- `OK`

## godot/client/app/header_badges.gd
- `QUALITY` godot/client/app/header_badges.gd:48-53 — a single failed `GET /api/replication/status` (server restarting, 1 timeout) sets `next = {}` and `render()` removes the L / F hot-backup badge until the next successful 2.5 s poll. For a badge whose whole job is to show the link state, "unknown" and "standalone" look identical. Keep the previous `_repl` (or show the amber "pending" tone) on a transport failure; only an OK reply saying standalone should hide it.

## godot/client/app/header_badges_model.gd
- `OK`

## godot/client/app/header_model.gd
- `BUG` godot/client/app/header_model.gd:66-71 — `saved_label()` converts the UTC `savedAt` to local time with `Time.get_time_zone_from_system().bias`, which is the CURRENT offset (incl. today's DST state), not the offset in force on the saved date. Failing case: project saved `2026-07-01T10:00:00Z`, Load dialog opened on 2026-10-29 in Europe/Warsaw (bias +60 after the 25.10 switch to CET): shows `2026-07-01 11:00`, the real local time was 12:00 (CEST). Every project saved in the other DST period is off by one hour in both the Load and the USB-stick dialogs. Display only. Fix: build the local time with `Time.get_datetime_dict_from_unix_time` plus the offset for that instant (e.g. compare `Time.get_datetime_dict_from_system()` at that unix time via a `Time.get_unix_time_from_datetime_dict` round trip), or show the UTC time with a "UTC" suffix.

## godot/client/app/header_project.gd
- `RISK` godot/client/app/header_project.gd:222-231 — "Load from file" first POSTs `/api/project/save` with `allowReplace: true` (header_model.gd:110), then loads it. Any file whose `name` slugs to an existing server project silently replaces that project on the server: no "a project with this name exists, replace it?" step, and the server's stale/unrelated-looks guard is bypassed on purpose (WO-823). Failing case: pick an old export called "Show" while the live "Show" has newer work → the live project is overwritten and activated. A confirm (the Load dialog already knows the slug list) would make it recoverable.

## godot/client/app/header_status.gd
- `DEAD` godot/client/app/header_status.gd:9 `const ThemeBuilder := preload("res://app/theme_builder.gd")` — never referenced. grep: `grep -c "\bThemeBuilder\b" godot/client/app/header_status.gd` → 1 (only the declaration).

## godot/client/app/header_tools.gd
- `OK`

## godot/client/app/help_dialog.gd
- `OK`

## godot/client/app/inspector_panel.gd
- `OK`

## godot/client/app/led_test_dialog.gd
- `OK`

## godot/client/app/led_test_model.gd
- `OK`

## godot/client/app/logs_dialog.gd
- `QUALITY` godot/client/app/logs_dialog.gd:209-212 — every WS `log_line` re-assigns the whole TextEdit text (`_high.text = L.append(_high.text, line)`), so each line costs a copy of up to 2000 lines plus a full TextEdit re-layout. At debug level with a busy server (hundreds of lines/s) the window stalls the whole client. Insert at the end (`insert_text` / `set_line`) and drop leading lines instead.
- `QUALITY` godot/client/app/logs_dialog.gd:240-242 — "Clear HighAsCG" awaits `POST /api/logs/clear` but ignores the result and clears the pane even when the POST failed; the lines return on the next open. Check `res.ok`.

## godot/client/app/logs_model.gd
- `QUALITY` godot/client/app/logs_model.gd:44-52 — `append()` runs `out.count("\n")` over the whole 2000-line buffer on every appended line (O(buffer) per line, called per WS message). Part of the same cost as above; track the line count in the caller.

## godot/client/app/main.gd
- `DEAD` godot/client/app/main.gd:20,483 `boot_log` — written (`boot_log.append(line)` in `_log`) and never read. grep: `grep -rn "boot_log" godot tools scripts` → only main.gd:20 and main.gd:483. The `_log` line already goes to stdout and the status line, so the array only grows.
- `QUALITY` godot/client/app/main.gd:23-373 — `_ready()` is a 350-line function whose last 320 lines are inline dev probes (`probe-take` … `probe-ftb`) reaching into ~60 private members of features (`ed._inspector._fx._registry`, `tp._records`, …). The file is 499 lines against the 500-line CI cap (tools/ci/check-max-file-lines.js), so any production line added to main.gd breaks CI, and the probes rot silently when those privates are renamed (they are only exercised by hand). The repo already has the right pattern at lines 368-371 (`probes` dict → separate `app/*_probe.gd`); move the rest there.

## godot/client/app/markdown_bbcode.gd
- `OK`

## godot/client/app/nuclear_gate.gd
- `OK`

## godot/client/app/nuclear_model.gd
- `OK`

## godot/client/app/operator_dock.gd
- `OK`

## godot/client/app/operator_dock_menu.gd
- `OK`

## godot/client/app/operator_dock_model.gd
- `OK`

## godot/client/app/operator_screen_model.gd
- `QUALITY` godot/client/app/operator_screen_model.gd:38 — `should_auto_open(rect, port, screen_count)`: the only production caller (main.gd:466) always passes `null` for `port`, so the parameter is vestigial; the real "no operator port flagged" test lives in boot_question.gd:39 (`r.data.get("port") == null`). Two places encode the same rule; drop the parameter or move the check here.

## godot/client/app/operator_screen_picker.gd
- `OK`

## godot/client/app/perf_overlay.gd
- `OK`

## godot/client/app/perf_overlay_model.gd
- `QUALITY` godot/client/app/perf_overlay_model.gd:57 — the doc comment lists a `static_mem` key for `client_rows()`; nothing produces or reads it (perf_overlay.gd `_sample_client` builds fps, frame_ms, render_*_ms, draw_calls, objects, vram, cpu_pct, rss). Stale comment.

## godot/client/app/perf_probe.gd
- `OK`

## godot/client/app/preset_e2_probe.gd
- `OK`

## godot/client/app/project_load_dialog.gd
- `OK`

## godot/client/app/shell.gd
- `OK`

## godot/client/app/stick_dialog.gd
- `OK`

## godot/client/app/theme_builder.gd
- `DEAD` godot/client/app/theme_builder.gd:20 `PANEL_W := 260` — unused. grep: `grep -rn "PANEL_W" godot tools scripts` → only the definition.
- `QUALITY` godot/client/app/theme_builder.gd:32-36 — wrong theme item names for `TabBar`: `font_color` (lines 32, 34) and `font_hover_color` (line 36) are not TabBar items (TabBar uses `font_unselected_color`, `font_hovered_color`, `font_selected_color`), so those three calls do nothing; the intended "unselected tabs muted" (line 34) is therefore not applied by this theme. Note also that every tab strip in the client is a `TabContainer` (shell.gd, settings_tab.gd, media_panel.gd, shader_fx_dialog.gd), which pushes its own `TabContainer`-type styles onto its inner bar, so the `tab_selected/unselected/hovered` TabBar styleboxes (lines 44-46) may not reach them either — not provable without a render; check with a render probe before relying on them.

## godot/client/app/ui_icons.gd
- `OK`

## godot/client/app/window_placement.gd
- `OK`
