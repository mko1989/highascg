extends RefCounted
## WO-616 T2 — tracking camera math against OpenFollow's own test vectors (tests/test_solver.py,
## test_solver_distortion.py, test_lens_model.py @ 2f8aa257, AGPL-3.0-or-later, (C) 2026 The OpenFollow Project):
## golden pixels, project ↔ unproject, pose recovery from the 4 floor corners, lens fold rule and inverse.

const C := preload("res://features/previs/tracking/camera_model.gd")
const GRID := [[-5.0, -5.0, 0.0], [5.0, -5.0, 0.0], [5.0, 5.0, 0.0], [-5.0, 5.0, 0.0]]
var t


func _cam(p: Array) -> Dictionary:
	return C.camera(p[0], p[1], p[2], p[3], p[4], p[5], p[6])


func _close(a: Array, b: Array, eps: float) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		if a[i] == null or b[i] == null or absf(float(a[i][0]) - float(b[i][0])) > eps or absf(float(a[i][1]) - float(b[i][1])) > eps:
			return false
		if a[i].size() > 2 and absf(float(a[i][2]) - float(b[i][2])) > eps:
			return false
	return true


func test_head_on_golden_pixels() -> void:
	var world := [[-4.0, -3.0, 0.0], [4.0, -3.0, 0.0], [4.0, 5.0, 0.0], [-4.0, 5.0, 0.0], [0.0, 1.0, 1.8]]
	var golden := {
		0.0: [[117.6381, 906.6958], [1465.4171, 906.6958], [1224.7765, 411.5542], [518.7058, 411.5542], [835.2268, 384.8844]],
		-12.0: [[212.2861, 1073.8195], [1530.6129, 793.6005], [1192.2851, 359.3109], [501.6437, 506.1112], [805.7031, 414.2158]],
		25.0: [[41.5885, 516.3417], [1263.0911, 1085.9377], [1254.2526, 535.4879], [614.3352, 237.0895], [912.4718, 346.6861]],
	}
	for roll in golden:
		var got := C.project(_cam([1.0, -9.0, 5.5, -27.0, 0.0, roll, 72.0]), world, 1920.0, 1080.0)
		t.ok(_close(got, golden[roll], 1e-4), "roll %s pixels match OpenFollow: %s" % [roll, got])


func test_fov_and_behind() -> void:
	t.ok(absf(C.hfov_to_vfov(90.0, 16.0 / 9.0) - 58.7155) < 1e-3, "hfov 90 on 16:9 = vfov 58.7155")
	t.ok(absf(C.vfov_to_hfov(C.hfov_to_vfov(63.0, 1.5), 1.5) - 63.0) < 1e-9)
	var cam := C.camera(0.0, -10.0, 5.0, -20.0, 0.0, 0.0, 60.0)
	t.eq(C.project(cam, [[0.0, -20.0, 0.0]], 1920.0, 1080.0), [null], "behind the lens → null, not a mirrored pixel")
	t.eq(C.project(C.camera(0, 0, 5, -20, 0, 0, 60).merged({"fov": 0.0}, true), [[0, 0, 0]], 1920.0, 1080.0), [],
		"degenerate fov refused")


func test_project_unproject_roundtrip() -> void:
	var cam := _cam([0.0, -8.0, 4.0, -25.0, 5.0, 0.0, 60.0])
	var back := C.unproject(cam, C.project(cam, GRID, 1920.0, 1080.0), 1920.0, 1080.0, 0.0)
	t.ok(_close(back, GRID, 1e-5), "unproject(project(p)) = p: %s" % [back])
	var hit: Array = C.unproject(_cam([0.0, -10.0, 8.0, -65.0, 30.0, 0.0, 60.0]), [[960.0, 540.0]], 1920.0, 1080.0)[0]
	t.ok(absf(Vector2(hit[0], float(hit[1]) + 10.0).length() - 8.0 / tan(deg_to_rad(65.0))) < 1e-6,
		"the optical axis meets the floor at height / tan(pitch)")
	t.ok(absf(rad_to_deg(atan2(float(hit[0]), float(hit[1]) + 10.0)) - 30.0) < 1e-6, "yaw is the ground bearing")


func test_solve_recovers_pose() -> void:
	for p in [[0.0, -11.0, 6.0, -22.0, 0.0, 0.0, 60.0], [0.0, 11.0, 6.0, -30.0, 180.0, 0.0, 60.0],
			[11.0, 0.0, 6.0, -30.0, -90.0, 0.0, 60.0], [-11.0, 0.0, 6.0, -30.0, 90.0, 0.0, 60.0],
			[-9.0, -9.0, 7.0, -28.0, 45.0, 3.0, 70.0], [8.0, -8.0, 5.0, -25.0, -38.0, -6.0, 55.0]]:
		var screen := C.project(_cam(p), GRID, 1920.0, 1080.0)
		var s := C.solve_floor(GRID, screen, 1920.0, 1080.0)
		t.ok(not s.is_empty(), "solved %s" % [p])
		if s.is_empty():
			continue
		var pos_ok := absf(s.pos_x - p[0]) < 0.01 and absf(s.pos_y - p[1]) < 0.01 and absf(s.pos_z - p[2]) < 0.01
		var ang_ok := absf(s.pitch - p[3]) < 0.05 and absf(s.roll - p[5]) < 0.05 and absf(s.fov - p[6]) < 0.05
		t.ok(pos_ok and ang_ok and absf(cos(deg_to_rad(s.yaw - p[4])) - 1.0) < 1e-5, "pose %s → %s" % [p, s])
		t.ok(s.rms < 1e-6, "exact input reprojects exactly (rms %s)" % s.rms)


func test_solve_more_points_and_noise() -> void:
	var cam := _cam([1.5, -12.0, 6.5, -24.0, 6.0, 1.0, 58.0])
	var world := GRID.duplicate(true)
	world.append_array([[0.0, 0.0, 0.0], [-5.0, 0.0, 0.0], [5.0, 0.0, 0.0], [0.0, 5.0, 0.0]])
	var screen := C.project(cam, world, 1920.0, 1080.0)
	var jitter := [0.8, -0.6, 0.3, -0.9, 0.5, 0.7, -0.4, 0.2]
	for i in screen.size():
		screen[i] = [screen[i][0] + jitter[i], screen[i][1] - jitter[(i + 3) % 8]]
	var s := C.solve_floor(world, screen, 1920.0, 1080.0)
	t.ok(not s.is_empty() and s.rms < 1.5, "8 noisy points (≤ 0.9 px) solve with rms %s" % s.get("rms"))
	t.ok(not s.is_empty() and absf(s.pos_z - 6.5) < 0.15 and absf(s.pitch + 24.0) < 0.5, "pose stays close: %s" % s)


func test_solve_refuses_degenerate() -> void:
	t.eq(C.solve_floor(GRID, [[100.0, 100.0], [100.0, 100.0], [100.0, 100.0], [100.0, 100.0]], 1280.0, 720.0), {})
	t.eq(C.solve_floor(GRID.slice(0, 3), [[1, 1], [2, 2], [3, 3]], 1280.0, 720.0), {}, "fewer than 4 points")
	var plumb := C.project(_cam([0.0, 0.0, 12.0, -90.0, 0.0, 0.0, 60.0]), GRID, 1920.0, 1080.0)
	t.eq(C.solve_floor(GRID, plumb, 1920.0, 1080.0), {}, "a dead-overhead rig is refused, not silently tilted")
	# The homography's mirror branch (OpenFollow test_solver_properties regression): never a camera that puts
	# its own points behind the lens.
	var w := 1920.0
	var h := 1080.0
	var screen := [[0.25 * w, 0.25 * h], [0.75 * w, 0.25 * h], [0.75 * w, 0.75 * h], [0.25 * w, 0.75 * h]]
	var world := C.unproject(_cam([-12.0, -5.0, 4.0, -68.0, -25.0, 0.0, 40.0]), screen, w, h, 0.0)
	var s := C.solve_floor(world, screen, w, h)
	t.ok(s.is_empty() or not C.project(s, world, w, h).has(null), "mirror solve rejected or finite")


func test_lens_rule() -> void:
	for k in [[0.0, 0.0], [-0.15, 0.0], [-0.3, 0.05], [-0.45, 0.2], [-0.47, 0.25], [0.2, 0.0], [0.6, 0.4], [5.0, 0.0],
			[-0.3333, 0.0]]:
		t.ok(C.lens_warp_is_valid(k[0], k[1]), "valid %s" % [k])
	for k in [[-0.4, -0.2], [-1.0 / 3.0, 0.0], [-0.5, 0.0], [-0.25, -0.1], [-0.6, 0.1], [-1.0, 0.3], [-1e200, 1e200],
			[2e3, 0.0], [NAN, 0.0]]:
		t.ok(not C.lens_warp_is_valid(k[0], k[1]), "folds %s" % [k])
	var pb := C.pull_back_to_fold(-0.6, 0.0)
	t.ok(C.lens_warp_is_valid(pb[0], pb[1]) and pb[0] < -0.3 and pb[1] == 0.0, "pulled back along the ray: %s" % [pb])


func test_lens_distortion() -> void:
	var w := 1920.0
	var h := 1080.0
	var hd := 0.5 * sqrt(w * w + h * h)
	var fwd: Array = C.apply_distortion([[w / 2.0 + hd, h / 2.0]], w, h, -0.2, 0.0)[0]
	t.ok(absf(fwd[0] - (w / 2.0 + hd * 0.8)) < 1e-9 and fwd[1] == h / 2.0, "r = 1 scales by 1 + k1")
	t.eq(C.apply_distortion([null, [1.0, 2.0]], w, h, 0.0, 0.0), [null, [1.0, 2.0]], "zero lens = identity")
	var pts := []
	var seed := 12345
	for i in 200:
		seed = (seed * 1103515245 + 12345) % 2147483648
		var x := float(seed % 1920)
		seed = (seed * 1103515245 + 12345) % 2147483648
		pts.append([x + 0.37, float(seed % 1080) + 0.61])
	for k in [[-0.3, 0.0], [-0.45, 0.2], [-0.47, 0.25], [0.6, 0.4], [5.0, 0.0]]:
		var back := C.invert_distortion(C.apply_distortion(pts, w, h, k[0], k[1]), w, h, k[0], k[1])
		t.ok(_close(back, pts, 1e-6), "inverse recovers every pixel under %s" % [k])
	for k1 in [-0.8, -0.47, -0.19]:
		var k2: float = 9.0 * k1 * k1 / 20.0 * (1.0 + 1e-9)
		var worst := 0.0
		for i in 201:
			var rd := i / 200.0
			var ru := C.invert_radius(rd, k1, k2)
			worst = maxf(worst, absf(ru * (1.0 + k1 * ru * ru + k2 * pow(ru, 4)) - rd))
		t.ok(worst * hd < 0.01, "Newton converges where the warp barely climbs (k1 %s)" % k1)
	var corner: Array = C.invert_distortion([[w, h]], w, h, -0.3, 0.0)[0]
	var r_out := Vector2(corner[0] - w / 2.0, corner[1] - h / 2.0).length() / hd
	t.ok(absf(r_out - C.lens_fold_radius(-0.3, 0.0)) < 1e-3, "an unreachable corner lands on the fold ring")


func test_godot_frame() -> void:
	t.eq(C.psn_to_godot([1.0, 2.0, 3.0]), Vector3(1, 3, -2), "PSN upstage (+Y) is Godot -Z")
	t.eq(C.godot_to_psn(Vector3(1, 3, -2)), [1.0, 2.0, 3.0])
	var cam := _cam([1.0, -9.0, 5.5, -27.0, 14.0, 6.0, 72.0])
	var tr := C.godot_transform(cam)
	var p: Array = C.project(cam, [[2.0, 3.0, 1.0]], 1920.0, 1080.0)[0]
	var c3 := Camera3D.new()
	c3.fov = C.hfov_to_vfov(72.0, 1920.0 / 1080.0)
	var view := tr.affine_inverse() * C.psn_to_godot([2.0, 3.0, 1.0])
	var f := 1.0 / tan(deg_to_rad(c3.fov) / 2.0)
	var sx := ((f / (1920.0 / 1080.0)) * view.x / -view.z + 1.0) / 2.0 * 1920.0
	var sy := (1.0 - f * view.y / -view.z) / 2.0 * 1080.0
	c3.free()
	t.ok(absf(sx - p[0]) < 0.05 and absf(sy - p[1]) < 0.05, "Camera3D transform + vfov sees the same pixel (%s vs %s)" % [[sx, sy], p])
