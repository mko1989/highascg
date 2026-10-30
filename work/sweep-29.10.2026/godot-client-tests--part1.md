# godot/client/tests (part 1) — sweep 29.10.2026 (batch 040)

Files: 69 · lines: 6892 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 6 RISK, 12 QUALITY

## godot/client/tests/run_tests.gd
- `BUG` godot/client/tests/run_tests.gd:36 `quit(failures)` — the exit code is the failure count, and a process exit status is 8-bit. Failing case: a scratch project with this runner and one test making 256 failing `t.ok(false)` calls prints `[tests] 0 passed, 256 failed` and exits 0 (ran it: `exit=0`). CI step ci.yml:93 and `run-client.sh --test` judge only the exit status, so exactly 256/512/... failures goes green. Fix: `quit(1 if failures > 0 else 0)` (or `mini(failures, 255)`).
- `RISK` godot/client/tests/run_tests.gd:31 `suite.call(name)` is neither awaited nor guarded. (a) A runtime script error inside a test (null call, bad index) aborts the rest of that test; the runner only flags a test that ran zero assertions (:32), so one assertion before the error is enough to hide it. (b) A test that really suspends (`await` a timer/signal) returns to the runner at the first suspension; later asserts run after `quit()` or never. Proved in a scratch project: a test `t.ok(true); null.nope(); t.ok(false)` and a test `t.ok(true); await timer; t.ok(false)` give `[tests] 2 passed, 0 failed`, exit 0. Today it is latent: 10 test files use `await` but every awaited fake completes synchronously, and the live run is 22969 passed / 0 failed. Fix: `await suite.call(name)` and count engine script errors (or have each test end with an explicit `t.done()` sentinel the runner requires).
- `RISK` godot/client/tests/run_tests.gd:3 header documents the bare `godot --headless ... run_tests.gd`, and CI (.github/workflows/ci.yml:93) uses it, but on the box that shares the kiosk's user:// (only `run-client.sh --test` sets an isolated XDG_DATA_HOME, WO-753). Observed during this sweep: every headless run rotates `~/.local/share/godot/app_userdata/HighAsCG Operator/logs/godot.log` (the live GUI's log; several rotated copies at 22:04-22:26). Tests also write fixed names in user:// (`test_wo811_ui.cfg`, `test_wo811_tok/`, `test_wo802_ui.cfg`), so two parallel runs race. Fix: point the header at `run-client.sh --test` and/or set a temp `XDG_DATA_HOME` in the runner's documented command.
## godot/client/tests/shm_fake_writer.gd
- `OK` — helper, not a test file (name has no `test_` prefix, so the runner skips it). Live: loaded by tests/test_shm_reader.gd (grep `shm_fake_writer` over repo, excluding work/ and node_modules). Writes go to a caller-given path, no shared state.
## godot/client/tests/test_aim_drag.gd
- `OK` — both tests assert real outcomes (selection, active flag, `aimed` count, sent bodies).
## godot/client/tests/test_audio_actions.gd
- `QUALITY` godot/client/tests/test_audio_actions.gd:48 `t.ok(true, "no live state is fine")` can never fail. Its only value is the preceding `AA.patch_live_layer(null, 1, 10, {})` not crashing, and a crash is invisible to the runner (see run_tests.gd:31, the test already has earlier assertions). Fix: assert something observable, e.g. that the call returns/leaves the arguments unchanged.
## godot/client/tests/test_audio_dock.gd
- `OK` — loops over 4x3x2 row/screen/dense combos with per-case messages; source-text pins (`audio_tab.gd`, `audio_dock.gd`, `shell.gd` footer order) all matched at run time.
## godot/client/tests/test_audio_layer_levels.gd
- `RISK` godot/client/tests/test_audio_layer_levels.gd:112 `t.ok(proc.find("if not is_visible_in_tree():") < proc.find("_poll_layers()"), ...)` passes when the guard is deleted: `find` returns -1 for the missing guard and `-1 < index` is true. Failing case: remove the `if not is_visible_in_tree(): return` lines from `audio_tab.gd:_process` (currently :231-232) and this assertion still passes, so the 'no poll while hidden' guard is not actually pinned. Fix: also assert `proc.find("if not is_visible_in_tree():") >= 0`.
## godot/client/tests/test_audio_mixer.gd
- `OK` — golden-driven (tests/golden/audio_mixer.json); counts are asserted before the per-row loops, so a short result cannot pass.
## godot/client/tests/test_audio_monitor_pair.gd
- `OK`
## godot/client/tests/test_audio_screen_labels.gd
- `OK`
## godot/client/tests/test_audio_strip_dense.gd
- `OK` — measures real minimum widths; the `<= 64` assertion pins the custom minimum, not content.
## godot/client/tests/test_audio_tab_split.gd
- `OK` — the third test pins `audio_tab.gd` source text (kept live by the smoke-test convention).
## godot/client/tests/test_auth_wo811.gd
- `OK` — `A.password` is saved/restored around the mutation; the two user:// artefacts are removed (see run_tests.gd:3 for the shared-user:// caveat).
## godot/client/tests/test_auto_groups_model.gd
- `OK`
## godot/client/tests/test_auto_overlay_model.gd
- `OK`
## godot/client/tests/test_border_artnet_model.gd
- `OK`
## godot/client/tests/test_camera_overlay.gd
- `OK`
## godot/client/tests/test_client_prefs_global.gd
- `OK` — mutates the static `CP.node` / `CP._listeners` but `_reset()` is called first and last in every test that touches them; `write()` was checked to not post (only `post()` does).
## godot/client/tests/test_clip_trim_model.gd
- `OK` — the three tests that read `clip_trim_section.gd` as text (:115-:134) are deliberate source pins; they matched at run time.
## godot/client/tests/test_compose_auto_layout.gd
- `OK`
## godot/client/tests/test_compose_math.gd
- `OK` — 1e-12 tolerance against the node golden; both the fixed-ratio and free cases are covered.
## godot/client/tests/test_compose_times_model.gd
- `OK`
## godot/client/tests/test_connection_profiles_model.gd
- `QUALITY` godot/client/tests/test_connection_profiles_model.gd:1 the only test file in this batch (with test_glb_screens_model.gd and test_hardware_reconcile_model.gd) with no header comment naming the WO/module under test. Fix: add the usual `## WO-… — …` line.
## godot/client/tests/test_core.gd
- `QUALITY` godot/client/tests/test_core.gd:10-13 `test_config_origin_precedence` repeats assertions made again in test_connection_profiles_model.gd:44-47 (`resolve_origin` default/env/arg precedence) and test_devices_target.gd:53 (default origin). Three copies must all be edited when the precedence rule changes. Fix: keep the full precedence table in one file.
## godot/client/tests/test_countdown_model.gd
- `OK`
## godot/client/tests/test_crop_math.gd
- `OK`
## godot/client/tests/test_deck_model.gd
- `OK`
## godot/client/tests/test_demo_server.gd
- `OK` — `test_data_set_is_public_safe` scans every demo json (thumbs.json keys only) for IPs/paths/names; the `test_demo_phase2` it cites exists.
## godot/client/tests/test_devices_cable.gd
- `QUALITY` godot/client/tests/test_devices_cable.gd:68 COLOR_GOLDEN's first row `["", "#94a3b8"]` duplicates `test_color_empty_id_is_neutral` (:27-28). Harmless; drop one.
## godot/client/tests/test_devices_cable_rope.gd
- `RISK` godot/client/tests/test_devices_cable_rope.gd:75 `test_step_cost` asserts a wall-clock budget (`us < 4000.0` per step). On this box it measured 420 us (suite log), so there is 10x headroom, but a loaded CI runner or a parallel sweep can still make it flaky. Fix: widen the bound or move it to a non-gating perf script.
## godot/client/tests/test_devices_cable_rules.gd
- `OK`
## godot/client/tests/test_devices_cable_seed.gd
- `QUALITY` godot/client/tests/test_devices_cable_seed.gd:45 `var key := "null" if v == null else (str(v) if not v is float else str(v))` — both branches of the inner ternary are `str(v)`, so the float test is dead logic. Fix: `"null" if v == null else str(v)`.
## godot/client/tests/test_devices_cluster.gd
- `OK`
## godot/client/tests/test_devices_decklink_drop.gd
- `OK` — awaits a fake whose methods complete synchronously (see run_tests.gd:31 for why that matters).
## godot/client/tests/test_devices_decklink_order.gd
- `QUALITY` godot/client/tests/test_devices_decklink_order.gd:89-93 for the first golden editor case ('no saved order', acts Save and Export) the branch asserts `shown == DO.ids(DO.display(order_items(merged), false))`, where `shown` is `DO.ids(DO.current(merged, []))` and `current(items, [])` is by definition `display(order(items, []), false)` (decklink_order.gd:79). It is a tautology, and the `continue` then skips the web's request/saved-order comparison (:94-102). So both acts of that case assert nothing about Save/Export. The deviation is documented in the header, but the replacement check cannot fail. Fix: assert the Godot Save/Export calls (`["LOAD"]`, `["DOWNLOAD", EXPORT_NAME, text]`) and `saved` against the default-order ids instead.
## godot/client/tests/test_devices_decklink_port.gd
- `OK` — the helper name `R_a` (:72) is odd but harmless.
## godot/client/tests/test_devices_destination_form.gd
- `RISK` godot/client/tests/test_devices_destination_form.gd:129-131 when a LineEdit action produces no `patch` signal the test only checks that the text reverted to `before`; it never checks that the web golden `a[1]` was an empty/no-op patch. A missing patch for an action whose golden expects one passes whenever the typed value is corrected back to the old text (e.g. clamping to the existing value). The count guard `n >= 48` (:137) has one spare. Fix: in that branch also assert `a[1]` is empty or equals the already-stored value.
## godot/client/tests/test_devices_gpu_editor.gd
- `OK`
## godot/client/tests/test_devices_gpu_layout.gd
- `QUALITY` godot/client/tests/test_devices_gpu_layout.gd:25 `_norm` silently drops every `physicalPort` key from both sides before comparing (the raw port blob embedded in entries, 83 occurrences in the golden). Reasonable, but the header does not say the comparison ignores it, so a wrong `physicalPort` can never fail here. Fix: one header line, or compare it with a separate assertion.
## godot/client/tests/test_devices_gpu_output.gd
- `OK`
## godot/client/tests/test_devices_host_channels.gd
- `OK`
## godot/client/tests/test_devices_host_source.gd
- `OK`
## godot/client/tests/test_devices_live_input.gd
- `OK` — `test_helpers` pins `http://127.0.0.1:4200` which matches `TEMPLATE_BASE` (live_input_model.gd:19), a constant, so it does not depend on the runtime origin.
## godot/client/tests/test_devices_mapping.gd
- `OK`
## godot/client/tests/test_devices_matrix.gd
- `OK`
## godot/client/tests/test_devices_model.gd
- `OK`
## godot/client/tests/test_devices_node_view.gd
- `OK`
## godot/client/tests/test_devices_output_ports.gd
- `QUALITY` godot/client/tests/test_devices_output_ports.gd:111,119,153 `var ok := true` is only ever reassigned in the v4l2 Start branch (:119), and the only read (:152-153) is guarded by `kind != "v4l2_out"`. So `t.eq(ok, str(a.ok).ends_with("--ok"))` compares the constant `true` with the golden: it checks the golden's own flag and nothing computed by the Godot model. The Godot status kind (ok vs error) is never verified for stream/record/audio, and the :119 assignment is dead. Fix: derive `ok` from the model's result (the models return a `status` only; add a status-kind field or test the kind helper) and drop the `v4l2_out` exclusion for Start.
## godot/client/tests/test_devices_server_page.gd
- `OK` — `applies > 0` guard (:194) proves the long-timeout loop ran.
## godot/client/tests/test_devices_snapshot.gd
- `OK`
## godot/client/tests/test_devices_target.gd
- `RISK` godot/client/tests/test_devices_target.gd:76 `direct.search(line.get_slice("#", 0))` drops everything after the first `#` to ignore comments, but `#` also appears in strings (hex colours, `"#pgm"`). A line such as `var c := "#fff"; Api.get_json(...)` in features/devices would not be seen. No such line exists today (suite passes and found == []). Fix: strip only lines whose stripped text starts with `#` and handle trailing comments with a string-aware split, or accept the gap in a comment.
## godot/client/tests/test_dmx_monitor_model.gd
- `OK`
## godot/client/tests/test_effects_model.gd
- `OK`
## godot/client/tests/test_fader_cap.gd
- `OK`
## godot/client/tests/test_fixtures_3d_model.gd
- `OK`
## godot/client/tests/test_fixtures_model.gd
- `OK`
## godot/client/tests/test_fixtures_watch.gd
- `OK` — name says fixtures watch; it tests `fixtures_3d_model.renders` and `NetUtil.hold` (the Ws watch bookkeeping), which is what WO-797 pins.
## godot/client/tests/test_follow_model.gd
- `OK`
## godot/client/tests/test_glb_screens_model.gd
- `QUALITY` godot/client/tests/test_glb_screens_model.gd:1 no header comment (no WO, no module note); see test_connection_profiles_model.gd.
## godot/client/tests/test_hap_status.gd
- `OK`
## godot/client/tests/test_hardware_reconcile_model.gd
- `QUALITY` godot/client/tests/test_hardware_reconcile_model.gd:1 no header comment (no WO, no module note); see test_connection_profiles_model.gd.
## godot/client/tests/test_haze.gd
- `OK`
## godot/client/tests/test_header_badges_model.gd
- `OK`
## godot/client/tests/test_header_model.gd
- `QUALITY` godot/client/tests/test_header_model.gd:53 the deliberate bad inputs (`"{oops"`) make production `header_model.gd:98` call `JSON.parse_string`, which prints `ERROR: Parse JSON failed...` into every suite log. The same applies to test_operator_dock_model (other batch). A real engine error then looks like these expected ones, and the runner does not count them (run_tests.gd:31). Fix: parse with a `JSON` instance in `parse_project_file` (no log) or filter known-expected errors.
## godot/client/tests/test_help_pages.gd
- `OK` — the TOPICS list (5) equals the 5 `.md` files in godot/client/help/.
## godot/client/tests/test_inspector_panel.gd
- `QUALITY` godot/client/tests/test_inspector_panel.gd:65 `t.ok(presets.is_visible_in_tree() or not p.is_inside_tree(), ...)` is always true: `p` is created by `_panel()` and never added to a tree, so `not p.is_inside_tree()` holds. The 'its pane is the visible one' check is never made (the next assertion, `not p._panes[0].visible`, does cover the hide half). Fix: assert `(presets.get_parent() as Control).visible`, which does not need the tree.
## godot/client/tests/test_layer_fit_math.gd
- `OK`
## godot/client/tests/test_layer_style_model.gd
- `OK`
## godot/client/tests/test_led_test_model.gd
- `OK`
## godot/client/tests/test_live_audio_settings.gd
- `OK`

Notes
- Suite run (headless, read-only): `[tests] 22969 passed, 0 failed` for all 172 test files (this batch's 67 test files included); no FAIL lines. Engine ERROR lines in the log come from test_stage_builder / test_operator_dock_model / test_project_undo_model (other batches) and the deliberate bad-JSON in test_header_model.
- All `preload(...)`/`load(...)` paths in the 67 files resolve (a bad path fails the whole suite at load; none did). Discovery (run_tests.gd:12-17) takes every top-level `res://tests/test_*.gd`; no test file sits in a subfolder, so none is orphaned. `shm_fake_writer.gd` is correctly not a test.
- Source-text pins (test_audio_dock, test_audio_tab_split, test_audio_layer_levels, test_auth_wo811, test_clip_trim_model, test_devices_target, test_demo_server, test_help_pages) are the repo's documented convention; every pinned string was present at run time. They count as live readers of the production files.
