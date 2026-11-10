extends RefCounted
## WO-1029 C15 — features/live/remote_air_model.gd (scene.remoteLive of a screen on another server).

const R := preload("res://features/live/remote_air_model.gd")
var t


func test_entry_shapes_and_unknown() -> void:
	var arr := {"remoteLive": [null, {"pgm": {"sceneId": "s1", "name": "Bumper"}, "prv": null}]}
	t.eq(R.entry(arr, 1).pgm.name, "Bumper", "array")
	t.eq(R.entry({"remoteLive": {"2": {"pgm": null}}}, 2).has("pgm"), true, "dict by str idx")
	t.eq(R.entry({}, 1), {}, "older server: no remoteLive")
	t.eq(R.look(R.entry(arr, 0), "pgm").state, "unknown", "null entry = unknown")
	t.eq(R.look(R.entry({}, 0), "pgm").state, "unknown", "no remoteLive = unknown")
	t.eq(R.look(R.entry(arr, 1), "pgm"), {"state": "look", "id": "s1", "name": "Bumper"}, "look")
	t.eq(R.look(R.entry(arr, 1), "prv").state, "empty", "explicit null = nothing on air")
	t.eq(R.look({"pgm": null, "unknown": true}, "pgm").state, "unknown", "flagged unknown")
	t.eq(R.look({"pgm": {"name": "x"}}, "prv").state, "unknown", "bus key missing = unknown")


func test_flags_and_timer() -> void:
	var e := {"testcard": true, "ftb": false, "timeline": {"state": "playing", "position": 10000, "age": 1500}}
	t.eq([R.flag(e, "testcard"), R.flag(e, "ftb"), R.flag(e, "x"), R.flag({}, "ftb")], ["on", "off", "unknown", "unknown"], "flags")
	t.eq(R.timer_ms(e, 500.0), 12000.0, "playing: position + age + waited")
	t.eq(R.timer_ms({"timeline": {"state": "paused", "position": 7000, "age": 9000}}), 7000.0, "paused: fixed")
	t.eq(R.timer_ms({}), -1.0, "unknown")
	t.eq(R.summary({"pgm": {"name": "A"}, "prv": null, "testcard": true}), "PGM A · PRV — · test card", "summary")
	t.eq(R.summary({}), "", "nothing known")


func test_server_shape_of_dest_air_view() -> void:
	# the exact shape src/cluster/dest-air-view.js publishes
	var live := [null, {"server": {"id": "highascg5867", "name": "highascg5867"}, "destId": "d", "screen": 1, "unknown": false, "age_ms": 400,
		"pgm": {"sceneId": "s1", "name": "Bumper", "at": 1, "age_ms": 400}, "prv": null, "testcard": false, "ftb": null,
		"timeline": {"id": "t", "state": "playing", "position_ms": 5000, "at": 1, "age_ms": 400}, "holder": null, "clips": []}]
	var sc := {"remoteLive": live}
	var e := R.entry(sc, 1)
	t.eq([R.look(e, "pgm").name, R.look(e, "prv").state, R.flag(e, "testcard"), R.flag(e, "ftb")], ["Bumper", "empty", "off", "unknown"], "known entry")
	t.eq(R.timer_ms(e, 100.0), 5500.0, "position_ms + age_ms + waited")
	t.eq(R.server_name(e), "highascg5867", "owner name")
	var gone := {"server": {"id": "x", "name": "x"}, "unknown": true, "last_seen_age_ms": 20000, "pgm": null, "prv": null, "testcard": null, "ftb": null, "timeline": null}
	t.eq([R.look(gone, "pgm").state, R.timer_ms(gone), R.summary(gone)], ["unknown", -1.0, ""], "unknown entry: nothing claimed")
	t.eq(R.look(R.entry({"remoteLive": [null, null]}, 1), "pgm").state, "unknown", "nobody reported = unknown")
