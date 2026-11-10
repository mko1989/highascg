extends RefCounted
## WO-1029 plan 07 (C15) — a Live compose tile (PGM / PRV window) whose screen is output by another linked server:
## no picture exists here (the relay is a later step), so the window is a quiet labelled placeholder.

const RC := preload("res://features/live/remote_cue.gd")
const SC := preload("res://core/screen_channels.gd")


static func is_remote(c: Dictionary) -> bool:
	return str(c.get("role", "")) in ["pgm", "prv"] and not SC.is_here(Store.get_value("channelMap", {}), int(c.get("mainIndex", 0)))


## Fills `r` on `node` and writes the cue lines in it; PRV tiles show only the cue + the PRV look.
static func draw(node: Control, r: Rect2, c: Dictionary, font: Font) -> void:
	node.draw_rect(r, Color(0.07, 0.08, 0.1, 0.92))
	var l: Array = RC.lines(Store.get_value("channelMap", {}), Store.cluster, Store.get_value("scene", {}), int(c.get("mainIndex", 0)))
	var y := r.position.y + 6.0
	for i in l.size():
		var tl := TextLine.new()
		tl.add_string(str(l[i]), font, 13 if i == 0 else 11)
		tl.width = maxf(0.0, r.size.x - 12.0)
		tl.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		if y + tl.get_size().y > r.end.y:
			return
		tl.draw(node.get_canvas_item(), Vector2(r.position.x + 6.0, y), Color(0.75, 0.78, 0.82, 0.9 if i == 0 else 0.7))
		y += tl.get_size().y + 3.0
