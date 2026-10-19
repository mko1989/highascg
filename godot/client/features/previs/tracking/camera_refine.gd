extends RefCounted
## WO-616 T3 — calibration from any mix of points (floor, LED-wall tops, measured marks): Levenberg–Marquardt over the
## pose (pos, pitch, yaw, roll, horizontal fov) and optionally the lens k1 (k1 + k2 with ≥ 8 points), minimising the
## pixel distance between where the camera shows each world point (pinhole + lens) and where the operator clicked it.
## Seeded by the 4-point floor homography when ≥ 4 clicked points share a height, else by the camera as it stands.
## HighAsCG code (not ported); the projection it drives is the OpenFollow port in camera_model.gd.

const C := preload("res://features/previs/tracking/camera_model.gd")
const Hg := preload("res://features/previs/tracking/homography.gd")

const KEYS := ["pos_x", "pos_y", "pos_z", "pitch", "yaw", "roll", "fov"]
const STEPS := [1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-6, 1e-6]  # central-difference half-steps
const ITERS := 60
const MIN_POINTS := 4


## points: [{world: [x, y, z] PSN, screen: [sx, sy] lens pixels}, …]. opts: fit_lens (bool).
## → {ok, cam, rms, errors[], method: "floor+refine" | "refine", error?}
static func calibrate(cam: Dictionary, points: Array, w: float, h: float, opts := {}) -> Dictionary:
	var world := []
	var screen := []
	for p in points:
		if p is Dictionary and p.get("world") is Array and p.get("screen") is Array:
			world.append(p.world)
			screen.append(p.screen)
	if world.size() < MIN_POINTS:
		return {"ok": false, "error": "need at least %d clicked points (have %d)" % [MIN_POINTS, world.size()]}
	var start := cam.duplicate()
	var method := "refine"
	var seed := _floor_seed(cam, world, screen, w, h)
	if not seed.is_empty():
		for k in KEYS:
			start[k] = seed[k]
		method = "floor+refine"
	var fit_lens: bool = opts.get("fit_lens", false) == true
	var n_lens := 0
	if fit_lens:
		n_lens = 2 if world.size() >= 8 else 1
	else:
		start["lens_k1"] = float(cam.get("lens_k1", 0.0))
		start["lens_k2"] = float(cam.get("lens_k2", 0.0))
	var out := refine(start, world, screen, w, h, n_lens)
	if out.is_empty():
		return {"ok": false, "error": "the points do not determine a camera (collinear, or all in one spot?)"}
	var res := residuals(out, world, screen, w, h)
	var errs := []
	var sum := 0.0
	for i in world.size():
		var e := Vector2(res[2 * i], res[2 * i + 1]).length()
		errs.append(e)
		sum += e * e
	return {"ok": true, "cam": out, "rms": sqrt(sum / world.size()), "errors": errs, "method": method}


## Floor homography seed from the largest group of clicked points sharing a height (lens undone with the camera's
## current k1/k2). {} when no 4 coplanar points or the solve fails.
static func _floor_seed(cam: Dictionary, world: Array, screen: Array, w: float, h: float) -> Dictionary:
	var by_z := {}
	for i in world.size():
		var z := snappedf(float(world[i][2]), 0.001)
		if not by_z.has(z):
			by_z[z] = []
		by_z[z].append(i)
	var best: Array = []
	for z in by_z:
		if (by_z[z] as Array).size() > best.size():
			best = by_z[z]
	if best.size() < 4:
		return {}
	var wz := []
	var sz := []
	for i in best:
		wz.append(world[i])
		sz.append(screen[i])
	var pin := C.invert_distortion(sz, w, h, float(cam.get("lens_k1", 0.0)), float(cam.get("lens_k2", 0.0)))
	var s := C.solve_floor(wz, pin, w, h)
	if s.is_empty():  # solve_floor's 20 px gate is for clean input — a noisier seed is still a good start
		var hm := Hg.homography(wz.map(func(p: Array) -> Array: return [float(p[0]), float(p[1])]), pin)
		s = Hg.decompose_homography(hm, w, h, float(wz[0][2])) if not hm.is_empty() else {}
	return s


## [dx0, dy0, dx1, dy1, …] = shown − clicked, in pixels (a point behind the lens counts as 10 000 px).
static func residuals(cam: Dictionary, world: Array, screen: Array, w: float, h: float) -> Array:
	var shown := C.apply_distortion(C.project(cam, world, w, h), w, h, float(cam.get("lens_k1", 0.0)), float(cam.get("lens_k2", 0.0)))
	var out := []
	for i in world.size():
		var p: Variant = shown[i] if i < shown.size() else null
		if p == null:
			out.append_array([1e4, 1e4])
		else:
			out.append_array([float(p[0]) - float(screen[i][0]), float(p[1]) - float(screen[i][1])])
	return out


static func _params(cam: Dictionary, n_lens: int) -> Array:
	var x := []
	for k in KEYS:
		x.append(float(cam[k]))
	if n_lens >= 1:
		x.append(float(cam.get("lens_k1", 0.0)))
	if n_lens >= 2:
		x.append(float(cam.get("lens_k2", 0.0)))
	return x


static func _with(cam: Dictionary, x: Array) -> Dictionary:
	var c := cam.duplicate()
	for i in KEYS.size():
		c[KEYS[i]] = x[i]
	if x.size() > 7:
		c["lens_k1"] = x[7]
	if x.size() > 8:
		c["lens_k2"] = x[8]
	return c


static func _cost(r: Array) -> float:
	var s := 0.0
	for v in r:
		s += v * v
	return s


## LM with a numeric Jacobian; keeps fov in range and the lens valid. {} when the normal equations stay singular.
static func refine(cam: Dictionary, world: Array, screen: Array, w: float, h: float, n_lens := 0) -> Dictionary:
	var x := _params(cam, n_lens)
	var n := x.size()
	var r := residuals(_with(cam, x), world, screen, w, h)
	var cost := _cost(r)
	var lam := 1e-3
	for _it in ITERS:
		var jac := []  # columns
		for j in n:
			var xp := x.duplicate()
			var xm := x.duplicate()
			xp[j] += STEPS[j]
			xm[j] -= STEPS[j]
			var rp := residuals(_with(cam, xp), world, screen, w, h)
			var rm := residuals(_with(cam, xm), world, screen, w, h)
			var col := []
			for i in r.size():
				col.append((rp[i] - rm[i]) / (2.0 * STEPS[j]))
			jac.append(col)
		var jtj := []
		var jtr := []
		for a in n:
			var row := []
			for b in n:
				var s := 0.0
				for i in r.size():
					s += jac[a][i] * jac[b][i]
				row.append(s)
			jtj.append(row)
			var g := 0.0
			for i in r.size():
				g += jac[a][i] * r[i]
			jtr.append(-g)
		var improved := false
		for _try in 10:
			var m := []
			for a in n:
				var row: Array = jtj[a].duplicate()
				row[a] += lam * maxf(jtj[a][a], 1e-9)
				m.append(row)
			var dx := Hg._solve(m, jtr)
			if dx.is_empty():
				lam *= 10.0
				continue
			var xn := x.duplicate()
			for j in n:
				xn[j] += dx[j]
			xn[6] = clampf(xn[6], Hg.POSE_FOV_RANGE[0], Hg.POSE_FOV_RANGE[1])
			if n > 7 and not C.lens_warp_is_valid(xn[7], xn[8] if n > 8 else 0.0):
				lam *= 10.0
				continue
			var rn := residuals(_with(cam, xn), world, screen, w, h)
			var cn := _cost(rn)
			if cn < cost:
				x = xn
				r = rn
				cost = cn
				lam = maxf(lam / 10.0, 1e-9)
				improved = true
				break
			lam *= 10.0
		if not improved or (cost < 1e-18):
			break
	var out := _with(cam, x)
	out["yaw"] = fposmod(float(out.yaw) + 180.0, 360.0) - 180.0
	return out
