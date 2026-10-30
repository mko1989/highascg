extends RefCounted
## WO-602 — the timeline canvas painting (moved out of timeline_view.gd in slice 6 for the 500-line limit; the code is
## unchanged): tracks + clips (with keyframes), the past-the-end shade, flag trails, layer headers (the selected one
## lit), the ruler with nice ticks, flag markers and the playhead.

const TM := preload("res://features/timeline/timeline_math.gd")
const KD := preload("res://features/timeline/timeline_kf_draw.gd")
const FD := preload("res://features/timeline/timeline_flag_draw.gd")
const LD := preload("res://features/timeline/timeline_lane_draw.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")
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
	var lane: Dictionary = v.lane()
	var vp: Dictionary = v.vp()
	v.scroll_y = clampf(v.scroll_y, 0.0, float(vp.max_scroll))
	var rows := RW.rows(v.tl)
	var bottom: float = vp.layers_bottom
	v.layers_bottom = bottom  # the clips and keyframes clip to it (the pinned lane covers the rest)
	# tracks (WO-837: in section order, a divider row per screen)
	for r in rows:
		var y: float = TM.RULER_H - v.scroll_y + float(r.y)
		var h := float(r.h)
		if y + h < TM.RULER_H or y > bottom:
			continue
		if r.kind == "divider":
			v.draw_rect(Rect2(TM.HEADER_W, y, v.size.x - TM.HEADER_W, h), Color("#1b2230"))
			continue
		var i: int = r.li
		v.draw_rect(Rect2(TM.HEADER_W, y, v.size.x - TM.HEADER_W, h), Color("#0d1117") if i % 2 == 0 else Color("#10151c"))
		v.draw_rect(Rect2(TM.HEADER_W, y + h - 1, v.size.x - TM.HEADER_W, 1), Color("#21262d"))
		for c in layers[i].get("clips", []):
			_clip(v, c, i, y, int(h), font)
	# past-the-end shade
	var end_x: float = v._x(dur)
	if end_x < v.size.x:
		v.draw_rect(Rect2(maxf(end_x, TM.HEADER_W), TM.RULER_H, v.size.x - maxf(end_x, TM.HEADER_W), v.size.y - TM.RULER_H), Color(0, 0, 0, 0.35))
	FD.draw_trails(v, v.tl, v._x, Vector2(v.size.x, vp.lane_top), v.sel_flag)
	# headers
	v.draw_rect(Rect2(0, 0, TM.HEADER_W, v.size.y), Color("#161b22"))
	var names: Dictionary = v.screen_names
	for r in rows:
		var y: float = TM.RULER_H - v.scroll_y + float(r.y)
		var h := float(r.h)
		if y + h < TM.RULER_H or y > bottom:
			continue
		if r.kind == "divider":
			_divider(v, r, y, font, names)
			continue
		var i: int = r.li
		if i == v.sel_layer:
			v.draw_rect(Rect2(0, y, TM.HEADER_W - 1, h - 1), Color("#1f2a37"))
		v.draw_string(font, Vector2(8, y + 18), str(layers[i].get("name", "Layer %d" % (i + 1))), HORIZONTAL_ALIGNMENT_LEFT, TM.HEADER_W - 12, 12, ThemeBuilder.TEXT)
		v.draw_rect(Rect2(0, y + h - 1, TM.HEADER_W, 1), Color("#21262d"))
	v.draw_rect(Rect2(TM.HEADER_W - 1, 0, 1, v.size.y), Color("#30363d"))
	_ruler(v, font, dur, fps)
	FD.draw_markers(v, v.tl, v._x, v.size.x, v.sel_flag, font)
	_screen_button(v, font)
	LD.draw(v, vp, lane, font)
	_scrollbar(v, vp)
	# playhead
	var px := roundf(v._x(v.playhead_ms)) + 0.5
	if px >= TM.HEADER_W:
		v.draw_line(Vector2(px, TM.RULER_H), Vector2(px, v.size.y), ThemeBuilder.ERROR, 1.0)
		v.draw_colored_polygon(PackedVector2Array([Vector2(px - 6, 0), Vector2(px + 6, 0), Vector2(px, 12)]), ThemeBuilder.ERROR)


## A screen section's divider row: the screen's name in the header column, "+" (a new layer in it) and, while the
## section is empty, "x" (drop it). The band across the tracks was drawn with the tracks.
static func _divider(v: Control, r: Dictionary, y: float, font: Font, names: Dictionary) -> void:
	var h := float(r.h)
	v.draw_rect(Rect2(0, y, TM.HEADER_W - 1, h), Color("#1b2230"))
	v.draw_rect(Rect2(0, y + h - 1, v.size.x, 1), Color("#30363d"))
	v.draw_rect(Rect2(0, y, 3, h), ThemeBuilder.ACCENT)
	var room := TM.HEADER_W - 12.0 - (RW.BTN_W if r.screen == RW.ALL else 2 * RW.BTN_W)
	v.draw_string(font, Vector2(9, y + 16), RW.screen_label(names, int(r.screen)), HORIZONTAL_ALIGNMENT_LEFT, room, 11, ThemeBuilder.ACCENT)
	var bx := TM.HEADER_W - 2 * RW.BTN_W - 4
	v.draw_string(font, Vector2(bx, y + 17), "+", HORIZONTAL_ALIGNMENT_CENTER, RW.BTN_W, 14, ThemeBuilder.TEXT)
	if r.screen != RW.ALL and RW.section_empty(v.tl, int(r.screen)):
		v.draw_string(font, Vector2(bx + RW.BTN_W, y + 16), "×", HORIZONTAL_ALIGNMENT_CENTER, RW.BTN_W, 13, ThemeBuilder.TEXT_MUTED)


## "+ Screen" in the corner above the layer list (the ruler's left cell).
static func _screen_button(v: Control, font: Font) -> void:
	var r := Rect2(6, 4, TM.HEADER_W - 13, TM.RULER_H - 8)
	v.draw_rect(r, Color("#21262d"))
	v.draw_rect(r, Color("#30363d"), false, 1.0)
	v.draw_string(font, Vector2(r.position.x, r.get_center().y + 4), "+ Screen", HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 11, ThemeBuilder.TEXT)


## The vertical scrollbar on the right edge, only while the layers scroll.
static func _scrollbar(v: Control, vp: Dictionary) -> void:
	var th := RW.thumb(vp, float(RW.content_h(v.tl)), v.scroll_y)
	if not th.is_empty():
		v.draw_rect(Rect2(v.size.x - RW.SCROLLBAR_W, th[0], RW.SCROLLBAR_W, th[1]), Color(1, 1, 1, 0.25))


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
	var bottom := minf(track_y + track_h - 4, float(v.layers_bottom))
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
