extends RefCounted
## WO-1106 B28 — the tracking view's black check: a sparse 12 × 7 CPU sample of the bytes ShmTexture already uploaded
## (or the native source's front buffer) instead of a full-frame GPU readback (get_image) every 2 s.

const ShmTexture := preload("res://video/shm_texture.gd")
const Lifetime := preload("res://tests/test_shm_texture_lifetime.gd")
var t


static func _frame(w: int, h: int, v := 0, stride := 0) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize((stride if stride > 0 else w * 4) * h)
	b.fill(v)
	return b


class FakeSrc:
	extends RefCounted
	var frame: PackedByteArray
	var gets := 0

	func get_width() -> int:
		return 64

	func get_height() -> int:
		return 36

	func get_frame() -> PackedByteArray:
		gets += 1
		return frame

	func upload_to(_rid: RID) -> void:
		pass

	func get_upload_ms() -> float:
		return 0.0


func test_sample_black() -> void:
	t.ok(ShmTexture.sample_black(_frame(64, 36), 64, 36), "all black")
	t.ok(ShmTexture.sample_black(_frame(64, 36, 12), 64, 36), "12 / 255 is still black (< 5 %)")
	t.ok(not ShmTexture.sample_black(_frame(64, 36, 40), 64, 36), "a dim grey is a picture")
	var one := _frame(64, 36)
	var o := int(3.5 * 36 / 7.0) * 64 * 4 + int(5.5 * 64 / 12.0) * 4 + 2  # one sampled pixel's third byte (R of BGRA)
	one[o] = 200
	t.ok(not ShmTexture.sample_black(one, 64, 36), "one sampled pixel lit")
	var padded := _frame(64, 36, 0, 64 * 4 + 32)
	t.ok(ShmTexture.sample_black(padded, 64, 36), "padded rows")
	padded[int(0.5 * 36 / 7.0) * (64 * 4 + 32) + int(0.5 * 64 / 12.0) * 4] = 255
	t.ok(not ShmTexture.sample_black(padded, 64, 36), "padded rows: the stride is the row length")
	t.ok(ShmTexture.sample_black(PackedByteArray(), 64, 36), "no bytes: nothing to show")


func test_texture_samples_what_it_uploaded() -> void:
	var x: RefCounted = ShmTexture.new()  # headless: the image fallback, the same bytes path
	t.eq(x.is_black(), false, "no frame yet: not called black")
	x.update(_frame(64, 36), 64, 36)
	t.eq(x.is_black(), true, "a black frame")
	x.update_rgba(_frame(64, 36, 90), 64, 36)
	t.eq(x.is_black(), false, "a picture")
	var rig := Lifetime.Rig.new()  # the native path: the source's own front buffer, sampled only when asked
	var n: RefCounted = rig.make()
	var src := FakeSrc.new()
	src.frame = _frame(64, 36, 90)
	n.update_native(src)
	t.eq(src.gets, 0, "nothing read while frames arrive")
	t.eq(n.is_black(), false, "native: a picture")
	src.frame = _frame(64, 36)
	t.eq([n.is_black(), src.gets], [true, 2], "native: black, one read per check")
	n.free_gpu()
	rig.pump()
	t.eq(n._src, null, "free_gpu lets go of the source")


func test_tracking_view_reads_no_frame_back() -> void:
	var v := FileAccess.get_file_as_string("res://features/previs/tracking/tracking_view.gd")
	var body := v.substr(v.find("func _process("), 700)
	t.ok(not body.contains("get_image()") and body.contains("VideoSurfaces.is_black(_role)"), "the 2 s check samples, never reads back")
