extends RefCounted
## WO-635 — compose_math.layer_xform: a rotated layer's chrome turns about its fill centre (Caspar ANCHOR 0.5 0.5,
## positive = clockwise on screen) and the pointer maps back into the layer's unrotated frame.

const C := preload("res://features/live/compose_math.gd")
var t


func test_layer_xform_turns_about_the_fill_centre() -> void:
	var r := Rect2(100, 50, 200, 100)  # centre (200, 100)
	var xf := C.layer_xform(r, 90.0)
	t.ok((xf * r.get_center()).is_equal_approx(Vector2(200, 100)), "the centre stays put")
	t.ok((xf * Vector2(300, 100)).is_equal_approx(Vector2(200, 200)), "the right-edge handle goes below (clockwise)")
	t.ok((xf.affine_inverse() * Vector2(200, 200)).is_equal_approx(Vector2(300, 100)), "a click there hits the right handle")
	t.ok(not r.has_point(xf.affine_inverse() * Vector2(290, 100)), "beside a 90°-turned 200 × 100 box: no hit")
	t.ok(C.layer_xform(r, 0.0).is_equal_approx(Transform2D.IDENTITY))
