extends RefCounted
## WO-950 — colour_probe_model.gd: the copy formats, the averaged sample (clipped at the image edge), the recent list,
## the readable ink. (The overlay / panel windows need a display and screen_get_image — owner QA.)

const M := preload("res://app/colour_probe_model.gd")
var t


func test_formats() -> void:
	var c := Color8(80, 173, 204)  # the gtzip template's end-bar blue #50ADCC
	var f := M.formats(c)
	t.eq(f.map(func(r: Array) -> String: return r[0]), ["HEX", "Caspar", "RGB", "0–1", "HSV"], "the panel's order")
	t.eq(f[0][1], "#50ADCC", "HEX")
	t.eq(f[1][1], "#FF50ADCC", "Caspar colour producer: alpha first")
	t.eq(f[2][1], "80, 173, 204", "RGB 0–255")
	t.eq(f[3][1], "0.314, 0.678, 0.800", "0–1 floats")
	t.eq(f[4][1], "195°, 61%, 80%", "HSV")
	t.eq(M.hex(Color.WHITE), "#FFFFFF")
	t.eq(M.formats(Color(1, 0, 0))[4][1], "0°, 100%, 100%", "red's hue is 0, not 360")


func test_sample_and_average() -> void:
	var img := Image.create(4, 4, false, Image.FORMAT_RGBA8)
	img.fill(Color.BLACK)
	img.set_pixel(1, 1, Color.WHITE)
	t.eq(M.hex(M.sample(img, Vector2i(1, 1))), "#FFFFFF", "radius 0 = the pixel")
	t.eq(M.hex(M.sample(img, Vector2i(1, 1), 1)), "#1C1C1C", "3×3 mean: one white of nine (28/255)")
	t.eq(M.hex(M.sample(img, Vector2i(0, 0), 1)), "#404040", "clipped at the corner: one white of four")
	t.eq(M.hex(M.sample(img, Vector2i(9, 9))), "#000000", "outside → clamped to the edge pixel")
	t.eq(M.sample(null, Vector2i.ZERO), Color.BLACK, "no image → black")


func test_history_and_ink() -> void:
	var h := []
	for i in 12:
		h = M.remember(h, "#%06X" % i)
	t.eq(h.size(), M.HISTORY_MAX, "at most %d" % M.HISTORY_MAX)
	t.eq(h[0], "#00000B", "newest first")
	h = M.remember(h, "#000005")
	t.eq([h[0], h.count("#000005")], ["#000005", 1], "a repeat moves to the front, not doubled")
	t.eq(M.ink(Color.WHITE), Color.BLACK)
	t.eq(M.ink(Color8(0, 84, 144)), Color.WHITE)
