extends Node
## WO-1103 dev probe (avatar_probe.gd, `--probe-avatar=<dir>`): a `<dir>/go` whose text is JSON runs a sweep through the
## running client instead of one round —
##   shots: {"name": "s", "quality": ["Low", "Ultra"], "house": [1, 0.35], "views": ["front", "three_quarter", "face"]}
##     every visible people-layer figure, per quality × house level × view → `<name>_<Quality>_<house %>_<n>_<body>_<view>.png`;
##     with "bodies": [...] (woman / man / an absolute "<dir>/<name>" of a baked body) and "centre": [x, y, z] (PSN)
##     those are put up as local stand-ins in a row instead (facing the Front camera, standing);
##   stride: {"name": "w", "stride": 8, "bodies": [...], "centre": [...], "speed": 1.2, "views": ["side", "front"]}
##     each body walks a straight line through `centre`; `stride` shots evenly over one walk cycle per view →
##     `<name>_<body>_<view>_<k>.png` and `<name>_<body>_feet.json` (the toes' floor points every frame for 4 s);
##   perf: {"name": "p", "perf": [0, 1, 3, 9], "quality": ["Low", "Ultra"], "centre": [...]}
##     n local walkers (bodies alternating, circles round `centre` at 1.1 m/s) per level: the stage view's GPU /
##     render-CPU ms and the window's frame time (mean, p95) over 240 frames → `<name>_perf.json`.
## Levels are set live for the run only (ui.cfg untouched) and put back, as are the orbit camera and the house level.

const Quality := preload("res://features/previs/previs_quality.gd")
const House := preload("res://features/previs/house_lights.gd")
const Human := preload("res://features/previs/tracking/person_human.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
## view → [yaw offset from the figure's facing, distance m, pitch, height share aimed at]
const VIEWS := {"front": [0.0, 3.0, 0.1, 0.55], "three_quarter": [0.7, 3.0, 0.1, 0.55], "face": [0.3, 0.75, 0.03, 0.93],
	"side": [PI / 2.0, 3.2, 0.06, 0.5], "back": [PI, 3.0, 0.1, 0.55], "stage": [0.35, 11.0, 0.16, 0.5]}

var dir := ""
var cards: Node
var cfg := {}
var _walkers := []  # [{node, mode, ang, r, h, from, dir, d}]
var _centre := Vector3.ZERO
var _upd := 0.0
var _clock := 0.0


func run() -> void:
	var st: Node = cards.get_parent()
	var q: RefCounted = Quality.shared()
	var hl: RefCounted = House.shared()
	var saved := {"yaw": st._yaw, "pitch": st._pitch, "dist": st._dist, "target": st._target, "q": q.level, "h": hl.level}
	var name_ := str(cfg.get("name", "sweep"))
	var vp := st.get_viewport()
	_centre = C.psn_to_godot(cfg.get("centre", [0.0, 0.0, 0.0]))
	RenderingServer.viewport_set_measure_render_time(vp.get_viewport_rid(), true)
	if cfg.has("perf"):
		await _perf(name_, st, q, vp)
	elif cfg.has("stride"):
		for qn in cfg.get("quality", ["Ultra"]):
			_quality(q, Quality.level_of(str(qn)))
			for h in cfg.get("house", [1.0]):
				hl.set_level(float(h), false)
				await _stride("%s_%s_%03d" % [name_, qn, roundi(float(h) * 100.0)], st, vp)
	else:
		if cfg.has("bodies"):
			_row(cfg.bodies, st)
			await _frames(30)
		for qn in cfg.get("quality", ["Low"]):
			_quality(q, Quality.level_of(str(qn)))
			for h in cfg.get("house", [1.0]):
				hl.set_level(float(h), false)
				await _frames(20)
				var k := 0
				for a in (_walkers.map(func(w: Dictionary) -> Node: return w.node) if cfg.has("bodies") else _figures()):
					k += 1
					for v in cfg.get("views", ["front"]):
						_aim(st, a, str(v))
						await _frames(24)
						vp.get_texture().get_image().save_png("%s/%s_%s_%03d_%d_%s_%s.png" % [dir, name_, qn, roundi(float(h) * 100.0), k, _label(a), v])
	_clear()
	_quality(q, int(saved.q))
	hl.set_level(float(saved.h), false)
	for key in ["yaw", "pitch", "dist", "target"]:
		st.set("_" + key, saved[key])
	st._update_camera()
	print("[client] human probe done: %s" % name_)


func _label(a: Node) -> String:
	var b := str(a.get("body"))
	return b.get_file() if b != "" and b != "<null>" else "cartoon"


## The bodies standing in a row across `centre`, facing the audience (the Front preset's direction).
func _row(bodies: Array, st: Node) -> void:
	_clear()
	var face := float(cfg.get("face_yaw", st._yaw))  # Godot yaw: the orbit camera's side (the audience, from Front)
	for i in bodies.size():
		var node := Human.new(str(bodies[i]))
		cards.avatars.add_child(node)
		var w := {"node": node, "mode": "stand", "at": _centre + Vector3((i - (bodies.size() - 1) / 2.0) * 1.2, 0.0, 0.0), "h": _h(str(bodies[i]))}
		node.set_heading(face - PI / 2.0)  # PSN heading h faces Godot yaw h + PI / 2 (person_human.set_heading)
		_walkers.append(w)
		_feed(w)


func _h(body: String) -> float:
	return float(cfg.get("height", 1.68 if body.get_file().begins_with("w") or body.get_file().begins_with("f") else 1.8))


## One body at a time walks a line along x through `centre` at `speed`; shots at k / n of its walk cycle.
func _stride(prefix: String, st: Node, vp: Viewport) -> void:
	for b in cfg.get("bodies", ["woman"]):
		_clear()
		var node := Human.new(str(b))
		cards.avatars.add_child(node)
		var sp := float(cfg.get("speed", 1.2))
		var w := {"node": node, "mode": "line", "from": _centre - Vector3(3.0, 0.0, 0.0), "dir": Vector3(1, 0, 0), "v": sp, "d": 0.0, "h": _h(str(b))}
		_walkers.append(w)
		_feed(w)
		var feet := []
		for i in 120:  # 2 s to get going
			await get_tree().process_frame
		var t_end := Time.get_ticks_msec() + 4000
		while Time.get_ticks_msec() < t_end:
			await get_tree().process_frame
			var sh: Dictionary = node.shown()
			feet.append([Time.get_ticks_msec() / 1000.0, sh.pos.x, sh.pos.z] + _flat(sh.feet) + [sh.cadence, sh.walk])
		var f := FileAccess.open("%s/%s_%s_feet.json" % [dir, prefix, str(b).get_file()], FileAccess.WRITE)
		f.store_string(JSON.stringify(feet))
		f.close()
		for v in cfg.get("views", ["side", "front"]):
			w.d = 0.0
			w.pause = false
			for i in 90:
				await get_tree().process_frame
			var cyc := 1.0 / maxf(float(node.shown().cadence), 0.1)
			var n := int(cfg.stride)
			for k in n:
				var t0 := Time.get_ticks_msec()
				_aim(st, node, str(v))
				await _frames(1)
				vp.get_texture().get_image().save_png("%s/%s_%s_%s_%d.png" % [dir, prefix, str(b).get_file(), v, k])
				while Time.get_ticks_msec() - t0 < cyc * 1000.0 / n:
					_aim(st, node, str(v))
					await get_tree().process_frame


func _flat(a: Array) -> Array:
	var out := []
	for v: Vector3 in a:
		out.append_array([v.x, v.y, v.z])
	return out


func _perf(name_: String, st: Node, q: RefCounted, vp: Viewport) -> void:
	st._target = _centre + Vector3(0, 1.0, 0)
	st._dist = 9.0
	st._pitch = 0.22
	st._update_camera()
	var out := []
	var bodies: Array = cfg.get("bodies", ["woman", "man"])
	for qn in cfg.get("quality", ["Low"]):
		_quality(q, Quality.level_of(str(qn)))
		for n in cfg.perf:
			_clear()
			for i in int(n):
				var node := Human.new(str(bodies[i % bodies.size()]))
				cards.avatars.add_child(node)
				var w := {"node": node, "mode": "circle", "ang": TAU * i / maxf(n, 1), "r": 1.0 + 0.6 * (i % 3), "h": 1.68 if i % 2 == 0 else 1.8}
				_walkers.append(w)
				_feed(w)
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
	var f := FileAccess.open("%s/%s_perf.json" % [dir, name_], FileAccess.WRITE)
	f.store_string(JSON.stringify(out, "\t"))
	f.close()


func _clear() -> void:
	for w in _walkers:
		(w.node as Node).queue_free()
	_walkers.clear()


func _process(dt: float) -> void:
	_clock += dt
	_upd += dt
	for w in _walkers:
		if w.mode == "circle":
			w.ang = float(w.ang) + dt * 1.1 / float(w.r)
		elif w.mode == "line":
			w.d = float(w.d) + dt * float(w.v)
	if _upd >= 1.0 / 15.0:  # a tracking snapshot's rate
		_upd = 0.0
		for w in _walkers:
			_feed(w)


func _feed(w: Dictionary) -> void:
	var p: Vector3
	match str(w.mode):
		"circle":
			p = _centre + Vector3(cos(float(w.ang)), 0.0, sin(float(w.ang))) * float(w.r)
		"line":
			p = w.from + w.dir * float(w.d)
		_:
			p = w.at
	w.node.set_target(p, float(w.h), {}, null, _clock)


func _figures() -> Array:
	var out := []
	for c in cards.avatars.get_children():
		if c is Node3D and (c as Node3D).visible and c.has_method("shown"):
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
