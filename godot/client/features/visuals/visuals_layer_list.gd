extends VBoxContainer
## WO-890 — the Visuals page's layer list, after the Look editor's (look_editor.gd: drop a source to add a layer, each layer
## with its opacity, reorder, remove). Top layer first, like the stack reads on the canvas. Each row: the eye (mute), what it
## runs, Add (blend: added onto the layers below instead of drawn over them), ▲ ▼ (order), ✕; under it the opacity fader
## and its value in % (a SpinBox: RULES.md input fields via core/numeric_field.gd, which every SpinBox in the tree gets).
## A Sources ▸ Visuals row dropped on a layer replaces that layer's picture (its fader, mute and blend kept); dropped
## anywhere else in the list it is a new layer on top. Clicking a row selects it (Shift-drops on the canvas and
## double-clicks in Sources replace the selected layer; the 3D view looks into it).

const L := preload("res://features/visuals/visuals_layers.gd")
const Catalog := preload("res://features/visuals/visuals_catalog.gd")
const Icons := preload("res://app/ui_icons.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal changed(layers: Array)  # a fader, mute, blend, order or a removal — the whole new stack, bottom → top
signal dropped(payload: Dictionary, target: int)  # a Sources ▸ Visuals row: -1 = a new layer on top, else that layer replaced
signal selected(i: int)

var layers := []  # bottom → top, as in the slice
var sel := -1  # the selected layer's index in `layers`
var rows := []  # by layer index: {panel, name, slider, spin, eye, blend, up, down, del}
var _box: VBoxContainer
var _empty: Label
var _note: Label
var _shape := ""  # the stack's keys: the rows are rebuilt only when it changes (never under a dragged fader)
var _names := {}
var _errors := {}
var _quiet := false


func _init() -> void:
	add_theme_constant_override("separation", 4)
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_drag_forwarding(Callable(), _can_drop, func(_at: Vector2, data: Variant) -> void: dropped.emit(data, -1))
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 3)
	add_child(_box)
	_empty = Label.new()
	_empty.text = "No layers — drag a visual here from Sources ▸ Visuals"
	_empty.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_empty.modulate = Color(1, 1, 1, 0.6)
	add_child(_empty)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.modulate = Color(1, 0.75, 0.6, 0.9)
	_note.visible = false
	add_child(_note)


## The stack to show; `names` = shader id → name, `errors` = layer index → why that shader layer is dark.
func set_layers(ls: Array, names := {}, errors := {}) -> void:
	layers = ls.duplicate(true)
	_names = names
	_errors = errors
	sel = clampi(sel, -1, layers.size() - 1)
	var shape := "/".join(layers.map(func(l: Dictionary) -> String: return L.key(l)))
	if shape != _shape or rows.size() != layers.size():
		_shape = shape
		_build()
	_fill()


## A line under the list ("" hides it): a refused drop, …
func set_note(text: String) -> void:
	_note.text = text
	_note.visible = text != ""


func select(i: int) -> void:
	sel = i if i >= 0 and i < layers.size() else -1
	_fill()


func _can_drop(_at: Vector2, data: Variant) -> bool:
	return Catalog.parse(data) != null


func _build() -> void:
	for c in _box.get_children():
		_box.remove_child(c)
		c.queue_free()
	rows.clear()
	for i in layers.size():
		rows.append(_row(i))
	for i in range(layers.size() - 1, -1, -1):  # top layer first
		_box.add_child(rows[i].panel)
	_empty.visible = layers.is_empty()


func _row(i: int) -> Dictionary:
	var r := {}
	var panel := PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.gui_input.connect(func(e: InputEvent) -> void:
		var mb := e as InputEventMouseButton
		if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			select(i)
			selected.emit(i))
	panel.set_drag_forwarding(Callable(), _can_drop, func(_at: Vector2, data: Variant) -> void: dropped.emit(data, i))
	r.panel = panel
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.mouse_filter = Control.MOUSE_FILTER_PASS
	panel.add_child(v)
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_PASS
	v.add_child(top)
	r.eye = Icons.button("eye", "Show / mute this layer (a muted layer does not render)")
	r.eye.toggle_mode = true
	r.eye.toggled.connect(func(on: bool) -> void:
		r.eye.icon = Icons.texture("eye" if on else "eye_off")
		_edit(i, "visible", on))
	top.add_child(r.eye)
	r.name = Label.new()
	r.name.clip_text = true
	r.name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.name.mouse_filter = Control.MOUSE_FILTER_PASS
	top.add_child(r.name)
	r.blend = Button.new()
	r.blend.text = "Add"
	r.blend.toggle_mode = true
	r.blend.focus_mode = Control.FOCUS_NONE
	r.blend.tooltip_text = "Add this layer's light onto the layers below (pressed) instead of drawing it over them"
	r.blend.toggled.connect(func(on: bool) -> void: _edit(i, "blend", "add" if on else "normal"))
	top.add_child(r.blend)
	r.up = _small("▲", "Move this layer up (drawn over the next one)", func() -> void: _move(i, i + 1))
	top.add_child(r.up)
	r.down = _small("▼", "Move this layer down", func() -> void: _move(i, i - 1))
	top.add_child(r.down)
	r.del = Icons.button("close", "Remove this layer")
	r.del.pressed.connect(func() -> void:
		var next := layers.duplicate(true)
		next.remove_at(i)
		sel = mini(sel, next.size() - 1) if sel != i else -1
		changed.emit(next))
	top.add_child(r.del)
	var bottom := HBoxContainer.new()
	bottom.mouse_filter = Control.MOUSE_FILTER_PASS
	v.add_child(bottom)
	r.slider = HSlider.new()
	r.slider.max_value = 100.0
	r.slider.step = 1.0
	r.slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	r.slider.tooltip_text = "Opacity of this layer"
	r.slider.focus_mode = Control.FOCUS_NONE  # the show keys (1–9, Space, B) stay show keys after a drag
	r.slider.value_changed.connect(func(val: float) -> void:
		r.spin.set_value_no_signal(val)
		_edit(i, "opacity", val / 100.0))
	bottom.add_child(r.slider)
	r.spin = SpinBox.new()
	r.spin.max_value = 100.0
	r.spin.step = 1.0
	r.spin.suffix = "%"
	r.spin.custom_minimum_size.x = 76
	r.spin.tooltip_text = "Opacity in % (maths works: 100/3)"
	r.spin.value_changed.connect(func(val: float) -> void:
		r.slider.set_value_no_signal(val)
		_edit(i, "opacity", val / 100.0))
	bottom.add_child(r.spin)
	return r


func _small(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(cb)
	return b


## The rows' values from `layers` (no signals out), the selected row highlighted.
func _fill() -> void:
	_quiet = true
	for i in rows.size():
		var r: Dictionary = rows[i]
		var l: Dictionary = layers[i]
		var on: bool = l.get("visible", true)
		r.eye.set_pressed_no_signal(on)
		r.eye.icon = Icons.texture("eye" if on else "eye_off")
		r.name.text = ("⚠ " if _errors.has(i) else "") + L.describe(l, _names)
		r.name.tooltip_text = "Layer %d — %s%s\nDrop a visual here to replace it · click to select" % [i + 1, L.describe(l, _names),
			"\n" + str(_errors[i]) if _errors.has(i) else ""]
		r.name.modulate = Color(1, 1, 1, 1.0 if on else 0.5)
		r.blend.set_pressed_no_signal(l.get("blend", "normal") == "add")
		var pct := roundf(float(l.get("opacity", 1.0)) * 100.0)
		if r.slider.value != pct:
			r.slider.set_value_no_signal(pct)
		if r.spin.value != pct and not r.spin.get_line_edit().has_focus():
			r.spin.set_value_no_signal(pct)
		r.up.disabled = i == rows.size() - 1
		r.down.disabled = i == 0
		var sb := StyleBoxFlat.new()
		sb.bg_color = ThemeBuilder.ACCENT.darkened(0.55) if i == sel else ThemeBuilder.BG_PANEL.lightened(0.04)
		sb.border_color = ThemeBuilder.ACCENT
		sb.set_border_width_all(1 if i == sel else 0)
		sb.set_corner_radius_all(3)
		sb.set_content_margin_all(4)
		r.panel.add_theme_stylebox_override("panel", sb)
	_quiet = false


func _edit(i: int, field: String, value: Variant) -> void:
	if _quiet or i >= layers.size():
		return
	layers[i][field] = value
	_fill()
	changed.emit(layers.duplicate(true))


func _move(i: int, to: int) -> void:
	if to < 0 or to >= layers.size():
		return
	if sel == i:
		sel = to
	changed.emit(L.moved(layers, i, to))
