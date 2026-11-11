extends VBoxContainer
## WO-1039 MVR — the left column of Studio's MVR tab: Windows (count, MVR output menu, one row per window with its
## size and a • while unsaved) and Add to MVR (screen PGM/PVW and inputs: drag one onto the layout, double-click to
## place it in free space; a source already in the MVR selects its window instead — mvr-sources.js).

signal screen_chosen(id: int)
signal window_picked(id: int)
signal source_added(key: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/pixelhue/mvr_model.gd")

var _count: Label
var _screens: OptionButton
var _list: VBoxContainer
var _sources: VBoxContainer
var _screen_ids: Array = []


func _init() -> void:
	custom_minimum_size.x = 230
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	var title := _label("Windows", ThemeBuilder.ACCENT, 16)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	_count = _label("0", ThemeBuilder.TEXT_MUTED)
	head.add_child(_count)
	add_child(head)
	add_child(_label("MVR output", ThemeBuilder.TEXT_MUTED, 12))
	_screens = OptionButton.new()
	_screens.clip_text = true
	_screens.item_selected.connect(func(i: int) -> void:
		if i >= 0 and i < _screen_ids.size():
			screen_chosen.emit(int(_screen_ids[i])))
	add_child(_screens)
	var ls := ScrollContainer.new()
	ls.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ls.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ls.add_child(_list)
	add_child(ls)
	add_child(HSeparator.new())
	add_child(_label("Add to MVR", ThemeBuilder.ACCENT, 14))
	var hint := _label("Drag onto the layout, or double-click to place. Drop on a window to swap its source.", ThemeBuilder.TEXT_MUTED, 12)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(hint)
	var ss := ScrollContainer.new()
	ss.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ss.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_sources = VBoxContainer.new()
	_sources.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ss.add_child(_sources)
	add_child(ss)


func _label(text: String, col: Color, fs := 0) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", col)
	if fs > 0:
		l.add_theme_font_size_override("font_size", fs)
	return l


func show_screens(screens: Array, current: int, busy: bool) -> void:
	_screens.clear()
	_screen_ids = []
	for s in screens:
		_screens.add_item(str(s.name) if str(s.name).strip_edges() != "" else "Multiviewer %d" % int(s.id))
		_screen_ids.append(int(s.id))
	if screens.is_empty():
		_screens.add_item("No MVR outputs found")
	var i := _screen_ids.find(current)
	if i >= 0:
		_screens.select(i)
	_screens.disabled = busy or screens.is_empty()


func show_windows(windows: Array, selected_id: int, dirty_ids: Array, busy: bool) -> void:
	_count.text = str(windows.size())
	for c in _list.get_children():
		c.queue_free()
	if windows.is_empty():
		_list.add_child(_label("No windows on this output.", ThemeBuilder.TEXT_MUTED, 12))
	for l in windows:
		var b := Button.new()
		var id := int(l.id)
		b.text = "%s  ·  %s%s" % [M.row_label(l), M.size_label(l.window), "  •" if dirty_ids.has(id) else ""]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.clip_text = true
		b.toggle_mode = true
		b.set_pressed_no_signal(id == selected_id)
		b.tooltip_text = "%s · %s" % [str(l.name), M.row_label(l)]
		b.disabled = busy
		b.pressed.connect(func() -> void: window_picked.emit(id))
		_list.add_child(b)


func show_sources(sources: Array, busy: bool) -> void:
	for c in _sources.get_children():
		c.queue_free()
	for s in sources:
		var b := Button.new()
		var key := M.source_key(s.type, s.id)
		var used: Variant = s.get("usedBy")
		b.text = "%s  ·  %s" % [str(s.name), M.source_meta(s)]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.clip_text = true
		b.disabled = busy
		if used != null:
			b.modulate = Color(1, 1, 1, 0.6)
			b.tooltip_text = "Already in the MVR; click to select its window."
			b.pressed.connect(func() -> void: window_picked.emit(int(used)))
		else:
			b.tooltip_text = "Drag onto the layout, or double-click to place it in free space."
			b.gui_input.connect(func(e: InputEvent) -> void:
				if e is InputEventMouseButton and (e as InputEventMouseButton).double_click and (e as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
					source_added.emit(key))
			b.set_drag_forwarding(func(_at: Vector2) -> Variant:
				if busy:
					return null
				var p := Label.new()
				p.text = str(s.name)
				b.set_drag_preview(p)
				return {"mvr_source": key}, Callable(), Callable())
		_sources.add_child(b)
