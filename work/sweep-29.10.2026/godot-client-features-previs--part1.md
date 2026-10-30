# godot/client/features/previs (part 1: color_rows, fixtures/*, fold_section, glb_screens_model, haze, model_tint, move/*, mvr_*) — sweep 29.10.2026 (batch 033)

Files: 41 · lines: 6845 · findings: 0 BUG-HIGH, 5 BUG, 2 DEAD, 5 RISK, 10 QUALITY

Method: every file read in full. Dead-code pass: every `func` / `signal` / `const` / member `var` of all 41 files was grepped across `godot tools scripts src` (`*.gd *.tscn *.js *.sh`), tests counted as live per the contract. No unused function, signal or const turned up. Every file is referenced from a production caller or a `preload`, so no dead file either. Two write-only member vars were found (pixel_map_rows.gd).
RULES.md check: `core/numeric_field.gd` (installed by `app/shell.gd:49`) puts select-on-focus and `+ - * /` maths on every SpinBox / LineEdit in the tree. The SpinBoxes here that don't set `select_all_on_focus` (position_card.gd, dmx_monitor_window.gd) are covered, so no finding.
Linked-servers rule: the only origin used is `Config.origin` (the local node), in `fixtures_section.gd` (GDTF upload) and `mvr_import.gd`. No finding.

## godot/client/features/previs/color_rows.gd
- `BUG` color_rows.gd:87 — `pick.popup_closed` emits `changed(name, pick.color)` unconditionally, even when the picker was opened and closed without touching it. For a row with no override the swatch shows `UNSET` (0.7 grey, line 39), so that grey is committed as a real override. Failing case: Previs → MVR → Layers, click the swatch of a layer with no colour set, press Esc → `changed("Layer", Color(0.7,0.7,0.7))` → `mvr_section._set_layer_color` (mvr_section.gd:277) → `Tint.with_color` stores `"#b3b3b3"` and saves. The layer is now a matte grey, double-sided override instead of the model's own materials, and the project is dirty. The same happens for a fixture type's "Body colour" via `fixtures_section._set_body`. Only the ↺ button undoes it. Fix: set a flag in `color_changed` and in `popup_closed` emit `changed` only if the flag was set, or only if `pick.color` differs from the colour the row was filled with.

## godot/client/features/previs/fixtures/aim_drag.gd
- `OK`

## godot/client/features/previs/fixtures/auto_groups_model.gd
- `BUG` auto_groups_model.gd:22-23 — `named[_type_name(types[t])] = t` keys the groups by display name. Two GDTF types whose fixtures share the same base name overwrite each other, and the earlier type's fixtures land in no "By position" group at all. Failing case: patch has fixtures "Spot 1", "Spot 2" with typeId A and "Spot 3", "Spot 4" with typeId B (for example one GDTF imported twice with different hashes, or a placeholder and its real type). `_type_name` gives "Spot" for both, `named = {"Spot": B}`, and the output has only B's row(s). "Spot 1/2" are in no By position group, and the "· all" group is missing them too. Fix: `named[name]` should collect all typeIds (concatenate their fixtures), or disambiguate with the typeId.
- `RISK` auto_groups_model.gd:106-109 — the `_ordered` comparator treats x within 0.15 m as equal and then orders by z/y. That is not transitive: x = 0, 0.1, 0.2 chain as "equal" while 0 < 0.2 by x. `sort_custom` then gives an order that depends on the input order for heads on a slightly skewed line. No crash, only an unstable left-to-right order of the group ids. Fix: bucket x to 0.15 m cells first, then sort by (bucket, -z, y).

## godot/client/features/previs/fixtures/calib_marks_3d.gd
- `OK`

## godot/client/features/previs/fixtures/calibrate_fold.gd
- `OK`

## godot/client/features/previs/fixtures/dmx_grid.gd
- `OK`

## godot/client/features/previs/fixtures/dmx_monitor_model.gd
- `QUALITY` dmx_monitor_model.gd:32 — `universe_label(protocol, int(u)) if protocol == "sacn" else str(int(u))` is just `str(int(u))`, because `universe_label` returns `str(u)` for sACN (line 13). The ternary and the `protocol` argument of `_unis` do nothing.

## godot/client/features/previs/fixtures/dmx_monitor_window.gd
- `QUALITY` dmx_monitor_window.gd:52 — `_universe.update_on_text_changed = true` has no effect: `NumericField.spin()` (core/numeric_field.gd:67, installed for every SpinBox that enters the tree) forces it back to `false` (RULES: commit on Enter / focus-out). The viewer therefore changes universe only on Enter / blur / arrows, not per keystroke as the line suggests. The same dead line exists in zones_section, detect_section, tracking_page, ptz_section, follow_output, follow_section and stage_panel. Drop it, or document that it is a no-op.

## godot/client/features/previs/fixtures/fixture_selection.gd
- `OK`

## godot/client/features/previs/fixtures/fixtures_3d.gd
- `BUG` fixtures_3d.gd:110 — a failed rig fetch is cached forever and nothing re-triggers a rebuild. `_rigs[k] = r.data if r.ok ... else {}`, and the next pass skips any `k` already in `_rigs` (line 104). `grep -n _rigs` shows no place that clears it. The server answers 404 for an unknown type (src/api/routes-fixture-types.js:53). Failing case: load a project whose patch has GDTF typeId T that is not on this box (a project moved between boxes, or a type removed with "Remove": the dialog says fixtures "stop output until it is imported again") → rig fetch 404 → `_rigs["T|mode"] = {}` → the operator imports T via "Import GDTF…" → the project JSON is unchanged, so `_on_project` returns at the `_key` compare (line 94) and even a forced rebuild would skip the cached `{}`. The heads stay missing until the client restarts. A transient network failure on the first fetch behaves the same. The same applies to `_meshes[mk] = null` (line 118) and the failed gobo image (`_gobos[key] = null`, line 455). Fix: do not store failures (or store a timestamp), and have fixtures_section.refresh_types / `mvr_section.types_changed` ask the rig to clear failed entries and rebuild.
- `QUALITY` fixtures_3d.gd:304-318 — in `hit()`, `var near := INF` and `var hit: Variant` shadow the methods `near()` and `hit()` of the same class. It compiles, but it is confusing next to `click()`/`near()` and silences nothing useful. Rename the locals (`best_d`, `t`).

## godot/client/features/previs/fixtures/fixtures_3d_model.gd
- `OK`

## godot/client/features/previs/fixtures/fixtures_model.gd
- `OK`

## godot/client/features/previs/fixtures/fixtures_section.gd
- `QUALITY` fixtures_section.gd:455-458 — `_remove()` awaits `Api.delete_json("/api/fixtures/types/" + id)` and ignores the result. A failed delete (server error, type in use) shows nothing: the list is refreshed and the type is simply still there, with no message in `_status`. Show `res.error` in `_status` as `_import` does.

## godot/client/features/previs/fixtures/fixtures_watch.gd
- `OK`

## godot/client/features/previs/fixtures/look_fixtures_model.gd
- `OK`

## godot/client/features/previs/fixtures/look_fixtures_store.gd
- `OK`

## godot/client/features/previs/fixtures/patch_edit_model.gd
- `OK`

## godot/client/features/previs/fixtures/patch_edit_section.gd
- `RISK` patch_edit_section.gd:13,48,75 — the mode list, the "(N ch)" footprint and `Apply` depend on `types`, which `fixtures_section` assigns later (fixtures_section.gd:258, after each `refresh_types`, including the `mvr_section.types_changed` ones from previs_tab.gd:474). `_fill()` only re-runs on `sel.changed`. After an Import / Replace / MVR patch with heads selected, the Mode dropdown and the channel count stay stale until the selection changes. If `/api/fixtures/types` failed (types == []), `Apply` runs `P.repatch` with `types = []`, so `M.fixture_footprint` falls back to the generic profile's `F.footprint` (highest pan/tilt/fixed offset). The overrun (> 512) and overlap checks then use footprints that are too small and can accept an overlapping re-patch. No failing run was reproduced. Fix: re-run `_fill()` when `types` is set (a setter), and refuse Apply while `types.is_empty()` for typed heads.

## godot/client/features/previs/fixtures/pixel_map_model.gd
- `OK`

## godot/client/features/previs/fixtures/pixel_map_proposal_model.gd
- `OK`

## godot/client/features/previs/fixtures/pixel_map_proposal_window.gd
- `OK`

## godot/client/features/previs/fixtures/pixel_map_rows.gd
- `DEAD` pixel_map_rows.gd:14 `_regions` — assigned in `set_regions` (line 95), never read. grep: `grep -wn _regions pixel_map_rows.gd` → only the declaration and the assignment; nothing outside the file reads it (`pixel_map_window` has its own `regions`).
- `DEAD` pixel_map_rows.gd:15 `_channel` — assigned in `set_regions` (line 96), never read. grep: `grep -wn _channel pixel_map_rows.gd` → declaration and assignment only. `set_regions` uses its own `ch` parameter.
- `QUALITY` pixel_map_rows.gd:13 — the comment on `_ui` lists `{region, order, swatch, error}`, but the dicts built at line 90 hold `{region, swatch, error}`. There is no `order` entry (the colour-order button is not kept).

## godot/client/features/previs/fixtures/pixel_map_view.gd
- `BUG` pixel_map_view.gd:151,157 — "a click without a drag draws nothing" only holds at low zoom. On a left press on empty picture `_press` sets `_rect = snap_rect(p, p, raster)` (a 1×1 channel-pixel rect). `_release` then emits `drawn` when that rect is ≥ 4 *view* px, and a whole channel pixel is ≥ 4 view px once `scale·zoom ≥ 4`. Failing case: raster 1920×1080 shown in a ~600 px-wide view (scale ≈ 0.31), wheel-zoom to ~13× or more (zoom is allowed up to 64×), then a plain click on an empty spot → `drawn(Rect2i(x, y, 1, 1))` → the window appends a new 1×1 px region "R<n>" (`pixel_map_window._on_drawn`, line 282) and selects it. Every click while zoomed creates one. Fix: decide from the mouse travel in view pixels (`at.distance_to(press_pos) >= 4`) rather than the snapped rect's size.

## godot/client/features/previs/fixtures/pixel_map_window.gd
- `OK`

## godot/client/features/previs/fixtures/programmer_groups_view.gd
- `OK`

## godot/client/features/previs/fixtures/programmer_model.gd
- `OK`

## godot/client/features/previs/fixtures/programmer_section.gd
- `BUG` programmer_section.gd:374-383 — `_thumb()` marks a thumbnail as "loading" by setting `_thumbs[key] = null` before the await. A second caller for the same key sees `_thumbs.has(key)`, skips the fetch, and immediately executes `b.icon = _thumbs[key]` = null. The button is never updated when the first fetch finishes (only the first caller's button gets the texture). Failing case: select heads → `_build_controls` creates the gobo buttons and starts the fetch for "typeId|gobo1"; before it completes (fetch time is a local HTTP round trip, but two `_on_selection` runs finish within it when selecting quickly or when a drag-aim fires `sel.aimed`) the controls are rebuilt → the new button for the same media gets a null icon, and its text is `""` because `media != ""` (line 361). The result is a blank, unlabelled gobo button until the next rebuild. The same happens for two slots in one wheel that share a media file. Fix: keep a `_thumb_wait[key] = [buttons]` list (as fixtures_3d `_gobo_wait` does), or `await` the pending request.
- `RISK` programmer_section.gd:190 — the features query puts every selected id in the URL: `"/api/fixtures/program/features?ids=" + ",".join(ids).uri_encode()`. MVR-patched heads have ids `mvr-<uuid>` (40 chars; 43 once the commas are encoded). Node's default max header size is 16 KiB and the server doesn't override it (`grep maxHeaderSize src` → nothing), so "All" with about 375 or more MVR heads exceeds it. The request should fail and the UI shows "Fixture engine not reporting — the Tracking module is off on the server." (line 197), which is misleading, and the controls vanish. Not run on a rig that large. Fix: POST the ids, or send a short selection token.
- `RISK` programmer_section.gd:217 — `_send` fires each coalesced write with `Api.post_json(...)` and doesn't await or sequence them. Two writes for the same fixture and attribute (slider drag at 20 Hz) go out as separate HTTP requests, so they may reach the server out of order and the stored final value can be an older one. Local-only and not reproduced.
- `QUALITY` programmer_section.gd:111,163 — with the "Groups" view visible, every `Store.project_changed` (including each colour-preview step and each head drag preview) runs `_fill_view()` → `Auto.by_position(_typed)` + `Auto.by_address(_typed)` before the Tree's own JSON key check can short-circuit. `_rows()` is O(n·rows·members) per type. Cache the result by a key of (typed ids, poses) or compare the key before computing.

## godot/client/features/previs/fixtures/replace_type_dialog.gd
- `OK`

## godot/client/features/previs/fixtures/replace_type_model.gd
- `OK`

## godot/client/features/previs/fixtures/rig_calibrate_fold.gd
- `QUALITY` rig_calibrate_fold.gd:29-63 — `_start` and `_box` both start visible (default `visible`), and `_render()` (which hides one of them) only runs after `await Api.get_json(PATH)`. Until the reply arrives, the "Calibrate the rig…" button and the empty step box (Beam is on…, Skip, Undo, …) are shown together. Call `_render()` once before the await.

## godot/client/features/previs/fold_section.gd
- `OK`

## godot/client/features/previs/glb_screens_model.gd
- `OK`

## godot/client/features/previs/haze.gd
- `OK`

## godot/client/features/previs/model_tint.gd
- `OK`

## godot/client/features/previs/move/move_drag.gd
- `OK`

## godot/client/features/previs/move/move_model.gd
- `OK`

## godot/client/features/previs/move/move_targets.gd
- `OK`

## godot/client/features/previs/move/position_card.gd
- `OK`

## godot/client/features/previs/mvr_export.gd
- `OK`

## godot/client/features/previs/mvr_import.gd
- `OK`

## godot/client/features/previs/mvr_model.gd
- `OK`

## godot/client/features/previs/mvr_scene.gd
- `RISK` mvr_scene.gd:35 — `show_scene(id)` returns at once when `id == scene_id`, and `scene_id` is set before the fetch (line 36), so a failed load (`loaded.emit({"error": ...})`, line 57) is never retried for the same id. Both callers are keyed on the config JSON (`mvr_section._maybe_reload`, mvr_section.gd:158-167, and `live_stage_3d._reload_mvr`, live_stage_3d.gd:70-77). After a transient failure of `GET /api/stage/mvr/<id>` (server restarting while the client is up) the stage stays empty, with only the error text, until the id changes or the client restarts. Not reproduced. Fix: reset `scene_id = ""` on the error path.
- `QUALITY` mvr_scene.gd:213-218 — `layer_of(uuid)` scans all children with `get_meta` per call. fixtures_3d calls it per patched head: `_build` (fixtures_3d.gd:173), `set_hidden_layers` (228), and via `color_of` → `head_color` in every `retint()` (232). `retint()` runs on each step of a layer-colour drag (`mvr_section.gd:80` → `scene.set_layer_colors` → `layer_colors_changed` → `fixtures_3d.set_layer_colors` → `retint`). With a 500-head rig on a 1,400-object scene that is roughly 700k iterations per drag step on the main thread (an estimate, not profiled). Cache a `uuid → layer` Dictionary when the scene loads.
- `QUALITY` mvr_scene.gd:341-346 — `_from_glb` duplicates `fixtures_3d_model.from_glb`, minus that one's WO-784 fallback (grey material for a glb with no materials). Two loaders to keep in sync; reuse one.
- `QUALITY` mvr_scene.gd:349 — member `var _check` is declared between functions, just above `_process`, instead of with the other members at the top.

## godot/client/features/previs/mvr_screen_model.gd
- `OK`
