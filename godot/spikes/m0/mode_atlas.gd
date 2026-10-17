extends Control
## WO-595 Scene B "atlas": four tiles sample the four quadrants of ONE shm texture (one upload per
## frame) and are placed freely by the client. Tile 1 is draggable; tiles 2–4 move and resize
## continuously. Nothing here talks to Caspar — moving a preview costs zero AMCP (WO-597 §D).

const NAMES := ["PGM 1", "PRV 1", "INPUT 4", "MEDIA"]

var _tex: Texture2D
var _tiles: Array[Control] = []
var _atlas: Array[AtlasTexture] = []
var _dragging := false
var _drag_offset := Vector2.ZERO
var _t := 0.0
var _last_size := Vector2i.ZERO


func setup(tex: Texture2D) -> void:
	_tex = tex
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color(0.08, 0.09, 0.11)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	for i in 4:
		var at := AtlasTexture.new()
		at.atlas = tex
		_atlas.append(at)
		var tile := _make_tile(at, NAMES[i], i == 0)
		add_child(tile)
		_tiles.append(tile)
	_tiles[0].position = Vector2(60, 140)
	_tiles[0].size = Vector2(640, 360)


func tick(delta: float, reader) -> void:
	_t += delta
	var sz := Vector2i(reader.width, reader.height)
	if sz != _last_size and sz.x > 0:
		_last_size = sz
		var hw := sz.x / 2.0
		var hh := sz.y / 2.0
		_atlas[0].region = Rect2(0, 0, hw, hh)
		_atlas[1].region = Rect2(hw, 0, hw, hh)
		_atlas[2].region = Rect2(0, hh, hw, hh)
		_atlas[3].region = Rect2(hw, hh, hw, hh)
	var view := get_viewport_rect().size
	for i in range(1, 4):
		var phase := _t * (0.35 + 0.15 * i) + i * 2.1
		var w := 260.0 + 140.0 * (0.5 + 0.5 * sin(phase * 1.3))
		_tiles[i].size = Vector2(w, w * 9.0 / 16.0)
		_tiles[i].position = Vector2(
			view.x * (0.55 + 0.3 * sin(phase)) - w / 2.0,
			view.y * (0.5 + 0.3 * cos(phase * 0.8)) - w * 9.0 / 32.0)
	for tile in _tiles:
		tile.get_node("NoSignal").visible = reader.signal_lost


func _make_tile(at: AtlasTexture, title: String, draggable: bool) -> Control:
	var tile := Panel.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0)
	sb.border_color = Color(0.35, 0.65, 1.0) if draggable else Color(0.3, 0.33, 0.38)
	sb.set_border_width_all(3)
	tile.add_theme_stylebox_override("panel", sb)
	tile.size = Vector2(400, 225)
	var video := TextureRect.new()
	video.texture = at
	video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	video.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	video.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	video.offset_left = 3
	video.offset_top = 3
	video.offset_right = -3
	video.offset_bottom = -3
	video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.add_child(video)
	var label := Label.new()
	label.text = title + ("  (drag me)" if draggable else "")
	label.position = Vector2(10, 6)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 5)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.add_child(label)
	var lost := Label.new()
	lost.name = "NoSignal"
	lost.text = "NO SIGNAL"
	lost.add_theme_color_override("font_color", Color(1, 0.8, 0.2))
	lost.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	lost.visible = false
	lost.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.add_child(lost)
	if draggable:
		tile.gui_input.connect(_on_drag_input.bind(tile))
	else:
		tile.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tile


func _on_drag_input(event: InputEvent, tile: Control) -> void:
	var mb := event as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
		_dragging = mb.pressed
		_drag_offset = tile.get_global_mouse_position() - tile.global_position
	var mm := event as InputEventMouseMotion
	if mm != null and _dragging:
		tile.global_position = tile.get_global_mouse_position() - _drag_offset
