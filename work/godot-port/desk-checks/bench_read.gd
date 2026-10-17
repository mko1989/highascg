extends SceneTree

# Measures GDScript-only frame reads (FileAccess.get_buffer) for the M0 "no native code" spike path.
# Usage: Godot --headless --script bench_read.gd -- <frame_file> <width> <height> <iterations>

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var path: String = args[0]
	var w := int(args[1])
	var h := int(args[2])
	var n := int(args[3])
	var size := w * h * 4
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		print("open failed ", FileAccess.get_open_error())
		quit(1)
		return
	var best := 1e20
	var total := 0.0
	var img: Image
	for i in n:
		var t0 := Time.get_ticks_usec()
		f.seek(4096)
		var buf := f.get_buffer(size)
		var t1 := Time.get_ticks_usec()
		total += t1 - t0
		best = min(best, t1 - t0)
		if i == 0:
			img = Image.create_from_data(w, h, false, Image.FORMAT_RGBA8, buf)
	var t2 := Time.get_ticks_usec()
	for i in 20:
		var buf2 := f.get_buffer(0)
		img.set_data(w, h, false, Image.FORMAT_RGBA8, f.get_buffer(0) if false else img.get_data())
	var t3 := Time.get_ticks_usec()
	print("READ %dx%d  %.1f MB/frame  avg %.2f ms  best %.2f ms  over %d reads" % [w, h, size / 1048576.0, total / n / 1000.0, best / 1000.0, n])
	print("IMAGE set_data (same buffer, 20x) avg %.2f ms" % ((t3 - t2) / 20.0 / 1000.0))
	quit()
