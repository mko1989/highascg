extends RefCounted
## WO-711 — ptz_model.gd answers like src/ptz/ptz-model.js (smoke-wo711-ptz-visca.test.js has the same cases).

const P := preload("res://features/previs/tracking/ptz_model.gd")
var t


func test_defaults() -> void:
	var c := P.normalize_camera({})
	t.eq(c.id, "ptz1")
	t.eq(c.name, "PTZ 1")
	t.eq(c.enabled, false, "disabled until ticked")
	t.eq(c.auto, false)
	t.eq(c.protocol, "visca-udp")
	t.eq(c.port, 1259)
	t.eq(P.normalize_camera({"protocol": "visca-ip"}).port, 52381)
	t.eq(c.address, 1)
	t.eq(c.pan, {"min": -170.0, "max": 170.0, "units_per_deg": 14.4, "invert": false})
	t.eq(c.tilt, {"min": -30.0, "max": 90.0, "units_per_deg": 14.4, "invert": false})
	t.eq(c.speed, {"pan": 12, "tilt": 10})
	t.eq(c.aim_z, 1.4)
	t.eq(c.home, {"preset": 0})
	t.eq(c.zoom, null)
	t.eq(c.pose, {"x": 0.0, "y": -8.0, "z": 2.5, "yaw": 0.0, "pitch": 0.0})


func test_junk_and_unique_ids() -> void:
	var l := P.normalize_list([{"id": "a", "port": 99999, "address": 12, "protocol": "telnet", "zoom": ""}, "x",
		{"id": "a", "pan": {"min": 50, "max": -50}}, {"enabled": 1, "host": 5, "aim_z": true}])
	t.eq(l.size(), 3)
	t.eq(l.map(func(c: Dictionary) -> String: return c.id), ["a", "a_", "ptz3"])
	t.eq(l[0].protocol, "visca-udp")
	t.eq(l[0].port, 65535)
	t.eq(l[0].address, 7)
	t.eq(l[0].zoom, null)
	t.eq([l[1].pan.min, l[1].pan.max], [-50.0, 50.0], "swapped bounds put right")
	t.eq(l[2].enabled, false, "only true enables")
	t.eq(l[2].host, "")
	t.eq(l[2].aim_z, 1.4, "a boolean is not a number")
	t.eq(P.normalize_list("nope"), [])
	t.eq(P.normalize_camera({"zoom": 8192.0}).zoom, 8192)


func test_new_camera_takes_lowest_free_id() -> void:
	var a := P.new_camera([])
	t.eq(a.id, "ptz1")
	t.eq(a.enabled, false)
	t.eq(P.new_camera([a, P.normalize_camera({"id": "ptz3"})]).id, "ptz2")


func test_straight_ahead_is_pan_zero() -> void:
	var c := P.normalize_camera({"pose": {"x": 0, "y": -8, "z": 2.5, "yaw": 0}})
	var a := P.aim_angles(c, {"x": 0.0, "y": 0.0, "z": 0.0})
	t.ok(absf(a.pan) < 1e-9, "pan 0")
	t.ok(absf(a.tilt - rad_to_deg(atan2(1.4 - 2.5, 8.0))) < 1e-9, "tilt down at the chest")
	t.eq(a.clamped, false)


func test_stage_left_is_pan_right() -> void:
	var c := P.normalize_camera({"pose": {"x": 0, "y": -8, "z": 2.5, "yaw": 0}})
	var left := P.aim_angles(c, {"x": 4.0, "y": 0.0, "z": 0.0})
	var right := P.aim_angles(c, {"x": -4.0, "y": 0.0, "z": 0.0})
	t.ok(absf(left.pan - rad_to_deg(atan2(4.0, 8.0))) < 1e-9, "stage left")
	t.ok(left.pan > 0.0 and right.pan < 0.0, "signs")
	var side := P.normalize_camera({"pose": {"x": -8, "y": 0, "z": 2.5, "yaw": 90}})
	t.ok(absf(P.aim_angles(side, {"x": 0.0, "y": 0.0, "z": 0.0}).pan) < 1e-9, "yaw 90 faces stage left")
	t.ok(P.aim_angles(side, {"x": 0.0, "y": 4.0, "z": 0.0}).pan < 0.0, "upstage is to its left")


func test_clamp_and_units() -> void:
	var c := P.normalize_camera({"pose": {"x": 0, "y": 0, "z": 2, "yaw": 0}, "pan": {"min": -90, "max": 90}})
	var behind := P.aim_angles(c, {"x": 1.0, "y": -5.0, "z": 0.0})
	t.eq(behind.pan, 90.0)
	t.eq(behind.clamped, true)
	t.eq(P.aim_angles(c, {"x": 0.0, "y": 0.0, "z": 40.0}).tilt, 90.0)
	t.eq(P.to_units({"units_per_deg": 14.4, "invert": false}, 170.0), 2448)
	t.eq(P.to_units({"units_per_deg": 14.4, "invert": false}, -170.0), -2448)
	t.eq(P.to_units({"units_per_deg": 14.4, "invert": true}, 10.0), -144)


func test_status_line() -> void:
	t.eq(P.status_line(null), "—")
	t.eq(P.status_line({"state": "idle"}), "idle")
	t.eq(P.status_line({"state": "following", "pan": 12.34, "tilt": -5.0}), "following  12.3° / -5.0°")
	t.eq(P.status_line({"state": "error", "error": "no host"}), "error  — no host")
