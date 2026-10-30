# godot/client/features/previs (tracking + xr) — sweep 29.10.2026 (batch 035)

Files: 27 · lines: 4585 · findings: 0 BUG-HIGH, 1 BUG, 3 DEAD, 2 RISK, 3 QUALITY

## godot/client/features/previs/tracking/person_cards_model.gd
- `DEAD` godot/client/features/previs/tracking/person_cards_model.gd:67 `best_view()` — no production caller; `cards()` calls `ranked_views()` directly. grep: `grep -rn "best_view" godot tools scripts src` → only the definition and godot/client/tests/test_person_cards_model.gd:41-85. Keep only if the test is meant to pin the "first of ranked_views" contract; otherwise drop with its test.
## godot/client/features/previs/tracking/person_dummy_mesh.gd
- `OK`
## godot/client/features/previs/tracking/person_dummy_model.gd
- `RISK` godot/client/features/previs/tracking/person_dummy_model.gd:27 — `out.sort_custom(a._a > b._a)` has no tie-break, and Godot's sort is not stable. `person_cards.gd:154` takes `views[0]` as the camera the still dummy faces and shader slot 0. Two views with exactly equal box area could swap slots between frames. `person_cards_model.ranked_views` already guards this with an index tie-break (line 97). No concrete failing input shown (needs bit-equal areas), so RISK.
## godot/client/features/previs/tracking/person_mark_model.gd
- `OK`
## godot/client/features/previs/tracking/person_mark_row.gd
- `OK`
## godot/client/features/previs/tracking/person_pose_model.gd
- `OK` (joints are `[x,y,z] | null` per src/tracking/pose3d.js:13, so `C.psn_to_godot(p)` on any `Array` joint is safe)
## godot/client/features/previs/tracking/presenters_model.gd
- `OK`
## godot/client/features/previs/tracking/presenters_section.gd
- `QUALITY` godot/client/features/previs/tracking/presenters_section.gd:84-124,184 — every `tracking:detections` frame that changes the bindable-person list (`choices`) rebuilds all rows. Each row calls `_photo()`. A photo that is not cached yet (slow or failed GET, the early return at 189-193) is re-requested on each rebuild, so overlapping duplicate GETs. `_photos` is also never pruned for deleted presenters. Minor; a `_fetching` set plus pruning on `_snap` change would fix both.
## godot/client/features/previs/tracking/ptz_calibrate_fold.gd
- `BUG` godot/client/features/previs/tracking/ptz_calibrate_fold.gd:147-155,193 — a failed `start` is shown nowhere. `_post()` sets `_err` and, for the `start` action, `_open = false`. `_refresh()` then does `_body.visible = _open`. `_state`, the only label that prints `_err`, is a child of `_body` (line 84). Failing case: tick "Calibrate on a person" for a camera the server rejects (src/ptz/ptz-calibrate.js:116-118 `fail(r.status, r.error)`, e.g. the camera not enabled/known) → the fold springs shut, the toggle just shows "> Calibrate on a person (n pins)", and the reason is invisible. Fix: show `_err` on the toggle's tooltip/text, or keep `_state` outside `_body`.
- `DEAD` godot/client/features/previs/tracking/ptz_calibrate_fold.gd:12 `const P := preload(".../ptz_model.gd")` — never referenced in the file. grep: `grep -n "\bP\b" ptz_calibrate_fold.gd` → only the declaration.
- `QUALITY` godot/client/features/previs/tracking/ptz_calibrate_fold.gd:136 — `_view.get("pins", []) if _view is Dictionary else []`: `_view` is always a Dictionary (`{}` / `res.data` checked at :150), so the `is Dictionary` test is dead.
## godot/client/features/previs/tracking/ptz_model.gd
- `DEAD` godot/client/features/previs/tracking/ptz_model.gd:146-176 `wrap180`, `geom_angles`, `aim_angles`, `to_units` (and `blend` at :70, used only by `aim_angles`) — no production caller; the client never aims the PTZ itself, the server does (src/ptz/ptz-model.js). grep: `grep -rn "aim_angles\|to_units\|geom_angles\|\.blend(" godot tools scripts src index.js` → definitions, plus godot/client/tests/test_tracking_ptz.gd:53-78 only. It is a deliberate twin of the server maths pinned by the test; say so in the header, or delete if the twin is no longer wanted (~45 lines).
## godot/client/features/previs/tracking/ptz_section.gd
- `OK`
## godot/client/features/previs/tracking/tracking_model.gd
- `OK`
## godot/client/features/previs/tracking/tracking_overlay.gd
- `OK`
## godot/client/features/previs/tracking/tracking_page.gd
- `QUALITY` godot/client/features/previs/tracking/tracking_page.gd:456-457 — `_sync_points()` replaces `_status.text` with "N point(s) clicked…" unless it starts with "RMS". It is called from `_sync()` (every mode switch, camera select, `sources_changed`) and `set_objects()`. So the error lines other code writes to `_status` vanish on the next of those: "Not solved: …" (:278), the `adopt_size` raster-mismatch warning (:269), and the PersonMarkRow errors (person_mark_row.gd:73, e.g. "Cam detects 2 persons"). Failing case: click "Person is on …" with 2 people in view → the message appears, then any stage object change (`set_objects`) wipes it. Fix: keep a separate "sticky error" label or clear it explicitly.
- Note: file is 496/500 lines (CI limit); the next addition needs a split.
## godot/client/features/previs/tracking/tracking_view.gd
- `OK` (494/500 lines)
## godot/client/features/previs/tracking/walk_model.gd
- `OK`
## godot/client/features/previs/tracking/walk_section.gd
- `OK`
## godot/client/features/previs/tracking/zone_model.gd
- `OK`
## godot/client/features/previs/tracking/zones_section.gd
- `OK`
## godot/client/features/previs/xr/vr_session_dialog.gd
- `OK`
## godot/client/features/previs/xr/vr_session_model.gd
- `OK`
## godot/client/features/previs/xr/xr_fan.gd
- `OK`
## godot/client/features/previs/xr/xr_looks_row.gd
- `RISK` godot/client/features/previs/xr/xr_looks_row.gd:32,36-46 — `_fill()` runs on every `Store.project_changed` and always `looks.clear()`s and refills the OptionButton. xr_type_row.gd:62 deliberately avoids this ("an autosave must not close the open menu"). If the look dropdown is open in the headset when a project change arrives (another client's autosave echo), the list is rebuilt under the open popup. Fix: keep the same key-compare guard xr_type_row uses.
## godot/client/features/previs/xr/xr_panel.gd
- `OK`
## godot/client/features/previs/xr/xr_type_row.gd
- `OK`
## godot/client/features/previs/xr/xr_walk.gd
- `OK`
## godot/client/features/previs/xr/xr_walk_model.gd
- `OK`
