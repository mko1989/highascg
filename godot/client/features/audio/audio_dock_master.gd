extends PanelContainer
## WO-806 — one master column of the Program audio dock (web audio-mixer__bus-master): label, one meter bar per
## program bus channel (meter_bank.gd) beside a vertical fader with the console's fader cap (fader_cap.gd), and the dB.
## No solo / mute on a master (web dock). WO-227 on the compact surface: more than 4 bus channels → narrow bars
## (audio_dock_model.gd), so an 8-channel master stays a narrow column. Emits like audio_strip.gd; audio_console_ctl.gd
## sends the write (POST /api/audio/volume {master: true}).

signal gain_changed(gain: float, final: bool)
signal mute_pressed  ## never emitted (a master has no mute); the controller binds every strip the same way

const ThemeBuilder := preload("res://app/theme_builder.gd")
const MM := preload("res://features/live/mixer_math.gd")
const DM := preload("res://features/audio/audio_dock_model.gd")
const MeterBank := preload("res://features/audio/meter_bank.gd")
const FaderCap := preload("res://features/audio/fader_cap.gd")
const BODY_H := 96

var row: Dictionary
var meter: MeterBank
var fader: VSlider
var dragging := false
var _val: Label
var _syncing := false


func setup(r: Dictionary, bars: int) -> void:
	row = r
	var sb := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1, 4)
	sb.set_content_margin_all(3)
	add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	add_child(v)
	var lab := Label.new()
	lab.text = DM.master_label(r)
	lab.tooltip_text = "%s (ch %s)" % [str(r.get("label", "")), str(r.get("ch", ""))]
	lab.mouse_filter = Control.MOUSE_FILTER_PASS
	lab.clip_text = true
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.custom_minimum_size.x = 30
	lab.add_theme_font_size_override("font_size", 10)
	lab.add_theme_color_override("font_color", ThemeBuilder.WARN if r.get("isPreview", false) == true else ThemeBuilder.ACCENT)
	v.add_child(lab)
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 2)
	body.custom_minimum_size.y = BODY_H
	v.add_child(body)
	meter = MeterBank.new()
	meter.set_count(bars)
	meter.custom_minimum_size.x = DM.meter_width(bars)  # after set_count, which sizes at 9 px per bar
	body.add_child(meter)
	fader = VSlider.new()
	fader.min_value = 0
	fader.max_value = 100
	fader.step = 1
	fader.scrollable = false
	fader.focus_mode = Control.FOCUS_NONE
	fader.add_theme_icon_override("grabber", FaderCap.grabber())
	fader.add_theme_icon_override("grabber_highlight", FaderCap.grabber(true))
	fader.add_theme_stylebox_override("slider", FaderCap.track())
	fader.custom_minimum_size.x = FaderCap.WIDTH
	fader.tooltip_text = "Master volume — double-click / Ctrl+click: 0 dB"
	fader.value = MM.gain_to_fader(float(r.get("v", 1.0)))
	fader.value_changed.connect(_on_value)
	fader.drag_started.connect(func() -> void: dragging = true)
	fader.drag_ended.connect(func(_c: bool) -> void:
		if dragging:
			dragging = false
			gain_changed.emit(gain(), true))
	fader.gui_input.connect(_on_fader_input)
	body.add_child(fader)
	_val = Label.new()
	_val.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_val.add_theme_font_size_override("font_size", 10)
	_val.text = MM.format_db(float(r.get("v", 1.0)))
	v.add_child(_val)


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


func set_gain(g: float) -> void:
	if dragging:
		return
	_syncing = true
	fader.value = MM.gain_to_fader(g)
	_val.text = MM.format_db(g)
	_syncing = false


func gain() -> float:
	var v := float(row.get("v", 1.0))
	return v if MM.gain_to_fader(v) == int(fader.value) else MM.fader_to_gain(fader.value)


func set_solo(_on: bool) -> void:
	pass


func muted() -> bool:
	return false
