extends Control
## WO-608 R5 — a look deck card's thumbnail (web scenes-editor-deck-thumb.js, idle mode): the look composited from
## each layer's source thumbnail at its FILL rect (look_thumb_math.gd), at the screen's aspect, opacity and rotation
## honoured. Thumbnails are fetched once per URL and shared by every card (the deck rebuilds its cards on each change).
## Sources without a static thumbnail (templates, buses, NDI…) get a dim box with their name, like the web.

const TM := preload("res://features/live/look_thumb_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

static var _cache := {}    # path → Texture2D, or null when the fetch failed
static var _waiters := {}  # path → Array[Callable] while the fetch runs

var look: Dictionary = {}
var aspect := 16.0 / 9.0
var cm: Dictionary = {}


func setup(look_: Dictionary, res: Vector2, cm_: Dictionary) -> void:
	look = look_
	cm = cm_
	if res.x > 0 and res.y > 0:
		aspect = res.x / res.y
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip_contents = true
	resized.connect(func() -> void: custom_minimum_size.y = roundf(size.x / aspect))
	custom_minimum_size.y = roundf(TM.CARD_W / 2.0 / aspect)
	refresh(look)


## A new state of the same look (WO-860: the look editor's thumbnail backdrop follows the edits).
func refresh(look_: Dictionary) -> void:
	look = look_
	for l in TM.sorted_layers(look):
		var p := TM.thumb_path(l.get("source"), cm)
		if p != "" and not _cache.has(p):
			_fetch(p, queue_redraw)
	queue_redraw()


static func _fetch(path: String, cb: Callable) -> void:
	if _waiters.has(path):
		(_waiters[path] as Array).append(cb)
		return
	_waiters[path] = [cb]
	var r: Dictionary = await Api.get_bytes(path)
	_cache[path] = decode(r.bytes) if r.ok else null
	for c in _waiters[path]:
		if (c as Callable).is_valid():
			(c as Callable).call()
	_waiters.erase(path)


static func decode(b: PackedByteArray) -> Texture2D:
	var img := Image.new()
	var err := ERR_FILE_UNRECOGNIZED
	if b.size() > 8 and b[0] == 0x89 and b[1] == 0x50:
		err = img.load_png_from_buffer(b)
	elif b.size() > 3 and b[0] == 0xFF and b[1] == 0xD8:
		err = img.load_jpg_from_buffer(b)
	elif b.size() > 12 and b.slice(8, 12).get_string_from_ascii() == "WEBP":
		err = img.load_webp_from_buffer(b)
	return ImageTexture.create_from_image(img) if err == OK else null


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color("#0d1117"))
	var layers := TM.sorted_layers(look)
	if layers.is_empty():
		draw_string(get_theme_default_font(), Vector2(8, size.y / 2.0 + 5), "Empty look", HORIZONTAL_ALIGNMENT_LEFT, size.x - 16, 12, ThemeBuilder.TEXT_MUTED)
		return
	for l in layers:
		var op := clampf(float(l.get("opacity", 1.0)) if l.get("opacity") != null else 1.0, 0.0, 1.0)
		var box := TM.fill_rect(l, size)
		var rot := deg_to_rad(float(l.get("rotation", 0)) if l.get("rotation") != null else 0.0)
		if rot != 0.0:
			var c := box.get_center()
			draw_set_transform_matrix(Transform2D(rot, c) * Transform2D(0.0, -c))
		var p := TM.thumb_path(l.get("source"), cm)
		var has_src: bool = l.get("source") is Dictionary and str(l.source.get("value", "")) != ""
		var tex: Texture2D = _cache.get(p) if p != "" else null
		if tex != null:
			var at := TM.placement(l, size, tex.get_size())
			if not at.is_empty():
				draw_texture_rect_region(tex, at.dst, at.src, Color(1, 1, 1, op))
		elif has_src:
			var vis := TM.visible_rect(l, size).intersection(Rect2(Vector2.ZERO, size))
			draw_rect(vis, Color(0.086, 0.106, 0.133, 0.45 * op))
			var label := "Loading…" if p != "" and not _cache.has(p) else ("No preview" if p != "" else str(l.source.get("label", l.source.value)).get_file())
			draw_string(get_theme_default_font(), vis.position + Vector2(6, minf(vis.size.y / 2.0 + 5, 18)), label, HORIZONTAL_ALIGNMENT_LEFT, maxf(vis.size.x - 12, 1), 11, ThemeBuilder.TEXT_MUTED)
		draw_set_transform_matrix(Transform2D.IDENTITY)
