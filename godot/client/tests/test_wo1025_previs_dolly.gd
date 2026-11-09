extends RefCounted
## WO-1025 — the previs camera walks forward: the wheel goes on through the orbit point at its 2 m stop, and left + right
## held with a drag up / down dollies along the view (previs_stage.gd dolly()).

const PrevisStage := preload("res://features/previs/previs_stage.gd")
var t


func _stage() -> Array:
	var sv := SubViewport.new()
	sv.size = Vector2i(1000, 500)
	sv.own_world_3d = true
	t.root.add_child(sv)
	var st: Node3D = PrevisStage.new()
	sv.add_child(st)
	await t.process_frame
	st._yaw = 0.0
	st._pitch = 0.0
	st._target = Vector3.ZERO
	st._dist = 2.0
	st._update_camera()  # camera at +Z 2 m, looking at −Z
	return [sv, st]


func _button(st: Node3D, b: MouseButton, down: bool) -> void:
	var e := InputEventMouseButton.new()
	e.button_index = b
	e.pressed = down
	st.handle_input(e)


func test_wheel_goes_on_through_the_orbit_point() -> void:
	var r: Array = await _stage()
	var st: Node3D = r[1]
	var cam0: Vector3 = st._cam.position
	_button(st, MOUSE_BUTTON_WHEEL_UP, true)
	t.eq(st._dist, 2.0, "the orbit distance stays at its stop")
	t.ok(st._target.z < -0.4, "the orbit point moved forward (−Z): %s" % st._target)
	t.ok(st._cam.position.z < cam0.z - 0.4, "and the camera with it")
	r[0].queue_free()


func test_left_and_right_held_dolly() -> void:
	var r: Array = await _stage()
	var st: Node3D = r[1]
	_button(st, MOUSE_BUTTON_LEFT, true)
	var right := InputEventMouseButton.new()
	right.button_index = MOUSE_BUTTON_RIGHT
	right.pressed = true
	t.ok(st.dolly_event(right), "right pressed while left is held → the dolly's, not a fixture aim")
	st.handle_input(right)
	var mm := InputEventMouseMotion.new()
	mm.relative = Vector2(30, -100)
	st.handle_input(mm)
	t.eq(st._yaw, 0.0, "no orbit while both are held")
	t.ok(st._target.z < -1.0 and absf(st._target.x) < 1e-4, "drag up → forward along the view: %s" % st._target)
	var at: Vector3 = st._target
	mm.relative = Vector2(0, 100)
	st.handle_input(mm)
	t.ok(st._target.z > at.z + 1.0, "drag down → back")
	right.pressed = false
	t.ok(st.dolly_event(right), "its release too")
	st.handle_input(right)
	at = st._target
	mm.relative = Vector2(40, 0)
	st.handle_input(mm)
	t.eq(st._target, at, "left alone again: orbit, no dolly")
	t.ok(st._yaw != 0.0, "…and it orbits")
	_button(st, MOUSE_BUTTON_LEFT, false)
	right.pressed = true
	t.ok(not st.dolly_event(right), "a right press on its own stays the fixture aim's (WO-679)")
	r[0].queue_free()
