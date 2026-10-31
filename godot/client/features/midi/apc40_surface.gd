extends Control
## WO-909 — the APC40 mkII drawn (apc40_layout.gd) with what every control does right now: its target under / on it,
## faders and knobs at their app value (an amber tick where a waiting fader physically is, midi_pickup.gd), pads and
## buttons lit like their target (the midi_leds.gd states: there / showing / alert), unmapped controls dim. A control
## flashes when it is touched, so moving anything on the unit shows where it is and what it drove. Hover = the full line;
## a click asks `picked` (the controller starts Learn for that control). Pure drawing: the host answers `info_cb`.
##   info_cb(control) → {label: String ("" = unmapped), value: float (0..1, -1 = none), lit: int (0..3), waiting: bool,
##                       hw: float (the physical position while waiting, -1 = unknown), line: String (the tooltip),
##                       color: Color or null (WO-913: a visual pad's own colour)}
## WO-913: a drag over a control asks `can_drop_cb(control, data)`; a drop emits `dropped`.

const L := preload("res://features/midi/apc40_layout.gd")
const FLASH_MS := 300
const LIT := [Color(0.2, 0.21, 0.23), Color(0.42, 0.44, 0.47), Color(0.25, 0.75, 0.35), Color(0.9, 0.3, 0.25)]
const AMBER := Color(1.0, 0.72, 0.2)
const TEXT := Color(0.86, 0.88, 0.9)
const DIM := Color(0.45, 0.47, 0.5)

signal picked(control: Dictionary)
signal dropped(control: Dictionary, data: Variant)

var info_cb: Callable
var can_drop_cb: Callable
var controls := L.controls()
var _touched := {}  # control key → msec
var _scale := 1.0
var _origin := Vector2.ZERO
var _tick: Timer


func _init() -> void:
	custom_minimum_size = Vector2(420, 280)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	tooltip_text = " "  # the real text comes from _get_tooltip
	mouse_filter = Control.MOUSE_FILTER_STOP
	_tick = Timer.new()
	_tick.wait_time = 0.1  # values follow the app (a look recall, a drag) while shown
	_tick.autostart = true
	_tick.timeout.connect(func() -> void:
		if is_visible_in_tree():
			queue_redraw())
	add_child(_tick)


## A MIDI message arrived: its control flashes.
func touch(msg: Dictionary) -> void:
	var c := L.find(controls, msg)
	if not c.is_empty():
		_touched[L.key(c)] = Time.get_ticks_msec()
		queue_redraw()


func _info(c: Dictionary) -> Dictionary:
	var d: Variant = info_cb.call(c) if info_cb.is_valid() else null
	return d if d is Dictionary else {"label": "", "value": -1.0, "lit": 0, "waiting": false, "hw": -1.0, "line": ""}


func _can_drop_data(at: Vector2, data: Variant) -> bool:
	var c := control_at(at)
	return not c.is_empty() and can_drop_cb.is_valid() and bool(can_drop_cb.call(c, data))


func _drop_data(at: Vector2, data: Variant) -> void:
	var c := control_at(at)
	if not c.is_empty():
		dropped.emit(c, data)
		_touched[L.key(c)] = Time.get_ticks_msec()
		queue_redraw()


func _box(r: Rect2) -> Rect2:
	return Rect2(_origin + r.position * _scale, r.size * _scale)


func control_at(at: Vector2) -> Dictionary:
	for c in controls:
		if _box(c.rect).grow(2.0).has_point(at):
			return c
	return {}


func _get_tooltip(at: Vector2) -> String:
	var c := control_at(at)
	if c.is_empty():
		return ""
	var line := str(_info(c).get("line", ""))
	return line if line != "" else "%s — not mapped (click to Learn it)" % c.name


func _gui_input(e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
		var c := control_at(mb.position)
		if not c.is_empty():
			picked.emit(c)
			accept_event()


func _draw() -> void:
	_scale = minf(size.x / L.W, size.y / L.H)
	_origin = (size - Vector2(L.W, L.H) * _scale) / 2.0
	draw_rect(Rect2(_origin - Vector2(6, 6), Vector2(L.W, L.H) * _scale + Vector2(12, 12)), Color(0.09, 0.095, 0.1))
	var font := get_theme_default_font()
	var now := Time.get_ticks_msec()
	for c in controls:
		var d := _info(c)
		var flash := now - int(_touched.get(L.key(c), -FLASH_MS)) < FLASH_MS
		var b := _box(c.rect)
		match c.shape:
			"pad", "btn":
				_button(font, c, d, b, flash)
			"knob", "encoder":
				_knob(font, c, d, b, flash)
			"fader":
				_fader(font, d, b, flash, true)
			"xfader":
				_fader(font, d, b, flash, false)


func _fs(units: float) -> int:
	return maxi(7, roundi(units * _scale))


func _text(font: Font, at: Vector2, width: float, text: String, col: Color, fs: int) -> void:
	if text == "" or width < 8.0:
		return
	var t := text
	while t.length() > 1 and font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > width:
		t = t.left(t.length() - 2) + "…"
	draw_string(font, at, t, HORIZONTAL_ALIGNMENT_CENTER, width, fs, col)


func _button(font: Font, c: Dictionary, d: Dictionary, b: Rect2, flash: bool) -> void:
	var mapped: bool = d.label != ""
	var col: Color = LIT[clampi(int(d.lit), 0, 3)] if mapped else Color(0.13, 0.135, 0.145)
	var own: Variant = d.get("color")
	if own is Color:
		col = own
	if flash:
		col = col.lightened(0.55)
	draw_rect(b, col)
	draw_rect(b, Color(0, 0, 0, 0.6), false, 1.0)
	if b.size.x < 3.0 * _fs(0.2):
		return  # the four small per-track buttons: hover tells
	var fs := _fs(0.22 if c.shape == "pad" else 0.2)
	var txt := TEXT if mapped and int(d.lit) != 1 else (Color(0.08, 0.08, 0.09) if mapped else DIM)
	if own is Color:
		txt = Color(0.05, 0.05, 0.06) if col.get_luminance() > 0.5 else TEXT
	_text(font, b.position + Vector2(2, b.size.y / 2.0 + fs * 0.35), b.size.x - 4.0, d.label if mapped else c.name, txt, fs)


func _knob(font: Font, c: Dictionary, d: Dictionary, b: Rect2, flash: bool) -> void:
	var mapped: bool = d.label != ""
	var ctr := b.get_center()
	var r := b.size.x * 0.42
	draw_circle(ctr, r, Color(0.22, 0.23, 0.25).lightened(0.4 if flash else 0.0))
	var v := float(d.value)
	var a0 := deg_to_rad(135.0)
	if mapped and v >= 0.0:
		draw_arc(ctr, r + 2.0, a0, a0 + deg_to_rad(270.0) * v, 24, Color(0.35, 0.65, 1.0), 3.0)
		var a := a0 + deg_to_rad(270.0) * v
		draw_line(ctr, ctr + Vector2(cos(a), sin(a)) * r, TEXT, 2.0)
	if d.waiting and float(d.hw) >= 0.0:
		var h := a0 + deg_to_rad(270.0) * float(d.hw)
		draw_line(ctr + Vector2(cos(h), sin(h)) * (r - 3.0), ctr + Vector2(cos(h), sin(h)) * (r + 5.0), AMBER, 3.0)
	var fs := _fs(0.2)
	var label: String = d.label if mapped else ("relative" if c.shape == "encoder" else "—")
	_text(font, Vector2(b.position.x - 0.25 * _scale, b.end.y + fs * 0.9), b.size.x + 0.5 * _scale, label,
		AMBER if d.waiting else (TEXT if mapped else DIM), fs)


func _fader(font: Font, d: Dictionary, b: Rect2, flash: bool, vertical: bool) -> void:
	var mapped: bool = d.label != ""
	var v := clampf(float(d.value), 0.0, 1.0) if float(d.value) >= 0.0 else 0.0
	var slot := Color(0.05, 0.05, 0.06)
	var cap := (Color(0.75, 0.77, 0.8) if mapped else DIM).lightened(0.3 if flash else 0.0)
	var fs := _fs(0.2)
	if vertical:
		var x := b.get_center().x
		draw_line(Vector2(x, b.position.y), Vector2(x, b.end.y), slot, 4.0)
		if mapped:
			draw_line(Vector2(x, b.end.y), Vector2(x, b.end.y - b.size.y * v), Color(0.35, 0.65, 1.0), 4.0)
		var y := b.end.y - b.size.y * v
		draw_rect(Rect2(b.position.x - 2.0, y - 0.2 * _scale, b.size.x + 4.0, 0.4 * _scale), cap)
		if d.waiting and float(d.hw) >= 0.0:
			var hy := b.end.y - b.size.y * float(d.hw)
			draw_line(Vector2(b.position.x - 6.0, hy), Vector2(b.end.x + 6.0, hy), AMBER, 3.0)
		_text(font, Vector2(b.position.x - 0.45 * _scale, b.end.y + 0.62 * _scale), b.size.x + 0.9 * _scale, d.label if mapped else "—",
			AMBER if d.waiting else (TEXT if mapped else DIM), fs)
	else:
		var y := b.get_center().y
		draw_line(Vector2(b.position.x, y), Vector2(b.end.x, y), slot, 4.0)
		var x := b.position.x + b.size.x * v
		draw_rect(Rect2(x - 0.25 * _scale, b.position.y, 0.5 * _scale, b.size.y), cap)
		if d.waiting and float(d.hw) >= 0.0:
			var hx := b.position.x + b.size.x * float(d.hw)
			draw_line(Vector2(hx, b.position.y - 4.0), Vector2(hx, b.end.y + 4.0), AMBER, 3.0)
		_text(font, Vector2(b.position.x, b.position.y - fs * 0.4), b.size.x, d.label if mapped else "Crossfader — not mapped",
			AMBER if d.waiting else (TEXT if mapped else DIM), fs)
		_text(font, Vector2(b.position.x - 0.6 * _scale, y + fs * 0.35), 0.5 * _scale, "A", DIM, fs)
		_text(font, Vector2(b.end.x + 0.1 * _scale, y + fs * 0.35), 0.5 * _scale, "B", DIM, fs)
