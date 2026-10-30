extends RefCounted
## WO-836 part 3 — the release suite's pixel probes (e2e/e2e_probe.gd) must tell a good frame from a bad one before any
## scenario trusts them, and a crop past the frame must be refused (ffmpeg would clamp it and measure another place).

const P := preload("res://e2e/e2e_probe.gd")
var t


func test_self_test_passes() -> void:
	t.eq(P.self_test(), "", "the probe separates picture from black, rejects grey and a scaled picture, refuses an out-of-frame crop")


func test_stats_of_known_frames() -> void:
	var white := Image.create(200, 100, false, Image.FORMAT_RGBA8)
	white.fill(Color8(255, 255, 255, 255))
	var s := P.stats(white)
	t.ok(absf(s.luma - 255.0) < 0.5 and s.nonblack > 0.99 and s.alpha_nonzero > 0.99, "white: %s" % P.fmt(s))
	var half := Image.create(200, 100, false, Image.FORMAT_RGBA8)
	half.fill(Color8(0, 0, 0, 0))
	half.fill_rect(Rect2i(0, 0, 100, 100), Color8(255, 0, 0, 255))
	t.ok(absf(P.stats(half).nonblack - 0.5) < 0.02, "left half red = 50 % nonblack")
	t.ok(P.is_black(P.stats(half, Rect2i(100, 0, 100, 100))), "the right half is black")
	t.ok(not P.is_black(P.stats(half, Rect2i(0, 0, 100, 100))), "the left half is not")
	t.ok(P.saturated(half, Rect2i(0, 0, 100, 100)) > 0.99 and P.saturated(half, Rect2i(100, 0, 100, 100)) < 0.01, "colour share separates red from black")


func test_crop_past_the_frame_is_refused_not_clamped() -> void:
	var img := Image.create(1280, 720, false, Image.FORMAT_RGBA8)
	t.ok(P.stats(img, Rect2i(1200, 0, 100, 10)).has("error"), "X + W > width")
	t.ok(P.stats(img, Rect2i(0, 715, 10, 10)).has("error"), "Y + H > height")
	t.ok(P.stats(img, Rect2i(-1, 0, 10, 10)).has("error"), "negative X")
	t.ok(not P.stats(img, Rect2i(1270, 710, 10, 10)).has("error"), "a crop that ends exactly on the edge is fine")
	t.eq(P.saturated(img, Rect2i(1200, 0, 100, 10)), -1.0, "saturated() refuses too")
