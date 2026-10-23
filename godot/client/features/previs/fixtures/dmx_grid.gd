extends Control
## WO-693 — 512 DMX slots as a 32 × 16 grid, drawn in one pass: each cell fills from the bottom with its level and
## shows the value; hover tells channel + value (+ percent). `set_values([])` = nothing to show.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const COLS := 32
const ROWS := 16

var values: Array = []
var _font: Font


func _init() -> void:
	custom_minimum_size = Vector2(COLS * 30, ROWS * 26 + 18)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	mouse_filter = Control.MOUSE_FILTER_STOP
	tooltip_text = " "  # non-empty so _get_tooltip is asked


func set_values(v: Array) -> void:
	if v == values:
		return
	values = v
	queue_redraw()


func _cell() -> Vector2:
	return Vector2((size.x - 34.0) / COLS, (size.y - 18.0) / ROWS)


## The slot under `at` (0-based), or -1.
func slot_at(at: Vector2) -> int:
	var c := _cell()
	var col := int(floor((at.x - 34.0) / c.x))
	var row := int(floor((at.y - 18.0) / c.y))
	return row * COLS + col if col >= 0 and col < COLS and row >= 0 and row < ROWS else -1


func _get_tooltip(at: Vector2) -> String:
	var i := slot_at(at)
	if i < 0:
		return ""
	if i >= values.size():
		return "Ch %d" % (i + 1)
	var v := int(values[i])
	return "Ch %d = %d  (%d %%)" % [i + 1, v, roundi(v * 100.0 / 255.0)]


func _draw() -> void:
	if _font == null:
		_font = get_theme_default_font()
	var fs := 11
	var c := _cell()
	for col in COLS:  # column header: 1..32
		draw_string(_font, Vector2(34.0 + col * c.x, 12), str(col + 1), HORIZONTAL_ALIGNMENT_CENTER, c.x, fs, ThemeBuilder.TEXT_MUTED)
	for row in ROWS:
		var y := 18.0 + row * c.y
		draw_string(_font, Vector2(0, y + c.y * 0.5 + 4), str(row * COLS + 1), HORIZONTAL_ALIGNMENT_RIGHT, 30, fs, ThemeBuilder.TEXT_MUTED)
		for col in COLS:
			var i := row * COLS + col
			var r := Rect2(34.0 + col * c.x + 1, y + 1, c.x - 2, c.y - 2)
			draw_rect(r, Color(1, 1, 1, 0.05))
			if i >= values.size():
				continue
			var v := int(values[i])
			if v > 0:
				var h := r.size.y * v / 255.0
				draw_rect(Rect2(r.position.x, r.end.y - h, r.size.x, h), Color(0.25, 0.6, 1.0, 0.25 + 0.5 * v / 255.0))
			draw_string(_font, Vector2(r.position.x, r.position.y + r.size.y * 0.5 + 4), str(v), HORIZONTAL_ALIGNMENT_CENTER,
				r.size.x, fs, Color.WHITE if v > 0 else ThemeBuilder.TEXT_MUTED)
