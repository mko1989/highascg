extends RefCounted
## WO-634 T1 — pure helpers for "MVR object → LED screen" (mvr_screens.gd). A Capture LED wall is not one object: it is
## one 0.5 × 0.5 m SceneObject per panel (Pabianice: a 20 × 8 centre wall and two 2 × 8 totems = 192 objects), so a
## click selects the panel's wall = the touching objects of the same model (`cluster`). The wall's frame comes from the
## clicked object's boxes (`wall_frame`: thinnest axis = picture normal, towards the viewer; the axis nearest world up =
## height), its panel count from that object's own size, and the result is a WO-614 LED wall (stage_objects.gd) whose
## crops are packed left → right, top-aligned, into one destination canvas (`pack`) — one media-server output feeding
## several walls through the sending card's map. Frame = the previs stage's (Godot, Y up, metres); +X = audience right.

const S := preload("res://features/previs/stage_objects.gd")


## Objects connected to `seed` through touching boxes (grown by `gap` m) that share its `key` (model signature).
## items: [{uuid, key, box: AABB}] → uuids, seed first.
## Grid-bucketed (cell ≥ the largest box + gap, so touching boxes are in neighbouring cells): guttmany's 1248-object
## wall in a 1374-object pool took 536 ms as a full rescan per member.
static func cluster(items: Array, seed: String, gap := 0.05) -> Array:
	var key := ""
	for it in items:
		if str(it.uuid) == seed:
			key = str(it.key)
	var box := {}
	var cell := gap
	for it in items:
		if str(it.key) == key:
			box[str(it.uuid)] = it.box
			var s: Vector3 = (it.box as AABB).size
			cell = maxf(cell, maxf(s.x, maxf(s.y, s.z)) + gap)
	var grid := {}
	for u in box:
		var c := Vector3i(((box[u] as AABB).get_center() / cell).floor())
		if not grid.has(c):
			grid[c] = []
		grid[c].append(u)
	var out := [seed]
	var seen := {seed: true}
	var i := 0
	while i < out.size():
		var a := (box[out[i]] as AABB).grow(gap)
		var c := Vector3i((a.get_center() / cell).floor())
		for dx in [-1, 0, 1]:
			for dy in [-1, 0, 1]:
				for dz in [-1, 0, 1]:
					for u in grid.get(c + Vector3i(dx, dy, dz), []):
						if not seen.has(u) and a.intersects(box[u] as AABB):
							seen[u] = true
							out.append(u)
		i += 1
	return out


static func _corners(b: Dictionary) -> Array:
	var box: AABB = b.aabb
	var xf: Transform3D = b.xf
	var out := []
	for k in 8:
		out.append(xf * box.get_endpoint(k))
	return out


## objects: per wall object, its boxes [{xf: Transform3D (mesh → stage), aabb: AABB (mesh local)}]; objects[0] = the one
## clicked (axes + panel cell). toward = the viewer (camera position, stage frame).
## → {basis (X width, Y up, Z out of the picture), origin (front face, bottom centre), size: Vector2 m, cell: Vector2 m}
static func wall_frame(objects: Array, toward: Vector3) -> Dictionary:
	var first: Array = objects[0]
	var big: Dictionary = first[0]  # the object's main box (a panel = body + a flat face part)
	for b in first:
		var s: Vector3 = (b.aabb as AABB).size
		var sb: Vector3 = (big.aabb as AABB).size
		if s.x + s.y + s.z > sb.x + sb.y + sb.z:
			big = b
	var basis: Basis = (big.xf as Transform3D).basis
	var ext := []
	for i in 3:
		ext.append((big.aabb as AABB).size[i] * basis[i].length())
	var thin := 0
	for i in 3:
		if ext[i] < ext[thin]:
			thin = i
	var others := [0, 1, 2].filter(func(i: int) -> bool: return i != thin)
	var up_i: int = others[0] if absf(basis[others[0]].normalized().dot(Vector3.UP)) >= absf(basis[others[1]].normalized().dot(Vector3.UP)) else others[1]
	var y: Vector3 = basis[up_i].normalized()
	if y.dot(Vector3.UP) < 0.0:
		y = -y
	var n: Vector3 = basis[thin].normalized()
	var centre: Vector3 = (big.xf as Transform3D) * (big.aabb as AABB).get_center()
	if n.dot(toward - centre) < 0.0:
		n = -n
	var x := y.cross(n).normalized()
	y = n.cross(x).normalized()
	var all := _span(objects, centre, x, y, n)
	var one := _span([first], centre, x, y, n)
	var origin: Vector3 = centre + x * (all[0].x + all[1].x) / 2.0 + y * all[0].y + n * all[1].z
	return {"basis": Basis(x, y, n), "origin": origin, "size": Vector2(all[1].x - all[0].x, all[1].y - all[0].y),
		"cell": Vector2(one[1].x - one[0].x, one[1].y - one[0].y), "depth": all[1].z - all[0].z}


## The same wall with its picture on the other side (the operator clicked it from backstage — Capture's panel face
## plate is no guide: ATM's panels are the same mesh as WEKTORY's, turned 180°).
static func turned(frame: Dictionary) -> Dictionary:
	var b: Basis = frame.basis
	var out := frame.duplicate()
	out["basis"] = Basis(-b.x, b.y, -b.z)
	out["origin"] = (frame.origin as Vector3) - b.z * float(frame.get("depth", 0.0))
	return out


## [min, max] of every corner in (x, y, n) coordinates around `ref`.
static func _span(objects: Array, ref: Vector3, x: Vector3, y: Vector3, n: Vector3) -> Array:
	var lo := Vector3(INF, INF, INF)
	var hi := -lo
	for boxes in objects:
		for b in boxes:
			for p in _corners(b):
				var d: Vector3 = p - ref
				var q := Vector3(d.dot(x), d.dot(y), d.dot(n))
				lo = lo.min(q)
				hi = hi.max(q)
	return [lo, hi]


## A WO-614 LED wall on `frame`. Panels: `panel_mm` (the MVR's own panel size when the wall is several objects, else
## the preset's) into the frame size; pixels per panel from the preset. Source rect = the whole wall (pack places it).
static func wall_object(frame: Dictionary, panel_px: Array, panel_mm: Vector2, role: String, existing: Array) -> Dictionary:
	var o := S.new_object("led_wall", existing)
	var size: Vector2 = frame.size
	o["panel_px"] = panel_px.duplicate()
	o["panel_mm"] = [snappedf(panel_mm.x, 0.1), snappedf(panel_mm.y, 0.1)]
	o["panels"] = [maxi(1, roundi(size.x * 1000.0 / panel_mm.x)), maxi(1, roundi(size.y * 1000.0 / panel_mm.y))]
	var p: Vector3 = frame.origin
	o["position"] = [snappedf(p.x, 0.001), snappedf(p.y, 0.001), snappedf(p.z, 0.001)]
	var r: Vector3 = (frame.basis as Basis).get_euler(EULER_ORDER_YXZ)
	o["rotation"] = [snappedf(rad_to_deg(r.x), 0.01), snappedf(rad_to_deg(r.y), 0.01), snappedf(rad_to_deg(r.z), 0.01)]
	o = S.normalize(o)
	var px := S.pixels(o)
	o["source"] = {"role": role, "rect": {"x": 0, "y": 0, "w": px.x, "h": px.y}}
	return o


## Pixels of a `panel_mm` panel at `pitch` mm (Narvill's 500 × 1000 panels at P3.9 → 128 × 256, not the preset's square).
static func panel_px_for(panel_mm: Vector2, pitch: float) -> Array:
	return [maxi(1, roundi(panel_mm.x / pitch)), maxi(1, roundi(panel_mm.y / pitch))]


## Panel size to build with: a multi-object wall's own panel (its clicked object), else the preset's.
static func panel_mm_for(frame: Dictionary, multi: bool, preset_mm: Array) -> Vector2:
	var cell: Vector2 = frame.cell
	if multi and cell.x > 0.05 and cell.y > 0.05:
		return cell * 1000.0
	return Vector2(float(preset_mm[0]), float(preset_mm[1]))


## Crops packed left → right as the audience sees them (along the first wall's width axis: stage +X for walls facing
## +Z, −X for guttmany's / Narvill's facing −Z), top-aligned from 0,0, at the walls' native pixels.
## A canvas bigger than `raster` (when given) is scaled into it, proportions kept — the media server's one output still
## covers every wall, as the owner's rig is fed. → {objects (copies, same order as given), canvas (native), scale (≤ 1)}
static func pack(walls: Array, raster := Vector2i.ZERO) -> Dictionary:
	var order := range(walls.size())
	var rot: Array = walls[0].rotation if not walls.is_empty() else [0, 0, 0]
	var across := Basis.from_euler(Vector3(deg_to_rad(rot[0]), deg_to_rad(rot[1]), deg_to_rad(rot[2])), EULER_ORDER_YXZ).x
	var along := func(o: Dictionary) -> float: return Vector3(o.position[0], o.position[1], o.position[2]).dot(across)
	order.sort_custom(func(a: int, b: int) -> bool: return along.call(walls[a]) < along.call(walls[b]))
	var out := walls.map(func(o: Dictionary) -> Dictionary: return o.duplicate(true))
	var x := 0
	var h := 0
	for i in order:
		var px := S.pixels(out[i])
		out[i].source.rect = {"x": x, "y": 0, "w": px.x, "h": px.y}
		x += px.x
		h = maxi(h, px.y)
	var k := 1.0
	if raster.x > 0 and raster.y > 0 and x > 0 and h > 0:
		k = minf(1.0, minf(float(raster.x) / x, float(raster.y) / h))
	if k < 1.0:
		for o in out:
			var r: Dictionary = o.source.rect
			var x0 := roundi(r.x * k)
			o.source.rect = {"x": x0, "y": 0, "w": maxi(1, roundi((r.x + r.w) * k) - x0), "h": maxi(1, roundi(r.h * k))}
	return {"objects": out, "canvas": Vector2i(x, h), "scale": k}


## Operator note for a packed canvas against the destination raster ("" = fits).
static func fit_note(canvas: Vector2i, raster: Vector2i) -> String:
	if canvas.x <= raster.x and canvas.y <= raster.y:
		return ""
	var k := minf(float(raster.x) / canvas.x, float(raster.y) / canvas.y)
	return "The walls are %d × %d px, the destination %d × %d: the canvas is scaled ×%.2f into it (%d × %d)." % [
		canvas.x, canvas.y, raster.x, raster.y, k, roundi(canvas.x * k), roundi(canvas.y * k)]
