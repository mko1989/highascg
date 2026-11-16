extends RefCounted
## WO-1100 — select_rule.gd: one selection in the previs 3D view. A click on a head / stage object / MVR wall selects it
## alone (the other kinds clear), ctrl / shift adds within its kind, the same thing again keeps it, an empty click and
## Esc clear everything, a floor tool (Place mark, Point at) keeps its clicks, and with nothing selected the nudge keys
## do nothing. Fakes stand in for the parts (move_targets.gd holds the real ones).

const R := preload("res://features/previs/move/select_rule.gd")
const D := preload("res://features/previs/move/move_drag.gd")
var t


class FSel:
	extends RefCounted
	var ids: Array = []
	var mark_pick := false
	var point_at := false
	var floor_clicks := 0

	func set_ids(l: Array) -> void:
		ids = l.duplicate()

	func pick(id: String, add: bool) -> void:
		var next := ids.duplicate() if add else []
		if add and next.has(id):
			next.erase(id)
		else:
			next.append(id)
		ids = next


class FRig:  # fixtures_3d.gd click(): a tool takes the floor first, else the head under the pointer
	extends RefCounted
	var sel: FSel
	var under := ""

	func click(_cam: Camera3D, _at: Vector2, add: bool) -> bool:
		if sel.mark_pick or (sel.point_at and not sel.ids.is_empty()):
			sel.floor_clicks += 1
			return true
		if under != "":
			sel.pick(under, add)
		return under != ""


class FBuilder:
	extends RefCounted
	var under := ""

	func pick(_cam: Camera3D, _at: Vector2) -> String:
		return under


class FPanel:
	extends RefCounted
	var sel := ""

	func select(id: String) -> void:
		sel = id

	func deselect() -> void:
		sel = ""

	func selected_id() -> String:
		return sel


class FScreens:
	extends RefCounted
	var owner_ref: WeakRef

	func clear() -> void:
		owner_ref.get_ref().uuids = []


class FMvr:  # mvr_section.click → mvr_screens.click: a plain click on nothing clears the walls itself
	extends RefCounted
	var uuids: Array = []
	var under := ""
	var _screens := FScreens.new()

	func _init() -> void:
		_screens.owner_ref = weakref(self)

	func click(_cam: Camera3D, _at: Vector2, add: bool) -> bool:
		if under == "":
			if not add:
				uuids = []
			return false
		if add:
			if uuids.has(under):
				uuids.erase(under)
			else:
				uuids.append(under)
		else:
			uuids = [under]
		return true

	func selected_uuids() -> Array:
		return uuids


class M:
	extends RefCounted
	signal changed
	var sel := FSel.new()
	var fixtures3d := FRig.new()
	var builder := FBuilder.new()
	var stage_panel := FPanel.new()
	var mvr_section := FMvr.new()

	func _init() -> void:
		fixtures3d.sel = sel


func _under(m: M, head: String, obj: String, wall: String) -> void:
	m.fixtures3d.under = head
	m.builder.under = obj
	m.mvr_section.under = wall


func _all(m: M) -> Array:
	return [m.sel.ids, m.stage_panel.sel, m.mvr_section.uuids]


func test_each_kind_empty_click_clears() -> void:
	for kind in ["heads", "stage", "mvr"]:
		var m := M.new()
		_under(m, "h1" if kind == "heads" else "", "s1" if kind == "stage" else "", "w1" if kind == "mvr" else "")
		t.eq(R.click(m, null, Vector2.ZERO, false), kind, kind + " picked")
		t.ok(R.any(m), kind + ": something selected")
		_under(m, "", "", "")
		t.eq(R.click(m, null, Vector2.ZERO, false), "none", kind + ": empty click")
		t.eq(_all(m), [[], "", []], kind + ": empty click clears it")
		t.ok(not R.any(m), kind + ": nothing selected")


func test_each_kind_escape_clears() -> void:
	for kind in ["heads", "stage", "mvr"]:
		var m := M.new()
		_under(m, "h1" if kind == "heads" else "", "s1" if kind == "stage" else "", "w1" if kind == "mvr" else "")
		R.click(m, null, Vector2.ZERO, false)
		t.ok(R.escape(m), kind + ": Esc clears")
		t.eq(_all(m), [[], "", []], kind + ": none after Esc")
		t.ok(not R.escape(m), kind + ": a second Esc goes on (view focus …)")


func test_clearing_walls_refreshes_the_position_card() -> void:
	var m := M.new()
	var n := [0]
	m.changed.connect(func() -> void: n[0] += 1)
	_under(m, "", "", "w1")
	R.click(m, null, Vector2.ZERO, false)
	R.escape(m)
	t.eq(n[0], 1, "move_targets.changed → the card's fold hides")


func test_plain_click_is_one_selection() -> void:
	var m := M.new()
	_under(m, "h1", "", "")
	R.click(m, null, Vector2.ZERO, false)
	_under(m, "", "s1", "")
	t.eq(R.click(m, null, Vector2.ZERO, false), "stage")
	t.eq(_all(m), [[], "s1", []], "a stage object replaces the heads")
	_under(m, "", "", "w1")
	t.eq(R.click(m, null, Vector2.ZERO, false), "mvr")
	t.eq(_all(m), [[], "", ["w1"]], "a wall replaces the stage object (the yellow box goes)")
	_under(m, "h2", "", "")
	R.click(m, null, Vector2.ZERO, false)
	t.eq(_all(m), [["h2"], "", []], "a head replaces the wall")


func test_add_click_keeps_other_kinds_and_toggles_within() -> void:
	var m := M.new()
	_under(m, "", "s1", "")
	R.click(m, null, Vector2.ZERO, false)
	_under(m, "h1", "", "")
	R.click(m, null, Vector2.ZERO, true)
	R.click(m, null, Vector2.ZERO, true)
	t.eq(_all(m), [[], "s1", []], "ctrl-click twice on a head: in then out; the stage object stays")
	_under(m, "", "", "")
	t.eq(R.click(m, null, Vector2.ZERO, true), "", "ctrl-click on nothing")
	t.eq(m.stage_panel.sel, "s1", "… keeps the selection")


func test_clicking_the_selection_again_keeps_it() -> void:
	var m := M.new()
	for under in [["h1", "", ""], ["", "s1", ""], ["", "", "w1"]]:
		_under(m, under[0], under[1], under[2])
		R.click(m, null, Vector2.ZERO, false)
		var was := _all(m)
		R.click(m, null, Vector2.ZERO, false)
		t.eq(_all(m), was, "no toggle: %s" % [under])


func test_floor_tools_keep_their_clicks() -> void:
	var m := M.new()
	_under(m, "h1", "", "")
	R.click(m, null, Vector2.ZERO, false)
	m.sel.point_at = true  # the Programmer's Point at: a floor click aims the heads
	_under(m, "", "", "")
	t.eq(R.click(m, null, Vector2.ZERO, false), "tool", "Point at takes the click")
	t.eq(m.sel.ids, ["h1"], "… the heads stay selected")
	t.ok(not R.escape(m), "Esc leaves a tool's selection alone")
	m.sel.point_at = false
	m.sel.mark_pick = true  # calibration Place mark
	_under(m, "", "s1", "")
	t.eq(R.click(m, null, Vector2.ZERO, false), "tool", "Place mark takes the click")
	t.eq(_all(m), [["h1"], "", []], "… nothing changes")
	t.eq(m.sel.floor_clicks, 2, "both reached the tool")


class NoTargets:
	extends RefCounted
	var log: Array = []

	func active() -> String:
		return ""

	func nudge(d: Vector3, dyaw: float) -> void:
		log.append([d, dyaw])


func test_nudge_keys_do_nothing_without_a_selection() -> void:
	var d := D.new()
	d.targets = NoTargets.new()
	for kc in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN, KEY_PAGEUP, KEY_PAGEDOWN, KEY_Q, KEY_E]:
		var k := InputEventKey.new()
		k.keycode = kc
		k.pressed = true
		t.ok(not d.key(k), "key %d not used" % kc)
	t.eq(d.targets.log, [], "nothing moved")


func test_wiring_pins() -> void:
	var tab := FileAccess.get_file_as_string("res://features/previs/previs_tab.gd")
	t.ok(tab.contains("if mb.position.distance_to(_press_at) < 4.0:  # a click, not an orbit"), "a drag never deselects (4 px)")
	t.ok(tab.contains("SelectRule.click(mover, stage.camera(), mb.position,"), "3D clicks go through the rule")
	t.ok(tab.contains("KEY_ESCAPE when PrevisKeys.stage_keys(mode) and not (move_drag.dragging or aim_drag.active):"),
		"Esc: 3D mode, no drag")
	t.ok(tab.contains("handled = SelectRule.escape(mover)"), "nothing selected: Esc goes on")
	var panel := FileAccess.get_file_as_string("res://features/previs/stage_panel.gd")
	t.ok(panel.contains("func deselect() -> void:\n\t_list.deselect_all()\n\t_select(\"\")"), "stage deselect: row + box + inspector")
	t.ok(panel.contains("_list.empty_clicked.connect(func(_at: Vector2, _b: int) -> void: deselect())"), "below the rows")
	var card := FileAccess.get_file_as_string("res://features/previs/move/position_card.gd")
	t.ok(card.contains("Esc / click empty space: deselect"), "the hint")
