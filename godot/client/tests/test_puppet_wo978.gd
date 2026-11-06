extends RefCounted
## WO-978 — the test puppet's Markers row (puppet_model.gd) and the hub markers on the 3D stage (marker_pins_3d.gd).

const PM := preload("res://features/previs/tracking/puppet_model.gd")
const Pins := preload("res://features/previs/tracking/marker_pins_3d.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
var t


func test_summary() -> void:
	t.ok(PM.summary(null).begins_with("No answer"), "no server answer")
	t.ok(PM.summary({}).begins_with("No answer"), "empty answer")
	var on := {"enabled": true, "id": 1.0, "name": "Puppet", "position": {"x": 1.26, "y": -2.0}, "ends_in_s": 7170.0}
	t.eq(PM.summary(on), "ON — marker 1 \"Puppet\" at 1.3, -2.0 m · it switches itself off in 120 min", "on: id, name, where, time left")
	t.ok(PM.summary({"enabled": false, "stopped": "ttl"}).begins_with("Off — it switched itself off"), "time limit said")
	t.ok(PM.summary({"enabled": false, "stopped": null}).begins_with("Off. "), "plain off")
	t.eq(PM.summary({"enabled": false, "error": "marker 1 is live from \"detect\""}), "Refused: marker 1 is live from \"detect\"",
		"a 409 shows its reason")


func test_body() -> void:
	t.eq(PM.body(true, "line", 1.234, 3.0), {"enabled": true, "pattern": "line", "speed": 1.23, "size": 3.0}, "body")
	t.eq(PM.body(false, "bogus", 1.0, 2.0).pattern, "circle", "unknown path → circle")
	t.eq(PM.PATTERNS.size(), PM.LABELS.size(), "one label per path")
	for p in ["hold", "circle", "figure8", "line", "walk"]:
		t.ok(p in PM.PATTERNS, "server path %s offered" % p)


func test_pin_look() -> void:
	var a := Pins.look({"id": 1.0, "name": "Puppet", "source": "puppet"})
	t.eq(a.text, "Puppet · test puppet", "the puppet says it is the test puppet")
	t.eq(a.color, Pins.PUPPET, "puppet colour")
	var b := Pins.look({"id": 7.0, "name": "", "source": "operator", "stale": true})
	t.eq(b.text, "Marker 7", "unnamed marker")
	t.ok(is_equal_approx(b.color.a, Pins.STALE_ALPHA) and b.color.r == Pins.OTHER.r, "stale is dimmed, other colour")


func test_pins_follow_the_hub() -> void:
	var pins: Node3D = Pins.new()
	pins.show_markers([{"id": 1.0, "x": 2.0, "y": 3.0, "z": 1.7, "source": "puppet", "name": "Puppet"}, {"id": 2.0, "x": 0.0, "y": 0.0, "z": 0.0}, "junk"])
	t.eq(pins.count(), 2, "one pin per marker, junk skipped")
	var root: Node3D = pins._pins[1].root
	t.eq(root.position, C.psn_to_godot([2.0, 3.0, 0.0]), "on the floor under the marker (PSN → Godot)")
	t.eq((pins._pins[1].ball as Node3D).position, Vector3(0, 1.7, 0), "ball at the marker's height")
	t.eq((pins._pins[2].ball as Node3D).position, Vector3(0, Pins.MIN_H, 0), "a floor marker still gets a pole")
	pins.show_markers([{"id": 2.0, "x": 1.0, "y": 0.0, "z": 0.0}])
	t.eq(pins.count(), 1, "a marker gone from the hub loses its pin")
	pins.show_markers(null)
	t.eq(pins.count(), 0, "no list → no pins")
	pins.free()


func test_wired() -> void:
	var tab := FileAccess.get_file_as_string("res://features/previs/previs_tab.gd")
	t.ok(tab.contains("preload(\"res://features/previs/tracking/marker_pins_3d.gd\").new()"), "previs stage gets the pins")
	var ms := FileAccess.get_file_as_string("res://features/previs/tracking/markers_section.gd")
	t.ok(ms.contains("preload(\"res://features/previs/tracking/puppet_row.gd\").new()"), "Markers section gets the puppet row")
	t.ok(FileAccess.get_file_as_string("res://features/previs/tracking/puppet_row.gd").contains("HelpDialog.beside(_on, \"tracking-desk-test\")"),
		"the row's \"?\" opens the desk test page")
