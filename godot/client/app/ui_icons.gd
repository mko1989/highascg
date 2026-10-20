extends RefCounted
## WO-621 — button icons from assets/ui/icons/*.svg, rasterised at runtime (no import step), cached per name + size.
## The font (Rewir) has no ⏱ / ⚙ / ▶ glyphs — they rendered blank — so icon buttons use these instead.

const DIR := "res://assets/ui/icons/"

static var _cache := {}


static func texture(name: String, px: int = 16) -> Texture2D:
	var key := "%s@%d" % [name, px]
	if _cache.has(key):
		return _cache[key]
	var bytes := FileAccess.get_file_as_bytes(DIR + name + ".svg")
	var tex: Texture2D = null
	var img := Image.new()
	if not bytes.is_empty() and img.load_svg_from_buffer(bytes, px / 24.0) == OK:
		tex = ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


## A flat-ish icon-only Button with a tooltip.
static func button(name: String, tip: String, px: int = 16) -> Button:
	var b := Button.new()
	b.icon = texture(name, px)
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return b
