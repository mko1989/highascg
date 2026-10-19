extends RefCounted
## WO-616 T3b — what the Camera view draws over the camera picture, in raster pixels of that camera (lens applied):
## the floor grid lines and the stage objects' picture outlines as polylines (each edge subdivided so the lens bends
## it like the real picture), and every calibration candidate where the camera currently shows it. Pure.

const C := preload("res://features/previs/tracking/camera_model.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")

const SEGMENTS := 24  # per straight world edge — enough for k1 ≈ -0.3 to look smooth at 4K


## world points → lens pixels ([sx, sy] | null) for camera entry `ce` (tracking_model camera).
static func shown(ce: Dictionary, world: Array) -> Array:
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var cam: Dictionary = ce.cam
	return C.apply_distortion(C.project(cam, world, w, h), w, h, float(cam.lens_k1), float(cam.lens_k2))


## A straight world segment a→b as screen polylines (split where it goes behind the camera). [PackedVector2Array]
static func edge(ce: Dictionary, a: Array, b: Array, n := SEGMENTS) -> Array:
	var world := []
	for i in n + 1:
		var f := float(i) / n
		world.append([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
	var px := shown(ce, world)
	var out := []
	var cur := PackedVector2Array()
	for p in px:
		if p == null:
			if cur.size() >= 2:
				out.append(cur)
			cur = PackedVector2Array()
		else:
			cur.append(Vector2(p[0], p[1]))
	if cur.size() >= 2:
		out.append(cur)
	return out


## {grid: [polylines], objects: [{id, name, lines: [polylines]}]}
static func lines(t: Dictionary, ce: Dictionary, objects: Array) -> Dictionary:
	var g: Dictionary = t.get("grid", T.GRID_DEFAULT)
	var grid := []
	var c := T.grid_corners(g)
	var nx := maxi(1, roundi(g.width / g.spacing))
	var ny := maxi(1, roundi(g.depth / g.spacing))
	for i in nx + 1:
		var x: float = c[0][0] + g.width * i / nx
		grid.append_array(edge(ce, [x, c[0][1], g.z_offset], [x, c[2][1], g.z_offset]))
	for j in ny + 1:
		var y: float = c[0][1] + g.depth * j / ny
		grid.append_array(edge(ce, [c[0][0], y, g.z_offset], [c[1][0], y, g.z_offset]))
	var objs := []
	for o in objects:
		if o is Dictionary and (o as Dictionary).get("visible", true) != false:
			var cs := T.object_corners(o)
			var ls := []
			for k in 4:
				ls.append_array(edge(ce, cs[k], cs[(k + 1) % 4]))
			objs.append({"id": str(o.get("id", "")), "name": str(o.get("name", "")), "lines": ls})
	return {"grid": grid, "objects": objs}


## Candidates with where the camera shows them now and where they were clicked:
## [{id, label, world, shown: Vector2 | null, click: Vector2 | null, err: float (-1 = not clicked / not shown)}]
static func points(t: Dictionary, ce: Dictionary, objects: Array) -> Array:
	var cands := T.candidate_points(t, objects)
	var clicks := {}
	for p in ce.points:
		if p.screen != null:
			clicks[p.id] = Vector2(p.screen[0], p.screen[1])
	# clicked points whose candidate is gone (object deleted / grid resized) still count and still show
	var known := {}
	for p in cands:
		known[p.id] = true
	for p in ce.points:
		if not known.has(p.id) and p.screen != null:
			cands.append({"id": p.id, "label": "%s (gone)" % p.label, "world": p.world})
	var px := shown(ce, cands.map(func(p: Dictionary) -> Array: return p.world))
	var out := []
	for i in cands.size():
		var p: Dictionary = cands[i]
		var s: Variant = Vector2(px[i][0], px[i][1]) if i < px.size() and px[i] != null else null
		var k: Variant = clicks.get(p.id)
		out.append({"id": p.id, "label": p.label, "world": p.world, "shown": s, "click": k,
			"err": (s as Vector2).distance_to(k) if s != null and k != null else -1.0})
	return out


## Index of the point shown (or clicked) nearest to raster px `at` within `radius` px, else -1. Ties go to the
## earlier point (a grid corner over the crossing at the same spot).
static func nearest(pts: Array, at: Vector2, radius: float) -> int:
	var best := -1
	var bd := radius
	for i in pts.size():
		for key in ["click", "shown"]:
			var v: Variant = pts[i][key]
			if v != null and (v as Vector2).distance_to(at) < bd:
				bd = (v as Vector2).distance_to(at)
				best = i
	return best
