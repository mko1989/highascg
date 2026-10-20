extends RefCounted
## WO-621 N1 — compose_tile_math.gd: the operator compose windows' move / resize rules (web
## operator-compose-tiles-geometry.js snapToGrid / clampTileRect / MIN_BODY, applied to the picture rect).

const TM := preload("res://features/live/compose_tile_math.gd")
const C := Vector2(1920, 1080)
var t


func test_px_frac_round_trip() -> void:
	var f := {"x": 0.225520833333333, "y": 0.174537037037037, "w": 0.2625, "h": 0.155555555555556}
	var p := TM.to_px(f, C)
	t.ok(p.is_equal_approx(Rect2(433, 188.5, 504, 168)), "server cell → canvas px")
	var back := TM.to_frac(p, C)
	for k in f:
		t.ok(is_equal_approx(back[k], f[k]), "round trip " + k)


func test_move_snaps_and_clamps() -> void:
	var s := Rect2(433, 188.5, 504, 168)
	t.eq(TM.moved(s, Vector2(10, 3), C), Rect2(440, 192, 504, 168), "snapped to the 8 px grid")
	t.eq(TM.moved(s, Vector2(-1000, -1000), C), Rect2(0, 0, 504, 168), "stops at the top-left edge")
	t.eq(TM.moved(s, Vector2(5000, 5000), C), Rect2(1416, 912, 504, 168), "stops at the bottom-right edge")


func test_resize_keeps_aspect() -> void:
	var s := Rect2(400, 200, 480, 270)
	var r := TM.resized(s, Vector2(96, 10), C)
	t.eq(r.position, s.position, "the top-left corner stays put")
	t.ok(is_equal_approx(r.size.x / r.size.y, 16.0 / 9.0), "aspect kept")
	t.eq(r.size.x, 576.0, "width wins (larger relative change), snapped")
	var v := TM.resized(s, Vector2(0, 90), C)
	t.eq(v.size.y, 360.0, "height wins, snapped")
	t.ok(is_equal_approx(v.size.x, 640.0), "width follows")


func test_resize_limits() -> void:
	var s := Rect2(400, 200, 480, 270)
	var small := TM.resized(s, Vector2(-1000, 0), C)
	t.eq(small.size, Vector2(160, 90), "never below MIN at 16:9")
	var big := TM.resized(s, Vector2(5000, 0), C)
	t.ok(big.end.x <= C.x + 0.001 and big.end.y <= C.y + 0.001, "never past the canvas")
	t.ok(is_equal_approx(big.size.x / big.size.y, 16.0 / 9.0), "capped without distortion")
	var tall := TM.resized(Rect2(0, 0, 90, 160), Vector2(-500, 0), C)
	t.eq(tall.size, Vector2(160, 160 * 16.0 / 9.0), "portrait: the width minimum binds, height follows the aspect")


func test_hit_topmost_and_label_strip() -> void:
	var rects := [Rect2(0, 0, 100, 100), Rect2(50, 50, 100, 100)]
	t.eq(TM.hit(rects, Vector2(60, 60)), 1, "overlap → the later (topmost) window")
	t.eq(TM.hit(rects, Vector2(10, 10)), 0, "only the first")
	t.eq(TM.hit(rects, Vector2(60, 160)), -1, "below the picture without a strip")
	t.eq(TM.hit(rects, Vector2(60, 160), 20.0), 1, "the label strip counts")
	t.eq(TM.hit(rects, Vector2(300, 300), 20.0), -1, "outside every window")


func test_source_aspect_and_fit() -> void:
	var cm := {"programChannels": [1], "previewChannels": [2],
		"channelResolutionsByChannel": {"1": {"w": 1920, "h": 1080}, "2": {"w": 1080, "h": 1920}},
		"programResolutions": [{"w": 3840, "h": 1080}]}
	t.ok(is_equal_approx(TM.source_aspect({"role": "pgm", "mainIndex": 0}, cm), 16.0 / 9.0), "PGM → its channel")
	t.ok(is_equal_approx(TM.source_aspect({"role": "prv", "mainIndex": 0}, cm), 9.0 / 16.0), "PRV → the preview channel")
	t.ok(is_equal_approx(TM.source_aspect({"role": "pgm", "mainIndex": 0, "srcW": 4, "srcH": 3}, cm), 4.0 / 3.0), "own srcW/H win")
	t.ok(is_equal_approx(TM.source_aspect({"role": "pgm", "mainIndex": 0}, {"programResolutions": [{"w": 3840, "h": 1080}]}), 3840.0 / 1080.0), "screen resolution before INFO")
	t.ok(is_equal_approx(TM.source_aspect({"role": "pgm", "mainIndex": 3}, cm), 16.0 / 9.0), "unknown → 16:9")
	t.ok(is_equal_approx(TM.source_aspect({"role": "pgm", "mainIndex": 0}, null), 16.0 / 9.0), "no channel map → 16:9")
	t.eq(TM.fit(Rect2(433, 188, 504, 168), 16.0 / 9.0), Rect2(535.6666666666666, 188, 298.6666666666667, 168), "3:1 cell → pillarboxed 16:9")
	t.eq(TM.fit(Rect2(0, 0, 160, 300), 16.0 / 9.0), Rect2(0, 105, 160, 90), "tall cell → letterboxed")
