extends RefCounted
## WO-950 — the colour picker's pure half (owner 05.11: "add a color picker/probe to available apps so users can easily
## grab a color from existing graphics etc."): the formats a picked colour is copied in, the average under the cursor
## (anti-aliased edges and compressed pictures are never one flat pixel) and the recent-picks list.
## Unit-tested in tests/test_colour_probe_model.gd.

const HISTORY_MAX := 10


## Every way the colour is offered for copying, in the panel's order: [label, text].
##   HEX     — CSS / HTML templates, CG Studio, most graphics tools
##   Caspar  — a Caspar colour producer / AMCP (`PLAY 1-10 #FFRRGGBB`)
##   RGB     — 0–255
##   0–1     — shaders, Godot, Art-Net-style floats
##   HSV     — hue °, saturation %, value %
static func formats(c: Color) -> Array:
	var r := roundi(c.r * 255.0)
	var g := roundi(c.g * 255.0)
	var b := roundi(c.b * 255.0)
	return [
		["HEX", "#%02X%02X%02X" % [r, g, b]],
		["Caspar", "#FF%02X%02X%02X" % [r, g, b]],
		["RGB", "%d, %d, %d" % [r, g, b]],
		["0–1", "%.3f, %.3f, %.3f" % [c.r, c.g, c.b]],
		["HSV", "%d°, %d%%, %d%%" % [roundi(c.h * 360.0) % 360, roundi(c.s * 100.0), roundi(c.v * 100.0)]],
	]


static func hex(c: Color) -> String:
	return str(formats(c)[0][1])


## The colour at `p` in `img`, averaged over a (2·radius + 1)² square clipped to the image (radius 0 = the pixel).
static func sample(img: Image, p: Vector2i, radius := 0) -> Color:
	if img == null or img.is_empty():
		return Color.BLACK
	var sz := img.get_size()
	var x0 := clampi(p.x - radius, 0, sz.x - 1)
	var x1 := clampi(p.x + radius, 0, sz.x - 1)
	var y0 := clampi(p.y - radius, 0, sz.y - 1)
	var y1 := clampi(p.y + radius, 0, sz.y - 1)
	var acc := Vector3.ZERO
	var n := 0
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var c := img.get_pixel(x, y)
			acc += Vector3(c.r, c.g, c.b)
			n += 1
	acc /= float(maxi(n, 1))
	return Color(acc.x, acc.y, acc.z, 1.0)


## `list` with `hex_` first (moved there if already in it), at most HISTORY_MAX.
static func remember(list: Array, hex_: String) -> Array:
	var out := [hex_]
	for h in list:
		if str(h) != hex_ and out.size() < HISTORY_MAX:
			out.append(str(h))
	return out


## Text (black / white) readable on `c`.
static func ink(c: Color) -> Color:
	return Color.BLACK if c.get_luminance() > 0.55 else Color.WHITE
