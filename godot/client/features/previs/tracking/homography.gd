extends RefCounted
## WO-616 T2 — plane → screen homography (normalised DLT) and its decomposition into a pinhole camera with square
## pixels and the principal point at the canvas centre. Pure float64; camera_model.gd wraps it as solve_floor().
##
## Ported from OpenFollow (https://github.com/openfollowapp/openfollow @ 2f8aa257, AGPL-3.0-or-later):
## openfollow/scene/solver.py (_normalize_points, compute_homography, decompose_homography).
## Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz.
## Changes: GDScript; ≥ 4 points solved as least squares with h33 = 1 (normal equations, Gaussian elimination) in
## place of the SVD null vector — the same answer for exactly 4 points while h33 ≠ 0, which holds for any camera
## that sees the plane origin in front of it; no output rounding.

const POSE_PITCH_LIMIT := 89.0
const POSE_FOV_RANGE := [10.0, 170.0]
const GIMBAL_COS_PITCH_EPS := 1e-3


## Hartley normalisation: centroid → origin, mean distance → √2. Returns {pts, t: 3×3 row-major}.
static func _normalize(pts: Array) -> Dictionary:
	var mx := 0.0
	var my := 0.0
	for p in pts:
		mx += float(p[0]); my += float(p[1])
	mx /= pts.size(); my /= pts.size()
	var avg := 0.0
	for p in pts:
		avg += Vector2(float(p[0]) - mx, float(p[1]) - my).length()
	avg /= pts.size()
	if avg < 1e-12:
		return {"pts": pts.duplicate(true), "t": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]}
	var s := sqrt(2.0) / avg
	var out := []
	for p in pts:
		out.append([s * (float(p[0]) - mx), s * (float(p[1]) - my)])
	return {"pts": out, "t": [s, 0.0, -s * mx, 0.0, s, -s * my, 0.0, 0.0, 1.0]}


## H (3×3 row-major, H[8] = 1) with s·[sx, sy, 1]ᵀ = H·[px, py, 1]ᵀ; [] when the system is singular.
static func homography(plane: Array, screen: Array) -> Array:
	var src := _normalize(plane)
	var dst := _normalize(screen)
	var ata := []
	var atb := []
	for i in 8:
		ata.append([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
		atb.append(0.0)
	for i in plane.size():
		var px: float = src.pts[i][0]
		var py: float = src.pts[i][1]
		var qx: float = dst.pts[i][0]
		var qy: float = dst.pts[i][1]
		for row in [[[px, py, 1.0, 0.0, 0.0, 0.0, -qx * px, -qx * py], qx], [[0.0, 0.0, 0.0, px, py, 1.0, -qy * px, -qy * py], qy]]:
			var a: Array = row[0]
			for r in 8:
				atb[r] += a[r] * row[1]
				for c in 8:
					ata[r][c] += a[r] * a[c]
	var hv := _solve(ata, atb)
	if hv.is_empty():
		return []
	hv.append(1.0)
	var hn := _mul(_inverse_similarity(dst.t), _mul(hv, src.t))  # H = T_dst⁻¹ · H_n · T_src
	if absf(hn[8]) > 1e-12:
		for i in 9:
			hn[i] /= hn[8]
	return hn


## Camera {pos_*, pitch, yaw, roll, fov (horizontal)} from H at plane height z_offset; {} when invalid.
static func decompose_homography(hm: Array, w: float, h: float, z_offset: float) -> Dictionary:
	var h1 := [hm[0], hm[3], hm[6]]
	var h2 := [hm[1], hm[4], hm[7]]
	var h3 := [hm[2], hm[5], hm[8]]
	var cw2 := w / 2.0
	var ch2 := h / 2.0
	var a: float = h1[0] - cw2 * h1[2]
	var b: float = h1[1] - ch2 * h1[2]
	var d: float = h2[0] - cw2 * h2[2]
	var e: float = h2[1] - ch2 * h2[2]
	var denom_orth: float = h1[2] * h2[2]
	var numer_orth := -(a * d + b * e)
	var denom_norm: float = h2[2] * h2[2] - h1[2] * h1[2]
	var numer_norm := a * a + b * b - d * d - e * e
	var ls_num := denom_orth * numer_orth + denom_norm * numer_norm
	var ls_den := denom_orth * denom_orth + denom_norm * denom_norm
	var fp2: float
	if ls_den > 1e-20 and ls_num / ls_den > 0.0:
		fp2 = ls_num / ls_den
	else:  # near-affine (camera nearly top-down)
		var avg_n := (sqrt(a * a + b * b + h1[2] * h1[2]) + sqrt(d * d + e * e + h2[2] * h2[2])) / 2.0
		if avg_n < 1e-12:
			return {}
		fp2 = avg_n * avg_n
	var fp := sqrt(fp2)
	var vfov := rad_to_deg(2.0 * atan(h / (2.0 * fp)))
	var fov := rad_to_deg(2.0 * atan(tan(deg_to_rad(vfov) / 2.0) * (w / h)))
	if fov < 10.0 or fov > 170.0:
		return {}
	var kinv := func(col: Array) -> Array:
		return [(col[0] - cw2 * col[2]) / fp, -(col[1] - ch2 * col[2]) / fp, col[2]]
	var v1: Array = kinv.call(h1)
	var v2: Array = kinv.call(h2)
	var v3: Array = kinv.call(h3)
	var lam := _len(v1)
	if lam < 1e-12:
		return {}
	if v3[2] / lam < 0.0:
		lam = -lam
	var b1 := v1.map(func(x: float) -> float: return x / lam)
	var b2 := v2.map(func(x: float) -> float: return x / lam)
	var b3 := v3.map(func(x: float) -> float: return x / lam)
	var r0 := [b1[0], b1[1], -b1[2]]
	var r2 := [-b2[0], -b2[1], b2[2]]
	var n0 := _len(r0)
	if n0 < 1e-12:
		return {}
	r0 = r0.map(func(x: float) -> float: return x / n0)
	var dot: float = r2[0] * r0[0] + r2[1] * r0[1] + r2[2] * r0[2]
	r2 = [r2[0] - dot * r0[0], r2[1] - dot * r0[1], r2[2] - dot * r0[2]]
	var n2 := _len(r2)
	if n2 < 1e-12:
		return {}
	r2 = r2.map(func(x: float) -> float: return x / n2)
	var r1 := [r2[1] * r0[2] - r2[2] * r0[1], r2[2] * r0[0] - r2[0] * r0[2], r2[0] * r0[1] - r2[1] * r0[0]]
	var rm := [r0, r1, r2]  # rows of the camera → world rotation
	var tv := [b3[0], b3[1], -b3[2]]
	var cam_g := []
	var origin := [0.0, z_offset, 0.0]
	for i in 3:
		cam_g.append(origin[i] - (rm[i][0] * tv[0] + rm[i][1] * tv[1] + rm[i][2] * tv[2]))
	var pitch := asin(clampf(-rm[1][2], -1.0, 1.0))
	var neg_yaw := 0.0
	var roll: float
	if absf(cos(pitch)) > GIMBAL_COS_PITCH_EPS:
		neg_yaw = atan2(rm[0][2], rm[2][2])
		roll = atan2(rm[1][0], rm[1][1])
	else:  # straight down: pin the pan, roll carries the rotation
		roll = atan2(-rm[0][1], rm[0][0])
	return {"pos_x": cam_g[0], "pos_y": -cam_g[2], "pos_z": cam_g[1],
		"pitch": clampf(rad_to_deg(pitch), -POSE_PITCH_LIMIT, POSE_PITCH_LIMIT),
		"yaw": -rad_to_deg(neg_yaw) + 0.0, "roll": rad_to_deg(roll),
		"fov": clampf(fov, POSE_FOV_RANGE[0], POSE_FOV_RANGE[1]), "lens_k1": 0.0, "lens_k2": 0.0}


## Gaussian elimination with partial pivoting; [] when singular.
static func _solve(a_in: Array, b_in: Array) -> Array:
	var n := b_in.size()
	var a := a_in.duplicate(true)
	var b := b_in.duplicate()
	for col in n:
		var piv := col
		for r in range(col + 1, n):
			if absf(a[r][col]) > absf(a[piv][col]):
				piv = r
		if absf(a[piv][col]) < 1e-14:
			return []
		if piv != col:
			var tr: Array = a[col]; a[col] = a[piv]; a[piv] = tr
			var tb: float = b[col]; b[col] = b[piv]; b[piv] = tb
		for r in range(col + 1, n):
			var k: float = a[r][col] / a[col][col]
			for c in range(col, n):
				a[r][c] -= k * a[col][c]
			b[r] -= k * b[col]
	var x := []
	x.resize(n)
	for r in range(n - 1, -1, -1):
		var s: float = b[r]
		for c in range(r + 1, n):
			s -= a[r][c] * x[c]
		x[r] = s / a[r][r]
	return x


static func _mul(p: Array, q: Array) -> Array:
	var out := []
	for r in 3:
		for c in 3:
			out.append(p[r * 3] * q[c] + p[r * 3 + 1] * q[3 + c] + p[r * 3 + 2] * q[6 + c])
	return out


## Inverse of a normalisation matrix [s 0 tx; 0 s ty; 0 0 1].
static func _inverse_similarity(t: Array) -> Array:
	var s: float = t[0]
	return [1.0 / s, 0.0, -t[2] / s, 0.0, 1.0 / s, -t[5] / s, 0.0, 0.0, 1.0]


static func _len(v: Array) -> float:
	return sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
