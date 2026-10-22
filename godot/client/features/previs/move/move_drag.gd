extends RefCounted
## WO-682 — move the selection in the 3D view: a left press ON the selected head(s), MVR object(s) or stage object and
## a drag slides it across the floor (shift at the press: up / down instead), saved on release. A press anywhere else,
## or a click without a drag, is left to the caller (orbit, pick). Keys: arrows nudge 5 cm (shift 50 cm), Page Up /
## Down raise / lower, Q / E turn 5° (shift 15°). Pure of autoloads: the targets (move_targets.gd) do the saving.

const MM := preload("res://features/previs/move/move_model.gd")
const SLOP := 4.0  ## px before a press becomes a drag

var targets: RefCounted
var dragging := false
var _armed := false
var _press := Vector2.ZERO
var _vertical := false
var _pivot := Vector3.ZERO
var _grab := Vector3.ZERO  # where the plane was hit at the press, relative to the pivot
var _d := Vector3.ZERO


## → whether the event was used.
func input(e: InputEvent, cam: Camera3D) -> bool:
	var mb := e as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
		if mb.pressed:
			if targets.active() == "" or not targets.hit(cam, mb.position):
				return false
			_vertical = mb.shift_pressed
			_pivot = targets.current().pos
			var h: Variant = _plane(cam, mb.position)
			if h == null:
				return false
			_grab = (h as Vector3) - _pivot
			_press = mb.position
			_armed = true
			_d = Vector3.ZERO
			return true
		if not _armed:
			return false
		_armed = false
		if not dragging:
			return false  # a click on the selection: the caller picks as before
		dragging = false
		targets.commit(_d, 0.0)
		return true
	var mm := e as InputEventMouseMotion
	if mm == null or not _armed:
		return false
	if not dragging:
		if mm.position.distance_to(_press) < SLOP:
			return true
		dragging = true
		targets.begin()
	var h: Variant = _plane(cam, mm.position)
	if h != null:
		var to: Vector3 = (h as Vector3) - _grab
		_d = Vector3(0.0, to.y - _pivot.y, 0.0) if _vertical else Vector3(to.x - _pivot.x, 0.0, to.z - _pivot.z)
		targets.preview(_d, 0.0)
	return true


func _plane(cam: Camera3D, at: Vector2) -> Variant:
	var r := _ray(cam, at)
	return MM.wall_at(r[0], r[1], _pivot, r[2]) if _vertical else MM.floor_at(r[0], r[1], _pivot.y)


## [origin, direction, camera forward] (tests override: the -s runner has no viewport to cast from).
func _ray(cam: Camera3D, at: Vector2) -> Array:
	return [cam.project_ray_origin(at), cam.project_ray_normal(at), -cam.global_transform.basis.z]


## Arrow / Page / Q / E keys → a nudge of the selection. → whether the key was used.
func key(k: InputEventKey) -> bool:
	if targets.active() == "":
		return false
	var step := 0.5 if k.shift_pressed else 0.05
	var turn := 15.0 if k.shift_pressed else 5.0
	var d := Vector3.ZERO
	var dyaw := 0.0
	match k.keycode:
		KEY_LEFT:
			d.x = -step
		KEY_RIGHT:
			d.x = step
		KEY_UP:
			d.z = -step
		KEY_DOWN:
			d.z = step
		KEY_PAGEUP:
			d.y = step
		KEY_PAGEDOWN:
			d.y = -step
		KEY_Q:
			dyaw = turn
		KEY_E:
			dyaw = -turn
		_:
			return false
	targets.nudge(d, dyaw)
	return true
