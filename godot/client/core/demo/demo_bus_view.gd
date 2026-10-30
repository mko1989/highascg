extends Control
## WO-865 — draws a demo bus's items (demo_bus.gd frame) with the GPU: a pool of TextureRects with demo_shader.gd, bottom →
## top. Sized in bus pixels; a window of the operator surface scales / clips this control to its picture rect, the bus's own
## SubViewport shows it 1:1. The stage supplies the video textures of real clips (`stage.video_texture(item)`); without
## one (tests) a clip draws its still.

const DemoShader := preload("res://core/demo/demo_shader.gd")
const Media := preload("res://core/demo/demo_media.gd")

static var _textures := {}  # media id → ImageTexture of its generated still

var stage: Node = null
var shown := 0  ## items drawn by the last apply()
var _nodes: Array[TextureRect] = []


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


static func still_texture(media_id: String) -> Texture2D:
	if not _textures.has(media_id):
		var img := Media.thumb_image(media_id)
		_textures[media_id] = ImageTexture.create_from_image(img) if img != null else null
	return _textures[media_id]


## The pool after `items`: node i draws item i; the surplus hides.
func apply(items: Array) -> void:
	while _nodes.size() < items.size():
		var n := TextureRect.new()
		n.mouse_filter = Control.MOUSE_FILTER_IGNORE
		n.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		n.stretch_mode = TextureRect.STRETCH_SCALE
		var m := ShaderMaterial.new()
		m.shader = DemoShader.shader()
		n.material = m
		add_child(n)
		_nodes.append(n)
	for i in _nodes.size():
		_nodes[i].visible = i < items.size()
		if i < items.size():
			_apply_item(_nodes[i], items[i])
	shown = items.size()


func node_at(i: int) -> TextureRect:
	return _nodes[i]


func _apply_item(n: TextureRect, it: Dictionary) -> void:
	var d: Rect2 = it.dst
	var tex: Texture2D = stage.video_texture(it) if stage != null and str(it.kind) == "stream" else null
	n.texture = tex if tex != null else still_texture(str(it.media))
	n.position = d.position
	n.size = d.size
	n.pivot_offset = d.size / 2.0
	n.rotation_degrees = float(it.rotation)
	var m := n.material as ShaderMaterial
	var uv: Rect2 = it.uv
	m.set_shader_parameter("uv_rect", Vector4(uv.position.x, uv.position.y, uv.size.x, uv.size.y))
	m.set_shader_parameter("alpha", float(it.alpha))
	m.set_shader_parameter("motion", 1.0 if str(it.kind) == "video" else 0.0)
	m.set_shader_parameter("t", minf(float(it.t), float(it.dur)) if bool(it.ended) else float(it.t))
	m.set_shader_parameter("seed", float(it.seed))
	var c: Rect2 = it.clip
	m.set_shader_parameter("clipped", c.size.x > 0.0)
	if c.size.x > 0.0:
		var lo := (c.position - d.position) / d.size
		var hi := (c.end - d.position) / d.size
		m.set_shader_parameter("clip", Vector4(lo.x, lo.y, hi.x, hi.y))
