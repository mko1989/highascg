# godot/client/features/live — sweep 29.10.2026 (batch 030)

Files: 50 · lines: 6976 · findings: 0 BUG-HIGH, 4 BUG, 4 DEAD, 10 RISK, 11 QUALITY

## godot/client/features/live/lower_third_model.gd
- `QUALITY` godot/client/features/live/lower_third_model.gd:61-63 — the doc comment `## JS truthiness for JSON values.` sits above `_jsv()` (which is the "integral → int" helper) and `_truthy()` (line 67) has none; the two comments are shifted by one function. Fix: move the first line down onto `_truthy`.
- `QUALITY` godot/client/features/live/lower_third_model.gd:57,63 — `_js_num` / `_jsv` are underscore-private but lower_third_section.gd:131 calls `LT._jsv(v)`. Rename to a public name (or add `LT.json_num`). grep: `grep -rn "_jsv" godot` → model def + section call.
## godot/client/features/live/lower_third_section.gd
- `BUG` godot/client/features/live/lower_third_section.gd:43-53 — `show_layer()` overwrites `_scene_id`, `_main`, `_layer` (lines 43-45) BEFORE it flushes the pending debounced update (lines 50-52), so `_flush()` → `_post("update")` (line 62) sends the OLD layer's `_cfg` with the NEW layer's `layerNumber`/`sceneId`. Failing case: a look with two loaded lower thirds on layers 3 and 5; type a Title on layer 3 and click layer 5 within 450 ms → POST /api/scene/lower-third `{layerNumber:5, action:"update", config:<layer 3 text>}`; src/api/routes-scene-lower-third.js:50-95 resolves layer 5, builds the payload from `b.config` and does a CG UPDATE on layer 5 (edit bus), so layer 5 on PRV shows layer 3's text and layer 3's own CG never gets its update (the stored config is fine: `_change` already emitted the patch). Fix: flush before reassigning the fields (move the `if not _timer.is_stopped()` block above line 43), or capture scene/layer in `_flush`.
- `RISK` godot/client/features/live/lower_third_section.gd:177 — `_act()` writes `_status.text` after two awaits; if the operator selects another layer meanwhile, `show_layer()` queue_free()s the old children (line 54-56) and `_build()` assigns a new `_status`, but a request in flight from the OLD build resumes with `_status` pointing at the new label (wrong layer's status line), and if the new layer is not a lower third `_status` is a freed object → "Invalid assignment on freed object". Fix: check `is_instance_valid(_status)` and that `_key` is unchanged after the awaits.
## godot/client/features/live/lt_presenters_model.gd
- `OK`
## godot/client/features/live/lt_roster_model.gd
- `RISK` godot/client/features/live/lt_roster_model.gd:85 — `normalize()` names a blank row key with `_safe_header(k, 0)`, i.e. always "Column 1", while the header list names blank header i as "Column i+1" (line 79). A sheet with a blank header in the 4th column gets header "Column 4" but its row cells under "Column 1" (and collide with a real first blank column) → that column shows empty in the picker. Only reachable if the server hands over blank keys (the shared JS lib normally names them first), hence RISK. Fix: key rows by position the same way as headers.
## godot/client/features/live/lt_roster_section.gd
- `RISK` godot/client/features/live/lt_roster_section.gd:139-140 — `_render_table()` re-selects the remembered row with `it.select(0)` on every filter keystroke / mapping change. In the engine `TreeItem.select()` goes through `Tree::item_selected` and emits `item_selected`, which is connected to `_on_pick` (line 59) → `row_picked` → lower_third_section.gd:112 `pick` overwrites Title and Subtitle (and posts a CG update). Failing case: pick a row, hand-edit the Title, then type in "Filter rows…" → Title is reset to the picked row. Not run live (no GUI allowed); verify before fixing. Fix: block the signal while rebuilding (`_table.item_selected.disconnect/connect`, or a `_rendering` flag in `_on_pick`).
- `QUALITY` godot/client/features/live/lt_roster_section.gd:135 — `rows.find(row)` per visible row is O(n²) deep Dictionary comparisons for a big sheet, and identical rows resolve to the first index. Have `R.filter_rows` return indices instead.
## godot/client/features/live/media_add_menu.gd
- `OK`
## godot/client/features/live/media_download.gd
- `RISK` godot/client/features/live/media_download.gd:37-63 — `ask()` checks `active()` only when the dialog opens; `_start()` (line 63) does not re-check. Open "Download to this computer…" on two files before choosing a path in either dialog, confirm both: the second `_start` overwrites `_http`/`_tick`/`_dest`/`_name` while the first request still runs; the first completion then calls `_finish()` which frees the SECOND request's nodes and, on failure, deletes the wrong `_dest`. Fix: `if active(): return` at the top of `_start`.
## godot/client/features/live/media_hap_dialog.gd
- `OK`
## godot/client/features/live/media_ingest.gd
- `DEAD` godot/client/features/live/media_ingest.gd:42 `busy()` — unused in production. grep: `grep -rn "\.busy(\|Ingest.busy" godot` → only godot/client/tests/test_media_ingest.gd:24 (test of the helper itself); media_panel.gd uses `status_text` only.
## godot/client/features/live/media_inspector.gd
- `BUG` godot/client/features/live/media_inspector.gd:166-181 — the In/Out fields commit on EVERY `focus_exited` (and Enter), not only when the text changed (the web uses the `change` event, client/components/inspector-media-file-library.js:89-90), and the text shown is `format_timecode` (m:ss.FF, FF = FRAMES) while `parse_time_input` reads the part after the dot as decimal seconds. Failing case: stored trimInMs = 1200 at 25 fps → field shows `0:01.05` (30 frames → s=1, ff=5); click into the field and Tab/click away without typing → `parse_time_input("0:01.05")` = 1.05 s → `_save({trimInMs: 1050})` → the trim silently moves 150 ms earlier (every blur shifts it again for most values; ff and decimal parts only agree when the value is a whole second). Also reachable by merely clicking another file in the tree while a trim field has focus. Fix: remember the text set by `_sync()` and skip the save when `e.text` is unchanged; ideally make the parser read `.ff` as frames (or show decimal seconds) so the display round-trips.
- `RISK` godot/client/features/live/media_inspector.gd:124-128 — `show_media()` leaves the previous file's `_lib` panel (trim fields, mute, usage, versions) visible and editable until the `/api/media/library/entry` reply arrives (`_lib.visible` is only reassigned at line 128), while `id` is already the new file. A trim edit in that window is POSTed (`_save`, line 189) against the NEW `id` with a value typed against the old file's clip. One HTTP round trip wide; hide `_lib` at the top of `show_media`.
## godot/client/features/live/media_math.gd
- `OK`
## godot/client/features/live/media_ops.gd
- `OK`
## godot/client/features/live/media_panel.gd
- `QUALITY` godot/client/features/live/media_panel.gd:1-498 — 498 of the 500 allowed lines (tools/ci/check-max-file-lines.js); the next feature in this file breaks CI. Candidates to split out: `_tree_input`/menu code (227-260), `_ingest`/`_download` (423-466).
- `QUALITY` godot/client/features/live/media_panel.gd:391 — one blank line between `_build_effects` and `_drag_data` (everything else uses two).
## godot/client/features/live/media_preview.gd
- `BUG` godot/client/features/live/media_preview.gd:177-199 — `_process()` runs an optimistic local play state against OSC `paused` with no allowance for latency: line 198 `if ly.paused is bool and ly.paused == _playing: _set_playing(not ly.paused)`. (a) Press ▶: `_toggle` sets `_playing = true` and POSTs; the next frame OSC still says `paused = true` → `true == true` → `_set_playing(false)`; the button flips back to ▶ and forward again when Caspar's OSC catches up (flicker for the HTTP+OSC round trip). (b) At the trim Out (line 195-197) it sets `_playing = false` and POSTs `pause`, but the same frame OSC still says `paused = false` → `false == false` → `_set_playing(true)`; next frame `_playing and pos >= out` is true again → another `pause` POST, repeated every frame until OSC reports paused (several duplicate POSTs). Fix: ignore OSC `paused` for ~300 ms after a local toggle/pause, or compare against the last state OSC itself reported.
- `RISK` godot/client/features/live/media_preview.gd:94-104 — `stop_preview()` clears `_id` first and then awaits `_report(false)` + the `stop` POST; a `start()` for another clip in that window sees `_id == ""`, skips its own `await stop_preview()` and POSTs `load`, after which the earlier call's trailing `stop` POST lands and kills the new preview. Reached by hiding the inspector (visibility_changed → un-awaited stop, line 54-56) and selecting another movie within ~2 round trips. Serialise stop/start with a pending-stop flag.
## godot/client/features/live/media_rename_dialog.gd
- `OK`
## godot/client/features/live/media_selection_bar.gd
- `OK`
## godot/client/features/live/media_versions.gd
- `OK`
## godot/client/features/live/mixer_math.gd
- `OK`
## godot/client/features/live/osc_mirror.gd
- `OK`
## godot/client/features/live/param_field.gd
- `OK`
## godot/client/features/live/pgm_timer_model.gd
- `DEAD` godot/client/features/live/pgm_timer_model.gd:17 `format_hmsf()` — no production caller (pgm_timer_view.gd and the compose tiles use `format_mmss`). grep: `grep -rn "format_hmsf" godot tools src client` → definition + godot/client/tests/test_transitions_timer.gd:33 only. Keep only if the golden test is wanted for a future HH:MM:SS:FF readout; otherwise delete both.
## godot/client/features/live/pgm_timer_view.gd
- `OK`
## godot/client/features/live/pip_model.gd
- `OK`
## godot/client/features/live/pip_section.gd
- `OK`
## godot/client/features/live/placeholders_model.gd
- `OK`
## godot/client/features/live/placeholders_panel.gd
- `OK`
## godot/client/features/live/playlist_edit_model.gd
- `OK`
## godot/client/features/live/playlist_section.gd
- `RISK` godot/client/features/live/playlist_section.gd:144-165 — `_edit()` awaits the POST and then emits `patch` for the layer it was started on, but layer_inspector.gd:87 forwards the patch to look_editor `_apply_layer()` (look_editor.gd:336-341) which merges it into whichever layer is selected NOW. Failing case: drag-reorder an item on layer 2 and click layer 4 before the reply arrives (tens of ms) → `{playlist: …layer 2…}` is merged into layer 4 and pushed to PRV. Fix: drop the reply when `scene_id`/`_layer.layerNumber` changed during the await (compare before `patch.emit`).
## godot/client/features/live/playlists_model.gd
- `OK`
## godot/client/features/live/playlists_panel.gd
- `RISK` godot/client/features/live/playlists_panel.gd:113-161 — the 2 s poll runs `_render()` which does `_list.clear()` / `_items.clear()` and re-adds every item even when nothing changed; with the Items/Playlists dropdown popup open (or being scrolled) the list is rebuilt under the cursor. Cache a signature of the rows (as source_list_panel.gd:60 does) and skip the rebuild when unchanged.
- `QUALITY` godot/client/features/live/playlists_panel.gd:196 — calls `M._num(...)`, an underscore-private helper of playlists_model.gd. Make it public (`num_text`).
## godot/client/features/live/preview_pusher.gd
- `DEAD` godot/client/features/live/preview_pusher.gd:18 `pushes` — written (line 45) but never read. grep: `grep -rn "\.pushes\|pusher\.pushes" godot tools` → no reader (tests use their fake's own `n`).
## godot/client/features/live/project_media_bar.gd
- `OK`
## godot/client/features/live/px_rect_math.gd
- `OK`
## godot/client/features/live/screen_timer_model.gd
- `OK`
## godot/client/features/live/screen_timer_panel.gd
- `BUG` godot/client/features/live/screen_timer_panel.gd:150-156 — `_apply()` always ends in `reload()`, which frees and rebuilds every section (lines 71-83). The form's X/Y px fields apply on `focus_exited` (screen_timer_settings.gd:67-70), so Tab from X to Y fires `_apply` → POST assign → `reload()` and the field the operator just tabbed into is destroyed ~2 HTTP round trips later: typed digits are lost / focus drops to nothing. Failing case: open a deck column's timer page, type 100 in "Position px X", press Tab, type 200 → Y never receives it (and the intermediate `{posX:100, posY:""}` is saved). The Timers dock handles the same form correctly by not rebuilding while a field has focus (timers_dock.gd:101-109 `editing()`); the 5 s poll here also checks focus (line 48) but `_apply`/`_post` do not. Not run live. Fix: skip the rebuild while a field inside `_list` has focus (reuse the dock's `editing()` rule), or update records in place.
- `QUALITY` godot/client/features/live/screen_timer_panel.gd:138-140 — the opacity HSlider commits only on `drag_ended`; keyboard/wheel changes (value_changed without a drag) are never sent, yet the tooltip updates only on drag end too. Use the debounced `slider()` of shader_live_controls.gd or connect `value_changed` with a short timer.
- `DEAD` godot/client/features/live/screen_timer_panel.gd:9 `signal closed` — emitted at line 36 but never connected. grep: `grep -rn "closed.connect\|timers.closed" godot/client` → nothing (live_tab.gd:109-110 only calls `timers.open`). The ✕ already hides the page itself.
## godot/client/features/live/screen_timer_settings.gd
- `QUALITY` godot/client/features/live/screen_timer_settings.gd:67-70 — `apply_px` is connected to BOTH `text_submitted` and `focus_exited`, so Enter then leaving the field posts the same assign (one per screen) twice, each followed by a full list reload in screen_timer_panel.gd. Apply only when the pair of values changed (see the BUG at screen_timer_panel.gd:150).
## godot/client/features/live/shader_fx_dialog.gd
- `OK`
## godot/client/features/live/shader_fx_model.gd
- `OK`
## godot/client/features/live/shader_fx_params.gd
- `OK`
## godot/client/features/live/shader_live_controls.gd
- `QUALITY` godot/client/features/live/shader_live_controls.gd:64-65 — the ≋ button is created with a `func() -> void: pass` callback and then gets its real handler via a second `pressed.connect` so the lambda can capture `w`. Create it with a throw-away callable only because `tool_btn` requires one; give `tool_btn` an optional `cb` or connect afterwards without the dummy.
## godot/client/features/live/shader_live_model.gd
- `OK`
## godot/client/features/live/shader_live_panel.gd
- `OK`
## godot/client/features/live/shader_live_stack.gd
- `OK`
## godot/client/features/live/shm_sources_model.gd
- `OK`
## godot/client/features/live/source_list_panel.gd
- `RISK` godot/client/features/live/source_list_panel.gd:87,114-125 — `rebuild()` sets `head.collapsed` programmatically for every remembered-closed group; `TreeItem.collapsed` emits `item_collapsed` on change, which is connected to `_on_collapsed`, so each rebuild that has closed groups does a ConfigFile load + save of user://ui.cfg per group (same values written back). Rebuilds are frequent (Store.project_changed for Timelines, filter typing). Guard with a `_building` flag. Not verified at runtime.
## godot/client/features/live/source_lists_model.gd
- `OK`
## godot/client/features/live/template_section.gd
- `OK`
## godot/client/features/live/timers_dock.gd
- `OK`
## godot/client/features/live/timers_dock_model.gd
- `RISK` godot/client/features/live/timers_dock_model.gd:61-67 — `commit_time()` compares the 24 h-wrapped display text, so a duration above 24 h is dropped or mis-shown. Failing case: stored durationSec 7200 (shows `02:00:00`); type `26:00:00` → patch.durationSec = 93600 but `shown = seconds_to_clock_text(93600) = "02:00:00"` equals the current value → returns `{}`, nothing saved, field snaps back. From stored 3600 the same input saves 93600 but displays `02:00:00` forever. The settings form allows up to 99 h (screen_timer_settings.gd:23), so the two editors disagree. Matches the web port, so either document the 24 h cap or compare numeric seconds.
## godot/client/features/live/transition_row.gd
- `QUALITY` godot/client/features/live/transition_row.gd:28,25 — reaches into transitions.gd privates `T._js_round` and `T._num_or_zero`. Expose public wrappers.
- `QUALITY` godot/client/features/live/transition_row.gd:41-42 — `max_frames` is applied only when `_build()` runs on the first `setup()`; setting `max_frames` after the first `setup` (it is a plain public var) is silently ignored. timeline_dest.gd:34 sets it before `setup`, so it works today.
