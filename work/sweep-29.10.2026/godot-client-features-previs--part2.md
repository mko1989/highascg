# godot/client/features/previs (part 2) — sweep 29.10.2026 (batch 034)

Files: 30 · lines: 6996 · findings: 0 BUG-HIGH, 4 BUG, 6 DEAD, 6 RISK, 15 QUALITY

Notes for the owner:
- `core/numeric_field.gd` `install()` (called from `app/shell.gd:49`) sets `select_all_on_focus = true` and `update_on_text_changed = false` on every SpinBox/LineEdit the tree gains. RULES.md input rules 1 and 2 are therefore met globally. The per-site `update_on_text_changed = true` lines below are overridden (QUALITY only), and "half-typed value is applied on every keystroke" is not a live problem.
- Test-only means the only references are `godot/client/tests/*.gd`.

## godot/client/features/previs/mvr_screens.gd
- `OK` Read in full. Selection, Map, `_build` and `_save_hidden` are consistent. `_save_hidden` returns early when `project.previs.mvr` is empty, after `_map` has already written `previs.stage`. A selection needs a loaded scene, so that state is not reachable.

## godot/client/features/previs/mvr_section.gd
- `RISK` godot/client/features/previs/mvr_section.gd:193-197 — `_on_pick` builds a fresh `c = {id, name, hidden_layers}` and, for the "shown scene again" branch, saves it. That replaces the whole `previs.mvr` slice and drops `place`, `layer_colors`, `hidden_objects` and `unpatched`. Dropping `hidden_objects` un-hides the MVR objects that LED screens replaced, so the picture doubles. Not reachable with a stock OptionButton, which emits `item_selected` only when the index changes, but the branch exists for exactly that case (its comment says "the shown scene again"). Fix: start from `_cfg().duplicate(true)` in that branch.
- `RISK` godot/client/features/previs/mvr_section.gd:264-270 — `_remove()` awaits `Api.delete_json("/api/stage/mvr/<id>")` and ignores the result. Failing case: server unreachable or the DELETE returns 4xx/5xx. The project still `_drop()`s the scene's fixtures and walls and `_save({})`, and the list refresh then shows the scene still on the box. No message is shown. Fix: check `res.ok`, and on failure show the error in `_status` and skip `_drop`/`_save`.
- `QUALITY` godot/client/features/previs/mvr_section.gd — 498 lines, so it is two lines under the CI-enforced 500 limit. The next edit forces a split.

## godot/client/features/previs/previs_stage.gd
- `BUG` godot/client/features/previs/previs_stage.gd:101-110 — `fly_to_preset` tweens `Vector3(_yaw, _pitch, _dist)` linearly to the preset, but `_yaw` is unbounded (`handle_input` does `_yaw -= relative.x * 0.005` with no wrap). Failing case: orbit about 2400 px sideways (`_yaw` ≈ 12 rad), then click "Front" (yaw 0). The camera spins about 2 turns in 0.5 s instead of taking the short way. Fix: wrap the start yaw into -PI..PI, or `lerp_angle` towards the target, before the tween.
- `QUALITY` godot/client/features/previs/previs_stage.gd:113 — `led_material` is `static` but only used inside this file (grep for `led_material`: previs_stage.gd:89, 98, 113, plus `_led_material` in spikes/m0, which is a different function). Harmless.

## godot/client/features/previs/previs_tab.gd
- `BUG` godot/client/features/previs/previs_tab.gd:294-320 — `_unhandled_key_input` is gated only on `is_visible_in_tree()`, not on `mode == "3d"`. Delete/Backspace calls `stage_panel.delete_selected()` and the nudge keys reach `move_drag.key()` in Camera mode too (`markers.driving` swallows the arrows only in the markers/follow/zones/detect sub-modes). Failing case: select an LED wall in 3D, switch to Camera, focus the markers list and press Delete or Backspace. The wall is removed from the project and autosaved. There is no confirmation for stage objects (`stage_panel.delete_selected` → `_delete`), and the wall is not visible in the side column. In the other Camera sub-modes the arrow keys, Q/E and PageUp/PageDown silently move the hidden selection. Fix: `if mode != "3d": return` at the top, except for the `markers.driving` arrow case.
- `RISK` godot/client/features/previs/previs_tab.gd:120-130 — each `markers.updated` rebuilds the Markers, Follow and Zones sections: `track_page.markers.refresh()`, `track_page.follow.refresh()`, `track_page.zones.refresh()`. `updated` fires from `_move` on every frame during a drag and on every `tracking:markers` WS broadcast (`marker_driver.gd:281, 353`). `follow_section.refresh()` clears and refills an ItemList and an OptionButton and calls `_output.show_output` (clears the interface OptionButton) and `_calib.refresh()` each time. While a person is tracked, or a marker is dragged, with the Follow page open, those widgets are rebuilt at broadcast rate, which is wasteful. An open dropdown (Follows, Interface) may close or flicker. Not run live. Fix: refresh only the live-state widgets on `updated`, and rebuild lists only when the data changed.
- `QUALITY` godot/client/features/previs/previs_tab.gd:477-478 — the models ItemList connects both `item_activated` and `item_selected` to `load_model`. A double-click selects (load) and then activates (load again), so the GLB is downloaded and parsed twice and the first model is freed straight away. Fix: connect only `item_selected`, or only `item_activated`.
- `QUALITY` godot/client/features/previs/previs_tab.gd — exactly 500 lines, zero headroom under the CI limit.

## godot/client/features/previs/previs_uv_mapper.gd
- `DEAD` godot/client/features/previs/previs_uv_mapper.gd (whole file) — no production consumer. grep `uv_mapper|UvMapper` over godot (.gd/.tscn/.cfg/.json), tools, scripts, .github, src → only the file itself and `godot/client/tests/test_previs_uv_mapper.gd`. WO-614's `stage_objects.uv_rect` plus `led_screen.gdshader` replaced the WO-607 T2 port. It is a 1:1 port of `client/lib/previs-uv-mapper.js`, kept alive by its own test. Recommend deleting both, or keeping them deliberately.
- `DEAD` godot/client/features/previs/previs_uv_mapper.gd:109 `rotate_2d()` — no references anywhere, not even in the test (`grep -rn rotate_2d godot tools` → definition only).

## godot/client/features/previs/projector_beams.gd
- `OK` Read in full. `shared()`, `checkbox()` (previs_tab.gd:400) and `changed` (stage_builder.gd:27) are all live.

## godot/client/features/previs/stage_builder.gd
- `QUALITY` godot/client/features/previs/stage_builder.gd:84-87 — the doc comment "World-space bounds of everything built (for camera framing)." sits above `front_yaw()`, and `bounds()` (line 97) has none. It looks like a stale paste. Move it.
- `QUALITY` godot/client/features/previs/stage_builder.gd:61-70 — `remove()` never refreshes the selection wireframe (`_sel_box`). It is the second half of the stage_panel.gd `_delete` bug below, and the box also stays when `remove` is called with the selected id. Fix: in `remove`, call `_update_highlight.call_deferred()` when `id == selected_id`.

## godot/client/features/previs/stage_objects.gd
- `DEAD` godot/client/features/previs/stage_objects.gd:225 `projector_world_xz()` — test-only. grep: `godot/client/tests/test_stage_objects.gd:104` plus the definition. The 2D plan view was removed in WO-621.
- `QUALITY` godot/client/features/previs/stage_objects.gd:300-304 — `array_copies` names copies `"%s %d" % [base_name, i + 1]`, but `base_name` is only trimmed of a trailing " 1". Failing case: Duplicate (stage_panel `_duplicate` → `array_copies(o, 1, …)`) on an object named "LED wall 2" gives "LED wall 2 2". On "TV 1" it gives "TV 2" even if a "TV 2" already exists. Names need not be unique, but the list becomes ambiguous.

## godot/client/features/previs/stage_panel.gd
- `BUG` godot/client/features/previs/stage_panel.gd:213-220 — `_delete()` sets `_selected = ""` but never emits `selection_changed("")`, and `builder.remove()` does not refresh the highlight. `previs_tab.gd:166` forwards only that signal to `builder.set_selected`. Failing case: select an LED wall (blue selection wireframe appears), press Delete or the Delete button. The object disappears, but `builder.selected_id` stays and the top-level `_sel_box` wireframe stays drawn in the air where it was, until the next selection. Fix: call `selection_changed.emit("")` in `_delete` (or `_select("")`).
- `RISK` godot/client/features/previs/stage_panel.gd:96-99 and 88-91 — `_load_dests()` keeps every destination, including `mode == "operator_gui"`. The "Sized from a screen destination" menu then offers it, and `S.from_destination` binds the object to `pgm<mainScreenIndex+1>`. `_role_raster` (line 146) and `mvr_screens.gd:135` both exclude `operator_gui`, and the operator surface is role `opgui`. Failing case: an Operator GUI destination at mainScreenIndex 0 produces a "→ LED wall" entry whose object shows pgm1 instead of the operator output. Fix: apply the same `operator_gui` filter in `_load_dests`.
- `QUALITY` godot/client/features/previs/stage_panel.gd:375 — `sb.update_on_text_changed = true` is overridden to false by `NumericField.prepare` when the SpinBox enters the tree (`core/numeric_field.gd:69`). It is dead and misleading. Same pattern in follow_section.gd:95, detect_section.gd:205 and follow_output.gd:176.

## godot/client/features/previs/tracking/air_rules_block.gd
- `OK` Read in full. The `zone_model` helpers it uses (`normalize_air`, `new_air_rule`, `action_error`, `AIR_HINT`) exist. Row rebuild versus in-place update is consistent with the index-bound closures.

## godot/client/features/previs/tracking/auto_overlay.gd
- `OK` Read in full. `adopt` is only called after `_ready`. The two instances (Live, Previs) intentionally share the static `collapsed`.

## godot/client/features/previs/tracking/auto_overlay_model.gd
- `OK` Read in full. Pure functions, all used by auto_overlay.gd or covered by tests.

## godot/client/features/previs/tracking/calibrate_section.gd
- `QUALITY` godot/client/features/previs/tracking/calibrate_section.gd:112-113 — the doc comment "Is the shown fixture being calibrated (a camera click then means 'the beam is here')?" is stuck on `end()`, below the new "WO-700 R7: end the open session" comment. It belongs on `is_open()` (line 118).

## godot/client/features/previs/tracking/camera_model.gd
- `DEAD` godot/client/features/previs/tracking/camera_model.gd:45 `vfov_to_hfov()` — test-only. grep: `tests/test_tracking_camera.gd:40` plus the definition. The production code only uses `hfov_to_vfov`.

## godot/client/features/previs/tracking/camera_overlay.gd
- `OK` Read in full. `material`, `set_opacity`, `set_active` and `set_camera` are all used by tracking_view.gd (lines 101, 106, 110).

## godot/client/features/previs/tracking/camera_refine.gd
- `BUG` godot/client/features/previs/tracking/camera_refine.gd:42-44 (and 189-191) — `refine()` is documented "{} when the normal equations stay singular" but always returns `_with(cam, x)`, never `{}`. So the `out.is_empty()` branch in `calibrate()` ("the points do not determine a camera (collinear…)") can never run. Failing case: 4+ clicked points that are collinear or all at one spot. Every `Hg._solve` returns `[]`, the loop breaks with `improved == false`, and `refine` returns the unrefined start camera. `calibrate` then returns `ok: true` with a huge rms, and `tracking_page.solve()` (line 276-286) writes `c.cam = r.cam; c.rms = r.rms` and shows "RMS … px" instead of "Not solved". Fix: track whether any step was ever solved/accepted, and return `{}` when none was.
- `QUALITY` godot/client/features/previs/tracking/camera_refine.gd:166 — calls `Hg._solve`, an underscore-private function of another script. Make it public (`solve_linear`) or move it.

## godot/client/features/previs/tracking/coverage_3d.gd
- `OK` Read in full. Cell and outline rebuild is keyed correctly, and `_bit` and `_bits` are safe because there are at most 31 cameras.

## godot/client/features/previs/tracking/coverage_model.gd
- `DEAD` godot/client/features/previs/tracking/coverage_model.gd:19 `sees()` — test-only. grep: `tests/test_tracking_coverage.gd:39` plus the definition. The production code calls `seen()` directly.

## godot/client/features/previs/tracking/detect_model.gd
- `OK` Read in full.

## godot/client/features/previs/tracking/detect_section.gd
- `QUALITY` godot/client/features/previs/tracking/detect_section.gd:205 — `sb.update_on_text_changed = true` is overridden to false by `NumericField` (see stage_panel.gd note), so it is dead and misleading.

## godot/client/features/previs/tracking/follow_model.gd
- `RISK` godot/client/features/previs/tracking/follow_model.gd:263 — `new_fixture` sets `fx.address = mini(512, last.address + max(footprint, type_fp))`. Failing case: the last fixture is at address 500 with a 20-channel footprint. The new fixture lands at 512 and spans 512-531, past the universe end, instead of rolling to the next universe or address 1. The patch accepts address ≤ 512, so nothing flags it. Fix: when the sum exceeds 513 - footprint, bump the universe and reset the address to 1.

## godot/client/features/previs/tracking/follow_output.gd
- `QUALITY` godot/client/features/previs/tracking/follow_output.gd:176 — `update_on_text_changed = true` is overridden by `NumericField` (dead).

## godot/client/features/previs/tracking/follow_section.gd
- `RISK` godot/client/features/previs/tracking/follow_section.gd:205-226, 238-248 — `refresh()` fully rebuilds the ItemList and the "Follows" OptionButton, and re-runs `_output.show_output` and `_calib.refresh()`. previs_tab.gd:126 calls it on every marker-driver `updated` (see the previs_tab.gd RISK). Not run live.
- `QUALITY` godot/client/features/previs/tracking/follow_section.gd:95 — `update_on_text_changed = true` is overridden by `NumericField` (dead).

## godot/client/features/previs/tracking/ghost_row.gd
- `OK` Read in full.

## godot/client/features/previs/tracking/homography.gd
- `QUALITY` godot/client/features/previs/tracking/homography.gd:96 — the literal `fov < 10.0 or fov > 170.0` duplicates `POSE_FOV_RANGE` (line 13), which is used a few lines below for the clamp. Use the constant.

## godot/client/features/previs/tracking/marker_driver.gd
- `DEAD` godot/client/features/previs/tracking/marker_driver.gd:47, 311 `follow_on` and 49, 321 `zones_on` — assigned from the server snapshots but never read. grep `follow_on|zones_on` over godot/client (including tests) → only these definitions and assignments. (`zones_seen` is read in zones_section.gd:241.) Remove both, or use them in the UI.

## godot/client/features/previs/tracking/marker_input.gd
- `QUALITY` godot/client/features/previs/tracking/marker_input.gd:69 — `step_speed`: `0.1 if speed <= 4.0 else 0.5`. SPEED_MAX is 3.0 and the result is clamped, so the 0.5 branch is unreachable. It is left over from OpenFollow's larger range.

## godot/client/features/previs/tracking/markers_section.gd
- `OK` Read in full. `_rename` fires twice (text_submitted then focus_exited) but is guarded by `v == cur.name`.

## godot/client/features/previs/tracking/mask_section.gd
- `OK` Read in full.

## godot/client/features/previs/tracking/person_cards.gd
- `OK` Read in full. The `_probe` dev helper (lines 258-296) follows the repo's `--probe-*` convention. The dummy mesh is cached (`person_dummy_mesh.gd:22`).
