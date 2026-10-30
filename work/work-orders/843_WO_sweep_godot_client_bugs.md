# WO-843 — Sweep: Godot client bugs

**Area:** godot-client
**Status: DONE (30.10, full Godot headless suite 23657 passed / 0 failed + source re-check of every fix; not exercised in the live GUI, owner QA listed below)**
**Source:** code sweep 29.10 (REPORT §4f, §5 Godot client, §7c debounce-after-reassign / count+1 ids (Godot side)).

Items: 4f timeline splitter drag saves a stale ConfigFile and clobbers ui.cfg keys (haze, previs folds, API
password); media inspector re-saves trim on every blur and parses m:ss.FF as decimal seconds (WO-813 area);
countdown + lower-third sections POST the old layer's config to a newly selected layer; MIX + MERGE preset migrates to
"MIX+ ANIMATE" and becomes a CUT (web too, golden pins the wrong output); Previs Delete in Camera mode deletes the
selected stage object; pixel map makes a 1×1 region on a click at zoom ≥13×; `count + 1` id generation
(output_ports_model). Timeline snap off-by-one and vertical scroll are left to WO-837 phase 2 (same files).


## 1. Investigation (30.10, every finding re-read in the code before fixing)

| Item | Real? | Evidence |
|---|---|---|
| 4f timeline splitter | yes | `timeline_tab.gd:77-82` loaded one `ConfigFile` at tab build and the `dragged` closure `save()`d it on every drag, writing back every key as it was then (haze, `previs_folds`, `[auth]` password). Every other ui.cfg writer in godot/client (about 30 sites checked: perf_overlay, header_status, live_*, previs haze/folds/beams, devices_toolbar, config.gd, lock_model …) already re-loads right before it saves; the splitter was the only one. |
| Media inspector trim | yes | `media_inspector.gd:166-181`: `commit` ran on every `focus_exited`; `_sync` shows `M.format_timecode` (m:ss.FF, FF = frames) but `M.parse_time_input` reads the part after the dot as decimal seconds. 1200 ms @25 fps shows `0:01.05`, a blur re-reads it as 1.05 s and saves 1050. Also `show_media` left `_in_lib` true until the library entry answered, so an edit in that window POSTed against the new id. |
| Countdown / lower-third | yes | `show_layer()` overwrote `_scene_id/_main/_layer/_index` before the pending-debounce `_flush()`, so `_post` built the body from the NEW layer number with the OLD `_cfg`. |
| MIX + MERGE | yes | `transitions.gd` `migrate_type`: the regex `\s*\+\s*MERGE` eats the space before "+", the replacement `"+ ANIMATE"` did not put it back: "MIX + MERGE" -> "MIX+ ANIMATE", in no type list, so `normalize_for_pgm_only` made it a CUT. `test_transitions_timer.gd` pinned exactly that ("generated from the JS"). Web `client/lib/transition-presets.js:44` has the same slip. |
| Previs Delete in Camera mode | yes | `previs_tab.gd` `_unhandled_key_input` is gated on visibility only; Delete/Backspace -> `stage_panel.delete_selected()`, Ctrl+D duplicate and `move_drag.key` (arrows/PgUp/PgDn/Q/E) all hit the hidden stage selection in Camera mode. |
| Pixel map 1x1 | yes | `pixel_map_view.gd` `_release` judged "was it a drag" by the snapped rect's view size (>= 4 px); one channel pixel is >= 4 view px at zoom >= ~13x, so a plain click emitted `drawn(1x1)`. |
| `count + 1` ids (Godot side) | yes | `output_ports_model.gd` `add_plan` (`str_%d`/`rec_%d`/`audio_%d` from `cur.size() + 1`): [str_1, str_3] -> a second `str_3`. Same shape in `mapping_graph.gd` `add_output` (`out_%d`), found while looking. |

Not touched (deferred as told): timeline snap off-by-one and vertical scroll (WO-837 phase 2).

## 2. What was done

- `core/ui_cfg.gd` (new): `save_value(section, key, value, path)` = load, set, save. `timeline_tab.gd` splitter now calls it (the build-time `cfg` is only used to read the initial offset).
- `features/live/clip_trim_model.gd`: new `field_patch(key, text, shown, fps)` (unchanged text -> `{}`, empty -> clear, otherwise `parse_tc` = ".ff is frames", plain numbers are seconds with maths, gibberish -> `{"error"}`). `media_inspector.gd` uses it, remembers the text each field was last set to (`_set_time`/meta `shown`), and sets `_in_lib = false` at the top of `show_media`. `M.parse_time_input` is left as is (it is golden-pinned against the web JS and no longer used by the inspector). Built on the WO-839 digits-only `parse_tc`, so no new parser.
- `countdown_section.gd`, `lower_third_section.gd`: `show_layer` computes the key first and flushes the pending debounce while the target fields are still the old ones; only then assigns the new ones. An echo of our own edit (same key) neither flushes nor retargets-before-return, as before.
- `transitions.gd`: replacement `" + ANIMATE"`. `test_transitions_timer.gd` goldens corrected (header notes the exception to "do not edit by hand").
- `features/previs/previs_keys.gd` (new, `stage_keys(mode)`), used in `previs_tab.gd` to gate Delete/Backspace, Ctrl+D and the nudge keys to 3D mode (F fit stays everywhere). `previs_tab.gd` was at exactly 500 lines, so the key doc comment was condensed.
- `pixel_map_model.gd` `drag_draws(press, at, min_px=4)`; `pixel_map_view.gd` records `_press_at` and `_release(at)` decides by pointer travel.
- `output_ports_model.gd` `add_plan` and `mapping_graph.gd` `add_output`: start at size + 1, increment while that id is taken (identical results for non-colliding lists, so the existing goldens hold).
- Tests: new `tests/test_wo843_client_sweep.gd`; `test_transitions_timer.gd` corrected.
- Needed on the web side (agent wo844): `client/lib/transition-presets.js:44` -> `.replace(/\s*\+\s*MERGE\b/gi, ' + ANIMATE')`; check any web golden/smoke that pins "MIX+ ANIMATE" (none found in client/test/tools by grep); web has the same `count + 1` ids in device-view-bands-render.js:333-350 / device-view-matrix / mapping-node-service / device-graph-suggest.
- Not fixed: countdown/lower-third `_status` freed-label RISK after awaits, countdown position fields math_line (separate sweep items, outside this WO's list).

## 3. Verified

- Re-run 30.10 15:15 (final check, all fixes re-read in the tree): full suite 23657 passed, 0 failed; `check-max-file-lines.js`: 0 over 500. Earlier run: 23264 passed, 0 failed.
- Full Godot suite `godot --headless --path godot/client --script res://tests/run_tests.gd`. `GODOT=... ./run-client.sh --check` from godot/client: "boot OK (no script errors)". `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- `test_wo843_client_sweep.gd` (13 test functions): splitter keeps haze/fold/password keys written after the "tab build" copy (real ConfigFile round trip); trim field decisions; MERGE migration; Camera-mode key gate; click-vs-drag; duplicate output ids (stream/record/audio and mapping); retarget order.
- Limits of proof: the countdown / lower-third sections and previs_tab cannot be loaded under `--script` (autoloads missing), so those three fixes are pinned by source-text/order assertions plus the pure helper, not by running the node. The old MERGE behaviour was proven by the old golden itself (it asserted "MIX+ ANIMATE" / CUT). The four GUI checks are covered by the GUI e2e below (real mouse / key events); nothing is left to owner QA.
- GUI e2e `11_wo843_sweep` 5/5 (30.10, `node tools/e2e/run-gui-e2e.js --e2e=11_wo843_sweep`, sandbox server + hidden Xvfb, real viewport events; scenario `godot/client/e2e/scenarios/11_wo843_sweep.gd`; the harness now also seeds the pixel-map fixture for it, passes `HIGHASCG_E2E_SANDBOX` and takes `--client=<dir>`):
  - 1 splitter: haze set to "Thick haze" through the Previs toolbar picker and a Previs fold clicked, then the Timeline splitter dragged 90 px with the button held; user://ui.cfg afterwards still has haze 1.0 and the fold key, plus the new `[timeline] preview_h` (570 = the splitter offset).
  - 2 media In field: In typed as 1.2 (stored 1200, field shows 0:01.05), then focused by a click and blurred with Tab untouched; the sandbox's media-library registry file (rewritten by every save; its mtime moved on the real save) did not change, stored trimInMs still 1200 (old code would have stored 1050).
  - 3 Previs Camera mode: two LED walls added through Add ▾, Camera mode, Delete + Backspace + Ctrl+D pressed: client stage objects and the autosaved project's `previs.stage.objects` both stay at 2; control: the same Delete in 3D mode removes one (client and project).
  - 4 pixel map at 26.6x zoom (12.9 view px per channel pixel, via 18 wheel notches): a plain click on empty picture leaves the region count at 0; control: a 70 px drag at that zoom draws one.
  - Probes calibrated against the old code: the same scenario run on a scratch copy of the client with the four fixes reverted (splitter re-saving the build-time ConfigFile, blur always saving + decimal-seconds parse, `stage_keys` always true, rect-size click test) fails all four checks (haze lost = null, trimInMs 1050 + registry rewritten, 2 -> 1 objects, a 1 x 1 region R1 at 1000,899). Suite after the harness change: 23657 passed, 0 failed.
