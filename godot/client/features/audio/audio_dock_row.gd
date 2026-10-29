extends PanelContainer
## WO-806 — one input column of the Program audio dock, vertical like a master column (owner 29.10: "masters as
## vertical faders (good) and inputs as horizontal (bad)"): the name (shortened, the tooltip has the full label), a
## thin vertical level bar beside a vertical fader with the console's fader cap (fader_cap.gd) on the console taper,
## the dB, then S / M (■ on an audio-only look, two per line) and the routing toggles (a look layer's Screens, a live
## input's Ch routes) one per line with the screen name. Double-click or Ctrl+click the fader → 0 dB. ~42 px wide,
## so the dock's flow fits up to eight per line in the 400 px Inspector column. It only emits — with the same signals as audio_strip.gd — and
## audio_console_ctl.gd turns that into the same server calls the Audio tab makes.

signal gain_changed(gain: float, final: bool)
signal solo_pressed(multi: bool)
signal mute_pressed
signal route_toggled(channel: int, on: bool)
signal screen_toggled(channel: int, on: bool)
signal stop_pressed

const ThemeBuilder := preload("res://app/theme_builder.gd")
const MM := preload("res://features/live/mixer_math.gd")
const DM := preload("res://features/audio/audio_dock_model.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const AA := preload("res://features/audio/audio_actions.gd")
const MeterBank := preload("res://features/audio/meter_bank.gd")
const FaderCap := preload("res://features/audio/fader_cap.gd")
const COL_W := 36  # content width: two 16 px buttons + 2 px gap, or level 4 + 2 + fader cap 26 (+ 4 slack)
const FADER_H := 110
const LEVEL_W := 4
const BTN_W := 16

var row: Dictionary
var fader: VSlider
var dragging := false
var level: VBar
var _val: Label
var _solo: Button
var _mute: Button
var _nosig := false
var _syncing := false
var _toggles := {}  # program channel → routing toggle
var _kind := ""  # "routes" | "screens" | ""
var _labels := {}  # program channel → screen label (AR.screen_labels)


## A thin vertical level bar filling from the bottom (web audio-mixer__meter), the console's colours.
class VBar extends Control:
	var v := 0.0
	var colour := ""
	var no_signal := false

	func set_level(s: float, c: String) -> void:
		if is_equal_approx(v, s) and colour == c:
			return
		v = s
		colour = c
		queue_redraw()

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), MeterBank.BG)
		var h := clampf(v, 0.0, 1.0) * size.y
		if h > 0.5 and colour != "":
			draw_rect(Rect2(0, size.y - h, size.x, h), MeterBank.CLIP if colour == "clip" else MeterBank.OK)
		if no_signal:
			draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.WARN, false, 1.0)


func setup(r: Dictionary, dense: bool, programs: Array, labels: Dictionary = {}) -> void:
	row = r
	_labels = labels
	var sb := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1, 4)
	sb.set_content_margin_all(3)
	add_theme_stylebox_override("panel", sb)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 1 if dense else 2)
	col.custom_minimum_size.x = COL_W
	add_child(col)
	var lab := Label.new()
	lab.text = str(r.get("label", "")).trim_prefix("🔊 ")
	lab.tooltip_text = str(r.get("labelTitle", r.get("label", ""))) + (" (src %s)" % r.sourceAudioPair if r.get("sourceAudioPair") != null else "")
	lab.mouse_filter = Control.MOUSE_FILTER_PASS
	lab.clip_text = true
	lab.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.custom_minimum_size.x = COL_W
	lab.add_theme_font_size_override("font_size", 9 if dense else 10)
	if r.get("isAudioOnlyLook", false) == true:
		lab.add_theme_color_override("font_color", ThemeBuilder.WARN)
	col.add_child(lab)
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 2)
	body.alignment = BoxContainer.ALIGNMENT_CENTER
	body.custom_minimum_size.y = FADER_H
	col.add_child(body)
	level = VBar.new()
	level.custom_minimum_size.x = LEVEL_W
	level.mouse_filter = Control.MOUSE_FILTER_IGNORE
	body.add_child(level)
	fader = VSlider.new()
	fader.min_value = 0
	fader.max_value = 100
	fader.step = 1
	fader.scrollable = false  # the wheel scrolls the dock, never a fader
	fader.focus_mode = Control.FOCUS_NONE
	fader.add_theme_icon_override("grabber", FaderCap.grabber())
	fader.add_theme_icon_override("grabber_highlight", FaderCap.grabber(true))
	fader.add_theme_stylebox_override("slider", FaderCap.track())
	fader.custom_minimum_size.x = FaderCap.WIDTH
	fader.tooltip_text = "Volume — double-click / Ctrl+click: 0 dB"
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
	_val.clip_text = true
	_val.add_theme_font_size_override("font_size", 9 if dense else 10)
	_val.text = MM.format_db(float(r.get("v", 1.0)))
	col.add_child(_val)
	var grid := _grid()  # S / M, then ■, then the routing toggles: two per line
	col.add_child(grid)
	if r.get("isLiveInput", false) != true:  # the console has no SOLO on live inputs either
		_solo = small("S", "Solo to the monitor output (Ctrl+click: add to the solo set)", ThemeBuilder.WARN, true)
		_solo.pressed.connect(func() -> void: solo_pressed.emit(Input.is_key_pressed(KEY_CTRL) or Input.is_key_pressed(KEY_META)))
		grid.add_child(_solo)
	_mute = small("M", "Mute", ThemeBuilder.ERROR, true)
	_mute.button_pressed = r.get("muted", false) == true
	_mute.pressed.connect(func() -> void: mute_pressed.emit())  # the button has already toggled: muted() = the new state
	grid.add_child(_mute)
	if r.get("isAudioOnlyLook", false) == true:
		var stop := small("■", "Stop this audio-only look (the channel's video look stays)", ThemeBuilder.ERROR, false)
		stop.pressed.connect(func() -> void: stop_pressed.emit())
		grid.add_child(stop)
	_kind = DM.routing(r, programs)
	if _kind != "":
		var box := VBoxContainer.new()  # one per line, full column width: the screen names stay readable (335b030f)
		box.add_theme_constant_override("separation", 2)
		col.add_child(box)
		for p in programs:
			var ch := int(p)
			var name := str(labels.get(ch, str(ch)))
			var b := small(AR.short_label(name, 6), "Route this input's audio onto %s (audio-only)" % name if _kind == "routes" else "Checking…", ThemeBuilder.ACCENT, true)
			b.disabled = _kind == "screens"  # until the server's plan says otherwise
			b.pressed.connect(func() -> void:
				if _kind == "routes":
					route_toggled.emit(ch, b.button_pressed)
				else:
					screen_toggled.emit(ch, b.button_pressed))
			_toggles[ch] = b
			box.add_child(b)
	if r.get("isMaster", false) != true:
		set_screens([], AA.cross_screen_targets(r))


static func _grid() -> GridContainer:
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 2)
	g.add_theme_constant_override("v_separation", 2)
	return g


## A compact button: font 10, 2 px margins, 16 px wide (two fit the column side by side).
static func small(text: String, tip: String, on_colour: Color, toggle: bool) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.toggle_mode = toggle
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(BTN_W, 0)
	b.clip_text = true  # the width is the column's, whatever the font (a glyph wider than 12 px clips, never widens it)
	b.add_theme_font_size_override("font_size", 10)
	var base := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1, 3)
	base.set_content_margin_all(2)
	var on := ThemeBuilder.box(on_colour.darkened(0.35), on_colour, 1, 3)
	on.set_content_margin_all(2)
	for st in ["normal", "hover", "disabled", "focus"]:
		b.add_theme_stylebox_override(st, base)
	for st in ["pressed", "hover_pressed"]:
		b.add_theme_stylebox_override(st, on)
	return b


## Screens (look layers): `buttons` = the server plan for this layer, `targets` = the look's audioScreens. The host
## stays lit and fixed; a refused target is disabled with the reason (audio_strip.gd set_screens).
func set_screens(buttons: Array, targets: Array) -> void:
	if _kind != "screens":
		return
	for ch in _toggles:
		var b: Button = _toggles[ch]
		var host: bool = int(row.get("ch", 0)) == ch
		var info: Dictionary = {}
		for x in buttons:
			if x is Dictionary and int(x.get("channel", 0)) == ch:
				info = x
		b.disabled = host or info.get("ok", false) != true
		if host:
			b.add_theme_stylebox_override("disabled", b.get_theme_stylebox("pressed"))
		b.set_pressed_no_signal(host or targets.has(ch))
		b.tooltip_text = "Host channel" if host else ("Route this layer's audio to %s" % str(_labels.get(ch, str(ch))) if info.get("ok", false) == true
			else str(info.get("reasonText", "Checking…")))


## Live input routes: the server's routing entry ({targets}).
func set_routing(entry: Dictionary) -> void:
	if _kind != "routes":
		return
	var targets: Array = entry.get("targets", []) if entry.get("targets") is Array else []
	for ch in _toggles:
		(_toggles[ch] as Button).set_pressed_no_signal(targets.any(func(t: Variant) -> bool: return int(t) == ch))


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


## The stored value while the fader still shows it (the 0..100 taper quantises unity), else the fader's position.
func gain() -> float:
	var v := float(row.get("v", 1.0))
	return v if MM.gain_to_fader(v) == int(fader.value) else MM.fader_to_gain(fader.value)


func set_solo(on: bool) -> void:
	if _solo:
		_solo.set_pressed_no_signal(on)


func set_muted(on: bool) -> void:
	_mute.set_pressed_no_signal(on)


func muted() -> bool:
	return _mute.button_pressed


func set_input_state(state: String) -> void:
	level.no_signal = state == "no-data"
	level.queue_redraw()
