extends Control
## WO-605 slice 1 — one connector on the Devices tab: a rear-panel socket drawn from the web's port SVG
## (assets/devices/, rasterised at runtime — no import step), or a plain dot (screen-destination outputs).
## Its centre is the cable anchor; `active` rings it (hovered / selected cable); `target` tints it during a cable
## gesture like the web's --cable-armed / --connector-target-valid / -invalid classes.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const DIR := "res://assets/devices/"
const TINT := {"armed": Color("#f59e0b"), "valid": Color("#22c55e"), "invalid": Color("#ef4444")}

static var _cache := {}

var icon := ""  # SVG basename, "" = dot
var dot_color := ThemeBuilder.TEXT_MUTED
var active := false:
	set(v):
		active = v
		queue_redraw()
var target := "":  # "" | armed | valid | invalid
	set(v):
		if target != v:
			target = v
			queue_redraw()


static func make(svg: String, size: Vector2, tip: String) -> Control:
	var p: Control = (load("res://features/devices/port_icon.gd") as GDScript).new()
	p.icon = svg
	p.custom_minimum_size = size
	p.tooltip_text = tip
	p.mouse_filter = Control.MOUSE_FILTER_PASS
	return p


## The SVG rasterised to fit `h` px tall (cached per name + height).
static func texture(svg: String, h: int) -> Texture2D:
	var key := "%s@%d" % [svg, h]
	if _cache.has(key):
		return _cache[key]
	var bytes := FileAccess.get_file_as_bytes(DIR + svg + ".svg")
	var tex: Texture2D = null
	var img := Image.new()
	if not bytes.is_empty() and img.load_svg_from_buffer(bytes, 1.0) == OK and img.get_height() > 0:
		var scale := float(h) / img.get_height()
		if img.load_svg_from_buffer(bytes, scale) == OK:
			tex = ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


## Cable anchor in global coordinates.
func anchor() -> Vector2:
	return get_global_rect().get_center()


func _draw() -> void:
	var c := size / 2.0
	var tint: Color = TINT.get(target, Color.TRANSPARENT)
	if icon == "":
		var r := minf(size.x, size.y) / 2.0 - 1.0
		draw_circle(c, r, ThemeBuilder.BG_DARK if target != "valid" and target != "invalid" else tint)
		draw_arc(c, r, 0.0, TAU, 24, tint if target != "" else ThemeBuilder.ACCENT if active else dot_color, 1.5, true)
		if target != "":
			draw_arc(c, r + 2.0, 0.0, TAU, 24, Color(tint, 0.4), 2.0, true)
		return
	var tex := texture(icon, int(size.y * 0.8))
	if tex:
		var ts := tex.get_size()
		if ts.x > size.x:
			ts *= size.x / ts.x
		draw_texture_rect(tex, Rect2(c - ts / 2.0, ts), false)
	if target != "":
		draw_rect(Rect2(Vector2.ZERO, size), Color(tint, 0.18))
		draw_rect(Rect2(Vector2.ONE, size - Vector2(2, 2)), tint, false, 2.0)
	elif active:
		draw_rect(Rect2(Vector2.ONE, size - Vector2(2, 2)), ThemeBuilder.ACCENT, false, 1.5)
