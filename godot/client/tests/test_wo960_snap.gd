extends RefCounted
## WO-960 — look editor snapping (layer_snap_math.gd): a dragged layer's left / centre / right (top / centre / bottom)
## snap to the canvas's edges and centre and to other layers' edges and centres within a screen-px threshold, the
## lines it lies on come back as guides, the modifier turns it off; crop and rotation count via bounds().

const S := preload("res://features/live/layer_snap_math.gd")
const CANVAS := Vector2(1920, 1080)
const THR := Vector2(0.01, 0.01)  # ~8 px of a 800 px-wide canvas box
var t


func _near(a: float, b: float) -> bool: return absf(a - b) < 1e-6  # bounds() goes through Vector2 (float32)


func _f(x: float, y: float, w: float, h: float) -> Dictionary: return {"x": x, "y": y, "scaleX": w, "scaleY": h}


func test_centre_snaps_to_the_canvas_centre_with_guides() -> void:
	var f := _f(0.1, 0.1, 0.2, 0.2)  # centre (0.2, 0.2)
	var r := S.move(f, f, 0.296, 0.304, [], THR)  # centre → (0.496, 0.504): 4 thousandths off the middle
	t.ok(_near(r.fill.x, 0.4) and _near(r.fill.y, 0.4), "centre lands on the canvas centre: %s" % r.fill)
	t.eq(r.guides.x, [0.5], "one vertical guide at the centre")
	t.eq(r.guides.y, [0.5], "one horizontal guide at the centre")
	t.eq(r.fill.scaleX, 0.2, "a move keeps the size")


func test_edges_snap_to_canvas_edges() -> void:
	var f := _f(0.3, 0.3, 0.25, 0.25)
	var r := S.move(f, f, -0.295, 0.444, [], THR)  # left → 0.005, bottom → 0.994
	t.ok(_near(r.fill.x, 0.0), "left edge onto the left border")
	t.ok(_near(r.fill.y + 0.25, 1.0), "bottom edge onto the bottom border")
	t.eq(r.guides.x, [0.0])
	t.eq(r.guides.y, [1.0])
	r = S.move(f, f, 0.445, 0.0, [], THR)  # right → 0.995
	t.ok(_near(r.fill.x + 0.25, 1.0) and r.guides.x == [1.0], "right edge onto the right border")


func test_outside_the_threshold_nothing_snaps() -> void:
	var f := _f(0.1, 0.1, 0.2, 0.2)
	var r := S.move(f, f, 0.28, 0.05, [], THR)  # centre 0.48: 20 thousandths off
	t.ok(_near(r.fill.x, 0.38) and _near(r.fill.y, 0.15), "moves freely: %s" % r.fill)
	t.eq(r.guides.x, [])
	t.eq(r.guides.y, [])


func test_threshold_is_screen_px_so_zoom_tightens_it() -> void:
	var f := _f(0.1, 0.1, 0.2, 0.2)
	var at_fit := Vector2(S.THRESHOLD_PX, S.THRESHOLD_PX) / Vector2(800, 450)  # canvas box 800 px wide
	var zoomed := Vector2(S.THRESHOLD_PX, S.THRESHOLD_PX) / Vector2(3200, 1800)  # 4× zoom
	t.ok(_near(S.move(f, f, 0.295, 0.0, [], at_fit).fill.x, 0.4), "5 thousandths = 4 px at fit: snaps")
	t.ok(_near(S.move(f, f, 0.295, 0.0, [], zoomed).fill.x, 0.395), "the same offset = 16 px at 4×: free")


func test_modifier_turns_snapping_off() -> void:
	var f := _f(0.1, 0.1, 0.2, 0.2)
	var r := S.move(f, f, 0.296, 0.304, [], THR, true)
	t.ok(_near(r.fill.x, 0.396) and _near(r.fill.y, 0.404), "plain move with the modifier held")
	t.eq(r.guides.x, [])
	t.eq(r.guides.y, [])


func test_other_layers_edges_and_centres_are_targets() -> void:
	var other := _f(0.65, 0.0, 0.3, 0.3)  # x lines 0.65 / 0.8 / 0.95
	var f := _f(0.0, 0.5, 0.2, 0.2)
	var r := S.move(f, f, 0.447, 0.0, [other], THR)  # right edge → 0.647
	t.ok(_near(r.fill.x, 0.45), "right edge onto the neighbour's left edge")
	t.eq(r.guides.x, [0.65])
	r = S.move(f, f, 0.696, 0.0, [other], THR)  # centre → 0.796
	t.ok(_near(r.fill.x, 0.7) and r.guides.x == [0.8], "centre onto the neighbour's centre: %s" % r.fill)


func test_nearest_target_wins_and_coinciding_lines_all_show() -> void:
	var f := _f(0.0, 0.0, 0.5, 0.5)
	var r := S.move(f, f, 0.006, 0.0, [], THR)  # left 0.006 (6 off 0), centre 0.256, right 0.506 (6 off 0.5)
	t.ok(_near(r.fill.x, 0.0), "tie → the start edge")
	t.eq(r.guides.x, [0.0, 0.5], "left on the border and right on the centre: both guides")
	r = S.move(f, f, 0.497, 0.0, [], THR)  # left 0.497 (3 off 0.5), right 0.997 (3 off 1.0): both close
	t.ok(_near(r.fill.x, 0.5) and r.guides.x == [0.5, 1.0], "a half-width box shows both lines it fills: %s" % [r.guides.x])


func test_cropped_layer_snaps_by_its_visible_picture() -> void:
	var f := _f(0.0, 0.0, 0.4, 0.4)
	var box := S.bounds(f, {"left": 0.25, "top": 0.0, "right": 1.0, "bottom": 1.0}, 0.0, CANVAS)  # visible x 0.1–0.4
	t.ok(_near(box.x, 0.1) and _near(box.scaleX, 0.3), "bounds: the crop counts (%s)" % box)
	var r := S.move(f, box, 0.596, 0.0, [], THR)  # visible right 0.996
	t.ok(_near(r.fill.x, 0.6), "the visible right edge snaps to the border, the fill follows: %s" % r.fill)
	t.eq(r.guides.x, [1.0])


func test_rotated_layer_snaps_by_its_axis_aligned_bounds() -> void:
	var f := _f(0.25, 0.25, 0.5, 0.5)  # 960 × 540 px about (960, 540)
	var box := S.bounds(f, null, 90.0, CANVAS)  # turned: 540 × 960 px
	t.ok(_near(box.scaleX, 540.0 / 1920.0) and _near(box.scaleY, 960.0 / 1080.0), "90° swaps the extents in px (%s)" % box)
	t.ok(_near(box.x + box.scaleX / 2.0, 0.5) and _near(box.y + box.scaleY / 2.0, 0.5), "the centre stays")
	var r := S.move(f, box, 0.0, -0.0505, [], THR)  # turned top 0.0051 → snaps onto 0
	t.ok(_near(r.fill.y - 0.25 + box.y, 0.0) and r.guides.y == [0.0], "the turned picture's top meets the border: %s" % r.fill)


func test_resize_snaps_the_dragged_edge_with_a_guide() -> void:
	var f := _f(0.1, 0.1, 0.3, 0.3)
	var r := S.resize("e", f, 0.096, 0.0, false, [], THR)  # right 0.496
	t.ok(_near(r.fill.x + r.fill.scaleX, 0.5) and _near(r.fill.x, 0.1), "the right edge stops on the centre: %s" % r.fill)
	t.eq(r.guides.x, [0.5])
	t.eq(r.guides.y, [], "no guide for edges not dragged")
	r = S.resize("e", f, 0.096, 0.0, false, [], THR, true)
	t.ok(_near(r.fill.x + r.fill.scaleX, 0.496) and r.guides.x == [], "modifier: free resize")
	r = S.resize("sw", f, -0.096, 0.004, false, [], THR)  # left 0.004, bottom 0.404
	t.ok(_near(r.fill.x, 0.0) and r.guides.x == [0.0], "the corner's left edge snaps to the border")


func test_guide_line_spans_the_frame() -> void:
	var b := Rect2(100, 50, 800, 450)
	var area := Rect2(0, 0, 1000, 550)
	t.eq(S.guide_line(0.5, true, b, area), PackedVector2Array([Vector2(500, 0), Vector2(500, 550)]), "vertical at the canvas centre")
	t.eq(S.guide_line(1.0, false, b, area), PackedVector2Array([Vector2(0, 500), Vector2(1000, 500)]), "horizontal at the bottom")


## Found by the WO-960 e2e: an editor opened while the client's project had no slug (re-pulled after a screen add)
## closed itself at the first autosave — the first slug learned is the same show.
func test_editor_opened_without_a_slug_adopts_the_first_one() -> void:
	var Stale := load("res://features/live/look_editor_stale.gd")
	t.eq(Stale.opened_slug("", "untitled_4"), "untitled_4", "unknown at open → adopt")
	t.eq(Stale.opened_slug("show", "other"), "show", "known at open → kept (another slug = another show)")
	var p := {"slug": "untitled_4", "scenes": {"scenes": [{"id": "a"}]}}
	t.ok(not Stale.stale(Stale.opened_slug("", "untitled_4"), p, "a", 0, 1), "the same look on the now-named show stays open")
	t.ok(Stale.stale(Stale.opened_slug("", "other"), {"slug": "other", "scenes": {"scenes": [{"id": "b"}]}}, "a", 0, 1), "another show: the look is gone → closes")
