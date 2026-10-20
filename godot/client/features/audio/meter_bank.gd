extends Control
## WO-604 — vertical VU bars drawn per frame (web audio-mixer-view__meter-vertical / bus-meter-bank). One bar for a
## layer / input strip, one per program bus channel on a master (numbered 1…n above the bars).

const OK := Color("#22c55e")  # the console's peakNormalColor / peakClipColor
const CLIP := Color("#ef4444")
const BG := Color("#0d1117")
const EDGE := Color("#30363d")

var levels := PackedFloat32Array([0.0])  # smoothed 0…1 per bar
var colours: Array[String] = [""]  # "" | "ok" | "clip"
var _font: Font


func _ready() -> void:
	_font = get_theme_default_font()
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_count(n: int) -> void:
	levels.resize(maxi(1, n))
	levels.fill(0.0)
	colours.resize(maxi(1, n))
	colours.fill("")
	custom_minimum_size.x = maxf(10.0, 9.0 * levels.size())
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
	var w := (size.x - gap * (n - 1)) / n
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
