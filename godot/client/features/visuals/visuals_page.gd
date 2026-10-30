extends VBoxContainer
## WO-863 — the Visuals tab's Inspector page: the scene's base parameters (the Flow graph adds the audio on top), and Output —
## which screen destination, which layer, the render size, and Send (on air through the WO-742/743 shm ring). Audio (WO-866):
## per-drum detector sensitivity (the box's `/api/audio/parts-sensitivity`, 0.5 = the measured tuning) and Sync.

const M := preload("res://features/visuals/visuals_model.gd")

signal params_changed(params: Dictionary)
signal output_changed(output: Dictionary)
signal send_toggled(on: bool)
signal sensitivity_changed(map: Dictionary)
signal sync_changed(ms: float)
signal scenes_changed(main: String, overlay: String)
signal burst_pressed
signal shader_changed(id: String)

var _sliders := {}
var _screen: OptionButton
var _layer: SpinBox
var _size: OptionButton
var _send: CheckButton
var _note: Label
var _screens := []
var _quiet := false
var _sens := {}
var _sync: HSlider
var _sync_label: Label
var _scene: OptionButton
var _overlay: OptionButton
var _shader: OptionButton
var _shader_row: HBoxContainer
var _shader_note: Label
var _shader_ids := []
var _shader_want := ""


func _init() -> void:  # built up front: the tab fills it before the Inspector adopts it
	add_theme_constant_override("separation", 6)
	add_child(_heading("Visuals"))
	_scene = OptionButton.new()
	_scene.tooltip_text = "The visual (WO-873 scene library)"
	_overlay = OptionButton.new()
	_overlay.tooltip_text = "A second scene drawn over the first in the same world — e.g. Tunnel + Particles"
	_overlay.add_item("None")
	for s in M.SCENES:
		_scene.add_item(s[1])
		_overlay.add_item(s[1])
	_scene.item_selected.connect(func(_i: int) -> void: _emit_scenes())
	_overlay.item_selected.connect(func(_i: int) -> void: _emit_scenes())
	add_child(_row("Scene", _scene))
	add_child(_row("Layer 2", _overlay))
	_shader = OptionButton.new()  # WO-874: the box's shader library, filled by set_shaders()
	_shader.tooltip_text = "The library shader the Shader scene runs (the same shaders Caspar's shader templates play)"
	_shader.fit_to_longest_item = false
	_shader.item_selected.connect(func(i: int) -> void:
		if not _quiet and i >= 0 and i < _shader_ids.size():
			_shader_want = _shader_ids[i]
			shader_changed.emit(_shader_want))
	_shader_row = _row("Shader", _shader)
	add_child(_shader_row)
	_shader_note = Label.new()
	_shader_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_shader_note.modulate = Color(1, 0.75, 0.6, 0.9)
	add_child(_shader_note)
	var burst := Button.new()
	burst.text = "Burst"
	burst.tooltip_text = "Fire the scenes' burst now (Flow: link a hit to the Burst parameter to fire it from the audio)"
	burst.pressed.connect(func() -> void: burst_pressed.emit())
	add_child(burst)
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
	add_child(_heading("Audio"))
	for d in ["kick", "snare", "hats"]:
		var s := _slider(0.0, 1.0, 0.05, "How easily a %s counts as a hit — left: only clear hits, right: ghost notes too" % d)
		s.value = 0.5
		s.value_changed.connect(func(_v: float) -> void: _emit_sens())
		add_child(_row(d.capitalize(), s))
		_sens[d] = s
	_sync = _slider(-300.0, 300.0, 5.0, "Sync — right: delay the pulses; left: fire them early from each drum's steady rhythm (the screens lag the room)")
	_sync.value_changed.connect(_on_sync)
	var sync_row := _row("Sync", _sync)
	_sync_label = Label.new()
	_sync_label.custom_minimum_size.x = 64
	_sync_label.text = "+0 ms"
	sync_row.add_child(_sync_label)
	add_child(sync_row)
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
	var ids := M.scene_ids()
	_scene.select(maxi(0, ids.find(str(slice.get("scene", "rings")))))
	_overlay.select(ids.find(str(slice.get("overlay", ""))) + 1)
	_shader_want = str(slice.get("shader", ""))
	_shader.select(_shader_ids.find(_shader_want))
	_shader_row.visible = "shader" in [slice.get("scene"), slice.get("overlay")]
	_shader_note.visible = _shader_row.visible
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
	_sync.set_value_no_signal(float(slice.get("sync", 0.0)))
	_sync_label.text = "%+d ms" % int(_sync.value)
	_quiet = false


## WO-874: the library ({id, name} rows of GET /api/shaders), sorted by name.
func set_shaders(list: Array) -> void:
	var rows := list.filter(func(r: Variant) -> bool: return r is Dictionary and r.get("id") is String)
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return str(a.get("name", a.id)).naturalnocasecmp_to(str(b.get("name", b.id))) < 0)
	_quiet = true
	_shader.clear()
	_shader_ids = rows.map(func(r: Dictionary) -> String: return r.id)
	for r in rows:
		_shader.add_item(str(r.get("name", r.id)))
	_shader.select(_shader_ids.find(_shader_want))
	_quiet = false


## WO-874: "" when the shader runs, else why not (compile error, not found, no box).
func set_shader_status(text: String) -> void:
	_shader_note.text = text


func set_sending(on: bool, can: bool, note: String) -> void:
	_quiet = true
	_send.button_pressed = on
	_send.disabled = not can and not on
	_quiet = false
	_note.text = note
	_screen.disabled = on  # switching screens on air would orphan the layer: stop first
	_layer.editable = not on


## The box's sensitivity (GET /api/audio/parts-sensitivity); an empty map (no box) leaves the sliders.
func set_sensitivity(map: Dictionary) -> void:
	_quiet = true
	for d in _sens:
		if map.get(d) is float or map.get(d) is int:
			_sens[d].set_value_no_signal(float(map[d]))
	_quiet = false


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


func _emit_scenes() -> void:
	if _quiet:
		return
	var ids := M.scene_ids()
	var main: String = ids[maxi(0, _scene.selected)]
	var over: String = ids[_overlay.selected - 1] if _overlay.selected > 0 else ""
	_shader_row.visible = "shader" in [main, over]
	_shader_note.visible = _shader_row.visible
	scenes_changed.emit(main, over)


func _on_sync(v: float) -> void:
	_sync_label.text = "%+d ms" % int(v)
	if not _quiet:
		sync_changed.emit(v)


func _emit_sens() -> void:
	if _quiet:
		return
	var out := {}
	for d in _sens:
		out[d] = _sens[d].value
	sensitivity_changed.emit(out)


func _emit_output() -> void:
	if not _quiet:
		output_changed.emit({"screen": maxi(0, _screen.selected), "layer": int(_layer.value), "size": maxi(0, _size.selected)})


func _slider(lo: float, hi: float, step: float, tip: String) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.tooltip_text = tip
	return s


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
