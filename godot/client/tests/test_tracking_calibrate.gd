extends RefCounted
## WO-616 T3 — tracking data model (grid, cameras, candidate points from stage objects) and the calibration
## (floor-homography seed + LM refinement, optional lens fit). The concert case is OpenFollow's gallery picture
## concert_default (@ 2f8aa257): camera upstage facing the house, k1 -0.2, k2 0.03, 12 × 6 m grid at 2 m.

const T := preload("res://features/previs/tracking/tracking_model.gd")
const R := preload("res://features/previs/tracking/camera_refine.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const SO := preload("res://features/previs/stage_objects.gd")
var t


func _clicks(cam: Dictionary, world: Array, noise := 0.0) -> Array:
	var px := C.apply_distortion(C.project(cam, world, 1920.0, 1080.0), 1920.0, 1080.0, cam.lens_k1, cam.lens_k2)
	var out := []
	for i in world.size():
		if px[i] == null:
			continue
		var j := noise * sin(i * 12.9898) if noise > 0.0 else 0.0
		var k := noise * cos(i * 78.233) if noise > 0.0 else 0.0
		out.append({"world": world[i], "screen": [px[i][0] + j, px[i][1] + k]})
	return out


func test_concert_with_lens() -> void:
	var truth := C.camera(0.0, 13.0, 12.0, -48.0, 180.0, 0.0, 70.0)
	truth["lens_k1"] = -0.2
	truth["lens_k2"] = 0.03
	var grid := T.normalize_grid({"width": 12, "depth": 6, "spacing": 2, "y_offset": 3})
	var pts := _clicks(truth, T.grid_crossings(grid))
	t.eq(pts.size(), 28, "7 × 4 crossings all on screen")
	var start: Dictionary = T.new_camera([]).cam  # FOH default: the wrong end of the stage
	var r := R.calibrate(start, pts, 1920.0, 1080.0, {"fit_lens": true})
	t.ok(r.ok and r.rms < 0.05, "lens + pose fit to the exact clicks (rms %s, %s)" % [r.get("rms"), r.get("method")])
	if not r.ok:
		return
	var c: Dictionary = r.cam
	t.ok(absf(c.pos_x) < 0.01 and absf(c.pos_y - 13.0) < 0.01 and absf(c.pos_z - 12.0) < 0.01, "position %s" % c)
	t.ok(absf(c.pitch + 48.0) < 0.05 and absf(cos(deg_to_rad(c.yaw)) + 1.0) < 1e-5 and absf(c.fov - 70.0) < 0.05, "angles")
	t.ok(absf(c.lens_k1 + 0.2) < 0.005 and absf(c.lens_k2 - 0.03) < 0.005, "lens k1 %s k2 %s" % [c.lens_k1, c.lens_k2])
	var no_lens := R.calibrate(start, pts, 1920.0, 1080.0)
	t.ok(no_lens.ok and no_lens.rms > 3.0, "the same clicks without a lens fit leave a visible error (%s px)" % no_lens.get("rms"))


func test_mixed_heights_with_noise() -> void:
	var truth := C.camera(2.0, -14.0, 5.0, -12.0, 8.0, 1.5, 55.0)
	var wall := {"id": "w", "name": "Wall", "type": "led_wall", "panels": [12, 6], "position": [0.0, 0.5, -2.0]}
	var tv := {"id": "tv", "name": "TV", "type": "tv", "position": [-5.0, 1.2, 1.0], "rotation": [0.0, 30.0, 0.0]}
	var world := []
	for o in [wall, tv]:
		world.append_array(T.object_corners(SO.normalize(o)))
	world.append_array(T.grid_corners(T.GRID_DEFAULT))
	var pts := _clicks(truth, world, 0.7)
	t.eq(pts.size(), 12)
	var r := R.calibrate(T.new_camera([]).cam, pts, 1920.0, 1080.0)
	t.ok(r.ok and r.rms < 1.2, "12 mixed points, ±0.7 px clicks → rms %s (%s)" % [r.get("rms"), r.get("method")])
	t.ok(r.ok and Vector3(r.cam.pos_x - 2.0, r.cam.pos_y + 14.0, r.cam.pos_z - 5.0).length() < 0.25, "position within 25 cm")
	t.ok(r.ok and (r.errors as Array).size() == 12, "a per-point error for every click")


func test_no_floor_group_refines_from_the_current_camera() -> void:
	var truth := C.camera(-1.0, -12.0, 4.0, -10.0, -5.0, 0.0, 50.0)
	var wall: Dictionary = SO.normalize(
		{"id": "w", "type": "led_wall", "panels": [10, 5], "position": [0.0, 1.0, 0.0]})
	var tall: Dictionary = SO.normalize(
		{"id": "p", "type": "projection", "screen_m": [3.0, 2.0], "position": [5.0, 2.5, 2.0], "rotation": [0.0, -20.0, 0.0]})
	var pts := _clicks(truth, T.object_corners(wall) + T.object_corners(tall))
	var near := truth.duplicate()
	near["pos_x"] = 0.0; near["pos_y"] = -10.0; near["pitch"] = -15.0; near["fov"] = 60.0
	var r := R.calibrate(near, pts, 1920.0, 1080.0)
	t.eq(r.get("method"), "refine", "no 4 points share a height → no homography seed")
	t.ok(r.ok and r.rms < 0.01 and absf(r.cam.pos_y + 12.0) < 0.01, "converges from a rough start: %s" % r.get("cam"))
	t.eq(R.calibrate(near, pts.slice(0, 3), 1920.0, 1080.0).ok, false, "3 points are not enough")


func test_model_normalize() -> void:
	var tr := T.normalize({"grid": {"width": "x", "depth": 0}, "cameras": [{"id": "a", "cam": {"fov": 500, "pos_x": NAN,
		"lens_k1": -0.6}, "points": [{"id": "p", "world": [1, 2, 3], "screen": [4, 5]}, {"world": [1]}]}, {"id": "a"}, 7]})
	t.eq(tr.grid.width, 10.0, "non-number → default")
	t.eq(tr.grid.depth, 0.5, "clamped")
	t.eq(tr.cameras.size(), 1, "duplicate id and junk dropped")
	var c: Dictionary = tr.cameras[0]
	t.eq(c.cam.fov, C.FOV_MAX)
	t.eq(c.cam.pos_x, 0.0, "NaN → default")
	t.ok(C.lens_warp_is_valid(c.cam.lens_k1, c.cam.lens_k2) and c.cam.lens_k1 < -0.3, "folding lens pulled back")
	t.eq(c.points.size(), 1)
	t.eq(c.rms, -1.0)
	var c2 := T.set_point(c, "p", "", [1.0, 2.0, 3.0], null)
	t.eq(T.clicked(c2).size(), 0, "a cleared click is not used")
	c2 = T.set_point(c2, "q", "Q", [0.0, 0.0, 0.0], [10.0, 20.0])
	t.eq(c2.points.size(), 2)
	t.eq(T.new_camera([c, c2]).id, "cam_3")


func test_grid_and_corners() -> void:
	var g := T.normalize_grid({"width": 12, "depth": 6, "spacing": 2, "y_offset": 3})
	t.eq(T.grid_corners(g), [[-6.0, 0.0, 0.0], [6.0, 0.0, 0.0], [6.0, 6.0, 0.0], [-6.0, 6.0, 0.0]])
	t.eq(T.grid_crossings(g).size(), 28)
	var tv: Dictionary = SO.normalize(
		{"id": "tv", "type": "tv", "diagonal_in": 65.0, "position": [1.0, 1.0, -2.0], "rotation": [0.0, 90.0, 0.0]})
	var cs := T.object_corners(tv)
	# yaw 90° turns the picture to face stage left (+X): its width runs along PSN Y, and a viewer standing stage left
	# looking at it has downstage on their left — so "bottom L" is the downstage corner
	t.ok(absf(cs[0][0] - 1.0) < 1e-3 and absf(cs[1][0] - 1.0) < 1e-3, "both bottom corners at x = 1")
	t.ok(absf(cs[1][1] - cs[0][1] - 1.439) < 0.01, "65\" 16:9 = 1.439 m wide, viewer-left corner downstage")
	t.ok(absf(cs[0][2] - 1.0) < 1e-6 and absf(cs[3][2] - 1.0 - 0.809) < 0.01, "bottom at 1 m, 0.809 m tall")
	var pts := T.candidate_points({"grid": g}, [tv])
	t.eq(pts.size(), 4 + 28 + 4)
	t.eq(pts[0].id, "grid:DSR")


func test_source_options_only_real_surfaces() -> void:  # WO-694
	var d := {"opgui": {"channel": 3}, "prv1": {"channel": 2}, "pgm1": {"channel": 1}, "pgm2": {"channel": null},
		"in2": {"channel": 5}, "in1": {"channel": 4}}
	var o := T.source_options(d, "in1")
	t.eq(o.map(func(x: Array) -> String: return x[0]), ["in1", "in2", "pgm1", "prv1"], "inputs, then PGM / PRV; no placeholders")
	t.eq(o[0][1], "SDI input 1  (channel 4)", "label")
	var gone := T.source_options(d, "in3")
	t.eq(gone[-1], ["in3", "SDI input 3 — not available"], "a camera's missing source stays, marked")
	t.eq(T.source_options({}, "in1"), [["in1", "SDI input 1 — not available"]], "no descriptors yet")
	t.eq(T.source_label("prv2"), "Preview 2", "prv label")
