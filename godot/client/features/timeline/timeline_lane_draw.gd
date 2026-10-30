extends RefCounted
## WO-837 — painting the control lane (timeline_lane.gd lays it out): the Control header, then a chip per companion_press
## / light flag — the Companion thumbnail chip as the ruler marker was, and a light chip with the console name and the
## action. Chips that overlap at the zoom stack upward. The selected chip is outlined in blue.

const TM := preload("res://features/timeline/timeline_math.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const FD := preload("res://features/timeline/timeline_flag_draw.gd")
const LF := preload("res://features/timeline/timeline_light.gd")
const LN := preload("res://features/timeline/timeline_lane.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


static func draw(v: Control, vp: Dictionary, lane: Dictionary, font: Font) -> void:
	var top: float = vp.lane_top
	var h: float = vp.lane_h
	v.draw_rect(Rect2(0, top, v.size.x, h), Color("#0d1117"))
	v.draw_rect(Rect2(0, top, v.size.x, 1), Color("#30363d"))
	if lane.chips.is_empty():
		v.draw_string(font, Vector2(TM.HEADER_W + 10, top + h / 2.0 + 4), "Companion and light flags go here", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, ThemeBuilder.TEXT_MUTED)
	for c in lane.chips:
		var r := LN.rect(c, int(lane.count), top, v._x)
		if r.end.x < TM.HEADER_W or r.position.x > v.size.x:
			continue
		_chip(v, c.flag, r, str(c.flag.get("id", "")) == v.sel_flag, font)
	v.draw_rect(Rect2(0, top, TM.HEADER_W, h), Color("#161b22"))
	v.draw_string(font, Vector2(8, top + 18), "Control", HORIZONTAL_ALIGNMENT_LEFT, TM.HEADER_W - 12, 12, ThemeBuilder.TEXT)
	v.draw_string(font, Vector2(8, top + 32), "%d flag%s" % [lane.chips.size(), "" if lane.chips.size() == 1 else "s"], HORIZONTAL_ALIGNMENT_LEFT, TM.HEADER_W - 12, 10, ThemeBuilder.TEXT_MUTED)
	v.draw_rect(Rect2(TM.HEADER_W - 1, top, 1, h), Color("#30363d"))


static func _chip(v: Control, f: Dictionary, r: Rect2, on: bool, font: Font) -> void:
	if str(f.get("type", "")) == "companion_press":
		FD.companion_chip(v, r, f, on, font)
		return
	var col := F.color("light")
	var bad := LF.problem(f) != ""
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("#10343a") if not bad else Color("#3a1d1d")
	sb.border_color = FD.SEL if on else (col if not bad else ThemeBuilder.ERROR)
	sb.set_border_width_all(2 if on else 1)
	sb.set_corner_radius_all(3)
	v.draw_style_box(sb, r)
	v.draw_rect(Rect2(r.position.x, r.position.y, 3, r.size.y), col)
	var clip_l := maxf(r.position.x + 7, TM.HEADER_W + 2)  # a chip scrolled partly under the headers keeps its text readable
	v.draw_string(font, Vector2(clip_l, r.position.y + r.size.y / 2.0 + 4), LF.chip_text(f), HORIZONTAL_ALIGNMENT_LEFT, maxf(0.0, r.end.x - clip_l - 4), 10, Color(1, 1, 1, 0.92))

