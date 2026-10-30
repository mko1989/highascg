extends VBoxContainer
## WO-863 — the Visuals tab's Inspector page: the scene's base parameters (the Flow graph adds the audio on top), and Output —
## which screen destination, which layer, the render size, and Send (on air through the WO-742/743 shm ring).

const M := preload("res://features/visuals/visuals_model.gd")

signal params_changed(params: Dictionary)
signal output_changed(output: Dictionary)
signal send_toggled(on: bool)

var _sliders := {}
var _screen: OptionButton
var _layer: SpinBox
var _size: OptionButton
var _send: CheckButton
var _note: Label
var _screens := []
var _quiet := false


func _init() -> void:  # built up front: the tab fills it before the Inspector adopts it
	add_theme_constant_override("separation", 6)
	add_child(_heading("Visuals"))
	for p in M.PARAMS:
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = p.capitalize()
		l.custom_minimum_size.x = 70
		row.add_child(l)
		var s := HSlider.new()
		s.max_value = 1.0
		s.step = 0.01
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		s.tooltip_text = "Base value — the Flow graph's audio adds on top"
		s.value_changed.connect(func(_v: float) -> void: _emit_params())
		row.add_child(s)
		_sliders[p] = s
		add_child(row)
	add_child(_heading("Output"))
	_screen = OptionButton.new()
	_screen.tooltip_text = "Screen destination the visual plays on (its PGM channel)"
	_screen.item_selected.connect(func(_i: int) -> void: _emit_output())
	add_child(_row("Screen", _screen))
	_layer = SpinBox.new()
	_layer.min_value = 1
	_layer.max_value = 9999
	_layer.tooltip_text = "Caspar layer on that channel (1 sits under the looks)"
	_layer.value_changed.connect(func(_v: float) -> void: _emit_output())
	add_child(_row("Layer", _layer))
	_size = OptionButton.new()
	for s in M.RENDER_SIZES:
		_size.add_item("%d p (screen aspect)" % s.y)
	_size.tooltip_text = "Render height; the width follows the screen's aspect and Caspar scales to the channel"
	_size.item_selected.connect(func(_i: int) -> void: _emit_output())
	add_child(_row("Render", _size))
	_send = CheckButton.new()
	_send.text = "Send to screen"
	_send.toggled.connect(func(on: bool) -> void:
		if not _quiet:
			send_toggled.emit(on))
	add_child(_send)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.modulate = Color(1, 1, 1, 0.7)
	add_child(_note)


func set_state(slice: Dictionary, cm: Variant) -> void:
	_quiet = true
	for p in M.PARAMS:
		_sliders[p].set_value_no_signal(float(slice.params[p]))
	_screens = M.screens(cm)
	_screen.clear()
	for s in _screens:
		_screen.add_item(s.label)
	if not _screens.is_empty():
		_screen.select(clampi(int(slice.output.screen), 0, _screens.size() - 1))
	_layer.set_value_no_signal(slice.output.layer)
	_size.select(int(slice.output.size))
	_quiet = false


func set_sending(on: bool, can: bool, note: String) -> void:
	_quiet = true
	_send.button_pressed = on
	_send.disabled = not can and not on
	_quiet = false
	_note.text = note
	_screen.disabled = on  # switching screens on air would orphan the layer: stop first
	_layer.editable = not on


func screen_channel() -> int:
	var i := _screen.selected
	return int(_screens[i].channel) if i >= 0 and i < _screens.size() else 0


func _emit_params() -> void:
	if _quiet:
		return
	var out := {}
	for p in M.PARAMS:
		out[p] = _sliders[p].value
	params_changed.emit(out)


func _emit_output() -> void:
	if not _quiet:
		output_changed.emit({"screen": maxi(0, _screen.selected), "layer": int(_layer.value), "size": maxi(0, _size.selected)})


func _heading(t: String) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_font_size_override("font_size", 15)
	return l


func _row(label: String, c: Control) -> HBoxContainer:
	var h := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = 70
	h.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(c)
	return h
