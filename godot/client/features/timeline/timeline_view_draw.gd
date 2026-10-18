extends RefCounted
## WO-602 — the timeline canvas painting (moved out of timeline_view.gd in slice 6 for the 500-line limit; the code is
## unchanged): tracks + clips (with keyframes), the past-the-end shade, flag trails, layer headers (the selected one
## lit), the ruler with nice ticks, flag markers and the playhead.

const TM := preload("res://features/timeline/timeline_math.gd")
const KD := preload("res://features/timeline/timeline_kf_draw.gd")
const FD := preload("res://features/timeline/timeline_flag_draw.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


static func draw(v: Control) -> void:
	v.draw_rect(Rect2(Vector2.ZERO, v.size), ThemeBuilder.BG_DARK)
	if v.tl.is_empty():
		v.draw_string(v.get_theme_default_font(), Vector2(TM.HEADER_W + 12, 60), "No timeline", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, ThemeBuilder.TEXT_MUTED)
		return
	var font := v.get_theme_default_font()
	var layers: Array = v.tl.get("layers", [])
	var dur := float(v.tl.get("duration", 30000))
	var fps := int(v.tl.get("fps", 25))
	# tracks
	for i in layers.size():
		var y := TM.track_top(v.tl, i, v.scroll_y)
		var h := TM.layer_h(v.tl, i)
		if y + h < TM.RULER_H or y > v.size.y:
			continue
		v.draw_rect(Rect2(TM.HEADER_W, y, v.size.x - TM.HEADER_W, h), Color("#0d1117") if i % 2 == 0 else Color("#10151c"))
		v.draw_rect(Rect2(TM.HEADER_W, y + h - 1, v.size.x - TM.HEADER_W, 1), Color("#21262d"))
		for c in layers[i].get("clips", []):
			_clip(v, c, i, y, h, font)
	# past-the-end shade
	var end_x: float = v._x(dur)
	if end_x < v.size.x:
		v.draw_rect(Rect2(maxf(end_x, TM.HEADER_W), TM.RULER_H, v.size.x - maxf(end_x, TM.HEADER_W), v.size.y - TM.RULER_H), Color(0, 0, 0, 0.35))
	FD.draw_trails(v, v.tl, v._x, v.size, v.sel_flag)
	# headers
	v.draw_rect(Rect2(0, 0, TM.HEADER_W, v.size.y), Color("#161b22"))
	for i in layers.size():
		var y := TM.track_top(v.tl, i, v.scroll_y)
		if y + TM.layer_h(v.tl, i) < TM.RULER_H or y > v.size.y:
			continue
		if i == v.sel_layer:
			v.draw_rect(Rect2(0, y, TM.HEADER_W - 1, TM.layer_h(v.tl, i) - 1), Color("#1f2a37"))
		v.draw_string(font, Vector2(8, y + 18), str(layers[i].get("name", "Layer %d" % (i + 1))), HORIZONTAL_ALIGNMENT_LEFT, TM.HEADER_W - 12, 12, ThemeBuilder.TEXT)
		v.draw_rect(Rect2(0, y + TM.layer_h(v.tl, i) - 1, TM.HEADER_W, 1), Color("#21262d"))
	v.draw_rect(Rect2(TM.HEADER_W - 1, 0, 1, v.size.y), Color("#30363d"))
	_ruler(v, font, dur, fps)
	FD.draw_markers(v, v.tl, v._x, v.size.x, v.sel_flag, font)
	# playhead
	var px := roundf(v._x(v.playhead_ms)) + 0.5
	if px >= TM.HEADER_W:
		v.draw_line(Vector2(px, TM.RULER_H), Vector2(px, v.size.y), ThemeBuilder.ERROR, 1.0)
		v.draw_colored_polygon(PackedVector2Array([Vector2(px - 6, 0), Vector2(px + 6, 0), Vector2(px, 12)]), ThemeBuilder.ERROR)


static func _ruler(v: Control, font: Font, dur: float, fps: int) -> void:
	v.draw_rect(Rect2(TM.HEADER_W, 0, v.size.x - TM.HEADER_W, TM.RULER_H), Color("#161b22"))
	v.draw_rect(Rect2(TM.HEADER_W, TM.RULER_H - 1, v.size.x - TM.HEADER_W, 1), Color("#30363d"))
	var interval := TM.ruler_interval(v.px_per_ms)
	var end_ms: float = v.scroll_x + (v.size.x - TM.HEADER_W) / v.px_per_ms
	var t := ceilf(v.scroll_x / interval) * interval
	while t <= minf(end_ms, dur + interval):
		var x: float = v._x(t)
		v.draw_rect(Rect2(x, 0, 1, TM.RULER_H), Color("#21262d"))
		v.draw_rect(Rect2(x, TM.RULER_H - 6, 1, 6), Color("#58a6ff"))
		v.draw_string(font, Vector2(x + 3, TM.RULER_H - 9), TM.fmt_timecode(t, fps), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, ThemeBuilder.TEXT_MUTED)
		t += interval
	var sub := interval / 5.0
	if sub * v.px_per_ms >= 5.0:
		var s := ceilf(v.scroll_x / sub) * sub
		while s <= end_ms:
			if fmod(s, interval) >= 1.0:
				v.draw_rect(Rect2(v._x(s), TM.RULER_H - 4, 1, 4), Color("#30363d"))
			s += sub


static func _clip(v: Control, c: Dictionary, li: int, track_y: float, track_h: int, font: Font) -> void:
	if not (c.get("source") is Dictionary) or str(c.source.get("value", "")) == "":
		return
	var x: float = v._x(float(c.get("startTime", 0)))
	var w := maxf(3.0, float(c.get("duration", 0)) * v.px_per_ms)
	var top := maxf(track_y + 4, TM.RULER_H)
	var bottom := minf(track_y + track_h - 4, v.size.y)
	var h := bottom - top
	if x + w < TM.HEADER_W + 1 or x > v.size.x or h < 4:
		return
	var col := Color(TM.CLIP_PALETTE[li % TM.CLIP_PALETTE.size()])
	var r := Rect2(x, top, w, h)
	v.draw_style_box(_box(col), r)
	if li == v.sel_li and str(c.get("id", "")) == v.sel_id:
		v.draw_rect(r.grow(-1), Color.WHITE, false, 2.0)
	var label := str(c.source.get("label", c.source.value)).get_file()
	var lx := maxf(x, TM.HEADER_W + 1) + 5
	var avail := minf(x + w, v.size.x) - lx - 4
	if avail > 12 and h >= 14:
		v.draw_string(font, Vector2(lx, top + 13), label, HORIZONTAL_ALIGNMENT_LEFT, avail, 11, Color(1, 1, 1, 0.92))
	KD.draw(v, c, top, h, v._x, TM.HEADER_W, v.size.x, v.sel_kf, v._drag.has("kf"))


static func _box(col: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(3)
	return sb
