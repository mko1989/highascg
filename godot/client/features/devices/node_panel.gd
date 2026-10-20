extends VBoxContainer
## WO-605 slice 10b — the Node view's rear panel (web renderCasparBandSimple, 09d-device-view-simple-wiring.css):
## node_view_model.gd's sections in a grid of ≥ 200 px columns, each a head (title, "+" for the output kinds) over
## its node cards. A card is a button (opens the connector's page, `open_requested`); its dot — on the left for
## inputs, the right otherwise — is a port_icon.gd registered in `anchors` under the cable id, so the cable layer and
## the tab's gesture treat it like a rear-panel socket. `highlight` rings the open page's card (blue) and the armed
## cable source's (amber), like --selected / --armed.

signal add_requested(kind: String)
signal open_requested(id: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const NV := preload("res://features/devices/node_view_model.gd")
const COL_W := 200.0
const GAP := Vector2(24, 14)
const CARD := Color("#18181c")
const CARD_HOVER := Color("#1d1d22")
const EDGE := Color("#3f3f48")
const SELECTED := Color(0.22, 0.74, 0.97, 0.65)
const ARMED := Color(0.98, 0.8, 0.08, 0.7)

var anchors := {}
var _grid: GridContainer
var _cards := {}  # cable id → card Button


func _init() -> void:
	add_theme_constant_override("separation", 8)
	var head := Label.new()
	head.text = "REAR PANEL"
	head.add_theme_font_size_override("font_size", 11)
	head.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(head)
	_grid = GridContainer.new()
	_grid.add_theme_constant_override("h_separation", int(GAP.x))
	_grid.add_theme_constant_override("v_separation", int(GAP.y))
	add_child(_grid)
	resized.connect(_fit)


## Columns as CSS grid auto-fit minmax(200px, 1fr) would give.
func _fit() -> void:
	_grid.columns = maxi(1, int((size.x + GAP.x) / (COL_W + GAP.x)))


func show_sections(sections: Array) -> void:
	for c in _grid.get_children():
		_grid.remove_child(c)
		c.queue_free()
	anchors = {}
	_cards = {}
	for s in sections:
		_grid.add_child(_section(s))
	_fit()


func highlight(selected: String, armed: String) -> void:
	for id in _cards:
		var b: Button = _cards[id]
		var edge: Color = ARMED if id == armed else (SELECTED if id == selected else EDGE)
		for st in ["normal", "hover", "pressed"]:
			(b.get_theme_stylebox(st) as StyleBoxFlat).border_color = edge if st != "hover" or edge != EDGE else Color("#4b5563")


func _section(s: Dictionary) -> Control:
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.custom_minimum_size.x = COL_W
	v.add_theme_constant_override("separation", 8)
	var head := HBoxContainer.new()
	var t := Label.new()
	t.text = str(s.title).to_upper()
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	t.add_theme_font_size_override("font_size", 10)
	t.add_theme_color_override("font_color", Color(ThemeBuilder.TEXT, 0.75))
	head.add_child(t)
	if s.add != "":
		var plus := Button.new()
		plus.text = "+"
		plus.flat = true
		plus.focus_mode = Control.FOCUS_NONE
		plus.tooltip_text = "Add new %s output" % str(s.title).to_lower()
		plus.add_theme_font_size_override("font_size", 12)
		plus.pressed.connect(func() -> void: add_requested.emit(str(s.add)))
		head.add_child(plus)
	v.add_child(head)
	if s.note:
		var n := Label.new()
		n.text = NV.NONE_YET
		n.add_theme_font_size_override("font_size", 11)
		n.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		v.add_child(n)
	for node in s.nodes:
		v.add_child(_card(node))
	return v


func _card(n: Dictionary) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, 48)
	b.tooltip_text = "%s — %s" % [n.label, NV.kind_title(n.kind)]
	for st in ["normal", "hover", "pressed"]:
		var sb := ThemeBuilder.box(CARD_HOVER if st == "hover" else CARD, Color("#4b5563") if st == "hover" else EDGE, 1, 8)
		b.add_theme_stylebox_override(st, sb)
	if n.dim:
		b.modulate.a = 0.55
	b.pressed.connect(func() -> void: open_requested.emit(str(n.id)))
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", 8)
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 24
	row.offset_right = -24
	b.add_child(row)
	var icon := TextureRect.new()
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	icon.texture = PortIcon.texture(str(n.icon), 18)
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.custom_minimum_size = Vector2(18, 18)
	icon.modulate.a = 0.9
	row.add_child(icon)
	var text := VBoxContainer.new()
	text.mouse_filter = Control.MOUSE_FILTER_IGNORE
	text.alignment = BoxContainer.ALIGNMENT_CENTER
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_constant_override("separation", 0)
	row.add_child(text)
	for part in [[n.label, 13, ThemeBuilder.TEXT], [n.sub, 11, Color(ThemeBuilder.TEXT, 0.75)]]:
		var l := Label.new()
		l.text = str(part[0])
		l.clip_text = true
		l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		l.add_theme_font_size_override("font_size", part[1])
		l.add_theme_color_override("font_color", part[2])
		text.add_child(l)
	var dot := PortIcon.make("", Vector2(12, 12), "Start or complete cable at this connector")
	b.add_child(dot)
	var place := func() -> void: dot.position = Vector2(-6.0 if n.input else b.size.x - 6.0, (b.size.y - 12.0) / 2.0)
	b.resized.connect(place)
	anchors[str(n.id)] = dot
	_cards[str(n.id)] = b
	return b
