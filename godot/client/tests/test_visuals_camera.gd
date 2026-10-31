extends RefCounted
## WO-896 the Visuals 3D view drives the output: the pose math (pose ↔ transform, clamps, Flow offsets, the camera-attached
## backdrop quad covering the frame at any angle), the stage and deck taking a pose (every layer aligned), and the tab — "Drive
## output" on/off, the pose and the switch stored per look, a recalled look putting its framing on the INCOMING deck only.

const Cam := preload("res://features/visuals/visuals_camera.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const Stage := preload("res://features/visuals/visuals_stage.gd")
const Deck := preload("res://features/visuals/visuals_deck.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
var t


func _near(a: Vector3, b: Vector3) -> bool:
	return a.distance_to(b) < 0.0001


func test_home_is_the_old_camera() -> void:
	var tf := Cam.transform_of(Cam.HOME)
	t.ok(_near(tf.origin, Vector3(0, 0, 14)) and tf.basis.is_equal_approx(Basis()), "pose HOME = the old fixed camera (0, 0, 14)")
	var s := Cam.normalize(null)
	t.eq([s.drive, Cam.pose_of(s)], [false, Cam.HOME], "nothing stored → home, not driving")


func test_pose_transform_round_trip() -> void:
	for p in [Vector3(0.7, 0.3, 20.0), Vector3(-2.5, -1.2, 5.0), Vector3(3.0, 1.35, 79.0), Vector3(0.0, 0.0, 2.0)]:
		var back := Cam.pose_from(Cam.transform_of(p))
		t.ok(_near(back, p), "pose %s → transform → pose %s" % [p, back])
	var tf := Cam.transform_of(Vector3(1.1, 0.4, 30.0))
	t.ok(absf(tf.origin.length() - 30.0) < 0.0001, "the camera sits `dist` from the origin")
	t.ok((tf.basis * Vector3(0, 0, -1)).dot(-tf.origin.normalized()) > 0.9999, "and looks at the origin")
	t.ok(Cam.transform_of(Vector3(0.0, 0.5, 14.0)).origin.y > 0.0, "positive pitch raises the camera")
	t.ok(Cam.transform_of(Vector3(0.5, 0.0, 14.0)).origin.x > 0.0, "positive yaw swings it to +x")


func test_clamp_and_normalize() -> void:
	t.eq(Cam.clamp_pose(Vector3(0.0, 9.0, 1000.0)), Vector3(0.0, Cam.PITCH_MAX, Cam.DIST_MAX), "pitch and distance limited")
	t.eq(Cam.clamp_pose(Vector3(0.0, -9.0, 0.1)), Vector3(0.0, -Cam.PITCH_MAX, Cam.DIST_MIN), "both ways")
	t.ok(absf(Cam.clamp_pose(Vector3(PI * 2.0 + 0.5, 0, 14)).x - 0.5) < 0.0001, "yaw wraps")
	var n := Cam.normalize({"drive": "yes", "yaw": "x", "pitch": 5, "dist": null, "extra": 1})
	t.eq([n.drive, n.yaw, n.pitch, n.dist, n.has("extra")], [false, 0.0, Cam.PITCH_MAX, Cam.DIST_MIN, false],
		"junk → safe values, only the four keys")
	t.eq(Cam.normalize({"drive": true, "yaw": 1.0, "pitch": 0.2, "dist": 30.0}), {"drive": true, "yaw": 1.0, "pitch": 0.2, "dist": 30.0},
		"a good camera is kept")
	t.eq(Cam.same(Cam.normalize({"yaw": 1.0}), Cam.normalize({"yaw": 1.0})), true, "same")
	t.eq(Cam.same(Cam.normalize({"yaw": 1.0}), Cam.normalize({"yaw": 1.0, "drive": true})), false, "the switch counts")


func test_flow_offsets() -> void:
	var p := Vector3(0.2, 0.1, 14.0)
	t.ok(_near(Cam.offset(p, {}), p), "no cam_* params = no offset")
	t.ok(_near(Cam.offset(p, M.PARAM_DEFAULTS), p), "the defaults (0.5) = no offset")
	var hi := Cam.offset(p, {"cam_yaw": 1.0, "cam_pitch": 1.0, "cam_zoom": 1.0})
	t.ok(hi.x > p.x and hi.y > p.y and absf(hi.z - 28.0) < 0.001, "1.0 = yaw+, pitch+, twice as far")
	var lo := Cam.offset(p, {"cam_yaw": 0.0, "cam_pitch": 0.0, "cam_zoom": 0.0})
	t.ok(lo.x < p.x and lo.y < p.y and absf(lo.z - 7.0) < 0.001, "0.0 = the other way, half the distance")
	t.ok(absf(Cam.offset(Vector3(0, 1.4, 70.0), {"cam_pitch": 1.0, "cam_zoom": 1.0}).y - Cam.PITCH_MAX) < 0.0001, "an offset never leaves the limits")
	t.ok(M.PARAMS.has("cam_yaw") and M.PARAMS.has("cam_pitch") and M.PARAMS.has("cam_zoom"), "Flow can bind them")
	var g := {"nodes": [{"id": "b", "type": "bus", "bus": "kick", "x": 0.0, "y": 0.0},
		{"id": "p", "type": "param", "param": "cam_yaw", "x": 0.0, "y": 0.0}], "links": [["b", "p"]]}
	var out := M.evaluate(M.normalize_graph(g), {"kick": 0.5}, M.params_of({}), {}, 0.016)
	t.ok(out.cam_yaw > 0.99, "a bus bound to cam_yaw moves it (0.5 base + 0.5)")
	t.eq(M.evaluate(M.normalize_graph(g), {"kick": 0.0}, M.params_of({}), {}, 0.016).cam_yaw, 0.5, "unbound / silent: 0.5 = no offset")


## The backdrop quad is camera-attached: in camera space it is always `dist` straight ahead, filling the frustum exactly.
func test_backdrop_covers_the_frame_at_any_angle() -> void:
	for p in [Cam.HOME, Vector3(2.9, 1.3, 80.0), Vector3(-1.5, -1.4, 2.0), Vector3(PI, 0.0, 40.0)]:
		var cam := Cam.transform_of(p)
		for dist in [300.0, 2.0, 20.0]:
			var q := Cam.attach(cam, dist)
			var local := cam.affine_inverse() * q.origin
			t.ok(_near(local, Vector3(0, 0, -dist)), "pose %s dist %s: dead ahead in camera space" % [p, dist])
			t.ok(q.basis.is_equal_approx(cam.basis), "and facing the camera")
			var h := Cam.frustum_h(dist, 60.0)
			var top := cam.affine_inverse() * (q.origin + q.basis * Vector3(0, 0.5 * h, 0))
			t.ok(absf(rad_to_deg(atan(top.y / -top.z)) - 30.0) < 0.01, "a quad of frustum height reaches exactly the frame's top edge")
	t.ok(_near(Cam.attach(Cam.transform_of(Cam.HOME), 300.0).origin, Vector3(0, 0, 14.0 - 300.0)), "at home it is where the old world-space quad was")


func test_stage_follows_pose_and_flow() -> void:
	var s: Node3D = Stage.new()
	s._ready()
	t.ok(_near(s.camera.transform.origin, Vector3(0, 0, 14)), "default: the old camera")
	s.pose = Vector3(0.8, 0.2, 25.0)
	t.ok(_near(s.camera.transform.origin, Cam.transform_of(s.pose).origin), "a pose moves the camera at once")
	s.params = M.PARAM_DEFAULTS.duplicate()
	s.params.cam_yaw = 1.0
	s._process(0.016)
	t.ok(_near(s.camera.transform.origin, Cam.transform_of(Cam.offset(s.pose, s.params)).origin), "Flow's cam_yaw offsets it per frame")
	s.params.cam_yaw = 0.5
	s._process(0.016)
	t.ok(_near(s.camera.transform.origin, Cam.transform_of(s.pose).origin), "binding removed / silent: back on the pose")
	s.set_layers("shader", "")
	s._process(0.016)
	var q: MeshInstance3D = s.layers[0]._quad
	t.ok(_near(q.transform.origin, s.camera.transform * Vector3(0, 0, -300.0)), "the Shader backdrop rides on the camera")
	s.pose = Vector3(3.0, 1.2, 60.0)
	s._process(0.016)
	t.ok(_near(s.camera.transform.affine_inverse() * q.transform.origin, Vector3(0, 0, -300.0)), "at an extreme angle it is still dead ahead")
	s.free()


func test_deck_aligns_every_layer_and_keeps_pose_per_deck() -> void:
	var d: Node = Deck.new()
	d.apply([L.layer_of({"scene": "rings"}), L.layer_of({"scene": "tunnel"}), L.layer_of({"scene": "shader"})], {}, 0.0)
	d.cam = Vector3(1.0, 0.5, 30.0)
	t.eq(d.slots.map(func(s: Dictionary) -> Vector3: return s.stage.pose), [d.cam, d.cam, d.cam], "all three layers share the pose")
	d.apply([L.layer_of({"scene": "rings"}), L.layer_of({"scene": "tunnel"}), L.layer_of({"scene": "starfield"})], {}, 0.0)
	t.eq(d.slots.map(func(s: Dictionary) -> Vector3: return s.stage.pose), [d.cam, d.cam, d.cam], "a new layer starts on it too")
	d.free()
	var m: Node = preload("res://features/visuals/visuals_mixer.gd").new()
	m.go([L.layer_of({"scene": "rings"})], {}, 0.0, false, Vector3(0.5, 0.0, 20.0))
	t.eq(m.deck().cam, Vector3(0.5, 0.0, 20.0), "an edit puts the pose on the live deck")
	var before: Node = m.deck()
	m.go([L.layer_of({"scene": "tunnel"})], {}, 2.0, true, Vector3(-1.0, 0.3, 40.0))
	t.eq([m.deck().cam, before.cam], [Vector3(-1.0, 0.3, 40.0), Vector3(0.5, 0.0, 20.0)],
		"a look's pose is the incoming deck's; the outgoing deck keeps its own (no jump while it fades)")
	t.eq(m.deck().slots[0].stage.pose, Vector3(-1.0, 0.3, 40.0), "and its layers start there")
	m.free()


func test_looks_carry_the_camera() -> void:
	var s := M.slice_of({"visuals": {"camera": {"drive": true, "yaw": 0.9, "pitch": 0.3, "dist": 22.0}}})
	t.eq([s.camera.drive, s.camera.yaw], [true, 0.9], "the slice loads its camera")
	t.eq(M.slice_of({}).camera, Cam.normalize(null), "an older slice: home")
	var l := Looks.capture(s)
	t.eq(l.camera, s.camera, "a look stores it")
	s.camera.yaw = -1.0
	t.eq(l.camera.yaw, 0.9, "as a copy")
	var back := Looks.apply(s, l)
	t.eq([back.camera.yaw, back.camera.drive], [0.9, true], "and puts it back")
	t.eq(Looks.showing([l], back), 0, "the look shows while the camera matches")
	back.camera.yaw = 0.1
	t.eq(Looks.showing([l], back), -1, "not once the camera moved")
	t.eq(Looks.normalize([{"scene": "rings"}])[0].camera, Cam.normalize(null), "a look stored before WO-896 = home, not driving")


func test_tab_drive_and_looks() -> void:
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	var w = tab.work
	t.eq(tab.cam_ctl.pose(), Cam.HOME, "starts on the old camera")
	w.orbit = Vector3(1.0, 0.4, 25.0)
	w.orbit_changed.emit()
	t.eq(tab.mixer.deck().cam, Cam.HOME, "Drive off: orbiting leaves the output where it is")
	t.eq(tab.slice.camera.drive, false, "and nothing is stored")
	w.drive.button_pressed = true
	t.eq(tab.mixer.deck().cam, Vector3(1.0, 0.4, 25.0), "Drive on: the output takes the orbit")
	t.eq([tab.slice.camera.drive, tab.slice.camera.yaw], [true, 1.0], "and the slice stores it")
	w.orbit = Vector3(-0.5, 0.1, 18.0)
	w.orbit_changed.emit()
	t.eq(tab.mixer.deck().cam, Vector3(-0.5, 0.1, 18.0), "and keeps following")
	for st in tab.mixer.deck().slots:
		t.eq(st.stage.pose, Vector3(-0.5, 0.1, 18.0), "every layer of the stack")
	tab.page.show_panel.save.emit(-1)  # look 1: driving, yaw −0.5
	w.drive.button_pressed = false
	w.orbit = Vector3(2.0, 0.0, 10.0)
	w.orbit_changed.emit()
	t.eq(tab.mixer.deck().cam, Vector3(-0.5, 0.1, 18.0), "Drive off again: the output stays at its last pose")
	tab.page.show_panel.save.emit(-1)  # look 2: not driving, same pose
	t.eq(tab.show_ctl.looks.size(), 2, "two looks saved")
	t.eq([tab.show_ctl.looks[0].camera.drive, tab.show_ctl.looks[1].camera.drive], [true, false], "each with its own switch")
	var outgoing: Node = tab.mixer.deck()
	outgoing.cam = Vector3(0.0, 0.0, 50.0)  # what is on stage when the look is recalled
	tab.show_ctl.recall(0)
	t.eq([tab.slice.camera.drive, tab.slice.camera.yaw], [true, -0.5], "recall: the look's camera is back")
	t.eq(tab.mixer.deck().cam, Vector3(-0.5, 0.1, 18.0), "on the incoming deck")
	t.ok(tab.mixer.deck() != outgoing, "(a crossfade, other deck)")
	t.eq(outgoing.cam, Vector3(0.0, 0.0, 50.0), "the outgoing deck did not jump to it")
	t.eq([w.drive.button_pressed, w.orbit], [true, Vector3(-0.5, 0.1, 18.0)], "the switch shows and the orbit joins the pose")
	tab.show_ctl.recall(1)
	t.eq([w.drive.button_pressed, tab.mixer.deck().cam], [false, Vector3(-0.5, 0.1, 18.0)], "a look without Drive: switch off, its pose held")
	tab.free()
