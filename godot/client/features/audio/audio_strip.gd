extends PanelContainer
## WO-604 — one console strip (web audio-mixer-view__strip): label, meter (bank), fader scale, 0–100 fader on the
## web taper, dB readout, SOLO / MUTE / PGM-PRV badge, "no signal" on dedicated inputs. Double-click or Ctrl+click
## the fader resets to 0 dB. The strip only emits; audio_tab.gd turns that into server calls.

signal gain_changed(gain: float, final: bool)
signal solo_pressed(multi: bool)
signal mute_pressed

const ThemeBuilder := preload("res://app/theme_builder.gd")
const MM := preload("res://features/live/mixer_math.gd")
const MeterBank := preload("res://features/audio/meter_bank.gd")
const SCALE := [[100.0, "+6"], [83.333, "0"], [66.667, "-6"], [50.0, "-12"], [33.333, "-24"], [16.667, "-48"], [0.0, "-∞"]]

var row: Dictionary
var meter: MeterBank
var fader: VSlider
var dragging := false
var _val: Label
var _solo: Button
var _mute: Button
var _nosig: Label
var _syncing := false


func setup(r: Dictionary, bars: int, dense: bool) -> void:
	row = r
	var master: bool = r.get("isMaster", false) == true
	custom_minimum_size = Vector2(100 + maxi(0, bars - 2) * 9 if master else (64 if dense else 84), 360)
	add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED if master else ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1, 4))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	add_child(v)
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


func _draw_scale(c: Control) -> void:
	var font := c.get_theme_default_font()
	var grab := 8.0  # VSlider grabber half-height: the track runs between the grabber centres
	for m in SCALE:
		var y: float = grab + (1.0 - m[0] / 100.0) * (c.size.y - 2 * grab)
		c.draw_string(font, Vector2(0, y + 4), m[1], HORIZONTAL_ALIGNMENT_RIGHT, c.size.x, 9, Color("#8b949e"))


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
