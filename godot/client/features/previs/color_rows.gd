extends VBoxContainer
## WO-641 — rows of "name · colour · ↺" for model_tint.gd overrides (MVR layers; a fixture type's body). Dragging in
## the picker previews (`previewed`); closing it commits (`changed`); ↺ goes back to the model's own colour
## (`changed` with null). fill() with the same names only updates the swatches, so the open picker survives the
## project reload its own commit causes.
## WO-647: with `eyes` on, each row also has an eye (visibility_toggled), and highlight() marks the rows of what is
## selected in the 3D view (scrolled into view).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const Tint := preload("res://features/previs/model_tint.gd")
const UNSET := Color(0.7, 0.7, 0.7)  # the server's default model grey (glb-write.js), shown when nothing is set

signal previewed(name: String, color: Color)
signal changed(name: String, color: Variant)
signal visibility_toggled(name: String, shown: bool)  # WO-647

var eyes := false  # WO-647: an eye per row (set before the first fill)
var _names: Array = []
var _labels := {}
var _rows := {}  # name → [ColorPickerButton, reset Button, eye Button | null, row PanelContainer]
var _lit: Array = []  # highlighted names


## `names` in order; `cols` name → "#rrggbb"; `labels` name → shown text (default: the name); `hidden` names show a
## closed eye; `off` rows have nothing to colour or show (WO-706: a layer the file left empty).
func fill(names: Array, cols: Dictionary, labels := {}, hidden := [], off := []) -> void:
	if names != _names or labels != _labels:
		_names = names.duplicate()
		_labels = labels.duplicate()
		_rows = {}
		for c in get_children():
			remove_child(c)
			c.queue_free()
		for n in names:
			_row(str(n), str(labels.get(n, n)))
	for n in _rows:
		var c: Variant = Tint.parse(cols.get(n))
		(_rows[n][0] as ColorPickerButton).color = c if c is Color else UNSET
		(_rows[n][0] as ColorPickerButton).disabled = off.has(n)
		(_rows[n][1] as Button).disabled = not c is Color or off.has(n)
		if _rows[n][2] != null:
			var b := _rows[n][2] as Button
			b.disabled = off.has(n)
			b.set_pressed_no_signal(not hidden.has(n))
			b.icon = Icons.texture("eye" if b.button_pressed else "eye_off")
	highlight(_lit)


## WO-647: mark these rows (the layers of the objects selected in 3D); the first is scrolled into view.
func highlight(names: Array) -> void:
	_lit = names.duplicate()
	var first: Control = null
	for n in _rows:
		var on := _lit.has(n)
		var p := _rows[n][3] as PanelContainer
		p.add_theme_stylebox_override("panel", _row_box(on))
		if on and first == null:
			first = p
	var scroll := _scroll()
	if first != null and scroll != null and first.is_visible_in_tree():
		scroll.ensure_control_visible.call_deferred(first)


func _scroll() -> ScrollContainer:
	var n := get_parent()
	while n != null and not n is ScrollContainer:
		n = n.get_parent()
	return n as ScrollContainer


func _row(name: String, text: String) -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _row_box(false))
	var row := HBoxContainer.new()
	panel.add_child(row)
	var l := Label.new()
	l.text = text if text != "" else "(no layer)"
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.clip_text = true
	row.add_child(l)
	var pick := ColorPickerButton.new()
	pick.custom_minimum_size = Vector2(48, 24)
	pick.edit_alpha = false
	pick.tooltip_text = "Colour of %s in the previs" % (text if text != "" else "objects with no layer")
	pick.color_changed.connect(func(c: Color) -> void: previewed.emit(name, c))
	pick.popup_closed.connect(func() -> void: changed.emit(name, pick.color))
	row.add_child(pick)
	var reset := Button.new()
	reset.text = "↺"
	reset.tooltip_text = "Back to the model's own colour"
	reset.pressed.connect(func() -> void: changed.emit(name, null))
	row.add_child(reset)
	var eye: Button = null
	if eyes:
		eye = Icons.button("eye", "Show / hide %s" % (text if text != "" else "objects with no layer"))
		eye.toggle_mode = true
		eye.button_pressed = true
		eye.toggled.connect(func(on: bool) -> void:
			eye.icon = Icons.texture("eye" if on else "eye_off")
			visibility_toggled.emit(name, on))
		row.add_child(eye)
	add_child(panel)
	_rows[name] = [pick, reset, eye, panel]


## A row's frame: lit = accent; both the same margins, so lighting a row never moves the list.
static func _row_box(on: bool) -> StyleBoxFlat:
	var sb := ThemeBuilder.box(ThemeBuilder.ACCENT.darkened(0.55) if on else Color.TRANSPARENT, ThemeBuilder.ACCENT if on else Color.TRANSPARENT, 1)
	sb.set_content_margin_all(2)
	return sb
