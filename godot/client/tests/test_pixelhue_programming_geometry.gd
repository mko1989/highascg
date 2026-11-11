extends RefCounted
## WO-1039 — features/pixelhue/programming_geometry.gd: Studio's program-stage.js / group-geometry.js / layer-tools.js
## maths (values worked out from the JS), the stage's view transform and hit tests.

const G := preload("res://features/pixelhue/programming_geometry.gd")
var t

const SCREEN := {"id": 1, "width": 3072, "height": 1024, "x": 0, "y": 0,
	"outputs": [{"pos": {"x": 0, "y": 0, "width": 1536, "height": 1024}}, {"pos": {"x": 1536, "y": 0, "width": 1536, "height": 1024}}]}


func test_js_round() -> void:
	t.eq(G.jr(2.5), 3, "half up")
	t.eq(G.jr(-2.5), -2, "negative half towards +inf like Math.round")
	t.eq(G.jr(-2.6), -3, "negative")


func test_canvas_margin() -> void:
	t.eq(G.canvas_of(SCREEN), {"mx": 614, "my": 205, "width": 3072 + 1228, "height": 1024 + 410}, "20 % per side")


func test_move_and_resize() -> void:
	var o := G.win(100, 100, 400, 200)
	t.eq(G.move_window(o, 10.4, -20.6), G.win(110, 79, 400, 200), "move rounds")
	t.eq(G.move_window(o, 50, 30, "se"), G.win(100, 100, 450, 230), "se grows")
	t.eq(G.move_window(o, 50, 30, "nw"), G.win(150, 130, 350, 170), "nw keeps the se corner")
	t.eq(G.move_window(o, 1000, 0, "nw"), G.win(436, 100, 64, 200), "min 64, anchored right")
	t.eq(G.move_window(o, 100, 0, "se", 2.0), G.win(100, 100, 500, 250), "ratio follows width")
	t.eq(G.move_window(o, 0, 100, "se", 2.0), G.win(100, 100, 600, 300), "ratio follows height when it moved more")
	t.eq(G.move_window(o, 0, -100, "ne", 2.0), G.win(100, 0, 600, 300), "ne locked keeps the bottom")
	t.eq(G.move_window(o, -1000, 0, "se", 2.0), G.win(100, 100, 128, 64), "locked min height 64")


func test_snap() -> void:
	var w := G.win(5, 3, 400, 200)
	t.eq(G.snap_window(w, SCREEN, [], 10.0), G.win(0, 0, 400, 200), "snaps to the top-left edges")
	t.eq(G.snap_window(G.win(1330, 405, 400, 200), SCREEN, [], 10.0), G.win(1336, 412, 400, 200), "centre to the screen centre")
	t.eq(G.snap_window(G.win(500, 500, 400, 200), SCREEN, [], 10.0), G.win(500, 500, 400, 200), "nothing near")
	t.eq(G.snap_window(G.win(500, 500, 400, 200), SCREEN, [G.win(905, 0, 100, 100)], 10.0).x, 505, "right edge onto another layer's left")
	t.eq(G.snap_window(G.win(100, 100, 2967, 200), SCREEN, [], 10.0, "se"), G.win(100, 100, 2972, 200), "e handle snaps the right edge")
	t.eq(G.snap_window(G.win(100, 100, 2967, 200), SCREEN, [], 10.0, "se", 2.0), G.win(100, 100, 2972, 1486), "locked: height from the ratio")
	t.eq(G.snap_window(G.win(6, 4, 400, 200), SCREEN, [], 10.0, "nw"), G.win(0, 0, 406, 204), "nw snaps both edges")


func test_drop_window() -> void:
	t.eq(G.drop_window({"width": 1920, "height": 1080}, {"x": 1536, "y": 512}), G.win(576, -28, 1920, 1080), "native size centred")
	t.eq(G.drop_window({"width": 0, "height": 0}, {"x": 0, "y": 0}), G.win(-960, -540, 1920, 1080), "unknown size → 1080p")
	t.eq(G.drop_window({"width": 10, "height": 10}, {"x": 0, "y": 0}).width, 64, "min 64")


func _layers() -> Array:
	return [
		{"id": 1, "screenId": 1, "scene": 4, "name": "GRP1-H-A", "window": G.win(0, 0, 1000, 500), "aspectLocked": false, "zorder": 1},
		{"id": 2, "screenId": 1, "scene": 4, "name": "GRP1-H-B", "window": G.win(1000, 0, 500, 500), "aspectLocked": true, "zorder": 2},
		{"id": 3, "screenId": 1, "scene": 2, "name": "GRP1-H-B", "window": G.win(0, 0, 100, 100), "zorder": 1},
		{"id": 4, "screenId": 1, "scene": 4, "name": "Layer 3", "window": G.win(200, 200, 300, 300), "aspectLocked": false, "zorder": 3},
	]


func test_groups() -> void:
	t.eq(G.parse_group("GRP12-V-B"), {"group": 12, "orient": "V", "part": "B"}, "parse")
	t.eq(G.parse_group("Layer 1"), {}, "not a group")
	var ls := _layers()
	var g := G.group_of(ls, ls[1])
	t.eq(int(g.a.id), 1, "A member")
	t.eq(int(g.b.id), 2, "B member")
	t.eq(G.group_of(ls, ls[2]), {}, "incomplete pair on PGM")
	t.eq(G.union_window(ls[0].window, ls[1].window), G.win(0, 0, 1500, 500), "union")
	t.ok(absf(G.group_share(g) - 2.0 / 3.0) < 1e-9, "A share")
	t.eq(G.split_window(G.win(0, 0, 1500, 500), "H", 2.0 / 3.0), [G.win(0, 0, 1000, 500), G.win(1000, 0, 500, 500)], "split H")
	t.eq(G.split_window(G.win(0, 0, 100, 1000), "V", 0.01), [G.win(0, 0, 100, 64), G.win(0, 64, 100, 936)], "split V min 64")
	t.eq(G.group_size({"width": 1920, "height": 1080}, {}, "H"), {"width": 3840, "height": 1080, "share": 0.5}, "group size H")
	t.eq(G.group_size({"width": 1280, "height": 720}, {"width": 1920, "height": 1080}, "V").height, 1800, "group size V")
	t.eq(G.target_window(ls, ls[0]), G.win(0, 0, 1500, 500), "tools act on the union")
	t.ok(absf(G.keep_ratio(ls, ls[0]) - 3.0) < 1e-9, "a locked member locks the group")
	t.eq(G.keep_ratio(ls, ls[3]), 0.0, "unlocked layer")


func test_tools() -> void:
	var w := G.win(10, 20, 1000, 500)
	t.eq(G.align_window(w, SCREEN, "right"), G.win(2072, 20, 1000, 500), "right")
	t.eq(G.align_window(w, SCREEN, "center"), G.win(1036, 262, 1000, 500), "centre")
	t.eq(G.align_window(w, SCREEN, "bottom"), G.win(10, 524, 1000, 500), "bottom")
	t.eq(G.output_tile(G.win(2000, 0, 100, 100), SCREEN), G.win(1536, 0, 1536, 1024), "tile under the centre")
	t.eq(G.output_tile(G.win(-5000, 0, 100, 100), SCREEN), G.win(0, 0, 1536, 1024), "else the first tile")
	t.eq(G.output_tile(w, {"width": 10, "height": 10, "outputs": []}), {}, "no outputs")
	t.eq(G.native_window(w, {"width": 1920, "height": 1080}), G.win(-450, -270, 1920, 1080), "native centred")
	t.eq(G.native_window(w, {"width": 0, "height": 0}), {}, "no signal size")
	var scr := G.win(0, 0, 3072, 1024)
	t.eq(G.fill_window(scr), scr, "fill free")
	t.eq(G.fill_window(scr, 16.0 / 9.0), G.win(626, 0, 1820, 1024), "fit 16:9 into a wide screen")
	t.eq(G.fill_window(G.win(0, 0, 1000, 1000), 2.0), G.win(0, 250, 1000, 500), "fit into a tall target")
	t.eq(G.fill_axis(w, scr, "width"), G.win(0, 20, 3072, 500), "fill width free")
	t.eq(G.fill_axis(w, scr, "width", 2.0), G.win(0, -498, 3072, 1536), "fill width locked")
	t.eq(G.fill_axis(w, scr, "height", 2.0), G.win(-514, 0, 2048, 1024), "fill height locked")
	t.eq(G.nudge(w, -1, 0, 10), G.win(0, 20, 1000, 500), "nudge")
	t.eq(G.field_edit(w, "width", 500, 2.0), G.win(10, 20, 500, 250), "locked W edit")
	t.eq(G.field_edit(w, "height", 100, 2.0), G.win(10, 20, 200, 100), "locked H edit")
	t.eq(G.field_edit(w, "x", -50), G.win(-50, 20, 1000, 500), "free X edit")


func test_limits() -> void:
	t.ok(G.window_ok(G.win(-10, 0, 64, 64)), "64 ok")
	t.ok(not G.window_ok(G.win(0, 0, 63, 64)), "under 64")
	t.ok(not G.window_ok({"x": 0.5, "y": 0, "width": 100, "height": 100}), "fraction")
	t.ok(G.within_limits(G.win(-5000, 0, 100, 100), SCREEN, true), "roam anywhere")
	t.ok(not G.within_limits(G.win(-5000, 0, 100, 100), SCREEN, false), "no roam: inside only")
	t.eq(G.clamp_to_screen(G.win(-50, 1000, 5000, 100), SCREEN), G.win(0, 924, 3072, 100), "clamped inside")


func test_view_and_hits() -> void:
	var v := G.view_of(SCREEN, Vector2(430, 400))
	t.ok(absf(float(v.scale) - 0.1) < 1e-9, "scale fits the width")
	t.ok(absf(float(v.oy) - (400 - 143.4) / 2.0) < 1e-6, "vertically centred")
	var r := G.to_view(G.win(0, 0, 3072, 1024), v)
	t.ok(absf(r.position.x - 61.4) < 1e-3 and absf(r.size.x - 307.2) < 1e-3, "screen rect")
	var back := G.to_screen(r.position, v)
	t.ok(absf(float(back.x)) < 1e-2 and absf(float(back.y)) < 1e-2, "round trip")
	var ls := [{"id": 7, "window": G.win(0, 0, 1000, 1000), "zorder": 1, "name": "a"}, {"id": 8, "window": G.win(500, 0, 1000, 1000), "zorder": 2, "name": "b"}]
	var p := G.to_view(G.win(600, 100, 1, 1), v).position
	t.eq(G.hit(ls, null, p, v), {"id": 8, "handle": ""}, "topmost wins")
	var c := G.corner(G.to_view(ls[0].window, v), "se")
	t.eq(G.hit(ls, 7, c, v), {"id": 7, "handle": "se"}, "selected handle wins over the layer above")
	t.eq(G.hit(ls, null, Vector2(1, 1), v), {}, "empty canvas")
	t.eq(G.by_zorder([{"zorder": 3}, {"zorder": 1}])[0].zorder, 1, "back to front")
