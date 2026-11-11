extends VBoxContainer
## WO-1039 MVR — the Properties column of Studio's MVR tab (index.html #inspector): the selected window's name and
## source, X / Y / Width / Height (whole pixels, maths allowed — RULES.md number fields), Keep aspect ratio, its
## detected input / UMD info, Center X / Center Y, the Source menu, Delete window and the window ID. Emits; the panel
## decides (mvr_model.gd).

signal field_committed(key: String, text: String)
signal center_requested(axis: String)
signal aspect_toggled(on: bool)
signal source_chosen(key: String)
signal delete_requested

const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/pixelhue/mvr_model.gd")

var _empty: Label
var _box: VBoxContainer
var _name: Label
var _source: Label
var _fields := {}  # key → LineEdit
var _shown := {}  # key → the value last shown
var _aspect: CheckBox
var _info: Label
var _center_x: Button
var _center_y: Button
var _menu: OptionButton
var _delete: Button
var _id: Label


func _init() -> void:
	custom_minimum_size.x = 230
	add_theme_constant_override("separation", 6)
	add_child(_label("Properties", ThemeBuilder.ACCENT, 16))
	_empty = _label("Select a window to adjust its position and size.", ThemeBuilder.TEXT_MUTED)
	_empty.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_empty)
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 6)
	add_child(_box)
	_name = _label("", ThemeBuilder.TEXT, 15)
	_name.clip_text = true
	_box.add_child(_name)
	_source = _label("", ThemeBuilder.TEXT_MUTED)
	_source.clip_text = true
	_box.add_child(_source)
	_box.add_child(_label("Position  px", ThemeBuilder.TEXT_MUTED, 12))
	_box.add_child(_pair([["X", "x"], ["Y", "y"]]))
	_box.add_child(_label("Size  px", ThemeBuilder.TEXT_MUTED, 12))
	_box.add_child(_pair([["Width", "width"], ["Height", "height"]]))
	_aspect = CheckBox.new()
	_aspect.text = "Keep aspect ratio"
	_aspect.tooltip_text = "Keep this window's content ratio (the UMD strip excluded) when resizing"
	_aspect.toggled.connect(func(on: bool) -> void: aspect_toggled.emit(on))
	_box.add_child(_aspect)
	_info = _label("", ThemeBuilder.TEXT_MUTED, 12)
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_box.add_child(_info)
	_box.add_child(_label("Align to output", ThemeBuilder.TEXT_MUTED, 12))
	var align := HBoxContainer.new()
	_center_x = _button(align, "Center X", "Center horizontally", func() -> void: center_requested.emit("x"))
	_center_y = _button(align, "Center Y", "Center vertically", func() -> void: center_requested.emit("y"))
	_box.add_child(align)
	_box.add_child(_label("Source", ThemeBuilder.TEXT_MUTED, 12))
	_menu = OptionButton.new()
	_menu.fit_to_longest_item = false
	_menu.clip_text = true
	_menu.tooltip_text = "MVR window source"
	_menu.item_selected.connect(func(i: int) -> void:
		var key := str(_menu.get_item_metadata(i))
		if key != "":
			source_chosen.emit(key))
	_box.add_child(_menu)
	_delete = Button.new()
	_delete.text = "Delete window"
	_delete.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	_delete.pressed.connect(func() -> void: delete_requested.emit())
	_box.add_child(_delete)
	_id = _label("", ThemeBuilder.TEXT_MUTED, 12)
	_box.add_child(_id)
	_box.visible = false


func _label(text: String, col: Color, fs := 0) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", col)
	if fs > 0:
		l.add_theme_font_size_override("font_size", fs)
	return l


func _button(parent: Node, text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


func _pair(items: Array) -> HBoxContainer:
	var row := HBoxContainer.new()
	for it in items:
		row.add_child(_label(str(it[0]), ThemeBuilder.TEXT_MUTED))
		var le := LineEdit.new()
		NF.math_line(le, true, 0, 16384)
		le.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		le.custom_minimum_size.x = 60
		var key := str(it[1])
		var commit := func() -> void:
			if le.text != str(_shown.get(key, "")):
				field_committed.emit(key, le.text)
		# connected after math_line's own handlers, so the maths has resolved the text already
		le.text_submitted.connect(func(_t: String) -> void: commit.call())
		le.focus_exited.connect(commit)
		_fields[key] = le
		row.add_child(le)
	return row


## `layer` {} = nothing selected. keep_editing leaves the focused field's text alone (a save landed while typing).
func show_layer(layer: Dictionary, info: String, options: Dictionary, busy: bool, keep_editing := false) -> void:
	_empty.visible = layer.is_empty()
	_box.visible = not layer.is_empty()
	if layer.is_empty():
		return
	_name.text = str(layer.get("name", ""))
	var src := M.source_label(layer)
	_source.text = src if src != "" else "MVR window"
	for key in M.KEYS:
		var le: LineEdit = _fields[key]
		_shown[key] = str(int(layer.window[key]))
		if not (keep_editing and le.has_focus()):
			le.text = _shown[key]
		le.editable = not busy
	_aspect.set_pressed_no_signal(M.lock_of(layer) > 0)
	_aspect.disabled = busy
	_info.text = info
	_info.visible = info != ""
	_center_x.disabled = busy
	_center_y.disabled = busy
	_delete.disabled = busy
	_menu.clear()
	var items: Array = options.get("items", [])
	for i in items.size():
		_menu.add_item(str(items[i][0]))
		_menu.set_item_metadata(i, str(items[i][1]))
	if not items.is_empty():
		_menu.select(int(options.get("index", 0)))
	_menu.disabled = busy
	_id.text = "Window ID %d" % int(layer.id)
