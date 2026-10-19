extends RefCounted
## WO-616 T2 — tracking camera model: pinhole project / unproject, radial lens k1/k2, and the 4+-point floor
## calibration (normalised DLT homography → pose + horizontal fov). Pure and float64 (plain floats / Arrays — Godot's
## Vector3/Basis are float32, too coarse for the golden pixels in the tests).
##
## Ported from OpenFollow (https://github.com/openfollowapp/openfollow @ 2f8aa257, AGPL-3.0-or-later):
## openfollow/scene/solver.py, openfollow/lens_model.py, openfollow/scene/camera.py.
## Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz.
## Changes: GDScript; NaN rows → null; the homography takes ≥ 4 points (least squares, h33 = 1) instead of exactly 4;
## no output rounding; the SVD "closest rotation" step is dropped (Gram–Schmidt + r1 = r2 × r0 is already proper).
##
## Frames: tracking/world = PSN metres, X = stage left, Y = upstage, Z = up. Godot / previs = (x, z, -y)
## (stage objects face +Z = the audience). Screen = pixels, origin top-left, Y down.
## Camera = { pos_x, pos_y, pos_z, pitch, yaw, roll (deg), fov (HORIZONTAL deg), lens_k1, lens_k2 }.

const Hg := preload("res://features/previs/tracking/homography.gd")

const FOV_MIN := 1.0
const FOV_MAX := 179.0
const MAX_REPROJ_PX := 20.0  # a solve that misses its own input by more is refused
const _INVERT_ITERS := 40
const _INVERT_SETTLED := 1e-14
const _INVERT_R_CAP := 4.0
const _MAX_COEFFICIENT := 1e3
const PULL_BACK_MARGIN := 0.01


static func camera(px := 0.0, py := -10.0, pz := 5.0, pitch := -20.0, yaw := 0.0, roll := 0.0, fov := 60.0) -> Dictionary:
	return {"pos_x": px, "pos_y": py, "pos_z": pz, "pitch": pitch, "yaw": yaw, "roll": roll,
		"fov": clampf(fov, FOV_MIN, FOV_MAX), "lens_k1": 0.0, "lens_k2": 0.0}


static func psn_to_godot(p: Array) -> Vector3:
	return Vector3(p[0], p[2], -float(p[1]))


static func godot_to_psn(v: Vector3) -> Array:
	return [float(v.x), -float(v.z), float(v.y)]


static func hfov_to_vfov(hfov: float, aspect: float) -> float:
	return rad_to_deg(2.0 * atan(tan(deg_to_rad(hfov) / 2.0) / aspect))


static func vfov_to_hfov(vfov: float, aspect: float) -> float:
	return rad_to_deg(2.0 * atan(tan(deg_to_rad(vfov) / 2.0) * aspect))


static func valid_view(cam: Dictionary, w: float, h: float) -> bool:
	var fov := float(cam.get("fov", 0.0))
	return fov >= FOV_MIN and fov <= FOV_MAX and is_finite(w) and w > 0.0 and is_finite(h) and h > 0.0


## Camera → world rotation (Y-up frame), row-major 9 floats. Pan about up, tilt about the camera's own right
## axis, roll about the optical axis: R = Ry(-yaw) · Rx(pitch) · Rz(roll).
static func rotation(pitch: float, yaw: float, roll: float) -> Array:
	var a := deg_to_rad(pitch)
	var b := -deg_to_rad(yaw)
	var c := deg_to_rad(roll)
	var ca := cos(a); var sa := sin(a); var cb := cos(b); var sb := sin(b); var cc := cos(c); var sc := sin(c)
	return [cb * cc + sb * sa * sc, -cb * sc + sb * sa * cc, sb * ca,
		ca * sc, ca * cc, -sa,
		-sb * cc + cb * sa * sc, sb * sc + cb * sa * cc, cb * ca]


## The solved camera as a Godot transform (Camera3D looks along -Z like this model). Use vfov for Camera3D.fov
## (KEEP_HEIGHT).
static func godot_transform(cam: Dictionary) -> Transform3D:
	var r := rotation(cam.pitch, cam.yaw, cam.roll)
	var basis := Basis(Vector3(r[0], r[3], r[6]), Vector3(r[1], r[4], r[7]), Vector3(r[2], r[5], r[8]))
	return Transform3D(basis, psn_to_godot([cam.pos_x, cam.pos_y, cam.pos_z]))


## World PSN points [[x, y, z], …] → screen [[sx, sy] | null, …] (null = at / behind the camera). Pinhole only.
static func project(cam: Dictionary, pts: Array, w: float, h: float) -> Array:
	var out := []
	if not valid_view(cam, w, h):
		return out
	var r := rotation(cam.pitch, cam.yaw, cam.roll)
	var cx := float(cam.pos_x); var cy := float(cam.pos_z); var cz := -float(cam.pos_y)
	var aspect := w / h
	var f := 1.0 / tan(deg_to_rad(hfov_to_vfov(cam.fov, aspect)) / 2.0)
	for p in pts:
		var tx: float = float(p[0]) - cx
		var ty: float = float(p[2]) - cy
		var tz: float = -float(p[1]) - cz
		var vx: float = r[0] * tx + r[3] * ty + r[6] * tz  # Rᵀ · t
		var vy: float = r[1] * tx + r[4] * ty + r[7] * tz
		var vz: float = r[2] * tx + r[5] * ty + r[8] * tz
		if vz >= -1e-9:
			out.append(null)
			continue
		var nx := (f / aspect) * (vx / -vz)
		var ny := f * (vy / -vz)
		out.append([(nx + 1.0) / 2.0 * w, (1.0 - ny) / 2.0 * h])
	return out


## Screen points → PSN points on the horizontal plane z = plane_z ([x, y, z] | null when the ray misses). Pinhole
## only: undistort clicks with invert_distortion first.
static func unproject(cam: Dictionary, screen: Array, w: float, h: float, plane_z := 0.0) -> Array:
	var out := []
	if not valid_view(cam, w, h):
		return out
	var r := rotation(cam.pitch, cam.yaw, cam.roll)
	var cx := float(cam.pos_x); var cy := float(cam.pos_z); var cz := -float(cam.pos_y)
	var aspect := w / h
	var f := 1.0 / tan(deg_to_rad(hfov_to_vfov(cam.fov, aspect)) / 2.0)
	for s in screen:
		if s == null:
			out.append(null)
			continue
		var dx := ((float(s[0]) / w) * 2.0 - 1.0) * aspect / f
		var dy := (1.0 - (float(s[1]) / h) * 2.0) / f
		var wx: float = r[0] * dx + r[1] * dy - r[2]  # R · (dx, dy, -1)
		var wy: float = r[3] * dx + r[4] * dy - r[5]
		var wz: float = r[6] * dx + r[7] * dy - r[8]
		if absf(wy) < 1e-12:
			out.append(null)
			continue
		var t := (plane_z - cy) / wy
		if t <= 0.0:
			out.append(null)
			continue
		out.append([cx + t * wx, -(cz + t * wz), cy + t * wy])
	return out


## Per-point reprojection error (px) and RMS of a camera against correspondences; a point behind the lens = INF.
static func reprojection(cam: Dictionary, world: Array, screen: Array, w: float, h: float) -> Dictionary:
	var proj := project(cam, world, w, h)
	var errs := []
	var sum := 0.0
	for i in screen.size():
		var p: Variant = proj[i] if i < proj.size() else null
		var e := INF if p == null else Vector2(p[0] - screen[i][0], p[1] - screen[i][1]).length()
		errs.append(e)
		sum += e * e
	return {"errors": errs, "rms": sqrt(sum / maxf(1.0, errs.size())) if not errs.is_empty() else INF}


# --- radial lens (r normalised to the half-diagonal; f(r) = 1 + k1 r² + k2 r⁴) ---------------------------------

## Normalised radius where r·f(r) first stops growing (the warp folds); INF when it never does.
static func lens_fold_radius(k1: float, k2: float) -> float:
	if k2 == 0.0:
		return sqrt(-1.0 / (3.0 * k1)) if k1 < 0.0 else INF
	var disc := 9.0 * k1 * k1 - 20.0 * k2
	if disc < 0.0:
		return INF
	var q := -0.5 * (3.0 * k1 + (sqrt(disc) if (3.0 * k1 if k1 != 0.0 else 1.0) >= 0.0 else -sqrt(disc)))
	var best := INF
	for s in [q / (5.0 * k2), 1.0 / q if q != 0.0 else INF]:
		if s > 0.0:
			best = minf(best, s)
	return sqrt(best) if best < INF else INF


static func lens_warp_is_valid(k1: float, k2: float) -> bool:
	if not (is_finite(k1) and is_finite(k2)) or maxf(absf(k1), absf(k2)) > _MAX_COEFFICIENT:
		return false
	return lens_fold_radius(k1, k2) > 1.0


## The pair itself when valid, else the largest valid t·(k1, k2) less a margin.
static func pull_back_to_fold(k1: float, k2: float) -> Array:
	if not (is_finite(k1) and is_finite(k2)):
		return [0.0, 0.0]
	if lens_warp_is_valid(k1, k2):
		return [k1, k2]
	var lo := 0.0
	var hi := minf(1.0, _MAX_COEFFICIENT / maxf(absf(k1), absf(k2)))
	for _i in 60:
		var mid := 0.5 * (lo + hi)
		if lens_warp_is_valid(mid * k1, mid * k2):
			lo = mid
		else:
			hi = mid
	var t := lo * (1.0 - PULL_BACK_MARGIN)
	return [t * k1, t * k2]


## Solve r·f(r) = r_d for the pinhole radius (bracketed Newton); past a barrel fold → the fold radius.
static func invert_radius(rd: float, k1: float, k2: float) -> float:
	var r_max := minf(lens_fold_radius(k1, k2), _INVERT_R_CAP)
	var lo := 0.0
	var hi := r_max
	var r := minf(rd, r_max)
	for _i in _INVERT_ITERS:
		var r2 := r * r
		var hv := r * (1.0 + k1 * r2 + k2 * r2 * r2) - rd
		var slope := 1.0 + 3.0 * k1 * r2 + 5.0 * k2 * r2 * r2
		if hv < 0.0:
			lo = r
		if hv > 0.0:
			hi = r
		var cand := r - hv / slope if slope > 1e-12 else NAN
		var moved := 0.5 * (lo + hi) if (is_nan(cand) or cand < lo or cand > hi) else cand
		var done := absf(moved - r) <= _INVERT_SETTLED
		r = moved
		if done:
			break
	return r


## Pinhole screen points → where the (k1, k2) lens shows them. null passes through.
static func apply_distortion(pts: Array, w: float, h: float, k1: float, k2: float) -> Array:
	return _radial(pts, w, h, k1, k2, false)


## Inverse of apply_distortion: a click on the distorted video → the pinhole point unproject() expects.
static func invert_distortion(pts: Array, w: float, h: float, k1: float, k2: float) -> Array:
	return _radial(pts, w, h, k1, k2, true)


static func _radial(pts: Array, w: float, h: float, k1: float, k2: float, inverse: bool) -> Array:
	if k1 == 0.0 and k2 == 0.0:
		return pts.duplicate(true)
	var cx := w / 2.0
	var cy := h / 2.0
	var hd := 0.5 * sqrt(w * w + h * h)
	var out := []
	for p in pts:
		if p == null:
			out.append(null)
			continue
		var dx := (float(p[0]) - cx) / hd
		var dy := (float(p[1]) - cy) / hd
		var s: float
		if inverse:
			var rd := sqrt(dx * dx + dy * dy)
			s = invert_radius(rd, k1, k2) / rd if rd > 0.0 else 1.0
		else:
			var r2 := dx * dx + dy * dy
			s = 1.0 + k1 * r2 + k2 * r2 * r2
		out.append([cx + dx * s * hd, cy + dy * s * hd])
	return out


# --- calibration -------------------------------------------------------------------------------------------------

## Camera from ≥ 4 coplanar world points (same z; e.g. the stage-floor corners) and where they appear on screen
## (pinhole pixels). {} when degenerate, outside the pose range, or when the solve misses its own input by > 20 px
## (this also rejects the homography's mirror branch, whose points reproject behind the lens).
static func solve_floor(world: Array, screen: Array, w: float, h: float) -> Dictionary:
	if world.size() < 4 or world.size() != screen.size() or not (w > 0.0 and h > 0.0):
		return {}
	var plane := []
	for p in world:
		plane.append([float(p[0]), float(p[1])])
	var hm := Hg.homography(plane, screen)
	if hm.is_empty():
		return {}
	var cam := Hg.decompose_homography(hm, w, h, float(world[0][2]))
	if cam.is_empty():
		return {}
	var rep := reprojection(cam, world, screen, w, h)
	for e in rep.errors:
		if not is_finite(e) or e > MAX_REPROJ_PX:
			return {}
	cam["rms"] = rep.rms
	return cam
