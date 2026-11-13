extends VBoxContainer
## WO-1054 — the Visuals Inspector page's Position block (owner 13.11: "pan tilt the selected visual so i can position it where
## i want. there are 4 unused encoders on the right"): X, Y, Size and Rotate of the selected layer (visuals_layers.gd PLACE)
## and Reset. The sliders are plain Ranges, so the mouse, the virtual controller, MIDI Learn ("pos:x" …) and the APC's
## device knobs 5–8 (visuals_midi_apc.gd page()) all move them; a move emits `edited` with the whole place, and the page
## sends it through the tab's layer edit path (layers_changed: autosave + undo, the live deck moved in place). Hidden while
## no layer is selected.
## Encoder feel (an APC knob moves a Range by 1/127 of its ratio per step, midi_pickup.gd turn()): X / Y span −1..1 = two
## canvases over the 127 steps — 0.016 canvas a step after the 0.001 slider step, one canvas in ~63 steps (about a knob
## turn); Size is exponential (exp_edit, 0.1..4: every step ×≈1.03, fine near 1); Rotate spans 360° over the 127 steps —
## 2.8° a step (0.1° slider step), about two turns. Every encoder step is far coarser than the slider's own step, so no
## turn is ever rounded away.

const L := preload("res://features/visuals/visuals_layers.gd")
## field, label, min, max, step, exponential, tooltip
const ROWS := [
	["x", "X", -1.0, 1.0, 0.001, false, "Left / right, in canvas widths from the centre"],
	["y", "Y", -1.0, 1.0, 0.001, false, "Down / up, in canvas heights from the centre"],
	["size", "Size", 0.1, 4.0, 0.001, true, "Scale around the centre (1 = the full canvas)"],
	["rot", "Rotate", -180.0, 180.0, 0.1, false, "Rotation in degrees, clockwise"],
]
const TARGETS := ["pos:x", "pos:y", "pos:size", "pos:rot"]

signal edited(place: Dictionary)

var sliders := {}  ## field → HSlider
var reset: Button
var _values := {}  # field → its value Label
var _quiet := false


func _init() -> void:
	visible = false
	add_theme_constant_override("separation", 2)
	var head := Label.new()
	head.text = "Position"
	head.add_theme_font_size_override("font_size", 15)
	add_child(head)
	for r in ROWS:
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = r[1]
		l.custom_minimum_size.x = 70
		row.add_child(l)
		var s := HSlider.new()
		s.min_value = r[2]
		s.max_value = r[3]
		s.step = r[4]
		s.exp_edit = r[5]
		s.value = L.PLACE[r[0]][0]
		s.tooltip_text = r[6]
		s.focus_mode = Control.FOCUS_NONE  # the show keys stay show keys after a drag (as the layer faders)
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		s.value_changed.connect(func(_v: float) -> void: _changed())
		row.add_child(s)
		var v := Label.new()
		v.custom_minimum_size.x = 56
		v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(v)
		sliders[r[0]] = s
		_values[r[0]] = v
		add_child(row)
	reset = Button.new()
	reset.text = "Reset"
	reset.tooltip_text = "Back to the full canvas: centred, size 1, no rotation"
	reset.focus_mode = Control.FOCUS_NONE
	reset.pressed.connect(func() -> void:
		var d := {}
		for f in L.PLACE:
			d[f] = L.PLACE[f][0]
		edited.emit(d))
	add_child(reset)
	_texts()


## The selected layer (null / {} = none: hidden). No signals out.
func show_layer(l: Variant) -> void:
	visible = l is Dictionary and not (l as Dictionary).is_empty()
	if not visible:
		return
	var p := L.place_of(l)
	_quiet = true
	for f in sliders:
		if not is_equal_approx(sliders[f].value, p[f]):
			sliders[f].set_value_no_signal(p[f])
	_quiet = false
	_texts()


## "pos:x" … → its slider (null for anything else).
func control(target: String) -> Range:
	return sliders.get(target.trim_prefix("pos:")) if target.begins_with("pos:") else null


## Device knobs 5–8: [{label, control}] — the control null while no layer is selected.
func entries() -> Array:
	return ROWS.map(func(r: Array) -> Dictionary: return {"label": r[1], "control": sliders[r[0]] if visible else null})


func _changed() -> void:
	_texts()
	if _quiet:
		return
	var d := {}
	for f in sliders:
		d[f] = sliders[f].value
	edited.emit(d)


func _texts() -> void:
	_values["x"].text = "%+.2f" % sliders["x"].value
	_values["y"].text = "%+.2f" % sliders["y"].value
	_values["size"].text = "×%.2f" % sliders["size"].value
	_values["rot"].text = "%+d°" % roundi(sliders["rot"].value)
