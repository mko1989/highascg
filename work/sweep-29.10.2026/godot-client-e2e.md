# godot/client/e2e — sweep 29.10.2026 (batch 024)

Files: 11 · lines: 1605 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 1 RISK, 3 QUALITY

Context checked: `app/main.gd:46` starts `e2e_runner.gd` only on `--e2e`; `tools/e2e/run-gui-e2e.js` is the only launcher; `export_presets.cfg` excludes `e2e/*`;
every selector/meta/member the scenarios reach into (`dest_id` meta, `_dests.add`, `_loading`, `_busy`, `refresh`, `editor._frame`, `tab.view`,
`XrPanel.PX/SIZE/quad/point/pointed`, `Walk.EYE`, `F.floor_hit`, `page.aim_drag.post`, `_svc`, `programmer._groups`, `row.look_id()/status`) exists in the live code.
Every public helper of `e2e_ui.gd` has a caller (grep `ui\.<name>(` over godot/client, tools).

## godot/client/e2e/e2e_runner.gd
- `QUALITY` godot/client/e2e/e2e_runner.gd:64 — `quit(failed + (1 if not up else 0))` double-counts the boot failure. When the client never connects, `all_results` already holds the `boot/connect` entry with `ok:false, skipped:false` (line 38-40), so `failed` is already 1 and the exit code becomes 2. The header comment (e2e_runner.gd:2, "exit code = failed steps") and `results.json` (`failed: 1`) then disagree with the process exit code. Fix: `quit(failed)`.

## godot/client/e2e/e2e_scenario.gd
- `RISK` godot/client/e2e/e2e_scenario.gd:24 — `ok = why == null or …` treats a `null` step result as PASS. A step lambda that hits a GDScript runtime error (wrong type, `Nonexistent function`, …) is aborted by the VM and yields `null` through `body.call()`, so it is reported as PASS with no reason. Concrete instance: see `04_timeline.gd:33`. Every step in this directory returns `String`/`""`, so nothing relies on `null` meaning pass. Fix: count `null` as a failure ("step returned nothing — script error?").

## godot/client/e2e/e2e_ui.gd
- `QUALITY` godot/client/e2e/e2e_ui.gd:342 — `img.save_png(path)` result is ignored and `shot()` returns `path` regardless, so a failed save (unwritable/removed `--e2e-out` dir) leaves `results.json` pointing at PNGs that do not exist. Fix: check the `Error` and return `""` on failure.

## godot/client/e2e/scenarios/01_new_project.gd
- `OK`

## godot/client/e2e/scenarios/02_outputs.gd
- `OK`

## godot/client/e2e/scenarios/03_looks_layers.gd
- `OK`

## godot/client/e2e/scenarios/04_timeline.gd
- `BUG` godot/client/e2e/scenarios/04_timeline.gd:33 — `var before: Array = (await api("/api/timelines")).get("data", [])`. `Api.request` failures return `{"ok":false, …, "data": null, …}` (core/api.gd:93), and `Dictionary.get("data", [])` returns the stored `null`, not the default. Assigning `null` to a typed `Array` is a runtime error, the step lambda aborts, returns `null` and is reported as PASS ("New timeline") although no timeline was created and `_tl_id` stays `""` (see the RISK in e2e_scenario.gd:24). Failing case: `/api/timelines` answers 500 or times out → step 1 PASS, `_tl_id == ""`, step 2 then fails with a misleading "timeline has no e2e_bars clip". Fix: `var r := await api(...); var before: Array = r.data if r.get("data") is Array else []`.

## godot/client/e2e/scenarios/05_live_inputs.gd
- `OK`

## godot/client/e2e/scenarios/06_xr_walk.gd
- `QUALITY` godot/client/e2e/scenarios/06_xr_walk.gd:44 — without `--xr` the scenario records one step `"Not run (needs --xr)"` that returns `""`, i.e. it is counted as PASSED in the runner totals and the report (`PASS 06_xr_walk / Not run`). A default `--e2e=all` run therefore always shows one green step that tested nothing. The runner already has a `skipped` state; `step()` has no way to produce it. Fix: append a result with `skipped:true` directly instead of calling `step`.

## godot/client/e2e/scenarios/07_pixel_map.gd
- `OK`

## godot/client/e2e/scenarios/08_audio_monitor_pair.gd
- `OK`
