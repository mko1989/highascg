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


func test_status_line() -> void:
	t.eq(P.status_line(null), "—")
	t.eq(P.status_line({"state": "idle"}), "idle")
	t.eq(P.status_line({"state": "following", "pan": 12.34, "tilt": -5.0}), "following  12.3° / -5.0°")
	t.eq(P.status_line({"state": "error", "error": "no host"}), "error  — no host")


## WO-713 R2 — offset_map normalizes like ptz-model.js (smoke-wo713-ptz-calibrate.test.js has the same cases).
func test_offset_map_normalize() -> void:
	var good := {"pan": 1.0, "tilt": 2.0, "dpan": 3.0, "dtilt": 4.0}
	t.eq(P.normalize_camera({}).offset_map, [])
	var c := P.normalize_camera({"offset_map": [good, {"pan": 1, "tilt": 2, "dpan": 3}, {"pan": null, "tilt": 2, "dpan": 3, "dtilt": 4},
		{"pan": true, "tilt": 2, "dpan": 3, "dtilt": 4}, {"pan": "x", "tilt": 2, "dpan": 3, "dtilt": 4},
		{"pan": "5", "tilt": 2, "dpan": 3, "dtilt": 4}, {"pan": 1e9, "tilt": -1e9, "dpan": 999, "dtilt": -999}, "junk", null]})
	t.eq(c.offset_map.size(), 3, "four real numbers or the pin goes")
	t.eq(c.offset_map[0], good)
	t.eq(c.offset_map[1].pan, 5.0, "numeric strings read like the server")
	t.eq(c.offset_map[2], {"pan": 720.0, "tilt": -360.0, "dpan": 180.0, "dtilt": -180.0}, "clamped")
	var many := []
	for i in 50:
		many.append({"pan": i, "tilt": 0, "dpan": 0, "dtilt": 0})
	var kept: Array = P.normalize_camera({"offset_map": many}).offset_map
	t.eq(kept.size(), P.MAX_PINS)
	t.eq(kept[-1].pan, 49.0, "newest last")
	t.eq(P.normalize_camera({"offset_map": "nope"}).offset_map, [])
