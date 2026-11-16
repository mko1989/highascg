extends Node
## WO-1087 dev probe — `--probe-avatar=<dir>`: looks at the first avatar of the people layer (person_cards.gd) from
## close by, inside the real client and its real venue light. Writing `<dir>/go` (its text = a name) starts one round:
## front / three-quarter / both sides / back / face / wide shots of the avatar as it walks, saved as `<dir>/<name>_<view>.png`,
## plus `<dir>/<name>_motion.json` (its feet and yaw every frame for 6 s: floor height, smoothness). The orbit camera
## is put back where it was after each round. Nothing runs without the flag.
## WO-1103: a `go` whose text is JSON runs avatar_probe_sweep.gd instead (quality × house × view shots of every figure,
## or the frame cost of n human puppets); a human's motion rows also carry its feet and the drawn balls of its feet.

const VIEWS := [["front", 0.0, 3.2, 0.12], ["three_quarter", 0.75, 3.2, 0.12], ["side", PI / 2.0, 1.6, 0.1],
	["side_l", -PI / 2.0, 1.6, 0.1], ["back", PI, 3.2, 0.12], ["face", 0.25, 1.3, 0.05], ["wide", 0.5, 7.0, 0.45]]
const SHOT_S := 0.6

var dir := ""
var cards: Node  # person_cards.gd (its parent is the previs stage)
var _busy := false
var _poll := 0.0
var _shot := {}  # {view, until, name}
var _queue := []
var _motion := []
var _motion_until := 0.0
var _saved := {}


func _process(dt: float) -> void:
	_poll += dt
	if not _busy and _poll > 0.5:
		_poll = 0.0
		if FileAccess.file_exists(dir + "/go"):
			var name_ := FileAccess.get_file_as_string(dir + "/go").strip_edges()
			DirAccess.remove_absolute(dir + "/go")
			if name_.begins_with("{"):
				_sweep(JSON.parse_string(name_))
				return
			_start(name_ if name_ != "" else "probe")
	if not _busy:
		return
	var a: Node3D = _first()
	var now := Time.get_ticks_msec() / 1000.0
	if a != null and now < _motion_until:
		var sh: Dictionary = a.shown()
		var row := [now, sh.pos.x, sh.pos.y, sh.pos.z, sh.yaw]
		if sh.has("feet"):  # WO-1103: [air, planted x, z, drawn ball x, y, z] per foot
			for i in 2:
				var f: Dictionary = sh.feet[i]
				var b: Vector3 = sh.balls[i]
				var at: Vector3 = f.at if f.at is Vector3 else Vector3.ZERO
				row.append_array([f.air, at.x, at.z, b.x, b.y, b.z])
		_motion.append(row)
	if _shot.is_empty():
		if _queue.is_empty():
			if now >= _motion_until:
				_finish()
			return
		_shot = {"view": _queue.pop_front(), "until": now + SHOT_S}
	if a != null:
		_aim(a, _shot.view)
	if now >= float(_shot.until):
		var img := get_viewport().get_texture().get_image()
		img.save_png("%s/%s_%s.png" % [dir, _saved.name, _shot.view[0]])
		_shot = {}


## WO-1103: the JSON sweep (avatar_probe_sweep.gd), one at a time.
func _sweep(cfg: Variant) -> void:
	if not (cfg is Dictionary):
		print("[client] human probe: go is not a JSON object")
		return
	_busy = true
	var sw: Node = preload("res://features/previs/tracking/avatar_probe_sweep.gd").new()
	sw.dir = dir
	sw.cards = cards
	sw.cfg = cfg
	add_child(sw)
	await sw.run()
	sw.queue_free()
	_busy = false


func _start(name_: String) -> void:
	var st: Node = cards.get_parent()
	_saved = {"name": name_, "yaw": st._yaw, "pitch": st._pitch, "dist": st._dist, "target": st._target}
	_queue = VIEWS.duplicate()
	_motion = []
	_motion_until = Time.get_ticks_msec() / 1000.0 + 6.0
	_busy = true


func _finish() -> void:
	var st: Node = cards.get_parent()
	st._yaw = _saved.yaw
	st._pitch = _saved.pitch
	st._dist = _saved.dist
	st._target = _saved.target
	st._update_camera()
	var f := FileAccess.open("%s/%s_motion.json" % [dir, _saved.name], FileAccess.WRITE)
	f.store_string(JSON.stringify(_motion))
	f.close()
	_busy = false


func _first() -> Node3D:
	var av: Node = cards.avatars
	for c in av.get_children():
		if c is Node3D and (c as Node3D).visible:
			return c
	return null


func _aim(a: Node3D, v: Array) -> void:
	var st: Node = cards.get_parent()
	var sh: Dictionary = a.shown()
	st._yaw = float(sh.yaw) + float(v[1])
	st._pitch = float(v[3])
	st._dist = float(v[2])
	st._target = (sh.pos as Vector3) + Vector3(0, float(sh.height) * (0.82 if v[0] == "face" else 0.68 if str(v[0]).begins_with("side") else 0.5), 0)
	st._update_camera()
