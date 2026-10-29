extends Node
## Dev: --probe-perf — every 5 s print measured render time (CPU/GPU ms per frame) of the main window
## and of every SubViewport (previs 3D), plus fps and process time. Used to size WO-617 (2D previs).
## With --probe-shot=<png> it also saves the window after 10 s (an Xvfb render check that never shows on :0).
## WO-798: the SubViewport list is found once every RESCAN_S, not every frame — a whole-tree find_children per frame
## cost ~220 ms/s, more than what the probe measures.

const RESCAN_S := 3.0

var _acc := {}  # name -> [cpu_sum, gpu_sum, n]
var _t := 0.0
var _shot_t := 0.0
var _scan_t := RESCAN_S  # scan on the first frame
var _vps := {}  # name -> Viewport (the window + every SubViewport found at the last scan)
var _proc_acc := 0.0  # Performance TIME_PROCESS summed over the window (seconds)
var _frames := 0


func _ready() -> void:
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _rescan() -> void:
	_vps = {"window": get_viewport()}
	for sv in get_tree().root.find_children("*", "SubViewport", true, false):
		RenderingServer.viewport_set_measure_render_time((sv as SubViewport).get_viewport_rid(), true)
		_vps["sub:" + str(sv.get_parent().get_parent().name)] = sv


func _process(delta: float) -> void:
	_scan_t += delta
	if _scan_t >= RESCAN_S:
		_scan_t = 0.0
		_rescan()
	for k in _vps:
		var vp: Variant = _vps[k]
		if not is_instance_valid(vp):
			continue
		var rid: RID = (vp as Viewport).get_viewport_rid()
		var a: Array = _acc.get(k, [0.0, 0.0, 0])
		a[0] += RenderingServer.viewport_get_measured_render_time_cpu(rid)
		a[1] += RenderingServer.viewport_get_measured_render_time_gpu(rid)
		a[2] += 1
		_acc[k] = a
	_proc_acc += Performance.get_monitor(Performance.TIME_PROCESS)
	_frames += 1
	_t += delta
	_shot_t += delta
	if Config.args.has("probe-shot") and _shot_t >= 10.0 and _shot_t - delta < 10.0:
		print("[perf] shot ", get_viewport().get_texture().get_image().save_png(str(Config.args["probe-shot"])))
	if _t >= 5.0:
		var parts := [
			"fps %d" % Engine.get_frames_per_second(),
			"process %.2f ms" % (_proc_acc / maxi(1, _frames) * 1000.0),
			"draw calls %d" % Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			"nodes %d" % Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
		]
		for k in _acc:
			var a: Array = _acc[k]
			parts.append("%s cpu %.2f gpu %.2f ms" % [k, a[0] / maxi(1, a[2]), a[1] / maxi(1, a[2])])
		print("[perf] ", " | ".join(parts))
		_acc.clear()
		_proc_acc = 0.0
		_frames = 0
		_t = 0.0
