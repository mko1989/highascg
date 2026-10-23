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


func test_live_rect() -> void:
	# box 21.10: the plan put the operator (DP-0) at 0,0, X still had DP-4 at 0,0 and DP-0 at +1920
	var plan := {"x": 0, "y": 0, "width": 1920, "height": 1080, "sysId": "DP-0"}
	var outs := [{"name": "DP-4", "x": 0, "y": 0, "width": 1920, "height": 1080}, {"name": "DP-0", "x": 1920, "y": 0, "width": 1920, "height": 1080}]
	var r: Dictionary = P.live_rect(plan, outs)
	t.eq([r.x, r.sysId], [1920, "DP-0"], "the named output's live place")
	var box := [Rect2i(0, 0, 1920, 1080), Rect2i(1920, 0, 1920, 1080)]
	t.eq(P.pick_screen(r, box), 1, "so the client lands on DP-0, not on PGM")
	t.eq(P.live_rect(plan, [{"name": "DP-6", "x": 5}]), plan, "an unknown output keeps the plan")
	t.eq(P.live_rect(plan, null), plan, "no outputs answer keeps the plan")
	t.eq(P.live_rect(null, outs), null, "no rect stays none")


func test_off_box_window_fits_the_layout() -> void:  # WO-688: a laptop window narrower than 1920 cut off the right edge
	var w := Window.new()
	P.fit(w, false, 0.0)
	t.eq(w.content_scale_mode, Window.CONTENT_SCALE_MODE_CANVAS_ITEMS, "off-box: the layout stretches to the window")
	t.eq(w.content_scale_aspect, Window.CONTENT_SCALE_ASPECT_EXPAND, "expand: the longer side gets more room, nothing is cut")
	t.eq(w.content_scale_size, Vector2i(1920, 1080), "fitted from the 1080p layout")
	t.eq(w.content_scale_factor, 1.0, "auto: the stretch alone")
	P.fit(w, false, 1.25)
	t.eq(w.content_scale_factor, 1.25, "the operator's UI-scale choice on top")
	var b := Window.new()
	P.fit(b, true, 1.5)
	t.eq(b.content_scale_mode, Window.CONTENT_SCALE_MODE_DISABLED, "on the box: no stretch (unchanged)")
	t.eq(b.content_scale_factor, 1.5, "on the box: the factor as before")
	w.free()
	b.free()


func test_window_mode_no_title_bar_on_the_box() -> void:  # WO-714: "fullscreen mode without the system top bar"
	var m := P.window_mode({}, true)
	t.eq(m.get("mode"), Window.MODE_MAXIMIZED, "on the box: the whole screen")
	t.eq(m.get("borderless"), true, "no Openbox title bar")
	t.ok(P.window_mode({}, false).is_empty(), "off-box (WO-688 laptop window): the window manager's frame stays")
	t.ok(P.window_mode({"windowed": "1"}, true).is_empty(), "--windowed opts out on the box")
	t.eq(P.window_mode({"fullscreen": "1"}, false).get("mode"), Window.MODE_EXCLUSIVE_FULLSCREEN, "--fullscreen as before")
	t.eq(P.window_mode({"fullscreen": "1", "windowed": "1"}, true).get("mode"), Window.MODE_EXCLUSIVE_FULLSCREEN, "--fullscreen wins")
