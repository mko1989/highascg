extends VBoxContainer
## WO-616 T5b — Markers section of the tracking Inspector page (Markers mode): the project's markers (add / delete /
## rename; live position and freshness from the server hub), the selected marker, move speed (m/s) and stick curve,
## Home (grid centre). Definitions are written through `edit` (tracking_page persists them); positions go through
## the marker_driver.

const T := preload("res://features/previs/tracking/tracking_model.gd")
const MI := preload("res://features/previs/tracking/marker_input.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal edit(markers: Array)  # new definition list → persist

var driver: Node  # marker_driver.gd
var defs: Array = []
var _list: ItemList
var _name: LineEdit
var _speed: SpinBox
var _curve: OptionButton
var _state: Label
var _confirm: ConfirmationDialog


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_list = ItemList.new()
	_list.custom_minimum_size.y = 160
	_list.item_selected.connect(func(i: int) -> void:
		if driver != null and i < defs.size():
			driver.selected = int(defs[i].id)
			driver.updated.emit())
	add_child(_list)
	var row := HBoxContainer.new()
	row.add_child(_button("Add marker", _add))
	row.add_child(_button("Delete", func() -> void: _confirm.popup_centered()))
	row.add_child(_button("Home", func() -> void:
		if driver != null and driver.selected != 0:
			driver.send_home(driver.selected)))
	add_child(row)
	_confirm = ConfirmationDialog.new()
	_confirm.dialog_text = "Delete this marker? It also leaves the server (follow loses it)."
	_confirm.confirmed.connect(_delete)
	add_child(_confirm)
	var g := GridContainer.new()
	g.columns = 2
	_name = LineEdit.new()
	_name.text_submitted.connect(func(v: String) -> void: _rename(v))
	_name.focus_exited.connect(func() -> void: _rename(_name.text))
	_pair(g, "Name", _name)
	_speed = SpinBox.new()
	_speed.min_value = MI.SPEED_MIN
	_speed.max_value = MI.SPEED_MAX
	_speed.step = 0.1
	_speed.suffix = "m/s"
	_speed.value_changed.connect(func(v: float) -> void:
		if driver != null:
			driver.speed = v)
	_pair(g, "Speed", _speed)
	_curve = OptionButton.new()
	for c in MI.CURVES:
		_curve.add_item(c)
	_curve.item_selected.connect(func(i: int) -> void:
		if driver != null:
			driver.curve = MI.CURVES[i])
	_pair(g, "Stick curve", _curve)
	add_child(g)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)


func set_defs(markers: Array) -> void:
	defs = markers
	refresh()


## Fields ← driver + defs (no signals).
func refresh() -> void:
	if _list == null or driver == null:
		return
	_list.clear()
	var sel := -1
	for i in defs.size():
		var d: Dictionary = defs[i]
		var id := int(d.id)
		var p: Dictionary = driver.pos(id)
		var live: bool = driver.positions.has(id) and p.stale != true
		_list.add_item("%s  %s   %.2f, %.2f m" % ["●" if live else "○", d.name, p.x, p.y])
		_list.set_item_custom_fg_color(i, Color.html(str(d.color)) if live else ThemeBuilder.TEXT_MUTED)
		if id == driver.selected:
			sel = i
	if sel >= 0:
		_list.select(sel)
	var cur := _def(driver.selected)
	if not _name.has_focus():
		_name.text = str(cur.get("name", ""))
	_name.editable = not cur.is_empty()
	_speed.set_value_no_signal(driver.speed)
	_curve.select(maxi(0, MI.CURVES.find(driver.curve)))
	_state.text = ("No markers — Add one; it starts at the grid centre." if defs.is_empty() else
		"Server hub not reachable — the Tracking module is off on the server." if not driver.synced else
		"● live  ○ stale (no write for 1 s). Positions go to the server hub (Art-Net follow, WO-615).")


func _def(id: int) -> Dictionary:
	for d in defs:
		if int(d.id) == id:
			return d
	return {}


func _add() -> void:
	var list := defs.duplicate(true)
	var m := T.new_marker(list)
	list.append(m)
	if driver != null:
		driver.selected = int(m.id)
	edit.emit(list)


func _delete() -> void:
	if driver == null or _def(driver.selected).is_empty():
		return
	var id: int = driver.selected
	edit.emit(defs.filter(func(d: Dictionary) -> bool: return int(d.id) != id))
	driver.forget(id)


func _rename(v: String) -> void:
	var id: int = driver.selected if driver != null else 0
	var cur := _def(id)
	if cur.is_empty() or v.strip_edges() == "" or v == cur.name:
		return
	var list := defs.duplicate(true)
	for d in list:
		if int(d.id) == id:
			d["name"] = v.strip_edges()
	edit.emit(list)


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b


func _pair(g: GridContainer, text: String, c: Control) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)
