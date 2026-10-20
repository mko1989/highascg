extends VBoxContainer
## WO-605 slice 7c — the Devices tab's "Mapping nodes" column (web device-view-mappings-render.js), between the
## destination cards and the rear panel: a "+" that adds a node, then one card per pixel mapping node — its label,
## the input dot (left) and one numbered dot per output (right) as cable anchors, and a "+" that adds an output.
## Clicking a card (not a dot or "+") opens the node's page (mapping_controls.gd); the selected card is outlined.

signal add_node()
signal add_output(id: String)
signal open_node(id: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const M := preload("res://features/devices/mapping_page_model.gd")

var _cards := VBoxContainer.new()


func _init() -> void:
	add_theme_constant_override("separation", 10)
	var head := HBoxContainer.new()
	var t := _label("MAPPING NODES", ThemeBuilder.TEXT_MUTED, 12)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(t)
	head.add_child(_plus("Add mapping node", func() -> void: add_node.emit()))
	add_child(head)
	_cards.add_theme_constant_override("separation", 12)
	add_child(_cards)


## Rebuild from the device view; `anchors` collects the dots for the cable layer.
func show_nodes(payload: Dictionary, anchors: Dictionary, selected_id: String) -> void:
	for c in _cards.get_children():
		_cards.remove_child(c)
		c.queue_free()
	var band := M.band(payload)
	if band.has("note"):
		var l := _label(band.note, ThemeBuilder.TEXT_MUTED, 12)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_cards.add_child(l)
		return
	for card in band.cards:
		_cards.add_child(_card(card, anchors))
	highlight(selected_id)


## Outline the card whose page is open ("" = none).
func highlight(id: String) -> void:
	for card in _cards.get_children():
		if card.has_meta("node_id"):
			card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED,
				ThemeBuilder.ACCENT if card.get_meta("node_id") == id else ThemeBuilder.BORDER, 1))


func _card(c: Dictionary, anchors: Dictionary) -> Control:
	var card := PanelContainer.new()
	card.set_meta("node_id", c.id)
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	card.tooltip_text = "Click to edit this mapping node in the Inspector"
	card.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			open_node.emit(c.id))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	v.mouse_filter = Control.MOUSE_FILTER_PASS
	card.add_child(v)
	var title := HBoxContainer.new()
	title.mouse_filter = Control.MOUSE_FILTER_PASS
	var t := _label(str(c.label), ThemeBuilder.TEXT, 13)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	t.clip_text = true
	title.add_child(t)
	title.add_child(_plus("Add output", func() -> void: add_output.emit(c.id)))
	v.add_child(title)
	var body := HBoxContainer.new()
	body.mouse_filter = Control.MOUSE_FILTER_PASS
	v.add_child(body)
	var left := VBoxContainer.new()
	left.mouse_filter = Control.MOUSE_FILTER_PASS
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.alignment = BoxContainer.ALIGNMENT_CENTER
	if str(c.get("in", "")) != "":
		var row := HBoxContainer.new()
		row.mouse_filter = Control.MOUSE_FILTER_PASS
		row.add_child(_dot(anchors, c["in"], "%s input" % c.label))
		row.add_child(_label("IN", ThemeBuilder.TEXT_MUTED, 10))
		left.add_child(row)
	body.add_child(left)
	var outs := VBoxContainer.new()
	outs.mouse_filter = Control.MOUSE_FILTER_PASS
	outs.add_theme_constant_override("separation", 6)
	for o in c.outs:
		var row := HBoxContainer.new()
		row.mouse_filter = Control.MOUSE_FILTER_PASS
		row.alignment = BoxContainer.ALIGNMENT_END
		row.add_child(_label(str(o[1]), ThemeBuilder.ACCENT, 10))
		row.add_child(_dot(anchors, o[0], "%s output %s" % [c.label, o[1]]))
		outs.add_child(row)
	body.add_child(outs)
	return card


func _dot(anchors: Dictionary, key: String, tip: String) -> Control:
	var p := PortIcon.make("", Vector2(14, 14), tip)
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	anchors[key] = p
	return p


func _plus(tip: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = "+"
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 12)
	b.pressed.connect(on_press)
	return b


func _label(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_PASS
	return l
