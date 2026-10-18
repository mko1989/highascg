extends RefCounted
## Inspector pixel rects — web lib/coordinate-origin.js + the timeline clip inspector's aspect lock.

const P := preload("res://features/live/px_rect_math.gd")
const CV := Vector2(1920, 1080)
var t


func test_origin() -> void:
	var r := {"x": 100, "y": 50, "w": 400, "h": 200}
	t.eq(P.display_from_stored(r, CV, false), {"x": 100.0, "y": 50.0, "w": 400.0, "h": 200.0}, "top-left = stored")
	t.eq(P.display_from_stored(r, CV, true), {"x": -660.0, "y": -390.0, "w": 400.0, "h": 200.0}, "centre offset")
	t.eq(P.stored_from_display({"x": -660, "y": -390, "w": 400, "h": 200}, CV, true), {"x": 100.0, "y": 50.0, "w": 400.0, "h": 200.0}, "round trip")


func test_patch_and_lock() -> void:
	var r := {"x": 0, "y": 0, "w": 1920, "h": 1080}
	t.eq(P.apply_patch(r, {"x": 10}, CV, false, true, 16.0 / 9.0), {"x": 10.0, "y": 0.0, "w": 1920.0, "h": 1080.0}, "x only")
	t.eq(P.apply_patch(r, {"x": 0, "y": 0}, CV, true, true, 1.0), {"x": 0.0, "y": 0.0, "w": 1920.0, "h": 1080.0}, "centre 0,0 = centred")
	t.eq(P.apply_patch(r, {"w": 960}, CV, false, true, 16.0 / 9.0), {"x": 0.0, "y": 0.0, "w": 960.0, "h": 540.0}, "locked W drives H")
	t.eq(P.apply_patch(r, {"h": 100}, CV, false, true, 2.0), {"x": 0.0, "y": 0.0, "w": 200.0, "h": 100.0}, "locked H drives W")
	t.eq(P.apply_patch(r, {"w": 960}, CV, false, false, 16.0 / 9.0), {"x": 0.0, "y": 0.0, "w": 960.0, "h": 1080.0}, "unlocked")
	# centre mode: a size change keeps the stored top-left (web applies w/h before re-deriving x/y only if given)
	t.eq(P.apply_patch(r, {"w": 960}, CV, true, false, 1.0), {"x": 0.0, "y": 0.0, "w": 960.0, "h": 1080.0}, "centre mode size edit")
	t.eq(P.lock_ratio(Vector2(1000, 500), r), 2.0, "media ratio wins")
	t.eq(P.lock_ratio(Vector2.ZERO, {"w": 300, "h": 100}), 3.0, "else the rect")
	t.eq(P.lock_ratio(Vector2.ZERO, {}), 16.0 / 9.0, "else 16:9")


func test_align() -> void:
	var r := {"x": 33, "y": 44, "w": 641, "h": 361}
	t.eq(P.align(r, CV, "left"), {"x": 0.0, "y": 44.0, "w": 641.0, "h": 361.0}, "left")
	t.eq(P.align(r, CV, "right"), {"x": 1279.0, "y": 44.0, "w": 641.0, "h": 361.0}, "right")
	t.eq(P.align(r, CV, "bottom"), {"x": 33.0, "y": 719.0, "w": 641.0, "h": 361.0}, "bottom")
	t.eq(P.align(r, CV, "center"), {"x": 640.0, "y": 360.0, "w": 641.0, "h": 361.0}, "centre rounds half up (639.5 → 640)")
	t.eq(P.align(r, CV, "center-v"), {"x": 33.0, "y": 360.0, "w": 641.0, "h": 361.0}, "centre vertically")
