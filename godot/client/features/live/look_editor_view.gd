extends RefCounted
## WO-654 — look editor zoom / pan: the wheel (or a pinch) zooms about the pointer, a middle-drag pans, a middle
## double-click fits the canvas again. Zooming back to 1× re-centres. Every editor rect derives from box(). Pure.

const MIN := 0.5
const MAX := 8.0
const STEP := 1.15

var zoom := 1.0
var pan := Vector2.ZERO  # px offset of the zoomed canvas from its fitted, centred place
var _grab := Vector2.INF


## The canvas's rect inside a `frame`-sized control: letterboxed fit × zoom, shifted by pan.
func box(frame: Vector2, canvas: Vector2) -> Rect2:
	var s := minf(frame.x / maxf(1.0, canvas.x), frame.y / maxf(1.0, canvas.y)) * zoom
	var sz := canvas * s
	return Rect2((frame - sz) / 2.0 + pan, sz)


## Zoom by STEP^steps keeping the canvas point under `at` where it is.
func zoom_at(at: Vector2, steps: float, frame: Vector2, canvas: Vector2) -> void:
	var b := box(frame, canvas)
	var rel := (at - b.position) / b.size
	zoom = clampf(zoom * pow(STEP, steps), MIN, MAX)
	if absf(zoom - 1.0) < 1e-3:
		reset()
		return
	var nb := box(frame, canvas)
	pan += at - (nb.position + rel * nb.size)


func reset() -> void:
	zoom = 1.0
	pan = Vector2.ZERO


## Handles wheel / pinch / middle-drag; true when the event was a view gesture (the caller accepts it).
func input(event: InputEvent, frame: Vector2, canvas: Vector2) -> bool:
	var mb := event as InputEventMouseButton
	if mb != null and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		if mb.pressed:
			zoom_at(mb.position, 1.0 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1.0, frame, canvas)
		return true
	if mb != null and mb.button_index == MOUSE_BUTTON_MIDDLE:
		if mb.pressed and mb.double_click:
			reset()
		_grab = mb.position if mb.pressed else Vector2.INF
		return true
	var mm := event as InputEventMouseMotion
	if mm != null and _grab != Vector2.INF:
		pan += mm.position - _grab
		_grab = mm.position
		return true
	var mg := event as InputEventMagnifyGesture
	if mg != null and mg.factor > 0.0:
		zoom_at(mg.position, log(mg.factor) / log(STEP), frame, canvas)
		return true
	return false
