extends RefCounted
## WO-1098 (owner 16.11: "at least for that scene the front camera preset is 'showing' wrong perspective") — the Previs
## View presets Front / Top / ISO follow the stage instead of fixed orbit poses around the venue origin. Pure.
##
## The audience side is the WO-1091 model (tracking/aim_model.gd `audience`: the stage objects' facing weighted by
## width → the room side with the most floor → the grid's shape) — one model for the tracking cameras and the views.
## What is framed: the visible stage objects (LED walls, TVs, projection screens) and the tracking grid with a standing
## person's height on it — the stage as people see it. Orbit convention = previs_stage.gd `_update_camera`: the
## camera sits at target + (sin yaw · cos pitch, sin pitch, cos yaw · cos pitch) · dist, yaw 0 = from +Z.
##   Front — from the audience, level (a slight look down), the stage + screens across the frame with a margin;
##   Top   — from high above with the audience at the bottom of the picture (upstage = up), the stage's plan in frame;
##   ISO   — a three-quarter view from the audience's side, the whole stage box in frame (inside a venue: a metre under
##           its ceiling — from above, the coffers and chandeliers stand between the camera and the stage).
## No stage objects and no tracking grid: the old fixed poses (around the venue box's centre when there is a venue).

const Aim := preload("res://features/previs/tracking/aim_model.gd")
const S := preload("res://features/previs/stage_objects.gd")
const TM := preload("res://features/previs/tracking/tracking_model.gd")

const LEGACY := {"Front": Vector3(0.0, 0.12, 12.0), "Top": Vector3(0.0, 1.45, 14.0), "ISO": Vector3(-0.75, 0.45, 13.0)}
const HEAD := 1.8  # a person standing on the grid stays in the picture
const MARGIN := 1.15  # 15 % air around the framed box
const MIN_DIST := 4.0
const FOV := 50.0  # previs_stage.gd Camera3D.fov (vertical)
const CEILING_GAP := 1.0  # ISO inside a venue: the camera this far (m) under the room's top (owner 16.11: "like a meter from the ceiling")


## The stage box in the Godot frame (visible stage objects + the tracking grid with HEAD on it); AABB() = no stage data.
static func stage_box(project: Dictionary) -> AABB:
	var pv: Dictionary = project.get("previs") if project.get("previs") is Dictionary else {}
	var pts := PackedVector3Array()
	for o in _objects(pv):
		var y0 := float(o.position[1])
		for p in S.footprint(o):
			pts.append(Vector3(p.x, y0, p.y))
			pts.append(Vector3(p.x, y0 + S.size_m(o).y, p.y))
	var g: Variant = _grid_src(pv)
	if g != null:
		var n: Dictionary = TM.normalize_grid(g)
		for sx in [-1.0, 1.0]:
			for sy in [-1.0, 1.0]:
				var x: float = float(n.x_offset) + sx * float(n.width) / 2.0
				var z: float = -(float(n.y_offset) + sy * float(n.depth) / 2.0)
				pts.append(Vector3(x, float(n.z_offset), z))
				pts.append(Vector3(x, float(n.z_offset) + HEAD, z))
	if pts.is_empty():
		return AABB()
	var box := AABB(pts[0], Vector3.ZERO)
	for p in pts:
		box = box.expand(p)
	return box


## The audience direction in the Godot frame (unit, level) and where it came from; dir ZERO = no stage data.
static func audience(project: Dictionary, room := AABB()) -> Dictionary:
	var pv: Dictionary = project.get("previs") if project.get("previs") is Dictionary else {}
	var objs := _objects(pv)
	var g: Variant = _grid_src(pv)
	if objs.is_empty() and g == null:
		return {"dir": Vector3.ZERO, "from": "none"}
	var a: Dictionary = Aim.audience(TM.normalize_grid(g), objs, room)
	var d: Vector2 = a.dir
	return {"dir": Vector3(d.x, 0.0, -d.y).normalized(), "from": a.from}


## A preset's orbit pose → {yaw, pitch, dist, target: Vector3 | null (keep the current orbit point), from}.
## `aspect` = the view's width / height; `room` = the venue / MVR box (Godot frame, AABB() = none).
static func pose(name: String, project: Dictionary, aspect := 16.0 / 9.0, room := AABB()) -> Dictionary:
	var legacy: Vector3 = LEGACY.get(name, LEGACY["Front"])
	var aud := audience(project, room)
	var box := stage_box(project)
	if aud.dir == Vector3.ZERO or box.size == Vector3.ZERO:
		var out := {"yaw": legacy.x, "pitch": legacy.y, "dist": legacy.z, "target": null, "from": "fixed"}
		if room.size != Vector3.ZERO:
			out.target = room.get_center()
			out.dist = maxf(legacy.z, room.get_longest_axis_size() * 0.9)
		return out
	var a: Vector3 = aud.dir
	var yaw := atan2(a.x, a.z) + legacy.x  # Front / Top straight from the audience, ISO turned like the old preset
	var side := Vector3(a.z, 0.0, -a.x)  # across the audience's view
	var half := box.size / 2.0
	var across := absf(side.x) * half.x + absf(side.z) * half.z  # the box's half extents across / along the view
	var along := absf(a.x) * half.x + absf(a.z) * half.z
	var tv := tan(deg_to_rad(FOV) / 2.0)
	var th := tv * maxf(0.2, aspect)
	var dist: float
	match name:
		"Top":
			dist = maxf(across / th, along / tv) * MARGIN + half.y
		"ISO":
			dist = half.length() * MARGIN / minf(tv, th)
		_:
			dist = maxf(across / th, half.y / tv) * MARGIN + along
	dist = maxf(MIN_DIST, dist)
	var pitch := legacy.y
	var c := box.get_center()
	if name == "ISO" and room.size.y > 0.0 and room.has_point(Vector3(c.x, room.get_center().y, c.z)):
		# inside a venue the three-quarter view stays under its ceiling (chandeliers, coffers), like a person in the room
		var rise := room.position.y + room.size.y - CEILING_GAP - c.y  # camera height above the orbit point
		pitch = maxf(LEGACY["Front"].y, asin(clampf(rise / dist, -1.0, 1.0)))
	return {"yaw": wrapf(yaw, -PI, PI), "pitch": pitch, "dist": dist, "target": c, "from": aud.from}


## The shortest turn from `from` to `to` (radians), so a fly-to never spins the long way round.
static func near_yaw(from: float, to: float) -> float:
	return from + wrapf(to - from, -PI, PI)


static func _objects(pv: Dictionary) -> Array:
	var st: Variant = pv.get("stage")
	var raw: Variant = (st as Dictionary).get("objects") if st is Dictionary else null
	var out := []
	for o in (raw if raw is Array else []):
		if o is Dictionary and (o as Dictionary).get("visible", true) != false:
			out.append(S.normalize(o))
	return out


static func _grid_src(pv: Dictionary) -> Variant:
	var t: Variant = pv.get("tracking")
	var g: Variant = (t as Dictionary).get("grid") if t is Dictionary else null
	return g if g is Dictionary else null
