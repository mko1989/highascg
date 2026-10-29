extends Control
## WO-604 — vertical VU bars drawn per frame (web audio-mixer-view__meter-vertical / bus-meter-bank). One bar for a
## layer / input strip, one per program bus channel on a master (numbered 1…n above the bars).
## WO-800: a layer strip's bank also holds a thin lane on the right — that layer's own level (layer_levels.gd); the lane
## is drawn only while the layer carries audio (lane < 0 = nothing at all, no empty bar).

const OK := Color("#22c55e")  # the console's peakNormalColor / peakClipColor
const CLIP := Color("#ef4444")
const BG := Color("#0d1117")
const EDGE := Color("#30363d")
const LANE_W := 3.0
const LANE_GAP := 1.0

var levels := PackedFloat32Array([0.0])  # smoothed 0…1 per bar
var colours: Array[String] = [""]  # "" | "ok" | "clip"
var lane_on := false  # WO-800: space for the layer lane is reserved (single-bar banks only)
var lane := -1.0  # the layer's smoothed 0…1; < 0 = no audio on the layer → not drawn
var lane_colour := ""
var _font: Font


func _ready() -> void:
	_font = get_theme_default_font()
	mouse_filter = Control.MOUSE_FILTER_PASS if tooltip_text != "" else Control.MOUSE_FILTER_IGNORE


func set_count(n: int) -> void:
	levels.resize(maxi(1, n))
	levels.fill(0.0)
	colours.resize(maxi(1, n))
	colours.fill("")
	custom_minimum_size.x = maxf(10.0, 9.0 * levels.size())
	queue_redraw()


## A layer strip: reserve the lane (the bank keeps its width; the bus bar gives up LANE_W + LANE_GAP).
func enable_lane() -> void:
	lane_on = levels.size() == 1
	queue_redraw()


func set_lane(s: float, colour: String) -> void:
	if not lane_on or (is_equal_approx(lane, s) and lane_colour == colour):
		return
	lane = s
	lane_colour = colour
	queue_redraw()


func set_bar(i: int, s: float, colour: String) -> void:
	if i >= levels.size() or (is_equal_approx(levels[i], s) and colours[i] == colour):
		return
	levels[i] = s
	colours[i] = colour
	queue_redraw()


func _draw() -> void:
	var n := levels.size()
	var top := 12.0 if n > 1 else 0.0
	var gap := 2.0
	var lane_x := size.x - LANE_W
	var w := ((lane_x - LANE_GAP if lane_on else size.x) - gap * (n - 1)) / n
	var h := size.y - top
	for i in n:
		var x := i * (w + gap)
		draw_rect(Rect2(x, top, w, h), BG)
		draw_rect(Rect2(x, top, w, h), EDGE, false, 1.0)
		var fill := clampf(levels[i], 0.0, 1.0) * (h - 2)
		if fill > 0.5 and colours[i] != "":
			draw_rect(Rect2(x + 1, top + h - 1 - fill, w - 2, fill), CLIP if colours[i] == "clip" else OK)
		if n > 1 and _font:
			draw_string(_font, Vector2(x, 9), str(i + 1), HORIZONTAL_ALIGNMENT_CENTER, w, 9, Color("#8b949e"))
	if lane_on and lane >= 0.0:
		draw_rect(Rect2(lane_x, 0, LANE_W, size.y), BG)
		var lf := clampf(lane, 0.0, 1.0) * size.y
		if lf > 0.5 and lane_colour != "":
			draw_rect(Rect2(lane_x, size.y - lf, LANE_W, lf), CLIP if lane_colour == "clip" else OK)
