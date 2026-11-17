extends RefCounted
## WO-1109 (owner 17.11: "add a camera slider option so i can easily create a 'cinematic' view") — the Previs camera
## slider, pure. A pose is `{pos: [x, y, z], look: [x, y, z], fov}` in the stage frame (previs_stage.gd: Godot axes, Y up):
## where the camera stands and the point it looks at, no roll. A move is a virtual slider / dolly between two poses:
## `{id, name, a, b, duration_s, ease, mode}`, kept in `project.previs.camera = {moves: [...], active: <id>}`.
## Sampling lerps the position AND the looked-at point (the subject stays framed), and the fov. The orbit camera
## takes a pose back as orbit state (target = look, dist, yaw, pitch — previs_stage.gd `_update_camera`), so orbit,
## pan and dolly go on from wherever a move left it.

const DEFAULT_DURATION := 12.0
const MIN_DURATION := 0.5
const MAX_DURATION := 600.0
const EASES := ["linear", "smooth", "in", "out"]
const EASE_NAMES := ["Linear", "Smooth (in + out)", "Ease in", "Ease out"]
const MODES := ["once", "pingpong", "loop"]
const MODE_NAMES := ["Once", "Ping-pong", "Loop"]
const DEFAULT_FOV := 50.0  # previs_stage.gd Camera3D.fov
const MIN_DIST := 0.05  # a pose whose position is its look point still gives the orbit camera a direction
const MAX_PITCH := 1.55  # rad: look_at with Vector3.UP fails straight up / down
const NUM_LIMIT := 100000.0


## {pos, look, fov} from vectors.
static func pose(pos: Vector3, look: Vector3, fov := DEFAULT_FOV) -> Dictionary:
	return {"pos": [pos.x, pos.y, pos.z], "look": [look.x, look.y, look.z], "fov": clampf(fov, 5.0, 120.0)}


static func pos_of(p: Dictionary) -> Vector3:
	return Vector3(float(p.pos[0]), float(p.pos[1]), float(p.pos[2]))


static func look_of(p: Dictionary) -> Vector3:
	return Vector3(float(p.look[0]), float(p.look[1]), float(p.look[2]))


static func _vec3(raw: Variant) -> Variant:
	if not raw is Array or (raw as Array).size() != 3:
		return null
	var out := []
	for v in raw:
		if not (v is float or v is int) or is_nan(float(v)) or is_inf(float(v)):
			return null
		out.append(clampf(float(v), -NUM_LIMIT, NUM_LIMIT))
	return out


## A clean pose, or null when it is not one (missing / non-numeric position or look point).
static func norm_pose(raw: Variant) -> Variant:
	if not raw is Dictionary:
		return null
	var pos: Variant = _vec3(raw.get("pos"))
	var look: Variant = _vec3(raw.get("look"))
	if pos == null or look == null:
		return null
	var f: Variant = raw.get("fov", DEFAULT_FOV)
	var fov := float(f) if (f is float or f is int) and not is_nan(float(f)) else DEFAULT_FOV
	return {"pos": pos, "look": look, "fov": clampf(fov, 5.0, 120.0)}


## One move, cleaned: null when it has no usable A (a missing B is A, a still shot). Unknown keys stay.
static func normalize_move(raw: Variant, index := 0) -> Variant:
	if not raw is Dictionary:
		return null
	var a: Variant = norm_pose(raw.get("a"))
	if a == null:
		return null
	var b: Variant = norm_pose(raw.get("b"))
	var out: Dictionary = (raw as Dictionary).duplicate(true)
	out.a = a
	out.b = b if b != null else (a as Dictionary).duplicate(true)
	var id := str(raw.get("id", "")).strip_edges()
	out.id = id if id != "" else "m%d" % (index + 1)
	var name := str(raw.get("name", "")).strip_edges()
	out.name = name if name != "" else "Move %d" % (index + 1)
	var d: Variant = raw.get("duration_s", DEFAULT_DURATION)
	out.duration_s = clampf(float(d), MIN_DURATION, MAX_DURATION) if (d is float or d is int) and not is_nan(float(d)) else DEFAULT_DURATION
	out.ease = str(raw.get("ease", "")) if EASES.has(str(raw.get("ease", ""))) else "smooth"
	out.mode = str(raw.get("mode", "")) if MODES.has(str(raw.get("mode", ""))) else "pingpong"
	return out


## `project.previs.camera`, cleaned: junk moves dropped, ids unique, `active` one of them ("" with none). Unknown keys stay.
static func normalize(raw: Variant) -> Dictionary:
	var out: Dictionary = (raw as Dictionary).duplicate(true) if raw is Dictionary else {}
	var moves := []
	var ids := {}
	var list: Array = raw.get("moves") if raw is Dictionary and raw.get("moves") is Array else []
	for i in list.size():
		var m: Variant = normalize_move(list[i], i)
		if m == null:
			continue
		var id := str(m.id)
		var n := 2
		while ids.has(id):
			id = "%s-%d" % [m.id, n]
			n += 1
		m.id = id
		ids[id] = true
		moves.append(m)
	out.moves = moves
	var act := str(out.get("active", ""))
	out.active = act if ids.has(act) else (str(moves[0].id) if not moves.is_empty() else "")
	return out


## The camera slice of a project.
static func of_project(project: Variant) -> Dictionary:
	var pv: Variant = (project as Dictionary).get("previs") if project is Dictionary else null
	return normalize((pv as Dictionary).get("camera") if pv is Dictionary else null)


static func find(cfg: Dictionary, id: String) -> Dictionary:
	for m in cfg.get("moves", []):
		if str(m.id) == id:
			return m
	return {}


## A new move with both ends at `p` (the operator then frames B): the next free id m<n> and name "Move <n>".
static func new_move(cfg: Dictionary, p: Dictionary) -> Dictionary:
	var n := 1
	var ids := {}
	var names := {}
	for m in cfg.get("moves", []):
		ids[str(m.id)] = true
		names[str(m.name)] = true
	while ids.has("m%d" % n) or names.has("Move %d" % n):
		n += 1
	return normalize_move({"id": "m%d" % n, "name": "Move %d" % n, "a": p, "b": p}, n - 1)


## The eased position 0..1 along a move for a raw progress k 0..1.
static func eased(k: float, name: String) -> float:
	k = clampf(k, 0.0, 1.0)
	match name:
		"linear":
			return k
		"in":
			return k * k
		"out":
			return 1.0 - (1.0 - k) * (1.0 - k)
	return k * k * (3.0 - 2.0 * k)  # smooth: smoothstep, gentle start and stop


## Where a move is (0..1, eased) `elapsed_s` after its start: once stops at B, loop jumps back to A, ping-pong goes
## back to A with the same ease.
static func phase(move: Dictionary, elapsed_s: float) -> float:
	var d := maxf(MIN_DURATION, float(move.get("duration_s", DEFAULT_DURATION)))
	var e := maxf(0.0, elapsed_s) if not is_nan(elapsed_s) else 0.0
	var k := 0.0
	match str(move.get("mode", "pingpong")):
		"once":
			k = minf(1.0, e / d)
		"loop":
			k = fposmod(e, d) / d
		_:
			var c := fposmod(e, 2.0 * d)
			k = c / d if c <= d else 2.0 - c / d
	return eased(k, str(move.get("ease", "smooth")))


## The elapsed time at which a move (going forward) is at position `t` — Play resumes from where the slider is.
static func elapsed_at(move: Dictionary, t: float) -> float:
	var lo := 0.0
	var hi := 1.0
	var name := str(move.get("ease", "smooth"))
	t = clampf(t, 0.0, 1.0)
	for i in 40:  # every ease is monotonic on 0..1
		var mid := (lo + hi) * 0.5
		if eased(mid, name) < t:
			lo = mid
		else:
			hi = mid
	return (lo + hi) * 0.5 * maxf(MIN_DURATION, float(move.get("duration_s", DEFAULT_DURATION)))


## A once move has reached B.
static func done(move: Dictionary, elapsed_s: float) -> bool:
	return str(move.get("mode", "")) == "once" and elapsed_s >= float(move.get("duration_s", DEFAULT_DURATION))


## The pose at `t` (0..1) along a move: position, look point and fov in straight lines from A to B.
static func sample(move: Dictionary, t: float) -> Dictionary:
	t = clampf(t, 0.0, 1.0) if not is_nan(t) else 0.0
	var a: Dictionary = move.a
	var b: Dictionary = move.b
	return pose(pos_of(a).lerp(pos_of(b), t), look_of(a).lerp(look_of(b), t), lerpf(float(a.fov), float(b.fov), t))


## A pose as orbit state {target, dist, yaw, pitch, fov} (previs_stage.gd: camera = target + (sin yaw cos pitch,
## sin pitch, cos yaw cos pitch) · dist). Never NaN: a pose looking at its own position keeps a level view along -Z.
static func orbit_of(p: Dictionary) -> Dictionary:
	var target := look_of(p)
	var off := pos_of(p) - target
	var dist := off.length()
	var yaw := 0.0
	var pitch := 0.0
	if dist >= 1e-6:
		yaw = atan2(off.x, off.z)
		pitch = clampf(asin(clampf(off.y / dist, -1.0, 1.0)), -MAX_PITCH, MAX_PITCH)
	return {"target": target, "dist": maxf(MIN_DIST, dist), "yaw": yaw, "pitch": pitch, "fov": float(p.get("fov", DEFAULT_FOV))}


## Orbit state → pose (the inverse of orbit_of for every pitch inside ±MAX_PITCH).
static func pose_of_orbit(target: Vector3, yaw: float, pitch: float, dist: float, fov := DEFAULT_FOV) -> Dictionary:
	var off := Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * dist
	return pose(target + off, target, fov)


## The camera transform of a pose (the Previs output's own camera).
static func transform_of(p: Dictionary) -> Transform3D:
	var o := orbit_of(p)
	var pos := (o.target as Vector3) + Vector3(sin(o.yaw) * cos(o.pitch), sin(o.pitch), cos(o.yaw) * cos(o.pitch)) * float(o.dist)
	return Transform3D(Basis.IDENTITY, pos).looking_at(o.target, Vector3.UP)
