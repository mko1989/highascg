extends RefCounted
## WO-741 — walking the previs (features/previs/xr/): first-person moves, look, snap turn, the trigger's pick / aim,
## and the one marked hook in previs_stage.gd.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const XrWalk := preload("res://features/previs/xr/xr_walk.gd")
var t


func _near(a: Vector3, b: Vector3) -> bool:
	return a.distance_to(b) < 1e-5


func test_start_and_step() -> void:
	var s := Walk.start_pose(Vector3(2, 3, -1), 8.0)
	t.ok(_near(s.pos, Vector3(2, Walk.EYE, 7)), "starts on the floor at eye height, downstage of the target")
	t.ok(_near(Walk.step(Vector3.ZERO, 0.0, Vector2(0, 1), 1.0, 1.0), Vector3(0, 0, -1)), "forward at yaw 0 = upstage (-Z)")
	t.ok(_near(Walk.step(Vector3.ZERO, 0.0, Vector2(1, 0), 1.0, 1.0), Vector3(1, 0, 0)), "strafe right = +X")
	t.ok(_near(Walk.step(Vector3.ZERO, PI / 2.0, Vector2(0, 1), 1.0, 1.0), Vector3(-1, 0, 0)), "yaw 90° left → forward is -X")
	t.ok(absf(Walk.step(Vector3.ZERO, 0.3, Vector2(1, 1), 1.0, 1.0).length() - 1.0) < 1e-5, "diagonal is not faster")
	t.ok(absf(Walk.step(Vector3(0, 1.7, 0), 0.0, Vector2(0, 1), 1.0).y - 1.7) < 1e-5, "walking keeps eye height")
	t.eq(Walk.keys(true, false, false, true), Vector2(1, 1), "W + D")
	t.eq(Walk.keys(true, true, true, true), Vector2.ZERO, "opposites cancel")


func test_look_and_snap() -> void:
	var v := Walk.look(0.0, 0.0, Vector2(100, 0))
	t.ok(v.x < 0.0, "mouse right turns right (yaw down)")
	t.ok(absf(Walk.look(0.0, 0.0, Vector2(0, -100000)).y - Walk.PITCH_MAX) < 1e-5, "pitch clamps short of straight up")
	var s := Walk.snap(0.0, 0.9, true)
	t.eq(s[0], -Walk.SNAP, "a push right snaps right")
	t.eq(s[1], false, "and disarms")
	t.eq(Walk.snap(s[0], 0.9, s[1])[0], -Walk.SNAP, "held: no second snap")
	t.eq(Walk.snap(s[0], 0.1, false)[1], true, "back to centre re-arms")


func test_trigger() -> void:
	var down := Vector3(0, -1, -1).normalized()
	t.eq(Walk.trigger("h1", "h2", false, Vector3(0, 2, 0), down), {"do": "pick", "id": "h1", "add": false}, "the head hit wins")
	t.eq(Walk.trigger("", "h2", true, Vector3(0, 2, 0), down, true), {"do": "pick", "id": "h2", "add": true}, "near head, grip adds")
	var aim := Walk.trigger("", "", true, Vector3(1, 2, 0), down)
	t.eq(aim.do, "aim", "floor with a selection aims")
	t.ok(absf(aim.psn[0] - 1.0) < 1e-5 and absf(aim.psn[1] - 2.0) < 1e-5 and aim.psn[2] == 0.0, "PSN = [x, -z, 0]: 2 m upstage")
	t.eq(Walk.trigger("", "", false, Vector3(0, 2, 0), down), {"do": "none"}, "no selection: nothing")
	t.eq(Walk.trigger("", "", true, Vector3(0, 2, 0), Vector3(0, 1, 0)), {"do": "none"}, "pointing at the sky: nothing")


func test_walk_node_desktop() -> void:
	var tab := Control.new()
	tab.set_script(_fake_tab())
	var stage := Node3D.new()
	tab.add_child(stage)
	var w: Node3D = XrWalk.attach(stage)
	t.ok(w != null and w.tab == tab, "attaches in a tab that has heads to program")
	t.ok(XrWalk.attach(Node3D.new()) == null, "the Live tab's 3D view (no Programmer) never walks")
	w._cam = Camera3D.new()
	w.add_child(w._cam)
	w._cam.position = Vector3(0, Walk.EYE, 8)
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	t.ok(w.handle_input(press), "left press starts a look, not an orbit")
	var mm := InputEventMouseMotion.new()
	mm.relative = Vector2(50, 0)
	w.handle_input(mm)
	t.ok(w._cam.rotation.y < 0.0, "drag right turns the camera right")
	var wheel := InputEventMouseButton.new()
	wheel.button_index = MOUSE_BUTTON_WHEEL_UP
	wheel.pressed = true
	var z0: float = w._cam.position.z
	w.handle_input(wheel)
	t.ok(w._cam.position.z < z0, "wheel up steps forward")
	t.ok(absf(w._cam.position.y - Walk.EYE) < 1e-5, "at eye height")
	tab.free()


func test_stage_hook() -> void:
	var src := FileAccess.get_file_as_string("res://features/previs/previs_stage.gd")
	t.eq(src.count("WO-741"), 4, "previs_stage.gd: exactly the 4 marked hook lines (How to remove, WO-741)")
	t.ok(src.contains("if Config.args.has(\"xr\"):  # WO-741"), "only with the client flag -- --xr")
	t.ok(src.contains("return walk.camera() if walk != null else _cam  # WO-741"), "picking goes through the walk camera")


func _fake_tab() -> GDScript:
	var g := GDScript.new()
	g.source_code = "extends Control\nvar fixtures3d = null\nvar aim_drag = null\n"
	g.reload()
	return g
