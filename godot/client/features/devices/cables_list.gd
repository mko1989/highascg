extends VBoxContainer
## WO-605 — the Devices tab's "CABLES" list under the rear panel (moved out of devices_tab.gd in slice 10b): one row
## per cable in its colour, "Source → Sink". Hovering a row thickens that cable (`hover`), clicking selects it, and
## the selected row shows a Remove button, like the web edge inspector's.

signal hover(id: String, on: bool)
signal select(id: String)
signal remove(id: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const CableModel := preload("res://features/devices/cable_model.gd")

var _box := VBoxContainer.new()
var _rows := {}  # cable id → [row button, remove button]


func _init() -> void:
	var head := Label.new()
	head.text = "CABLES"
	head.add_theme_font_size_override("font_size", 12)
	head.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(head)
	add_child(_box)


func show_cables(cables: Array) -> void:
	for c in _box.get_children():
		_box.remove_child(c)
		c.queue_free()
	_rows = {}
	if cables.is_empty():
		var l := Label.new()
		l.text = "No cables."
		l.add_theme_font_size_override("font_size", 12)
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_box.add_child(l)
	for c in cables:
		_box.add_child(_row(c))


func mark(selected: String) -> void:
	for id in _rows:
		_rows[id][1].visible = id == selected
		_rows[id][0].add_theme_color_override("font_outline_color", ThemeBuilder.ACCENT)
		_rows[id][0].add_theme_constant_override("outline_size", 1 if id == selected else 0)


func _row(c: Dictionary) -> Control:
	var h := HBoxContainer.new()
	var b := Button.new()
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.focus_mode = Control.FOCUS_NONE
	b.text = "●  " + str(c.label)
	b.add_theme_font_size_override("font_size", 12)
	var col: Color = CableModel.color(c.id)
	b.add_theme_color_override("font_color", col.lerp(ThemeBuilder.TEXT, 0.35))
	b.mouse_entered.connect(func() -> void: hover.emit(c.id, true))
	b.mouse_exited.connect(func() -> void: hover.emit(c.id, false))
	b.pressed.connect(func() -> void: select.emit(c.id))
	h.add_child(b)
	var rm := Button.new()
	rm.text = "Remove"
	rm.focus_mode = Control.FOCUS_NONE
	rm.add_theme_font_size_override("font_size", 12)
	rm.pressed.connect(func() -> void: remove.emit(c.id))
	rm.visible = false
	h.add_child(rm)
	_rows[c.id] = [b, rm]
	return h
