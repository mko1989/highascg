extends RefCounted
## WO-654 — look editor zoom / pan math.

const V := preload("res://features/live/look_editor_view.gd")
var t

const FRAME := Vector2(1000, 500)
const CANVAS := Vector2(3072, 1024)


func test_fit_and_zoom_about_the_pointer() -> void:
	var v := V.new()
	var b := v.box(FRAME, CANVAS)
	var fw := 1000.0 - 2.0 * V.MARGIN
	t.ok(absf(b.size.x - fw) < 1e-3 and absf(b.position.y - (500.0 - fw / 3.0) / 2.0) < 1e-3, "1× = letterboxed fit inside the margin")
	var tall := v.box(Vector2(1000, 300), CANVAS)
	t.ok(tall.position.y >= V.MARGIN - 1e-3, "height-bound: the top outline stays inside the frame")
	var at := Vector2(700, 260)
	var rel := (at - b.position) / b.size
	v.zoom_at(at, 3.0, FRAME, CANVAS)
	var z := v.box(FRAME, CANVAS)
	t.ok(absf(z.size.x - fw * pow(V.STEP, 3)) < 1e-2, "3 wheel steps = STEP³")
	t.ok((z.position + rel * z.size).distance_to(at) < 1e-3, "the point under the pointer stays put")


func test_back_to_one_recentres_and_clamps() -> void:
	var v := V.new()
	v.zoom_at(Vector2(900, 100), 2.0, FRAME, CANVAS)
	v.zoom_at(Vector2(10, 400), -2.0, FRAME, CANVAS)
	t.eq([v.zoom, v.pan], [1.0, Vector2.ZERO], "back at 1× → centred again")
	v.zoom_at(Vector2.ZERO, 100.0, FRAME, CANVAS)
	t.eq(v.zoom, V.MAX, "clamped in")
	v.zoom_at(Vector2.ZERO, -100.0, FRAME, CANVAS)
	t.eq(v.zoom, V.MIN, "clamped out")


func test_input_wheel_middle_drag_and_double_click() -> void:
	var v := V.new()
	var w := InputEventMouseButton.new()
	w.button_index = MOUSE_BUTTON_WHEEL_UP
	w.pressed = true
	w.position = Vector2(500, 250)
	t.ok(v.input(w, FRAME, CANVAS) and v.zoom > 1.0, "wheel up zooms in (consumed)")
	var m := InputEventMouseButton.new()
	m.button_index = MOUSE_BUTTON_MIDDLE
	m.pressed = true
	m.position = Vector2(100, 100)
	v.input(m, FRAME, CANVAS)
	var mm := InputEventMouseMotion.new()
	mm.position = Vector2(130, 90)
	var before := v.pan
	t.ok(v.input(mm, FRAME, CANVAS) and v.pan - before == Vector2(30, -10), "middle-drag pans")
	m.pressed = false
	v.input(m, FRAME, CANVAS)
	t.ok(not v.input(mm, FRAME, CANVAS), "motion after release is not ours (layer drags)")
	var left := InputEventMouseButton.new()
	left.button_index = MOUSE_BUTTON_LEFT
	t.ok(not v.input(left, FRAME, CANVAS), "left button left to the editor")
	m.pressed = true
	m.double_click = true
	v.input(m, FRAME, CANVAS)
	t.eq([v.zoom, v.pan], [1.0, Vector2.ZERO], "middle double-click fits again")
