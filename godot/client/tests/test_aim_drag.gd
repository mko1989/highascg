extends RefCounted
## WO-679 — aim_drag.gd: right-press on a head starts a drag (a head outside the selection selects it alone), a miss
## leaves the event to the stage; one aim request in flight, moves meanwhile keep only the newest target; release
## announces `aimed` once the last request is back.

const D := preload("res://features/previs/fixtures/aim_drag.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
var t


class Rig:
	var under := ""

	func hit(_cam: Camera3D, _pos: Vector2) -> String:
		return under


func _button(pressed: bool, index := MOUSE_BUTTON_RIGHT) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = index
	e.pressed = pressed
	return e


func test_right_press_on_a_head_selects_and_drags() -> void:
	var d := D.new()
	d.sel = Sel.new()
	var rig := Rig.new()
	var aimed := [0]
	d.sel.aimed.connect(func() -> void: aimed[0] += 1)
	t.eq(d.input(_button(true), null, rig), false, "nothing under the mouse → the stage gets the press")
	t.eq(d.input(_button(false), null, rig), false, "… and the release")
	t.eq(d.input(_button(true, MOUSE_BUTTON_LEFT), null, rig), false, "left button is the orbit")
	d.sel.set_ids(["a", "b"])
	rig.under = "b"
	t.eq(d.input(_button(true), null, rig), true, "press on a head starts the drag")
	t.eq(d.sel.ids, ["a", "b"], "a head in the selection keeps the selection (aims all)")
	t.eq(d.active, true, "dragging")
	t.eq(d.input(_button(false), null, rig), true, "release ends it")
	t.eq(aimed[0], 1, "release announces aimed (sliders follow)")
	rig.under = "c"
	d.input(_button(true), null, rig)
	t.eq(d.sel.ids, ["c"], "a head outside the selection selects it alone")


func test_one_request_in_flight_newest_target_wins() -> void:
	var d := D.new()
	d.sel = Sel.new()
	d.sel.set_ids(["a"])
	var sent: Array = []
	d.post = func(b: Dictionary) -> Dictionary:
		sent.append(b)
		return {"ok": true}
	d._busy = true
	d.aim([1.0, 2.0, 0.0])
	d.aim([3.0, 4.0, 0.0])
	t.eq(sent, [], "busy: nothing sent")
	d._busy = false
	d.aim([5.0, 6.0, 0.0])
	t.eq(sent, [{"ids": ["a"], "target": [5.0, 6.0, 0.0]}], "only the newest goes")
	t.eq(d._busy, false, "free again")
