extends MarginContainer
## WO-605 slice 1 — the Devices tab, read-only (web device-view.js): screen-destination cards on the left, the Caspar
## host's rear panel on the right, the cables list under it, and the hanging cables drawn over all of it. Data is
## GET /api/device-view, fetched whenever the tab is shown, on Refresh, and on WS `gpu_topology_changed` (DRM
## hotplug — the web's only device-view push). Patching, the inspector and the toolbar actions arrive in later slices.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Model := preload("res://features/devices/devices_model.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const RearPanel := preload("res://features/devices/rear_panel.gd")
const CableLayer := preload("res://features/devices/cable_layer.gd")
const PGM := Color("#e74c3c")
const PRV := Color("#2ecc71")

var _dests: VBoxContainer
var _rear: PanelContainer
var _list: VBoxContainer
var _cables: Control
var _status: Label
var _loops_value: Label
var _loading := false


func _ready() -> void:
	for side in ["left", "right", "top", "bottom"]:
		add_theme_constant_override("margin_" + side, 16)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	add_child(v)
	v.add_child(_toolbar())
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 40)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(body)
	var left := VBoxContainer.new()
	left.custom_minimum_size.x = 250
	body.add_child(left)
	left.add_child(_label("Screen destinations", ThemeBuilder.TEXT_MUTED, 13))
	_dests = VBoxContainer.new()
	_dests.add_theme_constant_override("separation", 12)
	left.add_child(_dests)
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_theme_constant_override("separation", 12)
	body.add_child(right)
	_rear = RearPanel.new()
	right.add_child(_rear)
	right.add_child(_label("CABLES", ThemeBuilder.TEXT_MUTED, 12))
	_list = VBoxContainer.new()
	right.add_child(_list)
	_cables = CableLayer.new()
	add_child(_cables)
	visibility_changed.connect(func() -> void: if is_visible_in_tree(): refresh())
	Ws.on("gpu_topology_changed", func(_d: Variant) -> void: if is_visible_in_tree(): refresh())  # DRM hotplug
	if is_visible_in_tree():
		refresh()


func _toolbar() -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	h.add_child(_label("Devices", ThemeBuilder.TEXT, 17))
	var gap := Control.new()
	gap.custom_minimum_size.x = 24
	h.add_child(gap)
	h.add_child(_label("Cable loops", ThemeBuilder.TEXT_MUTED, 13))
	var s := HSlider.new()
	s.min_value = 0
	s.max_value = 2
	s.step = 1
	s.custom_minimum_size = Vector2(70, 0)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.focus_mode = Control.FOCUS_NONE
	h.add_child(s)
	_loops_value = _label("0", ThemeBuilder.TEXT, 13)
	h.add_child(_loops_value)
	s.value_changed.connect(func(x: float) -> void:
		_cables.loops = int(x)
		_loops_value.text = str(int(x)))
	var fill := Control.new()
	fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(fill)
	_status = _label("", ThemeBuilder.TEXT_MUTED, 12)
	h.add_child(_status)
	var r := Button.new()
	r.text = "↻"
	r.tooltip_text = "Reload devices"
	r.focus_mode = Control.FOCUS_NONE
	r.pressed.connect(refresh)
	h.add_child(r)
	return h


func refresh() -> void:
	if _loading:
		return
	_loading = true
	var r: Dictionary = await Api.get_json("/api/device-view")
	_loading = false
	if not r.ok or not r.data is Dictionary:
		_status.text = "Could not load devices: %s" % str(r.get("error", "no data"))
		_status.add_theme_color_override("font_color", ThemeBuilder.ERROR)
		return
	_status.text = "Updated %s" % Time.get_time_string_from_system()
	_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS)
	show_model(Model.build(r.data))


func show_model(m: Dictionary) -> void:
	var anchors := {}
	_clear(_dests)
	if m.destinations.is_empty():
		_dests.add_child(_label("No screen destinations yet.", ThemeBuilder.TEXT_MUTED, 13))
	for d in m.destinations:
		_dests.add_child(_dest_card(d, anchors))
	_rear.show_slots(m.slots)
	anchors.merge(_rear.anchors)
	_clear(_list)
	if m.cables.is_empty():
		_list.add_child(_label("No cables.", ThemeBuilder.TEXT_MUTED, 12))
	for c in m.cables:
		_list.add_child(_cable_row(c))
	_cables.set_cables(m.cables, anchors)


## Title, "PGM/PRV · 1920x1080@50", then the output dot(s): one per half for a PGM/PRV pair (`id#pgm`, `id#prv`),
## else one on the title row. Under the card: what each output is cabled to.
func _dest_card(d: Dictionary, anchors: Dictionary) -> Control:
	var wrap := VBoxContainer.new()
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1))
	wrap.add_child(card)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	card.add_child(v)
	var title := HBoxContainer.new()
	v.add_child(title)
	var t := _label(str(d.label), ThemeBuilder.TEXT, 15)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_child(t)
	if d.halves.is_empty():
		title.add_child(_dot(anchors, d.connector, "%s output" % d.label))
	v.add_child(_label(str(d.sub), ThemeBuilder.TEXT_MUTED, 12))
	for half in d.halves:
		var row := HBoxContainer.new()
		row.custom_minimum_size.y = 26
		var tag := _label(str(half).to_upper(), PGM if half == "pgm" else PRV, 11)
		tag.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(tag)
		row.add_child(_dot(anchors, Model.anchor_key(d.connector, half), "%s %s output" % [d.label, str(half).to_upper()]))
		v.add_child(row)
	for l in d.links:
		wrap.add_child(_label("  • " + str(l), ThemeBuilder.TEXT_MUTED, 11))
	return wrap


func _dot(anchors: Dictionary, key: String, tip: String) -> Control:
	var p := PortIcon.make("", Vector2(14, 14), tip)
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	anchors[key] = p
	return p


## A cables-list row: the cable's colour, "Source → Sink"; hovering it thickens that cable.
func _cable_row(c: Dictionary) -> Control:
	var b := Button.new()
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.focus_mode = Control.FOCUS_NONE
	b.text = "●  " + str(c.label)
	b.add_theme_font_size_override("font_size", 12)
	var col: Color = preload("res://features/devices/cable_model.gd").color(c.id)
	b.add_theme_color_override("font_color", col.lerp(ThemeBuilder.TEXT, 0.35))
	b.mouse_entered.connect(func() -> void: _cables.active_id = c.id)
	b.mouse_exited.connect(func() -> void: if _cables.active_id == c.id: _cables.active_id = "")
	return b


func _clear(n: Node) -> void:
	for c in n.get_children():
		n.remove_child(c)
		c.queue_free()


func _label(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
