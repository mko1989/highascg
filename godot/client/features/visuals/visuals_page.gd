extends VBoxContainer
## WO-863 — the Visuals tab's Inspector page: the scene's base parameters (the Flow graph adds the audio on top), and Output —
## which screen destination, which layer, the render size, and Send (on air through the WO-742/743 shm ring). Audio (WO-866):
## per-drum detector sensitivity (the box's `/api/audio/parts-sensitivity`, 0.5 = the measured tuning) and Sync.

const M := preload("res://features/visuals/visuals_model.gd")
const Show := preload("res://features/visuals/visuals_show.gd")
const LayerList := preload("res://features/visuals/visuals_layer_list.gd")

signal params_changed(params: Dictionary)
signal output_changed(output: Dictionary)
signal send_toggled(on: bool)
signal ring_toggled(on: bool)
signal sensitivity_changed(map: Dictionary)
signal sync_changed(ms: float)
signal layers_changed(layers: Array)  # WO-890: a fader, mute, blend, order or removal in the layer list
signal layer_selected(i: int)
signal burst_pressed
signal visual_dropped(payload: Dictionary, target: int)  # WO-890: a Sources ▸ Visuals row on the list (-1 = add on top) or a layer
signal game_play(on: bool)

var _sliders := {}
var _screen: OptionButton
var _layer: SpinBox
var _size: OptionButton
var _send: CheckButton
var _ring: CheckButton
var _note: Label
var _screens := []
var _quiet := false
var _sens := {}
var _sync: HSlider
var _sync_label: Label
var layer_list: LayerList  # WO-890
var _errors := {}  # layer index → why that shader layer is dark
var _shader_names := {}  # id → name (GET /api/shaders)
var _slice := {}
var _shader_note: Label
var _game_box: VBoxContainer
var _game_play: Button
var _game_note: Label
var show_panel: Show  # WO-877: looks, fade, master — the tab wires its signals


func _init() -> void:  # built up front: the tab fills it before the Inspector adopts it
	add_theme_constant_override("separation", 6)
	add_child(_heading("Show"))
	show_panel = Show.new()
	add_child(show_panel)
	add_child(_heading("Visuals"))
	var hint := Label.new()  # WO-885: the pickers moved to Sources ▸ Visuals (thumbnails, folders)
	hint.text = "Layers, top first. Drag from Sources ▸ Visuals onto the canvas or this list to add one on top, onto a layer to replace it (canvas: Shift replaces the selected layer)."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.modulate = Color(1, 1, 1, 0.6)
	add_child(hint)
	layer_list = LayerList.new()
	layer_list.changed.connect(func(ls: Array) -> void: layers_changed.emit(ls))
	layer_list.dropped.connect(func(p: Dictionary, target: int) -> void: visual_dropped.emit(p, target))
	layer_list.selected.connect(func(i: int) -> void: layer_selected.emit(i))
	add_child(layer_list)
	_shader_note = Label.new()
	_shader_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_shader_note.modulate = Color(1, 0.75, 0.6, 0.9)
	add_child(_shader_note)
	_game_box = VBoxContainer.new()  # WO-876: Play opens the picked ROM's window on this screen
	_game_play = Button.new()
	_game_play.text = "Play"
	_game_play.tooltip_text = "Open the game in its own window on this screen — play it there with the keyboard or a gamepad"
	_game_play.toggle_mode = true
	_game_play.toggled.connect(func(on: bool) -> void:
		if not _quiet:
			game_play.emit(on))
	_game_box.add_child(_row("Game", _game_play))
	_game_note = Label.new()
	_game_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_game_note.modulate = Color(1, 1, 1, 0.7)
	_game_box.add_child(_game_note)
	add_child(_game_box)
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
	_size.add_item("Screen size", M.SIZE_SCREEN)  # WO-883: the canvas = the screen destination, pixel for pixel
	for i in M.RENDER_SIZES.size():
		_size.add_item("%d p (screen aspect)" % M.RENDER_SIZES[i].y, i)
	_size.tooltip_text = "Canvas size: the screen destination's own resolution, or a height at its aspect (Caspar scales to the channel)"
	_size.item_selected.connect(func(_i: int) -> void: _emit_output())
	add_child(_row("Render", _size))
	_ring = CheckButton.new()
	_ring.text = "Live source (shm://visuals)"
	_ring.tooltip_text = "Publish the canvas as a source: Sources ▸ Live lists it, drag it onto a look layer"
	_ring.toggled.connect(func(on: bool) -> void:
		if not _quiet:
			ring_toggled.emit(on))
	add_child(_ring)
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
	_slice = slice
	_show_layers()
	for p in M.PARAMS:
		_sliders[p].set_value_no_signal(float(slice.params[p]))
	_screens = M.screens(cm)
	var cfg := get_node_or_null("/root/Config")  # dev: --probe-visuals-channel=<ch> offers a bare Caspar channel as a screen
	if cfg and cfg.args.has("probe-visuals-channel"):
		_screens = [{"label": "Probe (ch %d)" % int(cfg.args["probe-visuals-channel"]), "channel": int(cfg.args["probe-visuals-channel"])}]
	_screen.clear()
	for s in _screens:
		_screen.add_item(s.label)
	if not _screens.is_empty():
		_screen.select(clampi(int(slice.output.screen), 0, _screens.size() - 1))
	_layer.set_value_no_signal(slice.output.layer)
	_size.select(_size.get_item_index(int(slice.output.size)))
	_ring.set_pressed_no_signal(slice.output.get("ring") == true)
	_sync.set_value_no_signal(float(slice.get("sync", 0.0)))
	_sync_label.text = "%+d ms" % int(_sync.value)
	_quiet = false


## WO-874: the library ({id, name} rows of GET /api/shaders) — the layer rows name the shader.
func set_shaders(list: Array) -> void:
	for r in list:
		if r is Dictionary and r.get("id") is String:
			_shader_names[r.id] = str(r.get("name", r.id))
	_show_layers()


## WO-890: the layer list, and the shader / game rows for what the layers run.
func _show_layers() -> void:
	if _slice.is_empty():
		return
	var ls: Array = _slice.get("layers", [])
	layer_list.set_layers(ls, _shader_names, _errors)
	_shader_note.visible = ls.any(func(l: Dictionary) -> bool: return l.scene == "shader")
	_game_box.visible = ls.any(func(l: Dictionary) -> bool: return l.scene == "game")


## WO-876: the Play button's state and the line under it (how to play, or why it cannot).
func set_game_status(playing: bool, text: String) -> void:
	_quiet = true
	_game_play.button_pressed = playing
	_game_play.text = "Stop" if playing else "Play"
	_quiet = false
	_game_note.text = text


## WO-874: "" when the shaders run, else why not (compile error, not found, no box). WO-890: `errors` = layer index → error,
## a ⚠ on those rows.
func set_shader_status(text: String, errors := {}) -> void:
	_shader_note.text = text
	if errors != _errors:
		_errors = errors
		_show_layers()


## `ring` / `can_ring` (WO-883): the Live source switch's state — off with a reason in `note` where it cannot publish.
func set_sending(on: bool, can: bool, note: String, ring := false, can_ring := true) -> void:
	_quiet = true
	_send.button_pressed = on
	_send.disabled = not can and not on
	_ring.button_pressed = ring
	_ring.disabled = not can_ring and not ring
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
		output_changed.emit({"screen": maxi(0, _screen.selected), "layer": int(_layer.value), "size": maxi(0, _size.get_selected_id()),
			"ring": _ring.button_pressed})


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
