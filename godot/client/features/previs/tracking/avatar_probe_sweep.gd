extends Node
## WO-1103 dev probe (avatar_probe.gd, `--probe-avatar=<dir>`): a `<dir>/go` whose text is JSON runs a sweep through the
## running client instead of one round —
##   {"name": "s", "quality": ["Low", "High"], "house": [1, 0.2, 0], "views": ["front", "three_quarter", "face", "stage"]}
##     every visible people-layer figure (the human puppets and a pebble), per quality level × house level × view:
##     `<dir>/<name>_<Quality>_<house %>_<n>_<body>_<view>.png` (the stage view only, not the window);
##   {"name": "p", "perf": [0, 1, 3, 9], "quality": ["Low", "High"], "centre": [x, y, z] (PSN)}
##     n local human walkers (woman / man alternating, circles round `centre` at 1.1 m/s) per level: the stage view's
##     GPU / render-CPU ms and the window's frame time (mean, p95) over 240 frames → "[client] human probe" lines + `<dir>/<name>_perf.json`.
## Levels are set live for the run only (ui.cfg untouched) and put back, as are the orbit camera and the house level.

const Quality := preload("res://features/previs/previs_quality.gd")
const House := preload("res://features/previs/house_lights.gd")
const Human := preload("res://features/previs/tracking/person_human.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const AV := preload("res://features/previs/tracking/person_avatar_model.gd")
## view → [yaw offset from the figure's facing, distance m, pitch, height share aimed at]
const VIEWS := {"front": [0.0, 3.0, 0.1, 0.55], "three_quarter": [0.7, 3.0, 0.1, 0.55], "face": [0.3, 0.9, 0.04, 0.93],
	"side": [PI / 2.0, 2.6, 0.08, 0.5], "back": [PI, 3.0, 0.1, 0.55], "stage": [0.35, 11.0, 0.16, 0.5]}

var dir := ""
var cards: Node
var cfg := {}
var _walkers := []  # [{node, ang, r, h}]
var _centre := Vector3.ZERO
var _upd := 0.0


func run() -> void:
	var st: Node = cards.get_parent()
	var q: RefCounted = Quality.shared()
	var hl: RefCounted = House.shared()
	var saved := {"yaw": st._yaw, "pitch": st._pitch, "dist": st._dist, "target": st._target, "q": q.level, "h": hl.level}
	var name_ := str(cfg.get("name", "sweep"))
	var vp := st.get_viewport()
	RenderingServer.viewport_set_measure_render_time(vp.get_viewport_rid(), true)
	if cfg.has("perf"):
		await _perf(name_, st, q, vp)
	else:
		for qn in cfg.get("quality", ["Low"]):
			_quality(q, Quality.level_of(str(qn)))
			for h in cfg.get("house", [1.0]):
				hl.set_level(float(h), false)
				await _frames(20)
				var k := 0
				for a in _figures():
					k += 1
					var body := str(a.shown().get("body", "cartoon"))
					for v in cfg.get("views", ["front"]):
						_aim(st, a, str(v))
						await _frames(24)
						vp.get_texture().get_image().save_png("%s/%s_%s_%03d_%d_%s_%s.png" % [dir, name_, qn, roundi(float(h) * 100.0), k, body, v])
	_quality(q, int(saved.q))
	hl.set_level(float(saved.h), false)
	for key in ["yaw", "pitch", "dist", "target"]:
		st.set("_" + key, saved[key])
	st._update_camera()
	print("[client] human probe done: %s" % name_)


func _perf(name_: String, st: Node, q: RefCounted, vp: Viewport) -> void:
	var c: Array = cfg.get("centre", [0.0, 0.0, 0.0])
	_centre = C.psn_to_godot(c)
	st._target = _centre + Vector3(0, 1.0, 0)
	st._dist = 9.0
	st._pitch = 0.22
	st._update_camera()
	var out := []
	for qn in cfg.get("quality", ["Low"]):
		_quality(q, Quality.level_of(str(qn)))
		for n in cfg.perf:
			_spawn(int(n))
			await _frames(60)
			var gpu := 0.0
			var cpu := 0.0
			var ft := []
			var t0 := Time.get_ticks_usec()
			for i in 240:
				await get_tree().process_frame
				var t1 := Time.get_ticks_usec()
				ft.append((t1 - t0) / 1000.0)
				t0 = t1
				gpu += RenderingServer.viewport_get_measured_render_time_gpu(vp.get_viewport_rid())
				cpu += RenderingServer.viewport_get_measured_render_time_cpu(vp.get_viewport_rid())
			ft.sort()
			var mean: float = ft.reduce(func(a: float, b: float) -> float: return a + b, 0.0) / ft.size()
			var row := {"quality": qn, "humans": n, "gpu_ms": snappedf(gpu / 240.0, 0.01), "render_cpu_ms": snappedf(cpu / 240.0, 0.01),
				"frame_ms": snappedf(mean, 0.01), "frame_p95_ms": snappedf(float(ft[int(ft.size() * 0.95)]), 0.01), "fps": roundi(1000.0 / mean)}
			out.append(row)
			print("[client] human probe: ", JSON.stringify(row))
			vp.get_texture().get_image().save_png("%s/%s_%s_%d.png" % [dir, name_, qn, int(n)])
	_spawn(0)
	var f := FileAccess.open("%s/%s_perf.json" % [dir, name_], FileAccess.WRITE)
	f.store_string(JSON.stringify(out, "\t"))
	f.close()


func _spawn(n: int) -> void:
	for w in _walkers:
		(w.node as Node).queue_free()
	_walkers.clear()
	var look := AV.look({"skin": [214, 165, 128]})
	for i in n:
		var node := Human.new("woman" if i % 2 == 0 else "man", "light")
		cards.avatars.add_child(node)
		var w := {"node": node, "ang": TAU * i / maxf(n, 1), "r": 1.0 + 0.6 * (i % 3), "h": 1.68 if i % 2 == 0 else 1.8, "look": look}
		_walkers.append(w)
		_feed(w, 0.0)


func _process(dt: float) -> void:
	_upd += dt
	for w in _walkers:
		w.ang = float(w.ang) + dt * 1.1 / float(w.r)
	if _upd >= 1.0 / 15.0:  # a tracking snapshot's rate
		_upd = 0.0
		for w in _walkers:
			_feed(w, Time.get_ticks_msec() / 1000.0)


func _feed(w: Dictionary, now: float) -> void:
	var p := _centre + Vector3(cos(float(w.ang)), 0.0, sin(float(w.ang))) * float(w.r)
	w.node.set_target(p, float(w.h), w.look, null, now)


func _figures() -> Array:
	var out := []
	for c in cards.avatars.get_children():
		if c is Node3D and (c as Node3D).visible and c.has_method("shown") and not _walkers.any(func(w: Dictionary) -> bool: return w.node == c):
			out.append(c)
	return out


func _aim(st: Node, a: Node3D, view: String) -> void:
	var v: Array = VIEWS.get(view, VIEWS.front)
	var sh: Dictionary = a.shown()
	st._yaw = float(sh.yaw) + float(v[0])
	st._pitch = float(v[2])
	st._dist = float(v[1])
	st._target = (sh.pos as Vector3) + Vector3(0, float(sh.height) * float(v[3]), 0)
	st._update_camera()


func _quality(q: RefCounted, lv: int) -> void:
	q.level = lv
	Quality.apply_globals(q.current())
	q.changed.emit(lv)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame
