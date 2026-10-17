extends Control
## WO-595 Scene A "canvas": the operator channel drawn full-window (today's monitor-shaped layout)
## with UI drawn OVER the video — the thing X SHAPE holes can never do: tally border, labels,
## a translucent bar, and a NO SIGNAL overlay when the writer stops.

var _video: TextureRect
var _tally: Panel
var _no_signal: Label
var _t := 0.0


func setup(tex: Texture2D) -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bg := ColorRect.new()
	bg.color = Color(0.05, 0.07, 0.09)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	_video = TextureRect.new()
	_video.texture = tex
	_video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_video.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_video.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var premult := CanvasItemMaterial.new()
	premult.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA  # Caspar frames are premultiplied
	_video.material = premult
	add_child(_video)

	# Tally border over the left half ("PGM" tile in today's layout), pulsing.
	_tally = Panel.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0)
	sb.border_color = Color(0.95, 0.15, 0.15)
	sb.set_border_width_all(6)
	_tally.add_theme_stylebox_override("panel", sb)
	_tally.anchor_left = 0.0
	_tally.anchor_top = 0.0
	_tally.anchor_right = 0.5
	_tally.anchor_bottom = 0.5
	add_child(_tally)
	_add_label("PGM · ON AIR", Vector2(0.01, 0.46), Color(1, 0.3, 0.3))
	_add_label("PRV", Vector2(0.51, 0.46), Color(0.4, 1, 0.5))

	var bar := PanelContainer.new()
	var bar_sb := StyleBoxFlat.new()
	bar_sb.bg_color = Color(0.05, 0.07, 0.09, 0.72)
	bar_sb.set_content_margin_all(10)
	bar.add_theme_stylebox_override("panel", bar_sb)
	bar.anchor_left = 0.2
	bar.anchor_right = 0.8
	bar.anchor_top = 0.9
	bar.anchor_bottom = 0.97
	add_child(bar)
	var bar_label := Label.new()
	bar_label.text = "UI drawn OVER live video in one scene — no X SHAPE holes, no xdotool, no top-assert"
	bar_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	bar.add_child(bar_label)

	_no_signal = Label.new()
	_no_signal.text = "NO SIGNAL"
	_no_signal.add_theme_font_size_override("font_size", 64)
	_no_signal.add_theme_color_override("font_color", Color(1, 0.8, 0.2))
	_no_signal.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_no_signal.visible = false
	add_child(_no_signal)


func tick(delta: float, reader) -> void:
	_t += delta
	_tally.modulate.a = 0.6 + 0.4 * sin(_t * 4.0)
	_no_signal.visible = reader.signal_lost
	_video.modulate = Color(0.4, 0.4, 0.4) if reader.signal_lost else Color(1, 1, 1)


func _add_label(text: String, anchor: Vector2, color: Color) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 22)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", 6)
	l.anchor_left = anchor.x
	l.anchor_top = anchor.y
	add_child(l)
