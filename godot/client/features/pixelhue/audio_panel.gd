extends VBoxContainer
## WO-1039 — PixelHue ▸ Audio: the routing matrix (Studio public/audio-ui.js). Inputs down, outputs across, one input
## per output; a click applies immediately. M mutes, T sends a test tone (per channel and per port). Pair routes all
## channels of the input port to the same channels of the output port (Alt-click: one channel). Routing only.

signal status(text: String)

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const M := preload("res://features/pixelhue/audio_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _state: Dictionary = {}
var _busy := false
var _pair := true
var _head: Label
var _body: ScrollContainer
var _clear: Button
var _pair_box: CheckBox
var _confirm: ConfirmationDialog


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 12)
	_head = Label.new()
	_head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(_head)
	_pair_box = CheckBox.new()
	_pair_box.text = "Pair"
	_pair_box.button_pressed = true
	_pair_box.tooltip_text = "One click routes all channels of the input port to the same channels of the output port"
	_pair_box.toggled.connect(func(on: bool) -> void: _pair = on)
	bar.add_child(_pair_box)
	_clear = Button.new()
	_clear.text = "Clear all"
	_clear.pressed.connect(func() -> void: _confirm.popup_centered())
	bar.add_child(_clear)
	add_child(bar)
	_body = ScrollContainer.new()
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_body)
	var hint := Label.new()
	hint.text = "Click a crosspoint to route; an output takes one input. M mutes, T sends a test tone. Alt-click routes a single channel while Pair is on."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(hint)
	_confirm = ConfirmationDialog.new()
	_confirm.dialog_text = "Remove every audio route?"
	_confirm.confirmed.connect(func() -> void: _send(M.clear_body(), "Audio routes cleared."))
	add_child(_confirm)
	_render()


func refresh() -> void:
	var r: Dictionary = await StudioApi.read(Api, "audio")
	if not r.ok:
		status.emit(str(r.error))
		return
	_state = r.data
	_render()


func _send(body: Dictionary, done := "") -> void:
	if _busy:
		return
	_busy = true
	_render()
	var r: Dictionary = await StudioApi.write(Api, "audio", body)
	_busy = false
	if r.ok:
		_state = r.data
		status.emit(done)
	else:
		status.emit(str(r.error))
	_render()


func _label(text: String, tip := "") -> Label:
	var l := Label.new()
	l.text = text
	l.tooltip_text = tip
	l.mouse_filter = Control.MOUSE_FILTER_PASS if tip != "" else Control.MOUSE_FILTER_IGNORE
	return l


func _flag_button(text: String, state: int, tip: String, body: Dictionary) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(24, 22)
	b.toggle_mode = false
	b.self_modulate = ThemeBuilder.ACCENT if state == 2 else (ThemeBuilder.WARN if state == 1 else Color.WHITE)
	b.disabled = _busy
	b.pressed.connect(func() -> void: _send(body))
	return b


func _render() -> void:
	for c in _body.get_children():
		_body.remove_child(c)
		c.queue_free()
	_clear.disabled = true
	_pair_box.disabled = false
	if _state.is_empty():
		_head.text = "Reading the audio matrix..."
		return
	if not M.supported(_state):
		_head.text = "This device does not advertise an audio matrix."
		return
	_head.text = M.summary(_state)
	_clear.disabled = _busy or M.routed_count(_state) == 0
	var inputs: Array = _state.get("inputs", [])
	var outputs: Array = _state.get("outputs", [])
	var grid := GridContainer.new()
	grid.columns = 2 + outputs.size()
	grid.add_theme_constant_override("h_separation", 2)
	grid.add_theme_constant_override("v_separation", 2)
	_body.add_child(grid)
	# header row 1: output port names + port M / T on the group's first columns
	grid.add_child(_label("In ↓  Out →"))
	grid.add_child(Control.new())
	var ports_row: Array = []
	var chans_row: Array = []
	for g in M.group_by_port(outputs):
		var cs: Array = g.channels
		for i in cs.size():
			var cell := VBoxContainer.new()
			if i == 0:
				cell.add_child(_label(str(g.port)))
			else:
				cell.add_child(_label(""))
			var tools := HBoxContainer.new()
			if i < 2:
				var f := "mute" if i == 0 else "tone"
				var tip := M.flag_tip(f, "all channels of " + str(g.port))
				tools.add_child(_flag_button("M" if i == 0 else "T", M.port_flag_state(g, f), tip, M.port_flag_body(g, f)))
			cell.add_child(tools)
			ports_row.append(cell)
			var c: Dictionary = cs[i]
			var cc := HBoxContainer.new()
			cc.add_child(_label(str(int(c.get("channel", 0)) + 1), "%s · %s" % [c.get("port", ""), c.get("name", "")]))
			cc.add_child(_flag_button("M", 2 if int(c.get("mute", 0)) != 0 else 0, M.flag_tip("mute", "%s %s" % [c.get("port", ""), c.get("name", "")]), M.flag_body(c, "mute")))
			cc.add_child(_flag_button("T", 2 if int(c.get("tone", 0)) != 0 else 0, M.flag_tip("tone", "%s %s" % [c.get("port", ""), c.get("name", "")]), M.flag_body(c, "tone")))
			chans_row.append(cc)
	for n in ports_row:
		grid.add_child(n)
	grid.add_child(Control.new())
	grid.add_child(Control.new())
	for n in chans_row:
		grid.add_child(n)
	for g in M.group_by_port(inputs):
		var cs: Array = g.channels
		for i in cs.size():
			var row: Dictionary = cs[i]
			if i == 0:
				var pc := HBoxContainer.new()
				pc.add_child(_label(str(g.port)))
				pc.add_child(_flag_button("M", M.port_flag_state(g, "mute"), M.flag_tip("mute", "all channels of " + str(g.port)), M.port_flag_body(g, "mute")))
				pc.add_child(_flag_button("T", M.port_flag_state(g, "tone"), M.flag_tip("tone", "all channels of " + str(g.port)), M.port_flag_body(g, "tone")))
				grid.add_child(pc)
			else:
				grid.add_child(Control.new())
			var rc := HBoxContainer.new()
			var sig: Variant = row.get("signal")
			var dot := _label("●", M.signal_tip(sig))
			dot.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if sig != null and int(sig) == 1 else ThemeBuilder.TEXT_MUTED)
			dot.visible = sig != null
			rc.add_child(dot)
			rc.add_child(_label(str(row.get("name", ""))))
			rc.add_child(_flag_button("M", 2 if int(row.get("mute", 0)) != 0 else 0, M.flag_tip("mute", "%s %s" % [row.get("port", ""), row.get("name", "")]), M.flag_body(row, "mute")))
			rc.add_child(_flag_button("T", 2 if int(row.get("tone", 0)) != 0 else 0, M.flag_tip("tone", "%s %s" % [row.get("port", ""), row.get("name", "")]), M.flag_body(row, "tone")))
			grid.add_child(rc)
			for out in outputs:
				grid.add_child(_point(row, out))


func _point(input: Dictionary, output: Dictionary) -> Button:
	var active := M.is_routed(_state, str(output.get("key")), str(input.get("key")))
	var b := Button.new()
	b.text = "●" if active else ""
	b.custom_minimum_size = Vector2(26, 24)
	b.focus_mode = Control.FOCUS_NONE
	b.tooltip_text = M.crosspoint_tip(input, output)
	b.self_modulate = ThemeBuilder.ACCENT if active else Color.WHITE
	b.disabled = _busy
	b.pressed.connect(func() -> void:
		var routes := M.click_routes(_state, input, output, _pair, Input.is_key_pressed(KEY_ALT))
		_send(M.routes_body(routes)))
	return b
