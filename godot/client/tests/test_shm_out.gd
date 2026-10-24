extends RefCounted
## WO-743 — features/shm_out/viewport_publisher.gd without libhshm_sink (the client and CI never load it): start()
## reports why, and nothing else happens. The writing itself is proven by tools/e2e/godot-shm-writer.sh.

const Publisher := preload("res://features/shm_out/viewport_publisher.gd")
var t


func test_without_extension() -> void:
	if Publisher.available():
		return  # a machine with the sink installed: the e2e covers it
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
