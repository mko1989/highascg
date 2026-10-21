extends RefCounted
## WO-658 — Live 2D Auto layout: PGM top / PRV bottom per screen, inside the visible canvas.

const AL := preload("res://features/live/compose_auto_layout.gd")
var t

const CANVAS := Vector2(1920, 1080)


func test_one_screen_pgm_top_prv_bottom_inside_the_view() -> void:
	var view := Rect2(0, 200, 1920, 700)
	var r := AL.tile([{"main": 0, "prv": true, "aspect": 3.0}], view, CANVAS, 30.0)
	t.eq(r.keys(), ["pgm_1", "prv_1"], "one PGM + one PRV window")
	var p: Dictionary = r.pgm_1
	var v: Dictionary = r.prv_1
	t.ok(p.y < v.y, "PGM above PRV")
	t.ok(absf(p.x - v.x) < 1e-9 and absf(p.w - v.w) < 1e-9, "stacked in one column, same size")
	t.ok(absf((p.w * CANVAS.x) / (p.h * CANVAS.y) - 3.0) < 1e-6, "picture at the screen's aspect")
	for f in [p, v]:
		var px := Rect2(f.x * CANVAS.x, f.y * CANVAS.y, f.w * CANVAS.x, f.h * CANVAS.y)
		t.ok(view.encloses(px), "inside the visible view: %s" % px)


func test_columns_per_screen_and_pgm_only() -> void:
	var r := AL.tile([{"main": 0, "prv": true, "aspect": 16.0 / 9.0}, {"main": 1, "prv": false, "aspect": 16.0 / 9.0}],
		Rect2(Vector2.ZERO, CANVAS), CANVAS, 20.0)
	t.eq(r.keys(), ["pgm_1", "prv_1", "pgm_2"], "screen 2 has no PRV bus → PGM only")
	t.ok(r.pgm_2.x > r.pgm_1.x + r.pgm_1.w, "screen 2 is the next column")
	t.eq(AL.tile([], Rect2(Vector2.ZERO, CANVAS), CANVAS, 20.0), {}, "no screens → nothing")


func test_shrinks_with_the_view() -> void:
	var big: Dictionary = AL.tile([{"main": 0, "prv": true, "aspect": 3.0}], Rect2(0, 0, 1920, 1080), CANVAS, 20.0).pgm_1
	var small: Dictionary = AL.tile([{"main": 0, "prv": true, "aspect": 3.0}], Rect2(0, 300, 1920, 400), CANVAS, 20.0).pgm_1
	t.ok(small.w < big.w, "a shorter panel → smaller windows")


func test_visible_view_of_the_width_filled_canvas() -> void:
	# A 1200×450 panel; the canvas drawn 1200×675, centred (−112.5 above the panel top).
	var v := AL.visible_view(Vector2(1200, 450), Rect2(0, -112.5, 1200, 675), CANVAS)
	t.ok(absf(v.position.y - 180.0) < 1e-6 and absf(v.size.y - 720.0) < 1e-6 and absf(v.size.x - 1920.0) < 1e-6, "%s" % v)


func test_apply_moves_adds_and_keeps_others() -> void:
	var cells := [{"id": "pgm_1", "role": "pgm", "mainIndex": 0, "rect": {"x": 0.0, "y": 0.0, "w": 0.1, "h": 0.1}},
		{"id": "src_x", "role": "source", "rect": {"x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}}]
	var rects := {"pgm_1": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}, "prv_1": {"x": 0.1, "y": 0.5, "w": 0.2, "h": 0.2}}
	t.ok(AL.apply(cells, rects), "changed")
	t.eq(cells.size(), 3, "prv_1 added")
	t.eq([cells[2].id, cells[2].role, cells[2].mainIndex], ["prv_1", "prv", 0], "new cell shape")
	t.eq(cells[1].rect.x, 0.5, "a source window is left alone")
	t.ok(not AL.apply(cells, rects), "same rects again → no change (no post loop)")
