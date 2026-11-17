extends RefCounted
## WO-1109 — camera_slider_model.gd: the Previs camera slider's poses and moves (normalize, sample, phase per mode and
## ease, the pose ⇄ orbit round trip the orbit camera relies on, degenerate poses without NaN).

const M := preload("res://features/previs/camera/camera_slider_model.gd")
var t


func _move(extra := {}) -> Dictionary:
	var m := {"id": "m1", "name": "Push in", "a": M.pose(Vector3(0, 2, 10), Vector3(0, 1, 0), 50.0),
		"b": M.pose(Vector3(4, 3, 4), Vector3(2, 1, 0), 30.0), "duration_s": 10.0, "ease": "linear", "mode": "once"}
	m.merge(extra, true)
	return M.normalize_move(m)


func _near(a: Vector3, b: Vector3, eps := 1e-4) -> bool:
	return a.distance_to(b) < eps


func test_normalize_defaults_clamps_and_keeps_unknown_keys() -> void:
	var c := M.normalize({"moves": [
		{"a": {"pos": [0, 1, 2], "look": [0, 0, 0]}, "duration_s": 9999, "ease": "bounce", "mode": "?", "note": "x"},
		{"id": "m1", "a": {"pos": [1, 1, 1], "look": [0, 0, 0], "fov": 500}, "b": {"pos": ["x", 1, 1], "look": [0, 0, 0]},
			"duration_s": 0.01},
		{"a": {"pos": [1, 1], "look": [0, 0, 0]}},  # junk: A has two numbers
		"junk", null], "active": "nope", "extra": 7})
	t.eq(c.moves.size(), 2, "junk moves dropped")
	t.eq(c.extra, 7, "unknown slice key kept")
	var m0: Dictionary = c.moves[0]
	t.eq(m0.id, "m1", "missing id → m<n>")
	t.eq(m0.name, "Move 1", "missing name → Move <n>")
	t.eq(m0.duration_s, M.MAX_DURATION, "duration clamped up to 600 s")
	t.eq(m0.ease, "smooth", "unknown ease → smooth")
	t.eq(m0.mode, "pingpong", "unknown mode → pingpong")
	t.eq(m0.note, "x", "unknown move key kept")
	t.eq(m0.a.fov, M.DEFAULT_FOV, "missing fov → 50")
	t.eq(m0.b, m0.a, "missing B = A (a still shot)")
	var m1: Dictionary = c.moves[1]
	t.eq(m1.id, "m1-2", "duplicate ids made unique")
	t.eq(m1.duration_s, M.MIN_DURATION, "duration clamped to 0.5 s")
	t.eq(m1.a.fov, 120.0, "fov clamped")
	t.eq(m1.b, m1.a, "a non-numeric B falls back to A")
	t.eq(c.active, "m1", "an unknown active → the first move")
	t.eq(M.normalize(null), {"moves": [], "active": ""}, "nothing → empty slice")
	t.eq(M.normalize({"moves": [], "active": "m3"}).active, "", "no moves → no active")
	t.ok(M.normalize_move({"a": {"pos": [NAN, 0, 0], "look": [0, 0, 0]}}) == null, "NaN is junk")


func test_of_project_and_new_move() -> void:
	var p := {"previs": {"camera": {"moves": [_move()], "active": "m1"}}}
	var c := M.of_project(p)
	t.eq(c.active, "m1", "read from project.previs.camera")
	t.eq(M.of_project({}).moves, [], "no previs → no moves")
	var n := M.new_move(c, M.pose(Vector3(1, 2, 3), Vector3.ZERO))
	t.eq(n.id, "m2", "next free id")
	t.eq(n.name, "Move 2", "next free name")
	t.eq(n.a, n.b, "a new move starts and ends at the current view")
	t.eq(n.mode, "pingpong", "default mode")
	t.eq(n.ease, "smooth", "default ease")
	t.eq(n.duration_s, 12.0, "default duration")
	t.eq(M.find(c, "m1").name, "Push in", "find by id")
	t.eq(M.find(c, "zz"), {}, "find a missing id")


func test_sample_lerps_position_look_and_fov() -> void:
	var m := _move()
	t.eq(M.sample(m, 0.0), m.a, "t 0 = A")
	t.eq(M.sample(m, 1.0), m.b, "t 1 = B")
	var mid := M.sample(m, 0.5)
	t.ok(_near(M.pos_of(mid), Vector3(2, 2.5, 7)), "position halfway")
	t.ok(_near(M.look_of(mid), Vector3(1, 1, 0)), "look point halfway (the subject stays framed)")
	t.eq(mid.fov, 40.0, "fov halfway")
	t.eq(M.sample(m, 7.0), m.b, "t clamped")
	t.eq(M.sample(m, NAN), m.a, "NaN t → A")


func test_eases() -> void:
	for e in M.EASES:
		t.eq(M.eased(0.0, e), 0.0, "%s starts at 0" % e)
		t.eq(M.eased(1.0, e), 1.0, "%s ends at 1" % e)
		var prev := -1.0
		var mono := true
		for i in 21:
			var v := M.eased(i / 20.0, e)
			mono = mono and v >= prev
			prev = v
		t.ok(mono, "%s is monotonic" % e)
	t.eq(M.eased(0.5, "smooth"), 0.5, "smooth is symmetric")
	t.ok(M.eased(0.1, "smooth") < 0.1 and M.eased(0.9, "smooth") > 0.9, "smooth starts and stops gently")
	t.ok(M.eased(0.5, "in") < 0.5 and M.eased(0.5, "out") > 0.5, "in starts slow, out ends slow")


func test_phase_once_loop_pingpong() -> void:
	var once := _move()
	t.eq(M.phase(once, 0.0), 0.0, "once: A at start")
	t.eq(M.phase(once, 5.0), 0.5, "once: halfway at half the duration")
	t.eq(M.phase(once, 25.0), 1.0, "once: holds B")
	t.ok(M.done(once, 10.0) and not M.done(once, 9.9), "once: done at the duration")
	var loop := _move({"mode": "loop"})
	t.eq(M.phase(loop, 12.5), 0.25, "loop: wraps to A")
	t.ok(not M.done(loop, 100.0), "a loop never ends")
	var pp := _move({"mode": "pingpong"})
	t.eq(M.phase(pp, 5.0), 0.5, "ping-pong: out")
	t.eq(M.phase(pp, 10.0), 1.0, "ping-pong: at B")
	t.eq(M.phase(pp, 15.0), 0.5, "ping-pong: on its way back")
	t.eq(M.phase(pp, 20.0), 0.0, "ping-pong: back at A")
	var pps := _move({"mode": "pingpong", "ease": "smooth"})
	t.ok(absf(M.phase(pps, 2.0) - M.phase(pps, 18.0)) < 1e-9, "the way back uses the same ease")
	t.eq(M.phase(pp, -3.0), 0.0, "negative time → A")
	t.eq(M.phase(pp, NAN), 0.0, "NaN time → A")


func test_elapsed_at_inverts_the_ease() -> void:
	for e in M.EASES:
		var m := _move({"ease": e})
		for want in [0.0, 0.2, 0.5, 0.9, 1.0]:
			t.ok(absf(M.phase(m, M.elapsed_at(m, want)) - want) < 1e-6, "%s: resume at %s" % [e, want])


func test_pose_orbit_round_trip() -> void:
	for spec in [[Vector3(0, 2.2, 0), -0.35, 0.18, 12.0], [Vector3(3, 1, -4), 2.9, -0.15, 5.5], [Vector3(-1, 0, 2), -3.0, 1.4, 30.0]]:
		var p := M.pose_of_orbit(spec[0], spec[1], spec[2], spec[3], 42.0)
		var o := M.orbit_of(p)
		t.ok(_near(o.target, spec[0]), "target back %s" % [spec])
		t.ok(absf(float(o.dist) - spec[3]) < 1e-4, "dist back")
		t.ok(absf(wrapf(float(o.yaw) - spec[1], -PI, PI)) < 1e-4, "yaw back")
		t.ok(absf(float(o.pitch) - spec[2]) < 1e-4, "pitch back")
		t.eq(o.fov, 42.0, "fov back")
		t.ok(_near(M.pos_of(M.pose_of_orbit(o.target, o.yaw, o.pitch, o.dist)), M.pos_of(p)), "pose → orbit → pose")
		var xf := M.transform_of(p)
		t.ok(_near(xf.origin, M.pos_of(p)), "transform at the position")
		t.ok(_near(-xf.basis.z, (M.look_of(p) - M.pos_of(p)).normalized()), "…looking at the look point")


func test_degenerate_poses_never_nan() -> void:
	var same := M.pose(Vector3(1, 2, 3), Vector3(1, 2, 3))
	var o := M.orbit_of(same)
	t.ok(not is_nan(o.yaw) and not is_nan(o.pitch) and o.dist > 0.0, "position = look point: a direction, no NaN")
	var xf := M.transform_of(same)
	t.ok(not is_nan(xf.origin.x) and not is_nan(xf.basis.z.x), "…and a valid camera transform")
	var up := M.orbit_of(M.pose(Vector3(0, 10, 0), Vector3.ZERO))
	t.ok(up.pitch <= M.MAX_PITCH, "straight down is held short of the pole (look_at with UP)")
	var still := _move({"b": _move().a})
	t.eq(M.sample(still, 0.7), still.a, "A = B samples A everywhere")
	t.eq(M.phase(_move({"duration_s": 0.0}), 1.0), M.phase(_move({"duration_s": M.MIN_DURATION}), 1.0), "a zero duration is the minimum")
