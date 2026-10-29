extends PanelContainer
## WO-604 — one console strip (web audio-mixer-view__strip): label, meter (bank), fader scale, 0–100 fader on the
## web taper, dB readout, SOLO / MUTE / PGM-PRV badge, "no signal" on dedicated inputs. Double-click or Ctrl+click
## the fader resets to 0 dB. The strip only emits; audio_tab.gd turns that into server calls.
## WO-604 slice 3: DeckLink / v4l2 inputs add the audio-send policy and one Ch toggle per program channel (the input's
## audio-only route there), startable inputs a START, audio-only looks a STOP.
## Look layers add the "Screens" row (web WO-284): one button per program channel — the host lit and fixed, the
## others route this layer's audio there (set_screens applies the server's plan + the look's `audioScreens`).

signal gain_changed(gain: float, final: bool)
signal solo_pressed(multi: bool)
signal mute_pressed
signal route_toggled(channel: int, on: bool)
signal screen_toggled(channel: int, on: bool)
signal send_selected(send: String)
signal start_pressed
signal stop_pressed
signal inspect_requested  ## a click on a live-audio strip's body (web: "Click to inspect / remove")
signal monitor_pair_selected(pair: String)  ## WO-801: the PRV master's headphone pair picker

const ThemeBuilder := preload("res://app/theme_builder.gd")
const MM := preload("res://features/live/mixer_math.gd")
const MeterBank := preload("res://features/audio/meter_bank.gd")
const AA := preload("res://features/audio/audio_actions.gd")
const FaderCap := preload("res://features/audio/fader_cap.gd")
const LL := preload("res://features/audio/layer_levels.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const SEND_TEXT := {"afv": "AFV", "always": "ALWAYS", "never": "NEVER"}
const SEND_TIP := "Audio send — AFV: audio follows video on takes (respects AUTO MIX) · ALWAYS: feeds its routed Ch buses even off-PGM · NEVER: video only"
const SCALE := [[100.0, "+6"], [83.333, "0"], [66.667, "-6"], [50.0, "-12"], [33.333, "-24"], [16.667, "-48"], [0.0, "-∞"]]
const PAIR_TIP := "Headphones (monitor output): HP Mix = every channel folded to stereo; a pair = only those two channels (e.g. 3+4 of an 8 ch look). Applies to whatever the monitor plays — PRV, or the SOLO set."
const SCALE_ICON_W := 7.0  # width of the fader-mark icon drawn at each scale point, on the track side of the label

var row: Dictionary
var meter: MeterBank
var fader: VSlider
var dragging := false
var _val: Label
var _solo: Button
var _mute: Button
var _nosig: Label
var _syncing := false
var _send: OptionButton
var _routes := {}  # program channel → toggle
var _screens := {}  # program channel → Screens toggle
var _labels := {}  # program channel → screen label (AR.screen_labels); the button text and tooltip
var _acts: VBoxContainer
var _pair: OptionButton  # WO-801: PRV masters only, while the box has a monitor output
var _pairs: Array = []


func setup(r: Dictionary, bars: int, dense: bool, programs: Array = [], labels: Dictionary = {}) -> void:
	row = r
	_labels = labels
	var master: bool = r.get("isMaster", false) == true
	custom_minimum_size = Vector2(100 + maxi(0, bars - 2) * 9 if master else (64 if dense else 84), 360)
	add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED if master else ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1, 4))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	add_child(v)
	if AA.inspect_slot(r) > 0:
		tooltip_text = "Click to inspect / remove"
		gui_input.connect(func(e: InputEvent) -> void:
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
				inspect_requested.emit())
	var lab := Label.new()
	lab.text = str(r.get("label", "")).trim_prefix("🔊 ")  # the UI font has no emoji; the tooltip says "Audio-only look"
	lab.tooltip_text = str(r.get("labelTitle", r.get("label", "")))
	lab.mouse_filter = Control.MOUSE_FILTER_PASS
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.clip_text = true
	lab.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	lab.add_theme_font_size_override("font_size", 12)
	if master:
		lab.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	elif r.get("isAudioOnlyLook", false) == true:
		lab.add_theme_color_override("font_color", ThemeBuilder.WARN)
	v.add_child(lab)
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 3)
	body.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(body)
	meter = MeterBank.new()
	meter.size_flags_vertical = Control.SIZE_EXPAND_FILL
	meter.set_count(bars)
	if not LL.target(r, {}).is_empty():  # WO-800: the layer's own level, a thin lane in the same meter
		meter.enable_lane()
		meter.tooltip_text = "Wide bar: the channel's level · thin bar: this layer's own audio (only while it has any)"
	body.add_child(meter)
	var sc := Control.new()
	sc.custom_minimum_size.x = 20
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sc.draw.connect(func() -> void: _draw_scale(sc))
	body.add_child(sc)
	fader = VSlider.new()
	fader.min_value = 0
	fader.max_value = 100
	fader.step = 1
	fader.scrollable = false  # the wheel scrolls the console, it never moves a fader by accident
	fader.size_flags_vertical = Control.SIZE_EXPAND_FILL
	# Mixer look: a physical fader cap as the grabber, a thin dark track. The cap is wider than the default
	# grabber, so the slider's minimum width grows to fit it (the track is centred in that width).
	fader.add_theme_icon_override("grabber", FaderCap.grabber())
	fader.add_theme_icon_override("grabber_highlight", FaderCap.grabber(true))
	fader.add_theme_stylebox_override("slider", FaderCap.track())
	fader.custom_minimum_size.x = FaderCap.WIDTH
	fader.tooltip_text = "Volume — double-click / Ctrl+click: 0 dB"
	fader.value = MM.gain_to_fader(float(r.get("v", 1.0)))
	fader.value_changed.connect(_on_value)
	fader.drag_started.connect(func() -> void: dragging = true)
	fader.drag_ended.connect(func(_c: bool) -> void:
		# The slider also ends a "drag" on the release of a double-click reset, whose press it never saw.
		if dragging:
			dragging = false
			gain_changed.emit(gain(), true))
	fader.gui_input.connect(_on_fader_input)
	body.add_child(fader)
	_nosig = Label.new()
	_nosig.text = "no signal"
	_nosig.visible = false
	_nosig.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_nosig.add_theme_font_size_override("font_size", 11)
	_nosig.add_theme_color_override("font_color", ThemeBuilder.WARN)
	v.add_child(_nosig)
	_val = Label.new()
	_val.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_val.add_theme_font_size_override("font_size", 12)
	_val.text = MM.format_db(float(r.get("v", 1.0)))
	v.add_child(_val)
	var acts := VBoxContainer.new()
	acts.add_theme_constant_override("separation", 3)
	v.add_child(acts)
	_acts = acts
	if master:
		var badge := Label.new()
		badge.text = "PRV" if r.get("isPreview", false) == true else "PGM"
		badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		badge.add_theme_color_override("font_color", ThemeBuilder.WARN if r.get("isPreview", false) == true else ThemeBuilder.ERROR)
		acts.add_child(badge)
	if r.get("isLiveInput", false) != true:
		_solo = _toggle("SOLO", "Solo to the monitor output (Ctrl+click: add to the solo set)", ThemeBuilder.WARN)
		_solo.pressed.connect(func() -> void: solo_pressed.emit(Input.is_key_pressed(KEY_CTRL) or Input.is_key_pressed(KEY_META)))
		acts.add_child(_solo)
	if not master:
		_mute = _toggle("MUTE", "Mute", ThemeBuilder.ERROR)
		_mute.button_pressed = r.get("muted", false) == true
		_mute.pressed.connect(func() -> void: mute_pressed.emit())  # the button has already toggled: muted() = the new state
		acts.add_child(_mute)
	if r.get("isAudioOnlyLook", false) == true:
		var stop := _button("STOP", "Stop this audio-only look (the channel's video look stays)")
		stop.pressed.connect(func() -> void: stop_pressed.emit())
		acts.add_child(stop)
	if AA.startable(r):
		var start := _button("START", "Start / restart this input's capture (its routes come back too)")
		start.pressed.connect(func() -> void: start_pressed.emit())
		acts.add_child(start)
	if AA.has_send(r):
		_send = OptionButton.new()
		_send.focus_mode = Control.FOCUS_NONE
		_send.tooltip_text = SEND_TIP
		_send.add_theme_font_size_override("font_size", 10)
		_send.fit_to_longest_item = false
		for k in AA.SENDS:
			_send.add_item(SEND_TEXT[k])
		_send.item_selected.connect(func(i: int) -> void: send_selected.emit(AA.SENDS[i]))
		acts.add_child(_send)
	if AA.routed(r):
		var grid := HFlowContainer.new()
		grid.add_theme_constant_override("h_separation", 3)
		grid.add_theme_constant_override("v_separation", 3)
		for p in programs:
			var ch := int(p)
			var b := _compact_toggle(AR.short_label(_label_of(ch)), "Route this input's audio onto %s (audio-only)" % _label_of(ch), ThemeBuilder.ACCENT)
			b.pressed.connect(func() -> void: route_toggled.emit(ch, b.button_pressed))
			_routes[ch] = b
			grid.add_child(b)
		acts.add_child(grid)
	if AA.cross_screen(r) and not programs.is_empty():
		var t := Label.new()
		t.text = "Screens"
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		t.add_theme_font_size_override("font_size", 10)
		t.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		acts.add_child(t)
		var sg := HFlowContainer.new()
		sg.add_theme_constant_override("h_separation", 3)
		sg.add_theme_constant_override("v_separation", 3)
		for p in programs:
			var ch := int(p)
			var b := _compact_toggle(AR.short_label(_label_of(ch)), "Checking…", ThemeBuilder.ACCENT)
			b.disabled = true  # until the plan says otherwise
			b.pressed.connect(func() -> void: screen_toggled.emit(ch, b.button_pressed))
			_screens[ch] = b
			sg.add_child(b)
		acts.add_child(sg)
		set_screens([], AA.cross_screen_targets(r))


## Screens row: `buttons` = the server plan for this layer ([{channel, ok, host, reasonText}]), `targets` = the
## look's audioScreens. The host button is lit and disabled; a refused target is disabled with the reason.
func set_screens(buttons: Array, targets: Array) -> void:
	for ch in _screens:
		var b: Button = _screens[ch]
		var host: bool = int(row.get("ch", 0)) == ch
		var info: Dictionary = {}
		for x in buttons:
			if x is Dictionary and int(x.get("channel", 0)) == ch:
				info = x
		b.disabled = host or info.get("ok", false) != true
		if host:  # a disabled Button draws the same pressed or not — keep the host visibly lit
			b.add_theme_stylebox_override("disabled", b.get_theme_stylebox("pressed"))
		else:
			b.remove_theme_stylebox_override("disabled")
		b.set_pressed_no_signal(host or targets.has(ch))
		b.tooltip_text = "Host channel" if host else ("Route this layer's audio to %s" % _label_of(ch) if info.get("ok", false) == true
			else str(info.get("reasonText", "Checking…")))


## WO-801: the headphone pair picker under SOLO (the PRV master's SOLO is what sends PRV to the headphones). `pairs` =
## AA.monitor_pairs(); the audio tab calls this on PRV masters only, and only when the box has a monitor output.
func enable_monitor_pairs(pairs: Array) -> void:
	if _pair or pairs.is_empty():
		return
	_pairs = pairs.duplicate()
	_pair = OptionButton.new()
	_pair.focus_mode = Control.FOCUS_NONE
	_pair.tooltip_text = PAIR_TIP
	_pair.add_theme_font_size_override("font_size", 10)
	_pair.fit_to_longest_item = false
	for p in _pairs:
		_pair.add_item(AA.monitor_pair_text(str(p)))
	_pair.item_selected.connect(func(i: int) -> void: monitor_pair_selected.emit(str(_pairs[i])))
	_acts.add_child(_pair)


## The server's pair (a pair past this picker's list still shows, so the picker never claims "Mix" falsely).
func set_monitor_pair(pair: String) -> void:
	if _pair == null:
		return
	if not _pairs.has(pair):
		_pairs.append(pair)
		_pair.add_item(AA.monitor_pair_text(pair))
	_pair.select(_pairs.find(pair))


func monitor_pair() -> String:
	return str(_pairs[_pair.selected]) if _pair and _pair.selected >= 0 else ""


## The PGM screen label for a program channel (its number when the labels dictionary has no entry).
func _label_of(ch: int) -> String:
	return str(_labels.get(ch, str(ch)))


func _button(text: String, tip: String) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 11)
	return b


## The server's routing entry for this input ({send, targets}); {} = defaults (AFV, nothing routed).
func set_routing(entry: Dictionary) -> void:
	if _send:
		_send.select(maxi(0, AA.SENDS.find(str(entry.get("send", "afv")))))
	var targets: Array = entry.get("targets", []) if entry.get("targets") is Array else []
	for ch in _routes:
		(_routes[ch] as Button).set_pressed_no_signal(targets.any(func(t: Variant) -> bool: return int(t) == ch))


func _toggle(text: String, tip: String, on_colour: Color) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 11)
	b.add_theme_stylebox_override("pressed", ThemeBuilder.box(on_colour.darkened(0.35), on_colour, 1, 4))
	b.add_theme_stylebox_override("hover_pressed", ThemeBuilder.box(on_colour.darkened(0.25), on_colour, 1, 4))
	return b


## Route / Screens button: the toggle style of _toggle, at font 10 with tighter padding and a 30 px minimum width so
## a short label stays tappable (the button flow wraps the row).
func _compact_toggle(text: String, tip: String, on_colour: Color) -> Button:
	var b := _toggle(text, tip, on_colour)
	b.add_theme_font_size_override("font_size", 10)
	b.custom_minimum_size = Vector2(30, 0)
	for st in ["normal", "hover", "focus", "disabled", "pressed", "hover_pressed"]:
		var sb := b.get_theme_stylebox(st)
		if sb is StyleBoxFlat:
			var d := (sb as StyleBoxFlat).duplicate() as StyleBoxFlat
			d.content_margin_left = 3
			d.content_margin_right = 3
			d.content_margin_top = 1
			d.content_margin_bottom = 1
			b.add_theme_stylebox_override(st, d)
	return b


func _draw_scale(c: Control) -> void:
	var font := c.get_theme_default_font()
	var grab := FaderCap.HEIGHT * 0.5  # VSlider grabber half-height: the track runs between the grabber centres
	var grey := Color("#8b949e")
	var track_x: float = c.size.x  # the fader sits to the right of this scale column
	for m in SCALE:
		var y: float = grab + (1.0 - m[0] / 100.0) * (c.size.y - 2 * grab)
		# Fader-style mark: a 2 px bar at the scale point, on the track side; the label sits just left of it.
		c.draw_rect(Rect2(track_x - SCALE_ICON_W, y - 1.0, SCALE_ICON_W, 2.0), grey)
		var text_w: float = font.get_string_size(m[1], HORIZONTAL_ALIGNMENT_LEFT, -1, 9).x
		c.draw_string(font, Vector2(track_x - SCALE_ICON_W - 2.0 - text_w, y + 4), m[1], HORIZONTAL_ALIGNMENT_LEFT, -1, 9, grey)


func _on_value(p: float) -> void:
	_val.text = MM.format_db(MM.fader_to_gain(p))
	if not _syncing:
		gain_changed.emit(MM.fader_to_gain(p), false)


func _on_fader_input(e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT and (mb.double_click or mb.ctrl_pressed or mb.meta_pressed):
		fader.accept_event()
		dragging = false
		set_gain(1.0)
		gain_changed.emit(1.0, true)


## A server / look value — ignored while the operator holds the fader.
func set_gain(g: float) -> void:
	if dragging:
		return
	_syncing = true
	fader.value = MM.gain_to_fader(g)
	_val.text = MM.format_db(g)
	_syncing = false


## Current gain. The 0..100 fader quantises (unity sits between steps, the web range input's −0.12 dB), so while
## the fader still shows the stored value that exact value wins; a moved fader reads back from its position.
func gain() -> float:
	var v := float(row.get("v", 1.0))
	return v if MM.gain_to_fader(v) == int(fader.value) else MM.fader_to_gain(fader.value)


func set_solo(on: bool) -> void:
	if _solo:
		_solo.set_pressed_no_signal(on)


func set_muted(on: bool) -> void:
	if _mute:
		_mute.set_pressed_no_signal(on)


func muted() -> bool:
	return _mute != null and _mute.button_pressed


func set_input_state(state: String) -> void:
	_nosig.visible = state == "no-data"
