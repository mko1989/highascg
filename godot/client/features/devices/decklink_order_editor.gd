extends VBoxContainer
## WO-605 slice 9a — the DeckLink page's rear-order editor in edit mode (web device-view-inspector-decklink-rear-order.js):
## one row per DeckLink port (Slot N, label, id) to drag into order — dropping on a row's lower half lands after it —
## then Save / Export / Load / Reset order. Every change saves the order for this client and asks for a reload
## (`changed`), like the web's persistAndRefresh. Load reports to the status line (web: alert on a bad file only).

signal changed
signal status(text: String, ok: bool)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const DO := preload("res://features/devices/decklink_order.gd")
const FilePick := preload("res://features/devices/file_pick.gd")

var confirm: Callable  # (text) -> bool, awaited
var _items: Array = []
var _ids: Array = []
var _rows: Array = []


func setup(payload: Dictionary) -> void:
	add_theme_constant_override("separation", 4)
	_items = DO.merged(payload)
	_ids = DO.ids(DO.current(_items, DO.saved()))
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1, 4))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	box.add_child(v)
	add_child(box)
	v.add_child(_text(DO.HEADING, ThemeBuilder.TEXT_MUTED, 11))
	for i in _ids.size():
		v.add_child(_row(i))
	var acts := HBoxContainer.new()
	for b in [["Save", _save], ["Export", _export], ["Load", _load]]:
		acts.add_child(_button(b[0], b[1]))
	var fill := Control.new()
	fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	acts.add_child(fill)
	var reset := _button("Reset order", _reset)
	reset.tooltip_text = DO.RESET_TIP
	reset.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	acts.add_child(reset)
	v.add_child(acts)


func _row(i: int) -> Control:
	var id: String = _ids[i]
	var c: Dictionary = {}
	for x in _items:
		if str(x.id) == id:
			c = x
	var p := PanelContainer.new()
	p.mouse_default_cursor_shape = Control.CURSOR_DRAG
	p.add_theme_stylebox_override("panel", _row_box(0, 0))
	var h := HBoxContainer.new()
	p.add_child(h)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 0)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(_text("Slot %d" % (i + 1), ThemeBuilder.TEXT_MUTED, 10))
	v.add_child(_text(str(c.label) if str(c.get("label", "")) != "" else id, ThemeBuilder.TEXT, 12))
	v.add_child(_text(id, ThemeBuilder.TEXT_MUTED, 9))
	h.add_child(v)
	h.add_child(_text("≡", ThemeBuilder.TEXT_MUTED, 14))
	for n in [v, h] + v.get_children() + h.get_children():
		n.mouse_filter = Control.MOUSE_FILTER_IGNORE  # the row takes the drag
	p.set_drag_forwarding(func(_at: Vector2) -> Variant:
		var pv := _text(id, ThemeBuilder.TEXT, 12)
		p.set_drag_preview(pv)
		return {"dl_rear_row": i},
		func(at: Vector2, data: Variant) -> bool:
			var ok: bool = data is Dictionary and data.has("dl_rear_row") and int(data.dl_rear_row) != i
			if ok:
				p.add_theme_stylebox_override("panel", _row_box(0 if at.y > p.size.y / 2 else 2, 2 if at.y > p.size.y / 2 else 0))
			return ok,
		func(at: Vector2, data: Variant) -> void:
			p.add_theme_stylebox_override("panel", _row_box(0, 0))
			_ids = DO.move(_ids, int(data.dl_rear_row), i, at.y > p.size.y / 2)
			_persist())
	p.mouse_exited.connect(func() -> void: p.add_theme_stylebox_override("panel", _row_box(0, 0)))
	_rows.append(p)
	return p


static func _row_box(top: int, bottom: int) -> StyleBoxFlat:
	var b: StyleBoxFlat = ThemeBuilder.box(ThemeBuilder.BG_DARK, ThemeBuilder.BORDER, 1, 3)
	b.border_width_top = 1 if top == 0 else top
	b.border_width_bottom = 1 if bottom == 0 else bottom
	if top > 0 or bottom > 0:
		b.border_color = ThemeBuilder.ACCENT
	b.content_margin_left = 6
	b.content_margin_right = 6
	b.content_margin_top = 4
	b.content_margin_bottom = 4
	return b


func _persist() -> void:
	DO.save(_ids)
	changed.emit()


func _save() -> void:
	_persist()


func _export() -> void:
	var path: String = await FilePick.save_path(self, "Export DeckLink rear order", DO.EXPORT_NAME)
	if path == "":
		return
	var err := FilePick.write_text(path, DO.export_text(_ids))
	status.emit("Export failed: " + err if err != "" else "Exported " + path.get_file(), err == "")


func _load() -> void:
	var path: String = await FilePick.open_path(self, "Load DeckLink rear order")
	if path == "":
		return
	var p := DO.parse_file(FileAccess.get_file_as_string(path), _items)
	if not p.ok:
		status.emit(p.error, false)
		return
	_ids = p.ids
	status.emit("Loaded " + path.get_file(), true)  # replaces an earlier bad-file error (web: alert only)
	_persist()


func _reset() -> void:
	if confirm.is_valid() and not await confirm.call(DO.RESET_CONFIRM):
		return
	DO.clear()
	changed.emit()


func _button(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 11)
	b.pressed.connect(on_press)
	return b


func _text(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
