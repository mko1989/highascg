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


func test_resize_any_corner() -> void:
	var s := Rect2(400, 200, 480, 270)
	var tl := TM.resized(s, Vector2(-96, 0), C, Vector2i(-1, -1))
	t.eq(tl.end, s.end, "top-left: the bottom-right corner stays put")
	t.eq(tl.size.x, 576.0, "top-left: dragging out grows it")
	var tr := TM.resized(s, Vector2(96, 0), C, Vector2i(1, -1))
	t.eq(Vector2(tr.position.x, tr.end.y), Vector2(s.position.x, s.end.y), "top-right: bottom-left anchored")
	var bl := TM.resized(s, Vector2(96, 0), C, Vector2i(-1, 1))
	t.eq(Vector2(bl.end.x, bl.position.y), Vector2(s.end.x, s.position.y), "bottom-left: top-right anchored")
	t.eq(bl.size.x, 384.0, "bottom-left: dragging inward shrinks it")
	var cap := TM.resized(s, Vector2(-5000, 0), C, Vector2i(-1, -1))
	t.ok(cap.position.x >= -0.001 and cap.position.y >= -0.001, "top-left: capped at the canvas origin")
	t.ok(is_equal_approx(cap.size.x / cap.size.y, 16.0 / 9.0), "capped without distortion")
	t.eq(cap.end, s.end, "still anchored when capped")


func test_corner_at() -> void:
	var r := Rect2(100, 100, 200, 100)
	t.eq(TM.corner_at(r, Vector2(101, 99), 14.0), Vector2i(-1, -1), "top-left")
	t.eq(TM.corner_at(r, Vector2(305, 102), 14.0), Vector2i(1, -1), "top-right")
	t.eq(TM.corner_at(r, Vector2(98, 204), 14.0), Vector2i(-1, 1), "bottom-left")
	t.eq(TM.corner_at(r, Vector2(300, 200), 14.0), Vector2i(1, 1), "bottom-right")
	t.eq(TM.corner_at(r, Vector2(200, 150), 14.0), Vector2i.ZERO, "middle → none")



## WO-624 E1: Sources "Live" rows drop onto the preview (route:// only; media files and looks pass through), and the
## ✕ at the right end of a label strip is its own square (the overlay picks it ahead of move / resize).
func test_source_drop_and_close_zone() -> void:
	t.ok(TM.droppable({"type": "route", "value": "route://5", "label": "DeckLink 2"}), "a live route drops")
	t.ok(not TM.droppable({"type": "file", "value": "AMB"}), "a media file does not")
	t.ok(not TM.droppable("route://5"), "only the row payload shape")
	var pic := Rect2(100, 100, 400, 225)
	t.eq(TM.close_rect(pic, 18.0, 18.0), Rect2(484, 327, 18, 18), "right end of the strip, under the picture")


## Owner 20.10 "invisible barriers": the bars beside the canvas are drawn as not-canvas (pillarbox left / right,
## letterbox top / bottom); a canvas that fills the area leaves none.
func test_outside_bars_mark_the_canvas_edge() -> void:
	var ir := Rect2(175, 0, 850, 478)
	t.eq(TM.outside(Vector2(1200, 478), ir), [Rect2(0, 0, 175, 478), Rect2(1025, 0, 175, 478)], "pillarbox")
	t.eq(TM.outside(Vector2(850, 600), Rect2(0, 61, 850, 478)), [Rect2(0, 0, 850, 61), Rect2(0, 539, 850, 61)], "letterbox")
	t.eq(TM.outside(Vector2(850, 478), Rect2(0, 0, 850, 478)), [], "exact fit: none")


func test_atlas_slots() -> void:
	t.eq(TM.atlas_of(null), {}, "no atlas → mosaic")
	t.eq(TM.atlas_of({"channel": 5}), {}, "a descriptor without slots is no atlas")
	var a := TM.atlas_of({"w": 1920, "h": 1080, "slots": {"pgm_1": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}, "prv_1": {"x": 0.5, "y": 0.25, "w": 0.25, "h": 0.25}}})
	t.eq(TM.slot_px(a, "pgm_1", C), Rect2(0, 0, 960, 540), "slot fractions → texture px")
	t.eq(TM.slot_px(a, "prv_1", C), Rect2(960, 270, 480, 270), "second slot")
	t.eq(TM.slot_px(a, "src_route_8_1", C), Rect2(), "a window without a slot crops nothing")
	t.eq(TM.slot_px({}, "pgm_1", C), Rect2(), "no atlas → no slot")

