extends RefCounted
## WO-616 T11 — the follow patch (follow_model.gd, twin of src/fixtures/follow-patch.js) and the beam the server's
## aim draws (same frame as src/fixtures/follow-ik.js beam()).

const F := preload("res://features/previs/tracking/follow_model.gd")
var t


func test_normalize_defaults_and_ids() -> void:
	var d := F.normalize({})
	t.eq(d.output.enabled, false, "output starts off")
	t.eq(d.patch, [])
	var p := F.normalize({"output": {"enabled": true}, "patch": [{"id": "a", "universe": 99999, "address": 0},
		{"id": "a", "pose": {"hang": "floor"}}, "junk"]})
	t.eq(p.output.enabled, true)
	t.eq(p.patch.map(func(f: Dictionary) -> String: return f.id), ["a", "a_", "fx3"], "unique ids")
	t.eq(p.patch[0].universe, F.PORT_ADDRESS_MAX, "port-address clamped")
	t.eq(p.patch[0].address, 1)
	t.eq(p.patch[0].pan, {"ch": 1, "fine": 2, "range": 540.0, "invert": false}, "16-bit 540° pan default")
	t.eq(p.patch[0].pose.hang, "truss")
	t.eq(p.patch[1].pose.hang, "floor")
	t.eq(p.patch[0].dest, F.DEFAULT_DEST)


func test_output_protocol_and_psn() -> void:
	# WO-631 — same answers as smoke-wo631-psn-output.test.js normalizePsn / normalizePatch.
	var d := F.normalize({})
	t.eq(d.output.protocol, "psn", "PSN is the default output")
	t.eq(d.output.psn, {"group": "236.10.10.10", "port": 56565, "iface": "", "system_name": "HighAsCG", "axes": "stage"})
	t.eq(F.normalize({"output": {"protocol": "artnet"}}).output.protocol, "artnet")
	t.eq(F.normalize({"output": {"protocol": "sacn"}}).output.protocol, "psn")
	t.eq(F.normalize_psn({"group": "10.0.0.1"}).group, "236.10.10.10", "unicast refused")
	t.eq(F.normalize_psn({"group": "239.1.2.3"}).group, "239.1.2.3")
	t.eq(F.normalize_psn({"iface": "eth0"}).iface, "")
	t.eq(F.normalize_psn({"iface": "192.168.1.20", "axes": "y_up", "port": 7000.0}),
		{"group": "236.10.10.10", "port": 7000, "iface": "192.168.1.20", "system_name": "HighAsCG", "axes": "y_up"})


func test_output_through() -> void:
	# WO-632 — same answers as smoke-wo632 normalizeThrough.
	t.eq(F.normalize({}).output.through, {"enabled": false, "offset": 0, "fade_s": 1.0}, "read-through off by default")
	t.eq(F.normalize_through({"enabled": true, "offset": 4.4, "fade_s": 99}), {"enabled": true, "offset": 4, "fade_s": 30.0})


func test_new_fixture_follows_the_last() -> void:
	var a := F.new_fixture([], 2)
	t.eq([a.id, a.follow, a.address], ["fx1", 2, 1])
	a.universe = 5
	a.fixed = "6=255, 9=8"
	t.eq(F.footprint(a), 9, "fixed channels count")
	var b := F.new_fixture([a], 1)
	t.eq([b.id, b.universe, b.address, b.fixed], ["fx2", 5, 10, "6=255, 9=8"], "next free address, same profile")
	t.ok(is_equal_approx(b.pose.x, a.pose.x + 2.0))


func test_beam_frame_matches_the_server() -> void:
	var hung := {"hang": "truss", "yaw": 0.0}
	t.ok(F.beam(hung, 0, 0).is_equal_approx(Vector3(0, 0, -1)), "hung: tilt 0 = straight down")
	t.ok(F.beam(hung, 0, 45).is_equal_approx(Vector3(0, sqrt(0.5), -sqrt(0.5))), "tilt + swings to yaw 0 = upstage")
	t.ok(F.beam({"hang": "floor", "yaw": 0.0}, 90, 45).is_equal_approx(Vector3(sqrt(0.5), 0, sqrt(0.5))), "standing: pan + clockwise from above")
	t.ok(F.beam({"hang": "truss", "yaw": 90.0}, 0, 90).is_equal_approx(Vector3(1, 0, 0)), "yaw 90 = stage left")


func test_beams_end_at_the_marker_or_the_floor() -> void:
	var fx := F.normalize_fixture({"id": "a", "name": "A", "follow": 1, "aim_z": 1.0, "pose": {"x": 0, "y": 0, "z": 6}}, 0)
	var e := F.beam_end(fx, {"pan": 0.0, "tilt": 45.0}, null, 0.0)
	t.ok(Vector3(e[0], e[1], e[2]).is_equal_approx(Vector3(0, 6, 0)), "no marker: down to the floor %s" % [e])
	var m := F.beam_end(fx, {"pan": 0.0, "tilt": 45.0}, [0.0, 5.0, 0.0], 0.0)
	t.ok(is_equal_approx(Vector3(m[0], m[1], m[2]).distance_to(Vector3(0, 0, 6)), Vector3(0, 5, 1).distance_to(Vector3(0, 0, 6))), "marker: as long as the aim")
	var bs := F.beams([fx, F.normalize_fixture({"id": "b"}, 1), F.normalize_fixture({"id": "c"}, 2)],
		{"a": {"state": "following", "pan": 0.0, "tilt": 45.0}, "c": {"state": "not output", "problem": "bad"}}, {}, 0.0)
	t.eq(bs.size(), 1, "unreported and problem fixtures are not drawn")
	t.eq([bs[0].name, bs[0].live], ["A", true])


## WO-624 E3: the server's calibration solve applied to a fixture, and the Inspector line.
func test_calibration_solve_applies_pose_and_pan_flip() -> void:
	var fx := F.normalize_fixture({"id": "a", "pose": {"x": 0, "y": 0, "z": 6, "hang": "floor", "yaw": 0}}, 0)
	var solve := {"ok": true, "pose": {"x": 3.0, "y": 5.0, "z": 7.01, "yaw": 30.1, "hang": "truss"}, "flip_pan": true,
		"rms_deg": 0.12, "max_deg": 0.2, "warning": null}
	var out := F.apply_solve(fx, solve)
	t.eq([out.pose.x, out.pose.y, out.pose.z, out.pose.yaw], [3.0, 5.0, 7.01, 30.1])
	t.eq(out.pose.hang, "floor", "the hang stays the operator's")
	t.eq(out.pan.invert, true, "a mirrored pan flips Invert pan")
	t.eq(fx.pose.x, 0.0, "the input is not touched")
	t.eq(F.apply_solve(fx, {"ok": false, "need": 2}), fx, "no solve → unchanged")
	var line := F.calib_summary({"points": [{}, {}, {}, {}], "solve": solve})
	t.ok(line.begins_with("4 points · fit 0.12° RMS (max 0.20°) → X 3.00  Y 5.00  Z 7.01  yaw 30.1°"), line)
	t.ok(line.contains("Invert pan"), line)
	t.eq(F.calib_summary({"points": [{}], "solve": {"ok": false, "need": 2}}), "1 point — 2 more to solve.")
	# WO-616 T13b: the beam spot the server found
	t.eq(F.spot_line({"at": [1.5, 2.04, 0], "px": [1012.4, 655.9], "contrast": 180, "reference": true}),
		"Beam spot at X 1.50  Y 2.04 (pixel 1012, 655 · contrast 180 · vs reference)")
	t.eq(F.spot_line({"ok": false, "peak": 60}), "", "no floor point → no line")
	t.eq(F.spot_line(null), "")
