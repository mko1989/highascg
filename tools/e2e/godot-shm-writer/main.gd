extends SceneTree
## WO-743 e2e scene (tools/e2e/godot-shm-writer.sh): a 640×360 transparent SubViewport — left half opaque orange
## Color8(240,128,16), top-right quarter the same at alpha 128, bottom-right empty — published through
## features/shm_out/viewport_publisher.gd into the ring named by argv after "--", for the given seconds.

const Publisher := preload("res://viewport_publisher.gd")


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var ring := args[0]
	var seconds := float(args[1])
	var vp := SubViewport.new()
	vp.size = Vector2i(640, 360)
	vp.transparent_bg = true
	root.add_child(vp)
	_rect(vp, Rect2(0, 0, 320, 360), Color8(240, 128, 16, 255))
	_rect(vp, Rect2(320, 0, 320, 180), Color8(240, 128, 16, 128))
	var pub := Publisher.new()
	root.add_child(pub)
	var err := pub.start(vp, ring, 50)
	if err != "":
		printerr("FAIL start: ", err)
		quit(1)
		return
	print("renderer ", "RenderingDevice" if RenderingServer.get_rendering_device() != null else "Compatibility")
	await create_timer(seconds).timeout
	print("published ", pub.sink.get_published(), " skipped ", pub.skipped)
	pub.stop()
	quit(0)


func _rect(vp: SubViewport, r: Rect2, c: Color) -> void:
	var cr := ColorRect.new()
	cr.position = r.position
	cr.size = r.size
	cr.color = c
	vp.add_child(cr)
