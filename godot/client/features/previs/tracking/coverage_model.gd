extends RefCounted
## WO-616 T10c — tracking-camera coverage for the two-camera workflow's placement step: which cameras see a person
## standing on each cell of the tracking grid (feet AND head top in the picture, through the camera's lens), each
## camera's frustum and floor footprint for the 3D stage, and how far apart the cameras look at the grid centre
## (fusion triangulates only rays ≥ 8° apart; 45–90° is the placement advice). Every camera counts, calibrated or
## not, so a pose can be planned by typing numbers before the rig exists. Pure: PSN metres, no nodes.

const C := preload("res://features/previs/tracking/camera_model.gd")

const CELL_M := 0.25
const MAX_CELLS := 40000  # a 200 m grid at 0.25 m would be 640k cells — the cell grows instead
const HEAD_M := 1.75  # the person whose feet and head must both be in the picture
const FAR_M := 30.0  # frustum / footprint reach past which nothing is drawn
const EDGE_SEGMENTS := 16  # per picture edge, so the footprint bends with the lens
const ADVISED_DEG := 45.0


## Is world point p in camera entry ce's picture (in front, inside the raster after the lens, before its fold)?
static func sees(ce: Dictionary, p: Array) -> bool:
	return seen(ce, [p])[0] == 1


## seen() for many points at once (one projection pass): PackedByteArray of 1 / 0 per point.
static func seen(ce: Dictionary, pts: Array) -> PackedByteArray:
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var k1 := float(ce.cam.lens_k1)
	var k2 := float(ce.cam.lens_k2)
	var hd := 0.5 * sqrt(w * w + h * h)
	var fold := C.lens_fold_radius(k1, k2)
	var px: Array = C.project(ce.cam, pts, w, h)
	var out := PackedByteArray()
	out.resize(pts.size())
	if px.is_empty():
		return out
	for i in px.size():
		if px[i] != null and Vector2(px[i][0] - w / 2.0, px[i][1] - h / 2.0).length() / hd >= fold:
			px[i] = null  # past a barrel fold the lens maps it back inside the frame — not really seen
	var d: Array = C.apply_distortion(px, w, h, k1, k2)
	for i in d.size():
		var q: Variant = d[i]
		out[i] = 1 if q != null and q[0] >= 0.0 and q[0] <= w and q[1] >= 0.0 and q[1] <= h else 0
	return out


## Coverage of grid g (tracking_model grid) by cameras: {nx, ny, cell, x0, y0, z, masks: PackedInt32Array (bit i =
## camera i sees a person on that cell, row-major from downstage-right), area: m² per cell, one: m² seen by exactly
## one camera, two: m² seen by 2+, total: m²}. Cameras past 31 are ignored (bit mask).
static func coverage(cams: Array, g: Dictionary) -> Dictionary:
	var cell := CELL_M
	while ceili(g.width / cell) * ceili(g.depth / cell) > MAX_CELLS:
		cell *= 2.0
	var nx := ceili(g.width / cell - 1e-9)
	var ny := ceili(g.depth / cell - 1e-9)
	var cx: float = g.width / nx  # cells fill the grid exactly
	var cy: float = g.depth / ny
	var x0: float = g.x_offset - g.width / 2.0
	var y0: float = g.y_offset - g.depth / 2.0
	var z: float = g.z_offset
	var feet := []
	var heads := []
	for j in ny:
		for i in nx:
			var x: float = x0 + (i + 0.5) * cx
			var y: float = y0 + (j + 0.5) * cy
			feet.append([x, y, z])
			heads.append([x, y, z + HEAD_M])
	var masks := PackedInt32Array()
	masks.resize(nx * ny)
	for k in mini(cams.size(), 31):
		var sf := seen(cams[k], feet)
		var sh := seen(cams[k], heads)
		for c in masks.size():
			if sf[c] == 1 and sh[c] == 1:
				masks[c] |= 1 << k
	var one := 0
	var two := 0
	for m in masks:
		var n := _bits(m)
		if n == 1:
			one += 1
		elif n >= 2:
			two += 1
	var a: float = cx * cy
	return {"nx": nx, "ny": ny, "cx": cx, "cy": cy, "x0": x0, "y0": y0, "z": z, "masks": masks, "area": a,
		"one": one * a, "two": two * a, "total": nx * ny * a}


## Horizontal angle (deg, 0–180) between two cameras as seen from point p — how differently they look at a person
## there. 0 for co-located cameras.
static func separation(a: Dictionary, b: Dictionary, p: Array) -> float:
	var va := Vector2(float(a.cam.pos_x) - p[0], float(a.cam.pos_y) - p[1])
	var vb := Vector2(float(b.cam.pos_x) - p[0], float(b.cam.pos_y) - p[1])
	if va.length() < 1e-6 or vb.length() < 1e-6:
		return 0.0
	return rad_to_deg(absf(va.angle_to(vb)))


## Every camera pair's separation at the grid centre: [{a, b, deg}] (camera ids).
static func pairs(cams: Array, g: Dictionary) -> Array:
	var c := [g.x_offset, g.y_offset]
	var out := []
	for i in cams.size():
		for j in range(i + 1, cams.size()):
			out.append({"a": cams[i].id, "b": cams[j].id, "deg": separation(cams[i], cams[j], c)})
	return out


## The world ray through lens pixel px: {o: [x, y, z], d: unit [x, y, z]} (PSN).
static func ray(ce: Dictionary, px: Array) -> Dictionary:
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var cam: Dictionary = ce.cam
	var u: Array = C.invert_distortion([px], w, h, float(cam.lens_k1), float(cam.lens_k2))[0]
	var aspect := w / h
	var f := 1.0 / tan(deg_to_rad(C.hfov_to_vfov(cam.fov, aspect)) / 2.0)
	var dx := ((float(u[0]) / w) * 2.0 - 1.0) * aspect / f
	var dy := (1.0 - (float(u[1]) / h) * 2.0) / f
	var r := C.rotation(cam.pitch, cam.yaw, cam.roll)
	var g := Vector3(r[0] * dx + r[1] * dy - r[2], r[3] * dx + r[4] * dy - r[5], r[6] * dx + r[7] * dy - r[8]).normalized()
	return {"o": [float(cam.pos_x), float(cam.pos_y), float(cam.pos_z)], "d": [g.x, -g.z, g.y]}  # Godot → PSN


## Where the ray through px ends for drawing: its floor hit (plane z) within FAR_M, else FAR_M along it.
## {p: [x, y, z], floor: bool}.
static func reach(ce: Dictionary, px: Array, z: float) -> Dictionary:
	var r := ray(ce, px)
	var t := FAR_M
	var hit := false
	if r.d[2] < -1e-9:
		var tf: float = (z - r.o[2]) / r.d[2]
		if tf > 0.0 and tf <= FAR_M:
			t = tf
			hit = true
	return {"p": [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t], "floor": hit}


## The 4 picture corners' reach (TL, TR, BR, BL) — the frustum's far ends.
static func frustum(ce: Dictionary, z: float) -> Array:
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var out := []
	for px in [[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]]:
		out.append(reach(ce, px, z).p)
	return out


## The picture border's floor footprint as polylines (PSN points), split where the border leaves the floor (above
## the horizon or past FAR_M). Lens-correct: EDGE_SEGMENTS samples per edge.
static func footprint(ce: Dictionary, z: float) -> Array:
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var corners := [[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]]
	var lines := []
	var cur := []
	var first_floor := false
	for e in 4:
		var a: Array = corners[e]
		var b: Array = corners[(e + 1) % 4]
		for s in EDGE_SEGMENTS + (1 if e == 3 else 0):  # the last edge also samples the closing corner
			var f := float(s) / EDGE_SEGMENTS
			var r := reach(ce, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], z)
			if e == 0 and s == 0:
				first_floor = r.floor
			if r.floor:
				cur.append(r.p)
			else:
				if cur.size() >= 2:
					lines.append(cur)
				cur = []
	if cur.size() >= 2:
		lines.append(cur)
	if lines.size() >= 2 and first_floor and cur.size() >= 2:  # cur = the last line, ending on the start corner
		lines[0] = lines.pop_back() + lines[0]  # the ring runs through the start corner: one polyline, not two
	return lines


static func _bits(m: int) -> int:
	var n := 0
	while m != 0:
		n += m & 1
		m >>= 1
	return n
