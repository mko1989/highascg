extends RefCounted
## Audio fader cap (features/audio/fader_cap.gd): the VSlider grabber is cap-sized and the helper caches its textures.

const FC := preload("res://features/audio/fader_cap.gd")
var t


func test_grabber_is_cap_sized() -> void:
	var tex: ImageTexture = FC.grabber()
	t.ok(tex != null, "grabber texture is non-null")
	t.eq(tex.get_size(), Vector2(26, 14), "grabber size")
	t.eq(FC.grabber(true).get_size(), Vector2(26, 14), "highlight grabber size")


func test_grabber_is_cached() -> void:
	t.ok(FC.grabber() == FC.grabber(), "second call returns the cached instance")
	t.ok(FC.grabber(true) == FC.grabber(true), "highlight variant is cached too")
	t.ok(FC.grabber() != FC.grabber(true), "highlight is a separate texture")


func test_track_is_thin_dark_stylebox() -> void:
	var sb := FC.track()
	t.ok(sb is StyleBoxFlat, "track is a StyleBoxFlat")
	t.eq(sb.get_minimum_size().x, FC.TRACK_W, "track min width")
	t.ok(sb == FC.track(), "track is cached")
