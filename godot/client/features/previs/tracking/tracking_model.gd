extends RefCounted
## WO-616 T3 — tracking data as plain dictionaries, persisted in project.previs.tracking (the previs slice is
## client-owned, WO-607): the floor grid (OpenFollow's [grid]: a measured rectangle on the stage floor) and the
## tracking cameras (source surface role, solved camera, calibration points). Pure: no nodes, no autoloads.
## World = PSN metres (X stage left, Y upstage, Z up); stage objects are converted from the previs (Godot) frame.

const C := preload("res://features/previs/tracking/camera_model.gd")
const S := preload("res://features/previs/stage_objects.gd")

const GRID_DEFAULT := {"width": 10.0, "depth": 6.0, "spacing": 1.0, "x_offset": 0.0, "y_offset": 3.0, "z_offset": 0.0}
const RASTER_DEFAULT := [1920, 1080]


static func normalize(src: Variant) -> Dictionary:
	var t: Dictionary = (src as Dictionary).duplicate(true) if src is Dictionary else {}
	t["version"] = 1
	t["grid"] = normalize_grid(t.get("grid"))
	var cams := []
	var ids := {}
	for c in t.get("cameras", []) if t.get("cameras") is Array else []:
		if c is Dictionary:
			var n := normalize_camera(c)
			if not ids.has(n.id):
				ids[n.id] = true
				cams.append(n)
	t["cameras"] = cams
	return t


static func normalize_grid(src: Variant) -> Dictionary:
	var g: Dictionary = src if src is Dictionary else {}
	var out := {}
	for k in GRID_DEFAULT:
		var v: Variant = g.get(k, GRID_DEFAULT[k])
		out[k] = float(v) if (v is float or v is int) else float(GRID_DEFAULT[k])
	out["width"] = clampf(out.width, 0.5, 200.0)
	out["depth"] = clampf(out.depth, 0.5, 200.0)
	out["spacing"] = clampf(out.spacing, 0.1, 50.0)
	return out


## Camera entry: {id, name, role (surface, WO-597: inN / chN / pgmN…), raster [w, h], cam (camera_model dict),
## points [{id, label, world [x,y,z], screen [sx,sy] | null}], rms (px, -1 = not calibrated)}.
static func normalize_camera(src: Dictionary) -> Dictionary:
	var o := src.duplicate(true)
	o["id"] = str(o.get("id", "cam_1"))
	o["name"] = str(o.get("name", "Camera"))
	o["role"] = str(o.get("role", "in1"))
	var r: Array = o.get("raster") if o.get("raster") is Array and (o.get("raster") as Array).size() == 2 else RASTER_DEFAULT
	o["raster"] = [clampi(int(r[0]), 16, 16384), clampi(int(r[1]), 16, 16384)]
	var base := C.camera()
	var cam: Dictionary = o.get("cam") if o.get("cam") is Dictionary else {}
	for k in base:
		var v: Variant = cam.get(k, base[k])
		base[k] = float(v) if (v is float or v is int) and is_finite(float(v)) else float(base[k])
	base["fov"] = clampf(base.fov, C.FOV_MIN, C.FOV_MAX)
	if not C.lens_warp_is_valid(base.lens_k1, base.lens_k2):
		var pb := C.pull_back_to_fold(base.lens_k1, base.lens_k2)
		base["lens_k1"] = pb[0]
		base["lens_k2"] = pb[1]
	o["cam"] = base
	var pts := []
	for p in o.get("points", []) if o.get("points") is Array else []:
		if p is Dictionary and p.get("world") is Array and (p.get("world") as Array).size() == 3:
			var s: Variant = p.get("screen")
			pts.append({"id": str(p.get("id", "")), "label": str(p.get("label", p.get("id", ""))),
				"world": [float(p.world[0]), float(p.world[1]), float(p.world[2])],
				"screen": [float(s[0]), float(s[1])] if s is Array and (s as Array).size() == 2 else null})
	o["points"] = pts
	o["rms"] = float(o.get("rms", -1.0)) if (o.get("rms") is float or o.get("rms") is int) else -1.0
	return o


static func new_camera(existing: Array, role := "in1") -> Dictionary:
	var ids := {}
	for c in existing:
		ids[str((c as Dictionary).get("id", ""))] = true
	var n := existing.size() + 1
	while ids.has("cam_%d" % n):
		n += 1
	# A front-of-house start (OpenFollow's stage_default camera) so the overlay is roughly right before calibration.
	return normalize_camera({"id": "cam_%d" % n, "name": "Camera %d" % n, "role": role,
		"cam": C.camera(0.0, -11.0, 6.0, -22.0, 0.0, 0.0, 60.0)})


## The grid rectangle's corners (PSN), downstage first, clockwise seen from above:
## DSR (-x, -y), DSL (+x, -y), USL (+x, +y), USR (-x, +y). Stage left = +X.
static func grid_corners(g: Dictionary) -> Array:
	var hw: float = g.width / 2.0
	var y0: float = g.y_offset - g.depth / 2.0
	var y1: float = g.y_offset + g.depth / 2.0
	var x0: float = g.x_offset
	return [[x0 - hw, y0, g.z_offset], [x0 + hw, y0, g.z_offset], [x0 + hw, y1, g.z_offset], [x0 - hw, y1, g.z_offset]]


## Every grid line crossing (PSN), row by row from downstage — the extra floor points for a lens fit.
static func grid_crossings(g: Dictionary) -> Array:
	var out := []
	var nx := maxi(1, roundi(g.width / g.spacing))
	var ny := maxi(1, roundi(g.depth / g.spacing))
	var c: Array = grid_corners(g)[0]
	for j in ny + 1:
		for i in nx + 1:
			out.append([c[0] + g.width * i / nx, c[1] + g.depth * j / ny, g.z_offset])
	return out


## Points an operator can click to calibrate: grid corners + every crossing, and each stage object's picture
## corners (audience view: L = the audience's left). [{id, label, world}].
static func candidate_points(t: Dictionary, objects: Array) -> Array:
	var out := []
	var g: Dictionary = t.get("grid", GRID_DEFAULT)
	var names := ["DSR", "DSL", "USL", "USR"]
	var corners := grid_corners(g)
	for i in 4:
		out.append({"id": "grid:%s" % names[i], "label": "Grid corner %s" % names[i], "world": corners[i]})
	var nx := maxi(1, roundi(g.width / g.spacing))
	var k := 0
	for p in grid_crossings(g):
		var col := k % (nx + 1)
		var row := k / (nx + 1)
		k += 1
		out.append({"id": "grid:%d,%d" % [col, row], "label": "Grid line X%d / Y%d" % [col, row], "world": p})
	for o in objects:
		if o is Dictionary and (o as Dictionary).get("visible", true) != false:
			var cs := object_corners(o)
			var lab := ["bottom L", "bottom R", "top R", "top L"]
			for i in 4:
				out.append({"id": "obj:%s:%d" % [o.get("id", ""), i], "label": "%s %s" % [o.get("name", "?"), lab[i]], "world": cs[i]})
	return out


## Picture corners of a stage object in PSN (bottom L, bottom R, top R, top L as the audience sees them).
static func object_corners(o: Dictionary) -> Array:
	var size := S.size_m(o)
	var lx0 := -size.x / 2.0
	var lx1 := size.x / 2.0
	var lz0 := 0.0
	var lz1 := 0.0
	if str(o.get("type")) == "led_wall":
		var e := S.column_edges(o)
		lx0 = e[0].x; lz0 = e[0].y
		lx1 = e[e.size() - 1].x; lz1 = e[e.size() - 1].y
	var rot: Array = o.get("rotation", [0.0, 0.0, 0.0])
	var basis := Basis.from_euler(Vector3(deg_to_rad(rot[0]), deg_to_rad(rot[1]), deg_to_rad(rot[2])))  # Node3D order YXZ
	var pos := Vector3(o.position[0], o.position[1], o.position[2])
	var out := []
	for l in [Vector3(lx0, 0.0, lz0), Vector3(lx1, 0.0, lz1), Vector3(lx1, size.y, lz1), Vector3(lx0, size.y, lz0)]:
		var p: Array = C.godot_to_psn(pos + basis * l)
		out.append([snappedf(p[0], 0.0001), snappedf(p[1], 0.0001), snappedf(p[2], 0.0001)])
	return out


## Set (or add) the clicked screen position of world point `pid` on camera `cam_entry`; screen null clears it.
static func set_point(cam_entry: Dictionary, pid: String, label: String, world: Array, screen: Variant) -> Dictionary:
	var c := cam_entry.duplicate(true)
	var pts: Array = c.points
	for p in pts:
		if p.id == pid:
			p["screen"] = screen
			return normalize_camera(c)
	pts.append({"id": pid, "label": label, "world": world, "screen": screen})
	return normalize_camera(c)


static func clicked(cam_entry: Dictionary) -> Array:
	return (cam_entry.points as Array).filter(func(p: Dictionary) -> bool: return p.screen != null)
