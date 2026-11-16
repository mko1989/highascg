extends RefCounted
## WO-1091 — where a tracking camera stands before it is calibrated, and the Camera view's rough-aim maths. Pure.
## World = PSN metres (camera_model.gd: X stage left, Y upstage, Z up; Godot = (x, z, −y)); the tracking grid is the
## axis-aligned rectangle of tracking_model.gd (centre x_offset / y_offset, floor z_offset).
##
## "Audience side" comes from data, first hit wins:
##   1. the stage objects (LED walls, TVs, projection screens) — each faces its audience (+Z local, stage_objects.gd);
##      their facings summed, weighted by picture width. The most direct statement of where people look from.
##   2. the room (MVR scene box) — a stage stands against a wall; the audience is on the side with the most floor.
##   3. the grid — an audience faces a long side: a stage deeper than wide that sits off to the X side of the venue
##      origin faces back towards it; otherwise PSN's own convention, downstage = −Y.
## Patched front lights were considered and left out: heads hang over the stage as often as in front of it.

const C := preload("res://features/previs/tracking/camera_model.gd")
const S := preload("res://features/previs/stage_objects.gd")

const ELEVATION := 25.0  # degrees the default camera looks down at the stage centre
const MIN_HEIGHT := 2.5  # metres above the stage floor, at least
const HEAD := 1.8  # the far edge's heads stay in the frame too (people are tracked feet AND head, coverage_model.gd)
const MARGIN := 0.08  # of the frame, each side
const FOV := 60.0
const FOV_ROOM_MAX := 100.0  # the widest a room may force before the camera is put outside it instead
const ROOM_INSET := 0.3
const ZOOM_MIN := 0.25  # the Camera view's 2D zoom: below 1 the frame sits inside a wider overlay
const ZOOM_MAX := 40.0
const WIDE_MAX := 4.0  # the overlay renders at most 4× the frame (camera_overlay.gd `wide`)
const FOV_MIN := 10.0  # the pose spin box limits (tracking_page / pose_section)
const FOV_MAX := 170.0


## {dir: Vector2 (PSN xy, unit, pointing from the stage towards the audience), from: "objects" | "room" | "grid"}.
## `room` = the MVR scene box in the Godot frame (AABB() = unknown).
static func audience(grid: Dictionary, objects: Array, room := AABB()) -> Dictionary:
	var sum := Vector2.ZERO
	var weight := 0.0
	for raw in objects:
		if not (raw is Dictionary) or (raw as Dictionary).get("visible", true) == false:
			continue
		var o := S.normalize(raw)
		var r: Array = o.get("rotation", [0.0, 0.0, 0.0])
		var f := Basis.from_euler(Vector3(deg_to_rad(r[0]), deg_to_rad(r[1]), deg_to_rad(r[2]))) * Vector3(0, 0, 1)
		var d := Vector2(f.x, -f.z)
		if d.length() < 0.2:
			continue  # lying flat: says nothing about the audience
		var w := maxf(0.1, S.size_m(o).x)
		sum += d.normalized() * w
		weight += w
	if weight > 0.0 and sum.length() > 0.25 * weight:
		return {"dir": sum.normalized(), "from": "objects"}
	if room_like(room, grid):
		var b := room_psn(room)
		var hw := float(grid.width) / 2.0
		var hd := float(grid.depth) / 2.0
		var gx := float(grid.x_offset)
		var gy := float(grid.y_offset)
		var best := [Vector2.ZERO, 1.0]  # less than a metre of floor is no audience side
		for side in [[Vector2(-1, 0), gx - hw - b.position.x], [Vector2(1, 0), b.end.x - gx - hw],
				[Vector2(0, -1), gy - hd - b.position.y], [Vector2(0, 1), b.end.y - gy - hd]]:
			if float(side[1]) > float(best[1]):
				best = side
		if best[0] != Vector2.ZERO:
			return {"dir": best[0], "from": "room"}
	var gx0 := float(grid.x_offset)
	if float(grid.depth) > float(grid.width) and absf(gx0) > absf(float(grid.y_offset)):
		return {"dir": Vector2(-signf(gx0), 0.0), "from": "grid"}
	return {"dir": Vector2(0, -1), "from": "grid"}


## The audience direction from a project (previs.tracking.grid + previs.stage.objects; no room).
static func project_audience(project: Dictionary) -> Vector2:
	var pv: Variant = project.get("previs")
	var p: Dictionary = pv if pv is Dictionary else {}
	var t: Variant = p.get("tracking")
	var g: Variant = (t as Dictionary).get("grid") if t is Dictionary else null
	var grid := {"width": 10.0, "depth": 6.0, "x_offset": 0.0, "y_offset": 3.0}
	if g is Dictionary:
		for k in grid:
			if (g as Dictionary).get(k) is float or (g as Dictionary).get(k) is int:
				grid[k] = float(g[k])
	var st: Variant = p.get("stage")
	var objs: Variant = (st as Dictionary).get("objects") if st is Dictionary else null
	return audience(grid, objs if objs is Array else []).dir


## WO-1091: a new PTZ camera's pose (ptz_model.gd: x, y, z, yaw — 0 = facing upstage, as here — pitch 0 = mounted
## level): where a tracking camera would stand for this project's stage, facing its centre.
static func ptz_pose(project: Dictionary) -> Dictionary:
	var pv: Variant = project.get("previs")
	var t: Variant = (pv as Dictionary).get("tracking") if pv is Dictionary else null
	var g: Dictionary = preload("res://features/previs/tracking/tracking_model.gd").normalize_grid((t as Dictionary).get("grid") if t is Dictionary else null)
	var st: Variant = (pv as Dictionary).get("stage") if pv is Dictionary else null
	var objs: Variant = (st as Dictionary).get("objects") if st is Dictionary else null
	var c: Dictionary = stage_pose(g, objs if objs is Array else []).cam
	return {"x": snappedf(c.pos_x, 0.01), "y": snappedf(c.pos_y, 0.01), "z": snappedf(c.pos_z, 0.01), "yaw": snappedf(c.yaw, 0.1), "pitch": 0.0}


## The room box in PSN: position / end = (x, y, z) mins / maxes.
static func room_psn(room: AABB) -> AABB:
	return AABB(Vector3(room.position.x, -room.end.z, room.position.y), Vector3(room.size.x, room.size.z, room.size.y))


## A box we may treat as the room: it holds the grid's centre and is bigger than the grid both ways (a truss-only scene
## is not a room).
static func room_like(room: AABB, grid: Dictionary) -> bool:
	if room.size.x <= 0.0 or room.size.z <= 0.0:
		return false
	var b := room_psn(room)
	var gx := float(grid.x_offset)
	var gy := float(grid.y_offset)
	return gx > b.position.x and gx < b.end.x and gy > b.position.y and gy < b.end.y \
		and b.size.x > float(grid.width) and b.size.y > float(grid.depth)


## The default pose of a camera for this stage: on the audience side, looking at the grid's centre from ELEVATION
## above, as close as frames every grid corner (feet and heads) with MARGIN at FOV; inside the room when it is known (a
## room too shallow widens the fov up to FOV_ROOM_MAX first). → {cam (camera_model dict), from, fits: bool}.
static func stage_pose(grid: Dictionary, objects: Array, room := AABB(), raster := [1920, 1080]) -> Dictionary:
	var aud := audience(grid, objects, room)
	var a: Vector2 = aud.dir
	var c := Vector3(float(grid.x_offset), float(grid.y_offset), float(grid.z_offset))
	var w := float(raster[0])
	var h := float(raster[1])
	var pts := []
	for z in [c.z, c.z + HEAD]:
		for sx in [-1.0, 1.0]:
			for sy in [-1.0, 1.0]:
				pts.append([c.x + sx * float(grid.width) / 2.0, c.y + sy * float(grid.depth) / 2.0, z])
	var top := INF
	var reach := INF
	var inside := room_like(room, grid)
	if inside:
		var b := room_psn(room)
		top = b.end.z - ROOM_INSET
		for i in 2:
			var ax: float = a[i]
			if absf(ax) > 1e-6:
				var bound: float = (b.end[i] - ROOM_INSET) if ax > 0.0 else (b.position[i] + ROOM_INSET)
				reach = minf(reach, (bound - c[i]) / ax)
	var yaw := rad_to_deg(atan2(-a.x, -a.y))
	var make := func(d: float, fov: float) -> Dictionary:
		var z := minf(c.z + d * tan(deg_to_rad(ELEVATION)), top)
		z = maxf(z, c.z + minf(MIN_HEIGHT, maxf(0.5, top - c.z)))
		return C.camera(c.x + a.x * d, c.y + a.y * d, z, -rad_to_deg(atan2(z - c.z, d)), yaw, 0.0, fov)
	var lo := MIN_HEIGHT / tan(deg_to_rad(ELEVATION))
	var d := _search(func(x: float) -> bool: return frames(make.call(x, FOV), pts, w, h), lo, 400.0)
	var out := {"cam": make.call(d, FOV), "from": aud.from, "fits": frames(make.call(d, FOV), pts, w, h)}
	if d <= reach:
		return out
	var dr := maxf(reach, 0.5)
	var f := _search(func(x: float) -> bool: return frames(make.call(dr, x), pts, w, h), FOV, FOV_ROOM_MAX)
	if frames(make.call(dr, f), pts, w, h):
		return {"cam": make.call(dr, f), "from": aud.from, "fits": true}
	out["outside_room"] = true  # a fisheye guess helps nobody: frame it from where it fits, past the room box
	return out


## Smallest x in [lo, hi] for which ok(x) holds (ok monotone); hi when none does.
static func _search(ok: Callable, lo: float, hi: float) -> float:
	if ok.call(lo):
		return lo
	if not ok.call(hi):
		return hi
	for _i in 40:
		var mid := 0.5 * (lo + hi)
		if ok.call(mid):
			hi = mid
		else:
			lo = mid
	return hi


## Every PSN point in front of the camera and inside the frame, `margin` of each side kept clear.
static func frames(cam: Dictionary, pts: Array, w: float, h: float, margin := MARGIN) -> bool:
	for p in C.project(cam, pts, w, h):
		if p == null or p[0] < margin * w or p[0] > (1.0 - margin) * w or p[1] < margin * h or p[1] > (1.0 - margin) * h:
			return false
	return true


# --- rough aim (the Camera view while the camera is not solved, or unlocked) --------------------------------------

## May the operator move this camera by hand? Only while it is not solved (rms < 0), or after an explicit unlock.
static func can_aim(entry: Dictionary, unlocked: bool) -> bool:
	return not entry.is_empty() and (float(entry.get("rms", -1.0)) < 0.0 or unlocked)


## The entry with a hand-set pose: {} when refused (a solved camera that is not unlocked). A hand pose is no solve, so
## rms goes to −1 (the points stay: Solve brings the calibration back).
static func with_pose(entry: Dictionary, cam: Dictionary, unlocked: bool) -> Dictionary:
	if not can_aim(entry, unlocked):
		return {}
	var e := entry.duplicate(true)
	e["cam"] = cam
	e["rms"] = -1.0
	return e


## Drag = look around, grabbing the picture: the stage follows the pointer (`frame_w` = the frame's on-screen width).
static func look(cam: Dictionary, delta: Vector2, frame_w: float) -> Dictionary:
	var k := float(cam.fov) / maxf(1.0, frame_w)
	var o := cam.duplicate()
	o["yaw"] = wrapf(float(cam.yaw) - delta.x * k, -180.0, 180.0)
	o["pitch"] = clampf(float(cam.pitch) + delta.y * k, -89.0, 89.0)
	return o


## Shift+drag = move the camera across its view; at `dist` metres the picture follows the pointer.
static func move(cam: Dictionary, delta: Vector2, frame_w: float, dist: float) -> Dictionary:
	var m := 2.0 * dist * tan(deg_to_rad(float(cam.fov)) / 2.0) / maxf(1.0, frame_w)
	var r := C.rotation(cam.pitch, cam.yaw, cam.roll)
	var step := Vector3(r[0], r[3], r[6]) * (-delta.x * m) + Vector3(r[1], r[4], r[7]) * (delta.y * m)  # Godot axes
	return _shift(cam, step)


## Shift+wheel = walk along the view (steps > 0 forward), a tenth of the distance per step (at least 25 cm).
static func dolly(cam: Dictionary, steps: float, dist: float) -> Dictionary:
	var r := C.rotation(cam.pitch, cam.yaw, cam.roll)
	return _shift(cam, Vector3(-r[2], -r[5], -r[8]) * steps * maxf(0.25, dist * 0.1))


## Ctrl+wheel = the lens: steps > 0 zooms in (narrower fov).
static func zoom_fov(cam: Dictionary, steps: float) -> Dictionary:
	var o := cam.duplicate()
	o["fov"] = clampf(float(cam.fov) / pow(1.1, steps), FOV_MIN, FOV_MAX)
	return o


static func _shift(cam: Dictionary, g: Vector3) -> Dictionary:
	var o := cam.duplicate()
	o["pos_x"] = float(cam.pos_x) + g.x
	o["pos_y"] = float(cam.pos_y) - g.z
	o["pos_z"] = float(cam.pos_z) + g.y
	return o


## Metres from the camera to where its optical axis meets the floor (10 m when it looks above the horizon, capped).
static func focus_distance(cam: Dictionary, floor_z: float) -> float:
	var hit: Variant = C.unproject(cam, [[0.5, 0.5]], 1.0, 1.0, floor_z)
	if hit.is_empty() or hit[0] == null:
		return 10.0
	return clampf(Vector3(hit[0][0] - cam.pos_x, hit[0][1] - cam.pos_y, hit[0][2] - cam.pos_z).length(), 0.5, 200.0)


## The Camera view's 2D zoom after a wheel step: [ZOOM_MIN, ZOOM_MAX], snapped to exactly 1 near it.
static func clamp_zoom(z: float) -> float:
	var v := clampf(z, ZOOM_MIN, ZOOM_MAX)
	return 1.0 if absf(v - 1.0) < 1e-3 else v


## How many frames wide the overlay must render so it fills the view around the frame (1 = only the frame).
static func wide(view: Vector2, frame: Rect2) -> float:
	if frame.size.x <= 0.0 or frame.size.y <= 0.0:
		return 1.0
	var c := frame.get_center()
	var sx := maxf(c.x, view.x - c.x) / (frame.size.x / 2.0)
	var sy := maxf(c.y, view.y - c.y) / (frame.size.y / 2.0)
	return clampf(maxf(sx, sy), 1.0, WIDE_MAX)


## A camera picture that is all black — a DeckLink input with nothing cabled still delivers frames (black ones), so
## "has a texture" is not "has a picture". 12 × 7 samples, none brighter than `thr`.
static func is_black(img: Image, thr := 0.05) -> bool:
	if img == null or img.is_empty():
		return true
	for j in 7:
		for i in 12:
			var c := img.get_pixel(int((i + 0.5) * img.get_width() / 12.0), int((j + 0.5) * img.get_height() / 7.0))
			if maxf(c.r, maxf(c.g, c.b)) > thr:
				return false
	return true


# --- stage names for an audience direction (grid corners, WO-703 preset marks) -----------------------------------

## The grid axis nearest the audience direction (the grid is axis-aligned, so its front edge is one of four).
static func snap(aud: Vector2) -> Vector2:
	if absf(aud.x) > absf(aud.y):
		return Vector2(signf(aud.x), 0.0)
	return Vector2(0.0, -1.0 if aud.y <= 0.0 else 1.0)


## "DSR" … "Centre" for a floor spot `off` metres from the grid centre (PSN xy). Stage left = the performer's left
## while facing the audience.
static func stage_name(off: Vector2, aud: Vector2) -> String:
	var a := snap(aud)
	var ds := off.dot(a)
	var l := off.dot(Vector2(-a.y, a.x))
	var ud := "DS" if ds > 1e-6 else ("US" if ds < -1e-6 else "")
	var lr := "L" if l > 1e-6 else ("R" if l < -1e-6 else "")
	if ud == "":
		return "Centre" if lr == "" else "S" + lr
	return ud + ("C" if lr == "" else lr)


## The grid spot `ds` (+1 downstage edge, −1 upstage, 0 middle) × `l` (+1 stage left edge, −1 right) in PSN xy.
static func stage_spot(grid: Dictionary, aud: Vector2, ds: float, l: float) -> Vector2:
	var a := snap(aud)
	var sl := Vector2(-a.y, a.x)
	var half := Vector2(float(grid.width), float(grid.depth)) / 2.0
	var c := Vector2(float(grid.x_offset), float(grid.y_offset))
	return c + Vector2(a.x * half.x, a.y * half.y) * ds + Vector2(sl.x * half.x, sl.y * half.y) * l
