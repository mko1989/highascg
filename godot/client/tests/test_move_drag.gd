extends RefCounted
## WO-682 — move_drag.gd: a press on the selection arms a drag (elsewhere it is left to orbit / pick), a click without
## a drag still falls through, a drag slides across the floor (shift: height only) and saves once on release; keys nudge.

const D := preload("res://features/previs/move/move_drag.gd")
var t


class Targets:
	extends RefCounted
	var on := true
	var kind := "heads"
	var log: Array = []

	func active() -> String:
		return kind

	func current() -> Dictionary:
		return {"pos": Vector3.ZERO, "yaw": 0.0}

	func hit(_cam: Camera3D, _at: Vector2) -> bool:
		return on

	func begin() -> void:
		log.append(["begin"])

	func preview(d: Vector3, dyaw: float) -> void:
		log.append(["preview", d, dyaw])

	func commit(d: Vector3, dyaw: float) -> void:
		log.append(["commit", d, dyaw])

	func nudge(d: Vector3, dyaw: float) -> void:
		log.append(["nudge", d, dyaw])


## Screen px / 100 = metres: looking straight down for the floor, straight upstage (-Z) for the height plane.
class Drag:
	extends "res://features/previs/move/move_drag.gd"

	func _ray(_cam: Camera3D, at: Vector2) -> Array:
		if _vertical:
			return [Vector3(at.x / 100.0, -at.y / 100.0, 10.0), Vector3(0, 0, -1), Vector3(0, 0, -1)]
		return [Vector3(at.x / 100.0, 10.0, at.y / 100.0), Vector3(0, -1, 0), Vector3(0, -1, 0)]


func _button(pressed: bool, at: Vector2, shift := false) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_LEFT
	e.pressed = pressed
	e.position = at
	e.shift_pressed = shift
	return e


func _motion(at: Vector2) -> InputEventMouseMotion:
	var e := InputEventMouseMotion.new()
	e.position = at
	return e


func _drag() -> Drag:
	var d := Drag.new()
	d.targets = Targets.new()
	return d


func test_press_off_the_selection_is_left_alone() -> void:
	var d := _drag()
	d.targets.on = false
	t.eq(d.input(_button(true, Vector2(100, 100)), null), false, "press elsewhere → orbit")
	t.eq(d.input(_motion(Vector2(300, 100)), null), false, "… its motion too")
	t.eq(d.input(_button(false, Vector2(300, 100)), null), false, "… and its release")
	d.targets.on = true
	d.targets.kind = ""
	t.eq(d.input(_button(true, Vector2(100, 100)), null), false, "nothing selected → orbit")
	t.eq(d.targets.log, [])


func test_click_on_the_selection_still_picks() -> void:
	var d := _drag()
	t.eq(d.input(_button(true, Vector2(100, 100)), null), true, "press on the selection is held back from the orbit")
	t.eq(d.input(_motion(Vector2(102, 101)), null), true, "inside the slop: no drag yet")
	t.eq(d.input(_button(false, Vector2(102, 101)), null), false, "release without a drag → the caller's click")
	t.eq(d.targets.log, [], "nothing moved, nothing saved")


func test_drag_slides_on_the_floor_and_saves_on_release() -> void:
	var d := _drag()
	d.input(_button(true, Vector2(100, 100)), null)
	t.eq(d.input(_motion(Vector2(300, 100)), null), true)
	t.eq(d.dragging, true)
	d.input(_motion(Vector2(300, 400)), null)
	t.eq(d.input(_button(false, Vector2(300, 400)), null), true, "release used")
	t.eq(d.targets.log, [["begin"], ["preview", Vector3(2, 0, 0), 0.0], ["preview", Vector3(2, 0, 3), 0.0],
		["commit", Vector3(2, 0, 3), 0.0]], "grab offset kept: the delta is how far the mouse went; one save")
	t.eq(d.dragging, false)


func test_shift_drag_changes_height_only() -> void:
	var d := _drag()
	d.input(_button(true, Vector2(100, -100), true), null)
	d.input(_motion(Vector2(400, -250)), null)
	d.input(_button(false, Vector2(400, -250)), null)
	t.eq(d.targets.log.back(), ["commit", Vector3(0, 1.5, 0), 0.0], "1.5 m up; the sideways move is ignored")


func test_keys_nudge() -> void:
	var d := _drag()
	var k := InputEventKey.new()
	k.keycode = KEY_LEFT
	t.eq(d.key(k), true)
	k.keycode = KEY_PAGEUP
	k.shift_pressed = true
	d.key(k)
	k.keycode = KEY_Q
	k.shift_pressed = false
	d.key(k)
	k.keycode = KEY_A
	t.eq(d.key(k), false, "other keys are not ours")
	t.eq(d.targets.log, [["nudge", Vector3(-0.05, 0, 0), 0.0], ["nudge", Vector3(0, 0.5, 0), 0.0],
		["nudge", Vector3.ZERO, 5.0]])
	d.targets.kind = ""
	k.keycode = KEY_LEFT
	t.eq(d.key(k), false, "nothing selected → the key is left to others")
