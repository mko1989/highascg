extends RefCounted
## WO-1039 MVR — mvr_geometry.gd: the port of Studio's public/mvr-geometry.js, editor.js fit / dragWindow and
## mvr-sources.js placeWindow. Cases derived from the JS (Studio's own tests are not vendored).

const G := preload("res://features/pixelhue/mvr_geometry.gd")
const SCREEN := {"id": 7, "width": 1920, "height": 1080}
var t


func _w(x: int, y: int, w: int, h: int) -> Dictionary:
	return {"x": x, "y": y, "width": w, "height": h}


func _layer(id: int, win: Dictionary, extra := {}) -> Dictionary:
	var l := {"id": id, "screenId": 7, "name": "L%d" % id, "source": "", "window": win, "sourceId": id, "sourceType": 2,
		"umdHeight": 24, "aspectMode": 5, "aspectLock": null}
	l.merge(extra, true)
	return l


func test_jround_is_javascript_math_round() -> void:
	t.eq(G.jround(2.5), 3, "half up")
	t.eq(G.jround(-2.5), -2, "negative half goes up too (JS)")
	t.eq(G.jround(-0.4), 0, "small negative")


func test_overlaps_edge_touching_is_allowed() -> void:
	t.ok(not G.overlaps(_w(0, 0, 100, 100), _w(100, 0, 100, 100)), "touching edges do not overlap")
	t.ok(G.overlaps(_w(0, 0, 100, 100), _w(99, 99, 10, 10)), "one pixel inside overlaps")
	var a := _layer(1, _w(0, 0, 100, 100))
	var b := _layer(2, _w(50, 50, 100, 100))
	t.ok(G.has_overlap([a, b]), "same screen overlap")
	b.screenId = 8
	t.ok(not G.has_overlap([a, b]), "other screens never collide")
	t.ok(G.can_place(a, _w(10, 10, 50, 50), [a, b]), "a window never collides with itself")


func test_matches_ratio_counts_umd() -> void:
	# real P20 window: 400 × 249 with a 24 px UMD strip = 400 × 225 content = 16:9
	t.ok(G.matches_ratio(_w(1215, 22, 400, 249), 16.0 / 9.0, 24), "16:9 content above a 24 px strip")
	t.ok(not G.matches_ratio(_w(1215, 22, 400, 249), 16.0 / 9.0, 0), "without UMD it is not 16:9")
	t.ok(not G.matches_ratio(_w(0, 0, 400, 249), 16.0 / 9.0, null), "unknown UMD never matches")
	t.ok(G.matches_ratio(_w(0, 0, 400, 226), 16.0 / 9.0, 0), "within one pixel")


func test_ratio_size() -> void:
	t.eq(G.ratio_size(16.0 / 9.0, 400, 249, 400, 24), {"width": 400, "height": 249}, "fits as is")
	t.eq(G.ratio_size(16.0 / 9.0, 1920, 1080), {"width": 1920, "height": 1080}, "desired defaults to max")
	t.eq(G.ratio_size(16.0 / 9.0, 1920, 200, 1920, 0), {"width": 356, "height": 200}, "height-limited: width from height")
	t.eq(G.ratio_size(16.0 / 9.0, 100, 50, 100, 0), {}, "below 64 px")
	t.eq(G.ratio_size(16.0 / 9.0, 400, 249, 400, null), {}, "unknown UMD")
	t.eq(G.ratio_size(0.0, 400, 249), {}, "no ratio")
	t.eq(G.ratio_size(1.0, 400, 24, 400, 24), {}, "no room above the strip")


func test_fit_keeps_window_inside_output() -> void:
	t.eq(G.fit(_w(-10, 2000, 10, 5000), SCREEN), _w(0, 0, 64, 1080), "64 minimum, output maximum, clamped position")
	t.eq(G.fit(_w(1900, 1070, 100, 100), SCREEN), _w(1820, 980, 100, 100), "pushed back inside")


func test_drag_move_snaps() -> void:
	var o := _w(100, 100, 200, 200)
	t.eq(G.drag_window(o, 13, 3, SCREEN, ""), _w(113, 103, 200, 200), "no snap")
	t.eq(G.drag_window(o, 13, 3, SCREEN, "", 8), _w(112, 104, 200, 200), "8 px snap")
	t.eq(G.drag_window(o, -500, 5000, SCREEN, ""), _w(0, 880, 200, 200), "kept inside the output")


func test_drag_resize_from_corners() -> void:
	var o := _w(100, 100, 200, 200)
	t.eq(G.drag_window(o, 50, 20, SCREEN, "se"), _w(100, 100, 250, 220), "se grows right/down")
	t.eq(G.drag_window(o, 50, 50, SCREEN, "nw"), _w(150, 150, 150, 150), "nw anchored at the bottom-right")
	t.eq(G.drag_window(o, -500, 0, SCREEN, "nw"), _w(0, 100, 300, 200), "nw cannot pass the output's left edge")
	t.eq(G.drag_window(o, 300, 0, SCREEN, "ne"), _w(100, 100, 500, 200), "ne")
	t.eq(G.drag_window(o, 190, 0, SCREEN, "se"), _w(100, 100, 390, 200), "")
	t.eq(G.drag_window(o, -190, -190, SCREEN, "se"), _w(100, 100, 64, 64), "64 px minimum")
	t.eq(G.drag_window(o, 2000, 2000, SCREEN, "se", 1, 0.0, 0, {"width": 512, "height": 480}), _w(100, 100, 512, 480), "input limit caps the size")


func test_drag_resize_locked_keeps_content_ratio() -> void:
	var o := _w(0, 0, 400, 249)
	var r := 16.0 / 9.0
	t.eq(G.drag_window(o, -100, -100, SCREEN, "se", 1, r, 24), _w(0, 0, 300, 193), "300 wide → 169 content + 24 UMD")
	t.eq(G.drag_window(o, -100, 0, SCREEN, "se", 1, r, 24), _w(0, 0, 400, 249), "the larger of width / height wins (JS)")
	t.eq(G.drag_window(o, 100, 100, SCREEN, "se", 1, r, null), o, "unknown UMD: a locked window does not resize")


func test_order_geometry_changes() -> void:
	var a := _layer(1, _w(0, 0, 100, 100))
	var b := _layer(2, _w(200, 0, 100, 100))
	var swap := G.order_geometry_changes([a, b], [{"id": 1, "window": _w(200, 0, 100, 100)}, {"id": 2, "window": _w(0, 0, 100, 100)}])
	t.ok(str(swap.get("error", "")).begins_with("These moves would overlap during application"), "a direct swap has no order")
	var chain := G.order_geometry_changes([a, b], [{"id": 1, "window": _w(200, 0, 100, 100)}, {"id": 2, "window": _w(400, 0, 100, 100)}])
	t.eq(chain.ordered.map(func(c: Dictionary) -> int: return c.id), [2, 1], "B frees its space before A moves in")
	t.eq(a.window, _w(0, 0, 100, 100), "inputs are not changed")


func test_fix_aspect_ratios_fits_and_locks() -> void:
	var sig := [{"id": 1, "connected": true, "width": 1920, "height": 1080}, {"id": 2, "connected": false, "width": null, "height": null},
		{"id": 9, "sourceType": 3, "connected": true, "width": 3072, "height": 1024}]
	var layers := [_layer(1, _w(0, 0, 400, 300)), _layer(2, _w(500, 0, 400, 300)), _layer(3, _w(1000, 0, 300, 300), {"umdHeight": null, "sourceId": 1}),
		_layer(4, _w(0, 400, 400, 300), {"umdHeight": 0, "sourceId": 1}), _layer(5, _w(600, 400, 600, 300), {"sourceId": 9, "sourceType": 3})]
	var r := G.fix_aspect_ratios(layers, sig, SCREEN)
	var by := {}
	for l in r.layers:
		by[l.id] = l
	t.eq(by[1].window, _w(0, 25, 400, 249), "centred vertically, 16:9 content + UMD")
	t.eq(by[1].aspectLock, 16.0 / 9.0, "locked to the source ratio")
	t.eq(by[1].aspectMode, 5, "Custom lock with a UMD strip")
	t.eq(by[4].window, _w(0, 437, 400, 225), "no UMD")
	t.eq(by[4].aspectMode, 8, "Original lock without UMD")
	t.eq(by[5].window, _w(600, 438, 600, 224), "PGM source resolved by its screen signal: 3:1 + 24")
	t.eq(r.fixed, [1, 4, 5], "fixed")
	t.eq(r.skipped, [{"id": 2, "reason": "No connected input or valid screen resolution"}, {"id": 3, "reason": "UMD height unavailable from device configuration"}], "skipped with reasons")
	t.eq(layers[0].window, _w(0, 0, 400, 300), "the input is not mutated")


func test_fix_aspect_ratios_minimum_size_moves_to_free_space() -> void:
	var sig := [{"id": 1, "connected": true, "width": 3072, "height": 1024}]
	var r := G.fix_aspect_ratios([_layer(1, _w(0, 0, 64, 64))], sig, SCREEN)
	t.eq(r.layers[0].window, _w(0, 0, 120, 64), "3:1 at the 64 px minimum needs 120 × 64")
	var crowded := G.fix_aspect_ratios([_layer(1, _w(0, 0, 64, 64)), _layer(2, _w(64, 0, 1856, 1080), {"sourceId": 5}), _layer(3, _w(0, 64, 64, 1016), {"sourceId": 6})], sig, SCREEN)
	t.eq(crowded.skipped, [{"id": 2, "reason": "No connected input or valid screen resolution"}, {"id": 3, "reason": "No connected input or valid screen resolution"},
		{"id": 1, "reason": "No free space for this ratio at the 64 px minimum"}], "no room anywhere")
	t.ok(str(G.fix_aspect_ratios([_layer(1, _w(0, 0, 100, 100)), _layer(2, _w(50, 50, 100, 100))], sig, SCREEN).get("error", "")).begins_with("Resolve the existing window overlaps"), "overlaps first")


func test_window_limit() -> void:
	t.eq(G.window_limit("P20", 2), {"width": 512, "height": 480}, "P20 input")
	t.eq(G.window_limit("P20", 3), {}, "PGM is not limited")
	t.eq(G.window_limit("Q8", 2), {}, "Q8 is not limited")
	t.ok(G.grows_past_limit(_w(0, 0, 600, 300), _w(0, 0, 400, 300), {"width": 512, "height": 480}), "growing past")
	t.ok(not G.grows_past_limit(_w(0, 0, 600, 300), _w(0, 0, 700, 300), {"width": 512, "height": 480}), "shrinking an oversized window is allowed")
	t.ok(not G.grows_past_limit(_w(0, 0, 600, 300), _w(0, 0, 400, 300), {}), "no limit")
	t.eq(G.shrink_to_limit(_w(10, 10, 800, 600), {"width": 512, "height": 480}), _w(10, 10, 512, 480), "unlocked: clamp both")
	t.eq(G.shrink_to_limit(_w(10, 10, 800, 600), {"width": 512, "height": 480}, 16.0 / 9.0, 24), _w(10, 10, 512, 312), "locked: ratio kept")
	t.eq(G.shrink_to_limit(_w(10, 10, 300, 200), {"width": 512, "height": 480}), _w(10, 10, 300, 200), "inside: unchanged")


func test_place_window() -> void:
	var src := {"type": 2, "id": 25, "width": 1920, "height": 1080, "umdHeight": 24}
	t.eq(G.place_window(src, SCREEN, []), _w(720, 393, 480, 294), "a quarter of the output, centred, UMD included")
	t.eq(G.place_window(src, SCREEN, [], Vector2(0, 0)), _w(0, 0, 480, 294), "at the drop point, clamped")
	var no_signal := {"type": 2, "id": 2, "width": null, "height": null, "umdHeight": 0}
	t.eq(G.place_window(no_signal, SCREEN, []), _w(720, 405, 480, 270), "no signal: 16:9 fallback")
	var at := G.place_window(src, SCREEN, [_layer(1, _w(700, 380, 520, 320))])
	t.ok(not at.is_empty() and not G.overlaps(at, _w(700, 380, 520, 320)), "an occupied centre moves to the nearest free spot")
	t.eq(at.x % 8 + at.y % 8, 0, "free spots are on an 8 px grid")
	t.eq(G.place_window(src, SCREEN, [_layer(1, _w(0, 0, 1920, 1080))]), {}, "a full output has no room")
	var pgm := {"type": 3, "id": 1, "width": 3072, "height": 1024, "umdHeight": 24}
	t.eq(G.place_window(pgm, SCREEN, [], null, {}), _w(720, 448, 480, 184), "3:1 screen PGM")
	var big := {"type": 2, "id": 3, "width": 1920, "height": 1080, "umdHeight": 24}
	t.eq(G.place_window(big, {"width": 3840, "height": 2160}, [], null, {"width": 512, "height": 480}).width, 512, "input limit caps the width")
