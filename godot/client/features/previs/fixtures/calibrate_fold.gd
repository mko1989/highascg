extends VBoxContainer
## WO-700 — Lighting → Calibrate heads (owner 23.10: "it should be done by pointing the lights at markers in real life
## than clicking this position of pan tilt is this marker and it calibrates"). Stage marks are real spots on the floor
## (tape, a grid corner) stored in project.fixtures.marks (PSN metres): Place mark drops one where the 3D floor is
## clicked, X / Y / Z take the measured values. For the one selected head the WO-624 E3 session (calibrate_section.gd,
## `lighting`) leaves the head to the Programmer above — the same Pan / Tilt (or right-drag) aims the real beam;
## "Beam is on <mark>" pairs the pan / tilt the head is being sent with that mark; from 3 marks the server solves where
## the head hangs and Apply pose writes it into the patch.

const F := preload("res://features/previs/tracking/follow_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const Calibrate := preload("res://features/previs/tracking/calibrate_section.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")

var sel: RefCounted = Sel.shared()
var _list: ItemList
var _place: Button
var _remove: Button
var _name: LineEdit
var _xyz: Array = []  # SpinBox x, y, z
var _edit: HBoxContainer
var _head: Label
var _calib := Calibrate.new()
var _on_mark: Button
var _picked := 0  # selected mark id
var _trim_row: HBoxContainer
var _trim: Array = []  # SpinBox pan, tilt — the selected head's beam offset (R7 manual trim)
var _key := ""


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_muted("Stage marks — real spots on the floor (tape, grid corners). Place one by clicking the floor in the 3D " +
		"view, then type its measured position (metres from the stage origin: X stage left, Y upstage).")
	_list = ItemList.new()
	_list.custom_minimum_size.y = 96
	_list.item_selected.connect(func(i: int) -> void:
		_picked = int(_list.get_item_metadata(i))
		_fill_edit())
	add_child(_list)
	var row := HBoxContainer.new()
	_place = Button.new()
	_place.text = "Place mark"
	_place.toggle_mode = true
	_place.tooltip_text = "Then click the stage floor in the 3D view"
	_place.toggled.connect(func(on: bool) -> void:
		if on:
			sel.set_point_at(false)
		sel.mark_pick = on
		_place.text = "Click the floor…" if on else "Place mark")
	row.add_child(_place)
	var preset := Button.new()
	preset.text = "Preset marks"
	preset.tooltip_text = "The tracking grid's corners, edge middles and dead centre (Tracking → grid)"
	preset.pressed.connect(_add_presets)
	row.add_child(preset)
	_remove = Button.new()
	_remove.text = "Remove mark"
	_remove.pressed.connect(_remove_mark)
	row.add_child(_remove)
	add_child(row)
	_edit = HBoxContainer.new()
	_name = LineEdit.new()
	_name.placeholder_text = "Name"
	_name.select_all_on_focus = true
	_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name.text_submitted.connect(func(_t: String) -> void: _store_edit())
	_name.focus_exited.connect(_store_edit)
	_edit.add_child(_name)
	for axis in ["X", "Y", "Z"]:
		var sb := SpinBox.new()
		sb.min_value = -500
		sb.max_value = 500
		sb.step = 0.01
		sb.prefix = axis
		sb.suffix = "m"
		sb.select_all_on_focus = true
		sb.custom_minimum_size.x = 92
		sb.value_changed.connect(func(_v: float) -> void: _store_edit())
		_edit.add_child(sb)
		_xyz.append(sb)
	add_child(_edit)
	_head = _muted("")
	_build_trim()
	_calib.lighting = true
	_calib.apply_requested.connect(_apply_solve)
	add_child(_calib)
	_on_mark = Button.new()
	_on_mark.pressed.connect(func() -> void:
		var m := _mark(_picked)
		if not m.is_empty():
			_calib.add_floor_point([m.x, m.y, m.z]))
	_calib.add_point_button(_on_mark)
	_calib.refreshed.connect(_fill_button)
	sel.floor_picked.connect(_add_mark)
	sel.changed.connect(_on_selection)
	Store.project_changed.connect(func(_p: Dictionary) -> void:
		_fill()
		_fill_trim())
	_fill()
	_on_selection()


func _exit_tree() -> void:
	sel.mark_pick = false


func _slice() -> Dictionary:
	return F.normalize(Store.project.get("fixtures"))


func _mark(id: int) -> Dictionary:
	for m in _slice().marks:
		if int(m.id) == id:
			return m
	return {}


func _fill() -> void:
	var marks: Array = _slice().marks
	var key := JSON.stringify(marks) + str(_picked)
	if key == _key:
		return
	_key = key
	_list.clear()
	for m in marks:
		_list.add_item("%s   X %.2f  Y %.2f  Z %.2f" % [m.name, m.x, m.y, m.z])
		_list.set_item_metadata(_list.item_count - 1, int(m.id))
		if int(m.id) == _picked:
			_list.select(_list.item_count - 1)
	if _mark(_picked).is_empty():
		_picked = 0
	_fill_edit()


func _fill_edit() -> void:
	var m := _mark(_picked)
	_edit.visible = not m.is_empty()
	_remove.disabled = m.is_empty()
	if not m.is_empty():
		if not _name.has_focus():
			_name.text = str(m.name)
		for i in 3:
			if not (_xyz[i] as SpinBox).get_line_edit().has_focus():
				(_xyz[i] as SpinBox).set_value_no_signal(float(m[["x", "y", "z"][i]]))
	_fill_button()


func _fill_button() -> void:
	var m := _mark(_picked)
	_on_mark.disabled = m.is_empty()
	_on_mark.text = "Beam is on %s" % m.name if not m.is_empty() else "Beam is on … (pick a mark above)"


func _on_selection() -> void:
	_calib.set_fixture(str(sel.ids[0]) if sel.ids.size() == 1 else "")
	_head.text = "" if sel.ids.size() == 1 else "Select one head (click it in the 3D view) to calibrate where it hangs."
	_head.visible = _head.text != ""
	_fill_trim()


func _add_mark(psn: Array) -> void:
	_place.button_pressed = false  # one mark per Place
	var s := _slice()
	var id := 1
	for m in s.marks:
		id = maxi(id, int(m.id) + 1)
	s.marks.append({"id": id, "name": "Mark %d" % id, "x": snappedf(psn[0], 0.01), "y": snappedf(psn[1], 0.01), "z": 0.0})
	_picked = id
	_persist(s)


## WO-703: the 9 floor spots the camera calibration uses — grid corners, edge middles, dead centre; names already
## there are kept (they may have been measured).
func _add_presets() -> void:
	var pv: Variant = Store.project.get("previs")
	var grid: Dictionary = T.normalize((pv as Dictionary).get("tracking") if pv is Dictionary else null).grid
	var s := _slice()
	s.marks = F.preset_marks(grid, s.marks)
	_persist(s)


func _store_edit() -> void:
	var s := _slice()
	for m in s.marks:
		if int(m.id) == _picked:
			var nm := _name.text.strip_edges()
			m.name = nm if nm != "" else m.name
			for i in 3:  # millimetres: the spin box steps leave float noise
				m[["x", "y", "z"][i]] = snappedf((_xyz[i] as SpinBox).value, 0.001)
			if JSON.stringify(s.marks) != JSON.stringify(_slice().marks):
				_persist(s)
			return


func _remove_mark() -> void:
	var s := _slice()
	s.marks = s.marks.filter(func(m: Dictionary) -> bool: return int(m.id) != _picked)
	_picked = 0
	_persist(s)


func _apply_solve(solve: Dictionary) -> void:
	var s := _slice()
	for i in s.patch.size():
		if s.patch[i].id == _calib.fixture_id:
			s.patch[i] = F.apply_solve(s.patch[i], solve)
			_persist(s)
			return


## WO-700 R7 (owner 23.10: "give the user the ability to position the digital 3d light beam adjusting the pan tilt
## offset without moving the artnet fixture"): the selected head's beam offset by hand — only the previs beam turns
## (nothing is sent; Point at aims with it). Clear drops the offset and every pinned mark.
func _build_trim() -> void:
	_trim_row = HBoxContainer.new()
	var l := Label.new()
	l.text = "Beam offset"
	_trim_row.add_child(l)
	for axis in ["Pan", "Tilt"]:
		var sb := SpinBox.new()
		sb.min_value = -180
		sb.max_value = 180
		sb.step = 0.1
		sb.prefix = axis
		sb.suffix = "°"
		sb.select_all_on_focus = true
		sb.custom_minimum_size.x = 104
		sb.tooltip_text = "Turns only the digital beam — the real head is not sent anything"
		sb.value_changed.connect(func(_v: float) -> void: _store_trim())
		_trim_row.add_child(sb)
		_trim.append(sb)
	var clear := Button.new()
	clear.text = "Clear"
	clear.tooltip_text = "Drop this head's beam offset and every mark pinned on it"
	clear.pressed.connect(_clear_calibration)
	_trim_row.add_child(clear)
	add_child(_trim_row)


func _patch_index() -> int:
	var s := _slice()
	for i in s.patch.size():
		if s.patch[i].id == _calib.fixture_id:
			return i
	return -1


func _fill_trim() -> void:
	var i := _patch_index()
	_trim_row.visible = i >= 0
	if i < 0:
		return
	var off: Dictionary = _slice().patch[i].get("offset", {})
	for k in 2:
		if not (_trim[k] as SpinBox).get_line_edit().has_focus():
			(_trim[k] as SpinBox).set_value_no_signal(float(off.get(["pan", "tilt"][k], 0.0)))


func _store_trim() -> void:
	var i := _patch_index()
	if i < 0:
		return
	var s := _slice()
	var o := {"pan": snappedf((_trim[0] as SpinBox).value, 0.01), "tilt": snappedf((_trim[1] as SpinBox).value, 0.01)}
	s.patch[i] = F.apply_solve(s.patch[i], {"ok": true, "offset": o})
	if JSON.stringify(s.patch[i]) != JSON.stringify(_slice().patch[i]):
		_persist(s)


func _clear_calibration() -> void:
	var i := _patch_index()
	if i < 0:
		return
	if _calib.is_open():
		_calib.end()  # an open session would put its starting pins back with the next point
	var s := _slice()
	s.patch[i] = F.apply_solve(s.patch[i], {"ok": true, "offset": {"pan": 0, "tilt": 0}, "map": []})
	_persist(s)


func _persist(s: Dictionary) -> void:
	Store.project["fixtures"] = s
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(l)
	return l
