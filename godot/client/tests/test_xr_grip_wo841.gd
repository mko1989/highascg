extends RefCounted
## WO-841 — owner 30.10: "make the pointing of selected heads in the vr world with the second trigger on the
## controller. the first trigger should be only selecting." The right grip points the selection at the ray's floor spot
## and follows it (throttled), left + right grip is the WO-774 fan, a grip with nothing selected / on the panel does
## nothing; the trigger never aims (also in test_xr_walk.gd / test_xr_box_fan_wo774.gd). aim_drag.gd's hold / end_hold.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const XrWalk := preload("res://features/previs/xr/xr_walk.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const AimDrag := preload("res://features/previs/fixtures/aim_drag.gd")
var t

const DRAG_SRC := "extends RefCounted\nvar sel = null\nvar hold := false\nvar aims: Array = []\nvar ended := 0\nfunc aim(p: Array) -> void: aims.append(p)\nfunc end_hold() -> void:\n\thold = false\n\tended += 1\n"
const FAN_SRC := "extends RefCounted\nvar active := false\nvar log: Array = []\nfunc start() -> void:\n\tactive = true\n\tlog.append('start')\nfunc end() -> void:\n\tactive = false\n\tlog.append('end')\n"
const TAB_SRC := "extends Control\nvar fixtures3d = null\nvar aim_drag = null\n"
const PANEL_SRC := "extends Node3D\nvar on := false\nfunc pointed() -> bool: return on\n"


func _make(src: String) -> Object:
	var g := GDScript.new()
	g.source_code = src
	g.reload()
	return g.new()


## A walk with a fake tab (aim_drag recording aims), fan and panel; `ids` = the selection.
func _rig(ids: Array) -> Dictionary:
	var w: Node3D = XrWalk.new()
	var drag: RefCounted = _make(DRAG_SRC)
	drag.sel = Sel.new()
	drag.sel.set_ids(ids)
	var tab := Control.new()
	var g := GDScript.new()
	g.source_code = TAB_SRC
	g.reload()
	tab.set_script(g)
	tab.aim_drag = drag
	w.tab = tab
	w._fan = _make(FAN_SRC)
	var panel: Node3D = Node3D.new()
	var pg := GDScript.new()
	pg.source_code = PANEL_SRC
	pg.reload()
	panel.set_script(pg)
	w.panel = panel
	return {"w": w, "drag": drag, "tab": tab, "panel": panel}


func _free(r: Dictionary) -> void:
	r.tab.free()
	r.panel.free()
	r.w.free()


func test_grip_mode() -> void:
	t.eq(Walk.grip_mode(false, true, false), "point", "right grip alone with a selection points")
	t.eq(Walk.grip_mode(false, false, false), "none", "no selection: nothing")
	t.eq(Walk.grip_mode(false, true, true), "none", "on the wrist panel: nothing")
	t.eq(Walk.grip_mode(true, true, false), "fan", "left grip already held: the fan")
	t.eq(Walk.grip_mode(true, false, false), "fan", "… with or without a selection (the fan session handles an empty one)")


func test_aim_throttle() -> void:
	var st := {}
	t.eq(Walk.aim_due(st, [1.0, 2.0, 0.0], 10.0), true, "the first spot goes out at once")
	t.eq(Walk.aim_due(st, [3.0, 2.0, 0.0], 10.01), false, "a big move inside the interval waits")
	t.eq(Walk.aim_due(st, [1.01, 2.0, 0.0], 10.5), false, "a tiny move (1 cm) is not sent even much later")
	t.eq(Walk.aim_due(st, [1.2, 2.0, 0.0], 10.5), true, "a real move after the interval goes out")
	t.eq(st.psn, [1.2, 2.0, 0.0], "and is what the next one is measured from")
	t.eq(Walk.aim_due(st, [1.2, 2.0, 0.0], 11.0), false, "standing still sends nothing however long")
	# a 72 Hz sweep of 1 m/s sends at most 15 per second
	var sent := 0
	var sweep := {}
	for i in 72:
		if Walk.aim_due(sweep, [i / 72.0, 0.0, 0.0], i / 72.0):
			sent += 1
	t.ok(sent <= 16 and sent >= 10, "a one-second sweep sends about AIM rate, not 72 (sent %d)" % sent)


func test_grip_points_selection() -> void:
	var r := _rig(["a", "b"])
	var w: Node3D = r.w
	var drag: RefCounted = r.drag
	var down := Vector3(0, -1, -1).normalized()
	w.grip(true, false)
	t.eq(w._grip, "point", "grip down with a selection → pointing")
	t.eq(drag.hold, true, "aim_drag holds its `aimed` while pointing")
	w._grip_aim(Vector3(1, 2, 0), down, 0.0, false)
	var a0: Array = drag.aims[0] if drag.aims.size() == 1 else []
	t.ok(a0.size() == 3 and absf(a0[0] - 1.0) < 1e-4 and absf(a0[1] - 2.0) < 1e-4 and a0[2] == 0.0,
		"aims at PSN [x, -z, 0] of the ray's floor spot (one request)")
	w._grip_aim(Vector3(1.5, 2, 0), down, 0.01, false)
	t.eq(drag.aims.size(), 1, "a move inside the throttle interval is not sent")
	w._grip_aim(Vector3(1.5, 2, 0), down, 0.2, false)
	t.eq(drag.aims.size(), 2, "held + moved, after the interval: follows the ray")
	t.ok(absf(drag.aims[1][0] - 1.5) < 1e-5, "… to the new spot")
	w._grip_aim(Vector3(1.5, 2, 0), down, 1.0, false)
	t.eq(drag.aims.size(), 2, "held still: no more requests")
	w._grip_aim(Vector3(1.5, 2, 0), Vector3(0, 1, 0), 2.0, false)
	t.eq(drag.aims.size(), 2, "the ray in the sky: nothing")
	w._grip_aim(Vector3(9, 2, 0), down, 3.0, true)
	t.eq(drag.aims.size(), 2, "the ray on the panel while held: nothing")
	w.grip(false, false)
	t.eq(w._grip, "none", "release ends the pointing")
	t.eq([drag.hold, drag.ended], [false, 1], "and announces it once")
	t.eq(r.w._fan.log, [], "no fan was involved")
	_free(r)


func test_grip_second_press_restarts_throttle() -> void:
	var r := _rig(["a"])
	var w: Node3D = r.w
	var down := Vector3(0, -1, -1).normalized()
	w.grip(true, false)
	w._grip_aim(Vector3(1, 2, 0), down, 5.0, false)
	w.grip(false, false)
	w.grip(true, false)
	w._grip_aim(Vector3(1, 2, 0), down, 5.01, false)
	t.eq(r.drag.aims.size(), 2, "a new grip press sends its spot at once, even the same one")
	_free(r)


func test_grip_nothing_selected_or_panel() -> void:
	var r := _rig([])
	var w: Node3D = r.w
	w.grip(true, false)
	t.eq(w._grip, "none", "no selection: the grip does nothing")
	t.eq(r.drag.hold, false, "no hold taken")
	w._grip_aim(Vector3(1, 2, 0), Vector3(0, -1, -1).normalized(), 0.0, false)
	t.eq(r.drag.aims, [], "no aim")
	w.grip(false, false)
	t.eq(r.drag.ended, 0, "and nothing to announce")
	r.drag.sel.set_ids(["a"])
	r.panel.on = true
	w.grip(true, false)
	t.eq(w._grip, "none", "with a selection but the ray on the wrist panel: nothing")
	t.eq(r.drag.hold, false, "no hold taken")
	w.grip(false, false)
	_free(r)


func test_left_plus_right_grip_fans() -> void:
	var r := _rig(["a", "b"])
	var w: Node3D = r.w
	w.grip(true, true)
	t.eq(w._grip, "fan", "right grip with the left already held → fan mode")
	t.eq(r.w._fan.log, ["start"], "the WO-774 fan session starts")
	t.eq(r.drag.hold, false, "and nothing points")
	w._grip_aim(Vector3(1, 2, 0), Vector3(0, -1, -1).normalized(), 0.0, false)
	t.eq(r.drag.aims.size(), 1, "(_grip_aim itself is mode-blind; _xr_move only calls it while pointing)")
	w.grip(false, false)
	t.eq(r.w._fan.log, ["start", "end"], "releasing the right grip ends the fan")
	t.eq(r.drag.ended, 0, "and announces no aim")
	_free(r)


func test_left_grip_let_go_first_keeps_the_mode() -> void:
	# the mode is decided on the right grip's press and kept: letting the left go does not turn a fan into pointing
	var r := _rig(["a"])
	var w: Node3D = r.w
	w.grip(true, true)
	w.grip(false, false)
	t.eq(r.w._fan.log, ["start", "end"], "one fan, ended by the right grip")
	_free(r)


func test_aim_drag_hold() -> void:
	var d := AimDrag.new()
	d.sel = Sel.new()
	d.sel.set_ids(["a"])
	var aimed := [0]
	d.sel.aimed.connect(func() -> void: aimed[0] += 1)
	d.post = func(_b: Dictionary) -> Dictionary: return {"ok": true}
	d.hold = true
	d.aim([1.0, 1.0, 0.0])
	d.aim([2.0, 1.0, 0.0])
	t.eq(aimed[0], 0, "held: no `aimed` per batch (the sliders would rebuild at the aim rate)")
	d.end_hold()
	t.eq([d.hold, aimed[0]], [false, 1], "end_hold announces once")
	d.aim([3.0, 1.0, 0.0])
	t.eq(aimed[0], 2, "a plain aim (no hold) announces as before")


func test_hooks() -> void:
	var src := FileAccess.get_file_as_string("res://features/previs/xr/xr_walk.gd")
	t.ok(not src.contains("tab.aim_drag.aim(p.aim)") and not src.contains("\"aim\": r.get"), "the trigger path no longer aims")
	t.ok(src.contains("elif _grip == \"point\":\n\t\t_grip_aim(_right.global_position, -_right.global_basis.z"), "the point is followed every frame while held")
	t.ok(src.contains("grip(false, false))"), "the right grip's release ends it")
	t.ok(not src.contains("Api."), "xr_walk.gd names no autoload (the test runner compiles it)")
	t.ok(src.contains("The right grip (middle finger, \"the second trigger\") POINTS"), "the header describes the new mapping")
