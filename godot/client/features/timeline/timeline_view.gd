extends Control
## WO-602 — timeline canvas (web timeline-canvas.js + -render.js + -clip.js + -wheel.js, read-only slice): ruler with
## nice ticks, layer headers, tracks, clips in the layer palette with their label, flags, the duration end and the
## red playhead. Vertical wheel zooms around the cursor, Shift/Alt + wheel pans; click/drag on the ruler seeks.
## HiDPI comes from Godot's content scale (the web canvas has no devicePixelRatio handling).

signal seek_requested(ms: float)

const TM := preload("res://features/timeline/timeline_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var tl: Dictionary = {}
var playhead_ms := 0.0
var px_per_ms := 0.1
var scroll_x := 0.0
var scroll_y := 0.0
var follow := true
var _scrubbing := false


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_CLICK


func set_timeline(t: Dictionary) -> void:
	var first := tl.is_empty() or str(tl.get("id", "")) != str(t.get("id", ""))
	tl = t
	if not tl.is_empty():
		TM.ensure_heights(tl)
	if first:
		fit()
	queue_redraw()


func fit() -> void:
	var dur := float(tl.get("duration", 30000))
	if dur > 0 and size.x > TM.HEADER_W + 40:
		px_per_ms = maxf(TM.MIN_PX_MS, (size.x - TM.HEADER_W - 20) / dur)
		scroll_x = 0.0
	queue_redraw()


func set_playhead(ms: float, playing: bool) -> void:
	playhead_ms = ms
	if follow and playing:
		var track_w := size.x - TM.HEADER_W
		var right := scroll_x + track_w / px_per_ms
		if ms > right - 0.1 * track_w / px_per_ms or ms < scroll_x:  # keep the playhead in view (page follow)
			_clamp_scroll(ms - 0.1 * track_w / px_per_ms)
	queue_redraw()


func _clamp_scroll(ms: float) -> void:
	var track_w := size.x - TM.HEADER_W
	var max_scroll := maxf(0.0, float(tl.get("duration", 0)) - track_w / px_per_ms) if px_per_ms > 0 else 0.0
	scroll_x = clampf(ms, 0.0, max_scroll)


func _x(ms: float) -> float:
	return TM.x_at(ms, px_per_ms, scroll_x)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BG_DARK)
	if tl.is_empty():
		draw_string(get_theme_default_font(), Vector2(TM.HEADER_W + 12, 60), "No timeline", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, ThemeBuilder.TEXT_MUTED)
		return
	var font := get_theme_default_font()
	var layers: Array = tl.get("layers", [])
	var dur := float(tl.get("duration", 30000))
	var fps := int(tl.get("fps", 25))
	# tracks
	for i in layers.size():
		var y := TM.track_top(tl, i, scroll_y)
		var h := TM.layer_h(tl, i)
		if y + h < TM.RULER_H or y > size.y:
			continue
		draw_rect(Rect2(TM.HEADER_W, y, size.x - TM.HEADER_W, h), Color("#0d1117") if i % 2 == 0 else Color("#10151c"))
		draw_rect(Rect2(TM.HEADER_W, y + h - 1, size.x - TM.HEADER_W, 1), Color("#21262d"))
		for c in layers[i].get("clips", []):
			_draw_clip(c, i, y, h, font)
	# past-the-end shade
	var end_x := _x(dur)
	if end_x < size.x:
		draw_rect(Rect2(maxf(end_x, TM.HEADER_W), TM.RULER_H, size.x - maxf(end_x, TM.HEADER_W), size.y - TM.RULER_H), Color(0, 0, 0, 0.35))
	# headers
	draw_rect(Rect2(0, 0, TM.HEADER_W, size.y), Color("#161b22"))
	for i in layers.size():
		var y := TM.track_top(tl, i, scroll_y)
		if y + TM.layer_h(tl, i) < TM.RULER_H or y > size.y:
			continue
		draw_string(font, Vector2(8, y + 18), str(layers[i].get("name", "Layer %d" % (i + 1))), HORIZONTAL_ALIGNMENT_LEFT, TM.HEADER_W - 12, 12, ThemeBuilder.TEXT)
		draw_rect(Rect2(0, y + TM.layer_h(tl, i) - 1, TM.HEADER_W, 1), Color("#21262d"))
	draw_rect(Rect2(TM.HEADER_W - 1, 0, 1, size.y), Color("#30363d"))
	_draw_ruler(font, dur, fps)
	for f in tl.get("flags", []):
		if f is Dictionary:
			var fx := _x(float(f.get("time", 0)))
			if fx >= TM.HEADER_W and fx <= size.x:
				draw_rect(Rect2(fx, 0, 1, size.y), Color(0.95, 0.75, 0.2, 0.6))
				draw_string(font, Vector2(fx + 3, 10), str(f.get("name", f.get("type", ""))), HORIZONTAL_ALIGNMENT_LEFT, 120, 10, Color("#f0b429"))
	# playhead
	var px := roundf(_x(playhead_ms)) + 0.5
	if px >= TM.HEADER_W:
		draw_line(Vector2(px, TM.RULER_H), Vector2(px, size.y), ThemeBuilder.ERROR, 1.0)
		draw_colored_polygon(PackedVector2Array([Vector2(px - 6, 0), Vector2(px + 6, 0), Vector2(px, 12)]), ThemeBuilder.ERROR)


func _draw_ruler(font: Font, dur: float, fps: int) -> void:
	draw_rect(Rect2(TM.HEADER_W, 0, size.x - TM.HEADER_W, TM.RULER_H), Color("#161b22"))
	draw_rect(Rect2(TM.HEADER_W, TM.RULER_H - 1, size.x - TM.HEADER_W, 1), Color("#30363d"))
	var interval := TM.ruler_interval(px_per_ms)
	var end_ms := scroll_x + (size.x - TM.HEADER_W) / px_per_ms
	var t := ceilf(scroll_x / interval) * interval
	while t <= minf(end_ms, dur + interval):
		var x := _x(t)
		draw_rect(Rect2(x, 0, 1, TM.RULER_H), Color("#21262d"))
		draw_rect(Rect2(x, TM.RULER_H - 6, 1, 6), Color("#58a6ff"))
		draw_string(font, Vector2(x + 3, TM.RULER_H - 9), TM.fmt_timecode(t, fps), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, ThemeBuilder.TEXT_MUTED)
		t += interval
	var sub := interval / 5.0
	if sub * px_per_ms >= 5.0:
		var s := ceilf(scroll_x / sub) * sub
		while s <= end_ms:
			if fmod(s, interval) >= 1.0:
				draw_rect(Rect2(_x(s), TM.RULER_H - 4, 1, 4), Color("#30363d"))
			s += sub


func _draw_clip(c: Dictionary, li: int, track_y: float, track_h: int, font: Font) -> void:
	if not (c.get("source") is Dictionary) or str(c.source.get("value", "")) == "":
		return
	var x := _x(float(c.get("startTime", 0)))
	var w := maxf(3.0, float(c.get("duration", 0)) * px_per_ms)
	var top := maxf(track_y + 4, TM.RULER_H)
	var bottom := minf(track_y + track_h - 4, size.y)
	var h := bottom - top
	if x + w < TM.HEADER_W + 1 or x > size.x or h < 4:
		return
	var col := Color(TM.CLIP_PALETTE[li % TM.CLIP_PALETTE.size()])
	var r := Rect2(x, top, w, h)
	draw_style_box(_box(col), r)
	var label := str(c.source.get("label", c.source.value)).get_file()
	var lx := maxf(x, TM.HEADER_W + 1) + 5
	var avail := minf(x + w, size.x) - lx - 4
	if avail > 12 and h >= 14:
		draw_string(font, Vector2(lx, top + 13), label, HORIZONTAL_ALIGNMENT_LEFT, avail, 11, Color(1, 1, 1, 0.92))


func _box(col: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(3)
	return sb


func _gui_input(event: InputEvent) -> void:
	if tl.is_empty():
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var dir := 1 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1
			if mb.shift_pressed or mb.alt_pressed:  # pan
				_clamp_scroll(scroll_x - dir * 80.0 / px_per_ms)
			else:  # zoom around the cursor
				var at := TM.ms_at(maxf(mb.position.x, TM.HEADER_W), px_per_ms, scroll_x)
				px_per_ms = TM.zoom(px_per_ms, dir)
				_clamp_scroll(at - (maxf(mb.position.x, TM.HEADER_W) - TM.HEADER_W) / px_per_ms)
			queue_redraw()
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed and mb.position.y < TM.RULER_H and mb.position.x > TM.HEADER_W:
				_scrubbing = true
				_seek_to(mb.position.x)
				accept_event()
			elif not mb.pressed:
				_scrubbing = false
	elif event is InputEventMouseMotion and _scrubbing:
		_seek_to((event as InputEventMouseMotion).position.x)
		accept_event()


func _seek_to(x: float) -> void:
	var ms := clampf(TM.ms_at(x, px_per_ms, scroll_x), 0.0, float(tl.get("duration", 0)))
	playhead_ms = ms
	queue_redraw()
	seek_requested.emit(ms)
