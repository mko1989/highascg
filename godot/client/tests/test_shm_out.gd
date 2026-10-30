extends RefCounted
## WO-743 — features/shm_out/viewport_publisher.gd without libhshm_sink (CI): start() reports why, and nothing else
## happens. With the sink loaded (the box since WO-863): a ring opens in /dev/shm and closing unlinks it. The writing
## itself is proven by tools/e2e/godot-shm-writer.sh.

const Publisher := preload("res://features/shm_out/viewport_publisher.gd")
var t


func test_without_extension() -> void:
	if Publisher.available():
		_with_extension()
		return
	var pub := Publisher.new()
	var vp := SubViewport.new()
	vp.size = Vector2i(64, 36)
	t.eq(pub.start(vp, "wo743-test"), "libhshm_sink is not loaded", "start reports the missing extension")
	t.eq(pub.sink, null, "no sink")
	pub._process(0.016)
	pub.stop()
	t.eq(pub.skipped, 0, "idle: nothing published or skipped")
	vp.free()
	pub.free()


func _with_extension() -> void:
	var pub := Publisher.new()
	var vp := SubViewport.new()
	vp.size = Vector2i(64, 36)
	var ring := "wo863-test-%d" % OS.get_process_id()
	t.eq(pub.start(vp, ring), "", "the sink opens a ring")
	t.ok(FileAccess.file_exists("/dev/shm/highascg-" + ring), "the ring is in /dev/shm")
	pub.stop()
	t.ok(not FileAccess.file_exists("/dev/shm/highascg-" + ring), "stop unlinks it")
	vp.free()
	pub.free()
