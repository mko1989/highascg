extends RefCounted
## WO-837 — the control lane's layout, pure. Control flags (companion_press, light) are chips in a lane at the bottom of
## the timeline. A chip starts at its flag's time and is `w` px wide; chips that would overlap at the current zoom stack
## upward into extra rows (row 0 is the bottom one) and the lane grows by one row per extra row. The packing works on
## absolute px (time x zoom), so scrolling never reshuffles the rows.

const F := preload("res://features/timeline/timeline_flags.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")
const TM := preload("res://features/timeline/timeline_math.gd")

const GAP := 4.0  # free px between two chips of one row
const COMPANION_W := 30.0  # the 28 px button thumbnail + a frame
const MIN_LIGHT_W := 64.0
const MAX_LIGHT_W := 220.0
const CHAR_PX := 6.0  # the light chip's text width estimate per character (10 px font)
const CHIP_H := RW.LANE_ROW_H - 4


## The chip width of a flag whose label is `text`.
static func chip_w(f: Dictionary, text: String) -> float:
	if str(f.get("type", "")) == "companion_press":
		return COMPANION_W
	return clampf(12.0 + text.length() * CHAR_PX, MIN_LIGHT_W, MAX_LIGHT_W)


## The control flags as chips {flag, x (absolute px), w}, in time order. `text_fn(flag) -> String` labels light chips.
static func chips(tl: Dictionary, px_per_ms: float, text_fn: Callable) -> Array:
	var out := []
	for f in F.flags(tl):
		if F.is_control(f):
			out.append({"flag": f, "x": float(f.get("timeMs", 0)) * px_per_ms, "w": chip_w(f, str(text_fn.call(f)))})
	return out


## Row per chip (first-fit from the bottom row), and how many rows the lane needs. Sorted by x; equal x keeps the order.
static func pack(chips_in: Array) -> Dictionary:
	var order := []
	for i in chips_in.size():
		order.append(i)
	order.sort_custom(func(a: int, b: int) -> bool:
		var xa := float(chips_in[a].x)
		var xb := float(chips_in[b].x)
		return xa < xb or (xa == xb and a < b))
	var ends: Array = []  # right edge of the last chip placed in each row
	var rows := []
	rows.resize(chips_in.size())
	for i in order:
		var row := 0
		while row < ends.size() and float(ends[row]) + GAP > float(chips_in[i].x):
			row += 1
		if row == ends.size():
			ends.append(0.0)
		ends[row] = float(chips_in[i].x) + float(chips_in[i].w)
		rows[i] = row
	return {"rows": rows, "count": maxi(1, ends.size())}


## The laid-out lane: {chips: [{flag, x, w, row}], count}.
static func layout(tl: Dictionary, px_per_ms: float, text_fn: Callable) -> Dictionary:
	var cs := chips(tl, px_per_ms, text_fn)
	var p := pack(cs)
	for i in cs.size():
		cs[i]["row"] = p.rows[i]
	return {"chips": cs, "count": p.count}


## A chip on screen: x from the flag's time, row 0 at the bottom of the lane.
static func rect(chip: Dictionary, count: int, lane_top: float, x_at: Callable) -> Rect2:
	var y := lane_top + RW.LANE_PAD + float(count - 1 - int(chip.row)) * RW.LANE_ROW_H
	return Rect2(float(x_at.call(float(chip.flag.get("timeMs", 0)))), y, float(chip.w), CHIP_H)


## The flag whose chip is under `p` (right of the headers, inside the lane), or {}.
static func hit(lane: Dictionary, lane_top: float, p: Vector2, x_at: Callable) -> Dictionary:
	if p.x < TM.HEADER_W or p.y < lane_top or p.y >= lane_top + RW.lane_h(int(lane.count)):
		return {}
	for c in lane.chips:
		if rect(c, int(lane.count), lane_top, x_at).has_point(p):
			return c.flag
	return {}
