# godot/client/tests (part 3) — sweep 29.10.2026 (batch 042)

Files: 3 · lines: 423 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 0 RISK, 1 QUALITY

## godot/client/tests/test_xr_box_fan_wo774.gd
- `OK` (every source-text pin in `test_hooks` verified present in xr_walk.gd, fixtures_3d.gd, xr_panel.gd and help/vr-walk.md.)
## godot/client/tests/test_xr_walk.gd
- `QUALITY` godot/client/tests/test_xr_walk.gd:56 — `XrWalk.attach(Node3D.new())` creates a Node3D that is never freed (attach returns null for a stage without a Programmer tab), so it is an orphan until process exit. Harmless to the result; fix: keep it in a var and `free()` it. All other pins (previs_stage.gd 4x WO-741 count, run-xr.sh lines, connection_menu.gd, programmer_section.gd, deck_view.gd) verified present.
## godot/client/tests/test_zone_model.gd
- `OK`
