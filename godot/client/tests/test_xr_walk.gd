extends RefCounted
## WO-741 — walking the previs (features/previs/xr/): first-person moves, look, snap turn, the trigger's pick / aim,
## and the one marked hook in previs_stage.gd. WO-757: the Programmer panel's ray maths and the trigger's routing.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const XrWalk := preload("res://features/previs/xr/xr_walk.gd")
const HelpDialog := preload("res://app/help_dialog.gd")
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
	t.eq(Walk.trigger("h1", "h2"), {"do": "pick", "id": "h1", "add": false}, "the head hit wins")
	t.eq(Walk.trigger("", "h2", true), {"do": "pick", "id": "h2", "add": true}, "near head, grip adds")
	t.eq(Walk.trigger("", ""), {"do": "press"}, "WO-841: off the heads the trigger only waits for a drag — it never aims")
	var psn: Variant = Walk.point_psn(Vector3(1, 2, 0), down)
	t.ok(psn is Array and absf(psn[0] - 1.0) < 1e-5 and absf(psn[1] - 2.0) < 1e-5 and psn[2] == 0.0, "PSN = [x, -z, 0]: 2 m upstage")
	t.eq(Walk.point_psn(Vector3(0, 2, 0), Vector3(0, 1, 0)), null, "pointing at the sky: no spot")


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


func test_panel_ray() -> void:
	var at := Transform3D(Basis(), Vector3(0, 1, -1))  # facing +Z, 1 m in front of an eye at the origin's height 1
	var sz := Vector2(0.3, 0.4)
	t.eq(Walk.panel_uv(at, sz, Vector3(0, 1, 0), Vector3(0, 0, -1)), Vector2(0.5, 0.5), "straight at it: the middle")
	var tl: Variant = Walk.panel_uv(at, sz, Vector3(-0.12, 1.16, 0), Vector3(0, 0, -1))
	t.ok(tl is Vector2 and (tl as Vector2).distance_to(Vector2(0.1, 0.1)) < 1e-5, "(0, 0) is its top left corner")
	t.eq(Walk.panel_uv(at, sz, Vector3(1, 1, 0), Vector3(0, 0, -1)), null, "beside it: a miss")
	t.eq(Walk.panel_uv(at, sz, Vector3(0, 1, 0), Vector3(0, 0, 1)), null, "behind the ray: a miss")
	t.eq(Walk.panel_uv(at, sz, Vector3(0, 1, 0), Vector3(1, 0, 0)), null, "along its plane: a miss")
	t.eq(Walk.panel_uv(at, sz, Vector3(1, 1, 0), Vector3(0, 0, -1), true), Vector2(1, 0.5), "a drag past the edge clamps")
	var turned := Transform3D(Basis(Vector3.UP, PI / 2.0), Vector3(-1, 1, 0))  # on the left, facing the eye
	var uv: Variant = Walk.panel_uv(turned, sz, Vector3(0, 1.1, 0), Vector3(-1, 0, 0))
	t.ok(uv is Vector2 and (uv as Vector2).distance_to(Vector2(0.5, 0.25)) < 1e-5, "a turned panel: 10 cm up is a quarter down")
	t.ok(absf(Walk.PANEL_PX.x * Walk.PANEL_SIZE.y - Walk.PANEL_PX.y * Walk.PANEL_SIZE.x) < 1e-3, "pixels keep the quad's aspect")


func test_trigger_routing() -> void:
	var w: Node3D = XrWalk.new()
	var log: Array = []
	var p := Node3D.new()
	var g := GDScript.new()
	g.source_code = "extends Node3D\nvar on := false\nvar log: Array\nfunc pointed() -> bool: return on\nfunc press(d: bool, c := false) -> void: log.append([d, c])\n"
	g.reload()
	p.set_script(g)
	p.log = log
	w.panel = p
	p.on = true
	w.trigger(true, true)
	w.trigger(false, false)
	t.eq(log, [[true, true], [false, false]], "pointing at the panel the trigger clicks there (grip = ctrl), and lets go")
	log.clear()
	p.on = false
	w.trigger(false, false)
	t.eq(log, [[false, false]], "a release always reaches the panel (it ends a drag that left the panel's edge)")
	var src := FileAccess.get_file_as_string("res://features/previs/fixtures/programmer_section.gd")
	t.ok(src.contains("\tif not mirror:\n\t\tsel.aim_at.connect(_aim)\n\t\tsel.delete_requested.connect(_ask_delete)"),
		"the panel's Programmer is a mirror: one Point at request and one Delete dialog, from the desktop column")
	var deck := FileAccess.get_file_as_string("res://features/live/deck_view.gd")
	t.ok(deck.contains("await LFS.store(scene_id)") and not deck.contains("LF.store("), "one Store-to-look for the card and VR")
	p.free()
	w.free()


func test_stage_hook() -> void:
	var src := FileAccess.get_file_as_string("res://features/previs/previs_stage.gd")
	t.eq(src.count("WO-741"), 4, "previs_stage.gd: exactly the 4 marked hook lines (How to remove, WO-741)")
	t.ok(src.contains("if Config.args.has(\"xr\"):  # WO-741"), "only with the client flag -- --xr")
	t.ok(src.contains("return walk.camera() if walk != null else _cam  # WO-741"), "picking goes through the walk camera")


func test_headset_launch() -> void:
	var sh := FileAccess.get_file_as_string("res://run-xr.sh")
	t.ok(sh.contains("exec \"$GODOT\" --path \"$HERE\" --xr-mode \"$xr_mode\" -- --xr --windowed --tab=Previs \"$@\""),
		"run-xr.sh: the XR mode (an engine flag, before --), the walk, the Previs tab")
	t.ok(sh.contains("xr_mode=off\n") and sh.contains("\txr_mode=on\n"),
		"on only with a runtime: without one Godot blocks on a modal alert")
	t.ok(sh.contains("export XR_RUNTIME_JSON=\"$rt\"") and sh.contains("export XDG_DATA_HOME="),
		"the runtime WiVRn registered, and a user dir of its own (the kiosk's settings untouched)")
	var cm := FileAccess.get_file_as_string("res://app/connection_menu.gd")
	t.ok(cm.contains("args = PackedStringArray([\"--xr-mode\", \"on\"]) + args"),
		"a restart (A/B switch, following the master) keeps the headset: get_cmdline_args drops --xr-mode")
	t.eq(HelpDialog.MD.title(HelpDialog.load_md("vr-walk")), "Walk the stage in VR (Meta Quest)", "help/vr-walk.md")


func _fake_tab() -> GDScript:
	var g := GDScript.new()
	g.source_code = "extends Control\nvar fixtures3d = null\nvar aim_drag = null\n"
	g.reload()
	return g


## Owner 27.10: "the programmer tablet in vr is too sensitive. it needs smoothing." — the panel pointer's One-Euro
## filter: a still hand's tremor is cut hard, a sweep follows with little lag, a fresh state starts where the ray is.
func test_pointer_smoothing() -> void:
	var st := {}
	t.eq(Walk.euro(st, Vector2(300, 400), 1.0 / 72.0), Vector2(300, 400), "the first sample is taken as is")
	var worst := 0.0
	for i in 144:  # 2 s of ±4 px tremor at 72 Hz around (300, 400)
		var p := Walk.euro(st, Vector2(300, 400) + Vector2(4, -4) * (1.0 if i % 2 == 0 else -1.0), 1.0 / 72.0)
		worst = maxf(worst, p.distance_to(Vector2(300, 400)))
	t.ok(worst < 1.0, "±4 px tremor moves the pointer under 1 px (%.2f)" % worst)
	var sweep := {}
	var p := Vector2.ZERO
	for i in 37:  # 0.5 s sweep at 600 px/s along x
		p = Walk.euro(sweep, Vector2(i * 600.0 / 72.0, 0), 1.0 / 72.0)
	t.ok(absf(p.x - 300.0) < 40.0, "a 600 px/s sweep lags under 40 px (%.1f behind)" % (300.0 - p.x))
	t.ok(Walk.PRESS_SLOP_PX > 4.0 and Walk.PRESS_SLOP_PX < 20.0, "the press slop is a small move, not a drag")
