extends RefCounted
## WO-599 T4 — operator_screen_model.gd: which server output each Godot screen shows, the prompt line, and when a
## fresh box prompts at start-up.

const P := preload("res://app/operator_screen_model.gd")
var t


func test_match_outputs() -> void:
	# the shop box: Godot lists DP-2 (+1920) first, the server lists DP-6 (0,0) first
	var screens := [Rect2i(1920, 0, 1920, 1080), Rect2i(0, 0, 1920, 1080)]
	var outputs := [{"name": "DP-6", "port": 4, "x": 0, "y": 0, "width": 1920, "height": 1080},
		{"name": "DP-2", "port": 2, "x": 1920, "y": 0, "width": 1920, "height": 1080, "current": true}]
	var m := P.match_outputs(outputs, screens)
	t.eq(m[0].name, "DP-2", "by origin, not by list order")
	t.eq(m[1].name, "DP-6")
	var scaled := [Rect2i(1930, 10, 1900, 1060)]
	t.eq(P.match_outputs(outputs, scaled)[0].name, "DP-2", "offset screen: the output holding its centre")
	t.eq(P.match_outputs(outputs, [Rect2i(9000, 0, 100, 100)])[0], {}, "no output there")
	t.eq(P.match_outputs([], screens).size(), 2, "one entry per screen")


func test_screen_line() -> void:
	t.eq(P.screen_line(0, {"name": "DP-2", "current": true}), "Screen 1 — DP-2 (operator screen now)")
	t.eq(P.screen_line(1, {"name": "DP-6"}), "Screen 2 — DP-6")
	t.eq(P.screen_line(2, {}), "Screen 3 — not a known output")


func test_should_auto_open() -> void:
	t.ok(P.should_auto_open(null, null, 2), "fresh two-screen box")
	t.ok(not P.should_auto_open(null, null, 1), "one screen: nothing to choose")
	t.ok(not P.should_auto_open({"x": 0, "y": 0}, null, 2), "a monitor resolves")
	t.ok(not P.should_auto_open(null, 2, 2), "a port is flagged")


func test_boot_countdown() -> void:  # WO-638
	t.eq(P.boot_countdown(120, "DP-0"), "DP-0 becomes the operator screen in 120 s")
	t.eq(P.boot_countdown(-3, "DP-4"), "DP-4 becomes the operator screen in 0 s")
	t.eq(P.boot_countdown(7, ""), "Choose the operator screen — 7 s")
