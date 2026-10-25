extends Node
## Dev: --probe-perf — every 5 s print measured render time (CPU/GPU ms per frame) of the main window
## and of every SubViewport (previs 3D), plus fps and process time. Used to size WO-617 (2D previs).
## With --probe-shot=<png> it also saves the window after 10 s (an Xvfb render check that never shows on :0).

var _acc := {}  # name -> [cpu_sum, gpu_sum, n]
var _t := 0.0
var _shot_t := 0.0


func _ready() -> void:
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _process(delta: float) -> void:
	var vps := {"window": get_viewport()}
	for sv in get_tree().root.find_children("*", "SubViewport", true, false):
		RenderingServer.viewport_set_measure_render_time((sv as SubViewport).get_viewport_rid(), true)
		vps["sub:" + str(sv.get_parent().get_parent().name)] = sv
	for k in vps:
		var rid: RID = (vps[k] as Viewport).get_viewport_rid()
		var a: Array = _acc.get(k, [0.0, 0.0, 0])
		a[0] += RenderingServer.viewport_get_measured_render_time_cpu(rid)
		a[1] += RenderingServer.viewport_get_measured_render_time_gpu(rid)
		a[2] += 1
		_acc[k] = a
	_t += delta
	_shot_t += delta
	if Config.args.has("probe-shot") and _shot_t >= 10.0 and _shot_t - delta < 10.0:
		print("[perf] shot ", get_viewport().get_texture().get_image().save_png(str(Config.args["probe-shot"])))
	if _t >= 5.0:
		var parts := ["fps %d" % Engine.get_frames_per_second(), "process %.2f ms" % (Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)]
		for k in _acc:
			var a: Array = _acc[k]
			parts.append("%s cpu %.2f gpu %.2f ms" % [k, a[0] / maxi(1, a[2]), a[1] / maxi(1, a[2])])
		print("[perf] ", " | ".join(parts))
		_acc.clear()
		_t = 0.0
