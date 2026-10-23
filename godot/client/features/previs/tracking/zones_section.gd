extends VBoxContainer
## WO-616 T7 — Zones section of the tracking Inspector page (Zones mode): trigger zones on the floor (zone_model;
## project.previs.tracking.zones, persisted by tracking_page through `edit`). The server engine (src/tracking/
## zone-*.js, OpenFollow zones port) fires each zone's action per transition; the master starts off and asks before
## it arms. Shape: Draw, then click floor points in the camera view (tracking_page.click → add_point). Live
## occupancy comes from the server (`tracking:zones`, via the marker driver). WO-712 R4: the "On air" rules below
## (air_rules_block.gd) live in the same slice (`on_air`).

const Z := preload("res://features/previs/tracking/zone_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const AirRules := preload("res://features/previs/tracking/air_rules_block.gd")

signal edit(zones: Dictionary)  # new zones slice → persist
signal drawing_changed

var driver: Node  # marker_driver.gd: marker names + the server's zone occupancy
var data := Z.normalize({})
var sel := 0
var drawing := false
var _master: CheckButton
var _debounce: SpinBox
var _hyst: SpinBox
var _list: ItemList
var _form: GridContainer
var _name: LineEdit
var _enabled: CheckBox
var _trig: LineEdit
var _acts := {}
var _draw_btn: Button
var _state: Label
var _confirm_on: ConfirmationDialog
var _confirm_del: ConfirmationDialog
var _air: VBoxContainer


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_master = CheckButton.new()
	_master.text = "Zone engine (fires actions)"
	_master.toggled.connect(func(on: bool) -> void:
		_master.set_pressed_no_signal(data.enabled)
		if on:
			_confirm_on.popup_centered()
		else:
			_set_key("enabled", false))
	add_child(_master)
	_confirm_on = _dialog("Arm the zone engine? Markers crossing a zone then fire its actions — take looks, press Companion buttons.",
		func() -> void: _set_key("enabled", true))
	var g := GridContainer.new()
	g.columns = 2
	_debounce = _spin(0, 60000, 10, "ms")
	_debounce.value_changed.connect(func(v: float) -> void: _set_key("debounce_ms", v))
	_pair(g, "Debounce", _debounce)
	_hyst = _spin(0, 10, 0.01, "m")
	_hyst.value_changed.connect(func(v: float) -> void: _set_key("hysteresis", v))
	_pair(g, "Exit margin", _hyst)
	add_child(g)
	_list = ItemList.new()
	_list.custom_minimum_size.y = 120
	_list.item_selected.connect(func(i: int) -> void:
		sel = i
		set_drawing(false)
		refresh())
	add_child(_list)
	var row := HBoxContainer.new()
	row.add_child(_button("Add zone", _add))
	row.add_child(_button("Delete", func() -> void: _confirm_del.popup_centered()))
	add_child(row)
	_confirm_del = _dialog("Delete this trigger zone?", _delete)
	_form = GridContainer.new()
	_form.columns = 2
	_name = _line(func(v: String) -> void: _edit("name", v if v.strip_edges() != "" else "Zone"))
	_pair(_form, "Name", _name)
	_enabled = CheckBox.new()
	_enabled.toggled.connect(func(on: bool) -> void: _edit("enabled", on))
	_pair(_form, "Enabled", _enabled)
	_trig = _line(func(v: String) -> void: _edit("triggered_by", Z.parse_ids(v)))
	_trig.placeholder_text = "marker ids, e.g. 1, 3 — blank = every marker"
	_pair(_form, "Triggered by", _trig)
	for k in Z.KINDS:
		var key: String = k
		var e := _line(func(v: String) -> void: _edit_action(key, v.strip_edges()))
		e.placeholder_text = "e.g. look:look-1"
		e.tooltip_text = Z.ACTION_HINT
		_acts[key] = e
		_pair(_form, Z.KIND_LABELS[key], e)
	add_child(_form)
	var shape := HBoxContainer.new()
	_draw_btn = _button("Draw shape", func() -> void: set_drawing(not drawing))
	_draw_btn.toggle_mode = true
	shape.add_child(_draw_btn)
	shape.add_child(_button("Undo point", func() -> void: _shape(-1)))
	shape.add_child(_button("Clear shape", func() -> void: _shape(0)))
	add_child(shape)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	add_child(HSeparator.new())
	_air = AirRules.new()
	_air.changed.connect(func(list: Array) -> void:
		data.on_air = list
		_persist())
	add_child(_air)
	refresh()


## tracking_page → the stored slice (remote edits / project load). Keeps the selection.
func set_zones(src: Variant) -> void:
	data = Z.normalize(src)
	sel = clampi(sel, 0, maxi(0, data.list.size() - 1))
	refresh()


func current() -> Dictionary:
	return data.list[sel] if sel < data.list.size() else {}


func set_drawing(on: bool) -> void:
	on = on and not current().is_empty()
	if on == drawing:
		return
	drawing = on
	if _draw_btn != null:
		_draw_btn.set_pressed_no_signal(on)
	refresh()
	drawing_changed.emit()


## A floor point [x, y] clicked in the camera view while drawing.
func add_point(at: Array) -> void:
	var z := current()
	if not drawing or z.is_empty():
		return
	z.vertices.append([snappedf(float(at[0]), 0.01), snappedf(float(at[1]), 0.01)])
	_persist()


func _shape(op: int) -> void:
	var z := current()
	if z.is_empty() or z.vertices.is_empty():
		return
	if op < 0:
		z.vertices.pop_back()
	else:
		z.vertices.clear()
	_persist()


func _set_key(key: String, v: Variant) -> void:
	if data[key] == v:
		return
	data[key] = v
	_persist()


func _edit(key: String, v: Variant) -> void:
	var z := current()
	if z.is_empty() or z[key] == v:
		return
	z[key] = v
	_persist()


func _edit_action(kind: String, v: String) -> void:
	var z := current()
	if z.is_empty() or z.actions[kind] == v:
		return
	z.actions[kind] = v
	_persist()


func _add() -> void:
	data.list.append(Z.new_zone(data.list))
	sel = data.list.size() - 1
	_persist()
	set_drawing(true)


func _delete() -> void:
	if sel < data.list.size():
		data.list.remove_at(sel)
		sel = clampi(sel, 0, maxi(0, data.list.size() - 1))
		set_drawing(false)
		_persist()


func _persist() -> void:
	edit.emit(data.duplicate(true))
	refresh()


## Server occupancy for zone `id` ({occupied, count, occupants, last_kind}) or {} when the engine is not reporting.
func occupancy(id: String) -> Dictionary:
	var s: Variant = driver.zones.get(id) if driver != null else null
	return s if s is Dictionary else {}


## Fields ← data + the server's occupancy (no signals).
func refresh() -> void:
	if _list == null:
		return
	_master.set_pressed_no_signal(data.enabled)
	_debounce.set_value_no_signal(data.debounce_ms)
	_hyst.set_value_no_signal(data.hysteresis)
	_list.clear()
	for z in data.list:
		var o := occupancy(z.id)
		var who := "inside: " + ", ".join((o.occupants as Array).map(func(i: Variant) -> String: return _marker_name(int(i)))) if o.get("occupied") == true else "empty"
		_list.add_item("%s · %d pts · %s%s" % [z.name, z.vertices.size(), who, "" if z.enabled else " · off"])
		_list.set_item_custom_fg_color(_list.item_count - 1, Color(z.color) if o.get("occupied") == true else ThemeBuilder.TEXT_MUTED)
	_air.set_rules(data.on_air)
	_form.visible = not data.list.is_empty()
	_draw_btn.disabled = data.list.is_empty()
	if data.list.is_empty():
		_state.text = "No trigger zones — Add one, then click its corners on the floor in the camera view."
		return
	_list.select(sel)
	var z := current()
	if not _name.has_focus():
		_name.text = z.name
	_enabled.set_pressed_no_signal(z.enabled)
	if not _trig.has_focus():
		_trig.text = ", ".join(z.triggered_by.map(func(i: Variant) -> String: return str(i)))
	var errs := []
	for k in Z.KINDS:
		var e: LineEdit = _acts[k]
		if not e.has_focus():
			e.text = z.actions[k]
		var why := Z.action_error(z.actions[k])
		e.add_theme_color_override("font_color", ThemeBuilder.ERROR if why != "" else ThemeBuilder.TEXT)
		if why != "":
			errs.append("%s: %s" % [Z.KIND_LABELS[k], why])
	var o := occupancy(z.id)
	var lines := []
	if drawing:
		lines.append("Drawing — click the zone's corners on the floor in the camera view (%d so far, 3+ needed)." % z.vertices.size())
	elif z.vertices.size() < 3:
		lines.append("No shape yet — Draw shape, then click 3+ floor points.")
	lines.append_array(errs)
	var seen: bool = driver != null and driver.zones_seen
	lines.append("Server zone engine not reporting — the Tracking module is off on the server." if not seen else
		"Not on the server yet (autosave pending)." if o.is_empty() else
		"Engine %s. Last: %s. Stale marker = stays inside." % ["ARMED" if data.enabled else "off",
		str(o.get("last_kind", "")).replace("_", " ") if str(o.get("last_kind", "")) != "" else "—"])
	_state.text = "\n".join(lines)


func _marker_name(id: int) -> String:
	for d in (driver.defs if driver != null else []):
		if int(d.id) == id:
			return str(d.name)
	return "Marker %d" % id


func _pair(g: GridContainer, text: String, c: Control) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)


func _line(cb: Callable) -> LineEdit:
	var e := LineEdit.new()
	e.text_submitted.connect(cb)
	e.focus_exited.connect(func() -> void: cb.call(e.text))
	return e


func _spin(lo: float, hi: float, step: float, suffix: String) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.step = step
	sb.suffix = suffix
	sb.update_on_text_changed = true
	return sb


func _dialog(text: String, cb: Callable) -> ConfirmationDialog:
	var d := ConfirmationDialog.new()
	d.dialog_text = text
	d.confirmed.connect(cb)
	add_child(d)
	return d


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
