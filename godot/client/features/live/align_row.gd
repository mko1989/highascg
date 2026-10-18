extends HBoxContainer
## The seven align buttons of the web inspectors (inspector-fill.js appendLayerAlignButtons). The web artwork is a
## mix of plain and PNG-embedding SVGs; these are drawn instead — same glyph idea (guide line + bars), theme coloured.

signal align(mode: String)

const P := preload("res://features/live/px_rect_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	for mode in P.ALIGN_MODES:
		var b := Button.new()
		b.custom_minimum_size = Vector2(32, 30)
		b.tooltip_text = P.ALIGN_TITLES[mode]
		var icon := _Icon.new()
		icon.mode = mode
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		icon.set_anchors_preset(Control.PRESET_FULL_RECT)
		b.add_child(icon)
		b.pressed.connect(func() -> void: align.emit(mode))
		add_child(b)


class _Icon extends Control:
	var mode := ""

	func _draw() -> void:
		var c := ThemeBuilder.TEXT
		var o := (size - Vector2(18, 18)) / 2.0  # an 18 px glyph box, centred
		var guide := func(a: Vector2, b: Vector2) -> void: draw_line(o + a, o + b, c, 1.5)
		var bar := func(r: Rect2) -> void: draw_rect(Rect2(o + r.position, r.size), c, false, 1.5)
		match mode:
			"left":
				guide.call(Vector2(1, 0), Vector2(1, 18))
				bar.call(Rect2(4, 3, 12, 4))
				bar.call(Rect2(4, 11, 7, 4))
			"right":
				guide.call(Vector2(17, 0), Vector2(17, 18))
				bar.call(Rect2(2, 3, 12, 4))
				bar.call(Rect2(7, 11, 7, 4))
			"top":
				guide.call(Vector2(0, 1), Vector2(18, 1))
				bar.call(Rect2(3, 4, 4, 12))
				bar.call(Rect2(11, 4, 4, 7))
			"bottom":
				guide.call(Vector2(0, 17), Vector2(18, 17))
				bar.call(Rect2(3, 2, 4, 12))
				bar.call(Rect2(11, 7, 4, 7))
			"center-h":
				guide.call(Vector2(9, 0), Vector2(9, 18))
				bar.call(Rect2(1, 3, 5, 12))
				bar.call(Rect2(12, 3, 5, 12))
			"center-v":
				guide.call(Vector2(0, 9), Vector2(18, 9))
				bar.call(Rect2(3, 1, 12, 5))
				bar.call(Rect2(3, 12, 12, 5))
			"center":
				bar.call(Rect2(4, 4, 10, 10))
				guide.call(Vector2(9, 0), Vector2(9, 18))
				guide.call(Vector2(0, 9), Vector2(18, 9))
