extends RefCounted
## WO-599 T4 — window_placement.gd: the operator monitor from GET /api/system/operator-display → a Godot screen;
## the UI scale per screen size (the kiosk's operator-gui-scale.js rule).

const P := preload("res://app/window_placement.gd")
var t


func test_pick_screen() -> void:
	# the shop box: DP-2 (operator) at +1920 listed first, DP-6 (a Caspar output) at 0,0
	var box := [Rect2i(1920, 0, 1920, 1080), Rect2i(0, 0, 1920, 1080)]
	t.eq(P.pick_screen({"x": 1920, "y": 0, "width": 1920, "height": 1080}, box), 0, "the operator monitor by origin")
	t.eq(P.pick_screen({"x": 0, "y": 0, "width": 1920, "height": 1080}, box), 1)
	t.eq(P.pick_screen({"x": 1930, "y": 10, "width": 1900, "height": 1060}, box), 0, "an inset rect: the screen holding its centre")
	t.eq(P.pick_screen({"x": 9000, "y": 0, "width": 100, "height": 100}, box), -1, "no such screen")
	t.eq(P.pick_screen(null, box), -1, "no answer from the server")
	t.eq(P.pick_screen({"x": 0, "y": 0}, []), -1, "headless: no screens")


func test_ui_scale() -> void:
	t.eq(P.ui_scale(Vector2i(1920, 1080)), 1.0)
	t.eq(P.ui_scale(Vector2i(1280, 720)), 1.0, "never below 1")
	t.eq(P.ui_scale(Vector2i(3840, 2160)), 2.0)
	t.eq(P.ui_scale(Vector2i(2560, 1440)), 1.33)
	t.eq(P.ui_scale(Vector2i(3840, 1080)), 1.0, "the tighter axis decides")
	t.eq(P.ui_scale(Vector2i(0, 0)), 1.0, "headless")
	t.eq(P.ui_scale(Vector2i(3840, 2160), 1.5), 1.5, "the override wins")
	t.eq(P.ui_scale(Vector2i(1920, 1080), 9.0), 4.0, "override clamped")
