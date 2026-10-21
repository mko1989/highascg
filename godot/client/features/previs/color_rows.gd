extends VBoxContainer
## WO-641 — rows of "name · colour · ↺" for model_tint.gd overrides (MVR layers; a fixture type's body). Dragging in
## the picker previews (`previewed`); closing it commits (`changed`); ↺ goes back to the model's own colour
## (`changed` with null). fill() with the same names only updates the swatches, so the open picker survives the
## project reload its own commit causes.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Tint := preload("res://features/previs/model_tint.gd")
const UNSET := Color(0.7, 0.7, 0.7)  # the server's default model grey (glb-write.js), shown when nothing is set

signal previewed(name: String, color: Color)
signal changed(name: String, color: Variant)

var _names: Array = []
var _rows := {}  # name → [ColorPickerButton, reset Button]


## `names` in order; `cols` name → "#rrggbb"; `labels` name → shown text (default: the name).
func fill(names: Array, cols: Dictionary, labels := {}) -> void:
	if names != _names:
		_names = names.duplicate()
		_rows = {}
		for c in get_children():
			remove_child(c)
			c.queue_free()
		for n in names:
			_row(str(n), str(labels.get(n, n)))
	for n in _rows:
		var c: Variant = Tint.parse(cols.get(n))
		(_rows[n][0] as ColorPickerButton).color = c if c is Color else UNSET
		(_rows[n][1] as Button).disabled = not c is Color


func _row(name: String, text: String) -> void:
	var row := HBoxContainer.new()
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
	add_child(row)
	_rows[name] = [pick, reset]
