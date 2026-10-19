extends RefCounted
## WO-616 T10c — tracking camera coverage (coverage_model.gd)

const V := preload("res://features/previs/tracking/coverage_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")
var t


func _entry(id: String, cam: Dictionary) -> Dictionary:
	return T.normalize_camera({"id": id, "raster": [1920, 1080], "cam": cam})


func _floor_xy(r: Dictionary) -> Array:
	var k := -float(r.o[2]) / float(r.d[2])
	return [float(r.o[0]) + float(r.d[0]) * k, float(r.o[1]) + float(r.d[1]) * k]


func _dist(a: Array, b: Array) -> float:
	var s := 0.0
	for i in 3:
		var d := float(a[i]) - float(b[i])
		s += d * d
	return sqrt(s)


func _close(a: Array, b: Array, tol: float) -> bool:
	return absf(float(a[0]) - float(b[0])) < tol and absf(float(a[1]) - float(b[1])) < tol


func test_sees_points_in_front_only() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var s := V.seen(foh, [[0, 3, 0], [0, 3, 1.75], [0, -15, 0], [60, 3, 0]])
	t.eq(s.size(), 4, "one flag per point")
	t.eq(s[0], 1, "stage centre at the feet is seen")
	t.eq(s[1], 1, "stage centre at head height is seen")
	t.eq(s[2], 0, "a point behind the camera is not seen")
	t.eq(s[3], 0, "a point far to the side is not seen")
	t.eq(V.sees(foh, [0, 3, 0]), true, "sees() agrees with seen()")


func test_coverage_single_camera_default_grid() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var cov := V.coverage([foh], T.normalize_grid({}))
	t.eq(cov.nx * cov.cx, 10.0, "cells span the 10 m width")
	t.eq(cov.ny * cov.cy, 6.0, "cells span the 6 m depth")
	t.eq(cov.masks.size(), cov.nx * cov.ny, "one mask per cell")
	t.ok(absf(float(cov.total) - 60.0) < 1e-6, "total is the grid area (60 m2), got %s" % str(cov.total))
	t.eq(cov.two, 0, "one camera cannot cover a cell twice")
	t.ok(cov.one > 0, "the FOH camera sees some of the grid")
	t.ok(cov.one <= cov.total, "seen area does not exceed the grid")
	var binary := true
	for m in cov.masks:
		if m != 0 and m != 1:
			binary = false
	t.ok(binary, "every mask value is 0 or 1 for one camera")


func test_coverage_two_cameras_masks_and_separation() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var side := _entry("cam_2", C.camera(-12, 3, 6, -25, 90, 0, 70))
	var g := T.normalize_grid({})
	var cov := V.coverage([foh, side], g)
	t.ok(cov.two > 0, "some cells are seen by both cameras")
	var in_set := true
	for m in cov.masks:
		if not (m in [0, 1, 2, 3]):
			in_set = false
	t.ok(in_set, "every mask is in {0,1,2,3}")
	t.ok(absf(V.separation(foh, side, [0, 3]) - 90.0) < 1e-4, "FOH and SIDE are 90 degrees apart at the grid centre, got %s" % str(V.separation(foh, side, [0, 3])))
	var prs := V.pairs([foh, side], g)
	t.eq(prs.size(), 1, "one pair for two cameras")
	t.eq(prs[0].a, "cam_1", "pair names the first camera")
	t.eq(prs[0].b, "cam_2", "pair names the second camera")
	t.ok(absf(float(prs[0].deg) - 90.0) < 1e-4, "pair separation is 90 degrees, got %s" % str(prs[0].deg))


func test_twin_cameras_see_the_same_cells() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var twin := _entry("cam_2", C.camera(0, -11, 6, -22, 0, 0, 60))
	t.eq(V.separation(foh, twin, [0, 3]), 0.0, "identical cameras have zero separation")
	var cov := V.coverage([foh, twin], T.normalize_grid({}))
	var paired := true
	for m in cov.masks:
		if ((m & 1) != 0) != ((m & 2) != 0):
			paired = false
	t.ok(paired, "for every cell, bit0 is set exactly when bit1 is set")
	t.eq(cov.one, 0, "twins leave no cell seen by exactly one camera")


func test_ray_matches_unproject_without_lens() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var r := V.ray(foh, [700, 800])
	var n := _dist(r.d, [0.0, 0.0, 0.0])
	t.ok(absf(n - 1.0) < 1e-6,"ray direction is unit length, got %s" % str(n))
	var want: Array = C.unproject(foh.cam, [[700, 800]], 1920, 1080, 0.0)[0]
	t.ok(_close(_floor_xy(r), want, 1e-6), "floor hit matches unproject() (%s vs %s)" % [str(_floor_xy(r)), str(want)])


func test_ray_matches_unproject_with_lens() -> void:
	var cam := C.camera(0, -11, 6, -22, 0, 0, 60)
	cam["lens_k1"] = -0.12
	cam["lens_k2"] = 0.02
	var foh := _entry("cam_1", cam)
	var r := V.ray(foh, [300, 900])
	var pin: Array = C.invert_distortion([[300, 900]], 1920, 1080, -0.12, 0.02)
	var want: Array = C.unproject(foh.cam, pin, 1920, 1080, 0.0)[0]
	t.ok(_close(_floor_xy(r), want, 1e-6), "lensed floor hit matches invert_distortion + unproject (%s vs %s)" % [str(_floor_xy(r)), str(want)])


func test_reach_floor_and_far_clamp() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var hit := V.reach(foh, [960, 540], 0.0)
	t.eq(hit.floor, true, "the centre pixel of a downward camera reaches the floor")
	t.ok(absf(float(hit.p[2])) < 1e-6, "the floor hit is at z 0")
	var level := _entry("cam_2", C.camera(0, -11, 1.5, 0, 0, 0, 60))
	var far := V.reach(level, [0, 0], 0.0)
	t.eq(far.floor, false, "the top-left pixel of a level camera does not reach the floor")
	var dist := _dist(far.p, [0.0, -11.0, 1.5])
	t.ok(absf(dist - V.FAR_M) < 1e-4, "a non-floor reach is FAR_M from the camera, got %s" % str(dist))


func test_frustum_has_four_corners() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var f := V.frustum(foh, 0.0)
	t.eq(f.size(), 4, "four frustum corners")
	var all3 := true
	for p in f:
		if p.size() != 3:
			all3 = false
	t.ok(all3, "every corner is a 3-float point")


func test_footprint_straight_down_is_one_closed_ring() -> void:
	var down := _entry("cam_1", C.camera(0, 3, 5, -89, 0, 0, 60))
	var lines := V.footprint(down, 0.0)
	t.eq(lines.size(), 1, "a downward camera gives one footprint polyline")
	t.eq(lines[0].size(), 4 * V.EDGE_SEGMENTS + 1, "the ring has 4*EDGE_SEGMENTS+1 points")
	var flat := true
	for p in lines[0]:
		if absf(float(p[2])) > 1e-6:
			flat = false
	t.ok(flat, "every footprint point is on the floor (z 0)")


func test_footprint_with_horizon_is_floor_part_only() -> void:
	var cam := _entry("cam_1", C.camera(0, -11, 6, -5, 0, 0, 60))
	var lines := V.footprint(cam, 0.0)
	t.eq(lines.size(), 1, "the horizon splits nothing: one floor polyline")
	var flat := true
	var near := true
	for p in lines[0]:
		if absf(float(p[2])) > 1e-6:
			flat = false
		var d := _dist(p, [0.0, -11.0, 6.0])
		if d > V.FAR_M + 1e-6:
			near = false
	t.ok(flat, "every floor-part point is at z 0")
	t.ok(near, "every floor-part point is within FAR_M of the camera")


func test_big_grid_is_capped_and_covers_its_area() -> void:
	var foh := _entry("cam_1", C.camera(0, -11, 6, -22, 0, 0, 60))
	var cov := V.coverage([foh], T.normalize_grid({"width": 200, "depth": 200}))
	t.ok(cov.nx * cov.ny <= V.MAX_CELLS, "a 200 m grid stays within MAX_CELLS (%d cells)" % (cov.nx * cov.ny))
	t.ok(absf(float(cov.total) - 40000.0) < 1e-6, "total is the 200 x 200 area, got %s" % str(cov.total))
