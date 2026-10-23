extends RefCounted
## WO-713 — calibrate on a person standing on a mark (person_mark_model.gd): R1 the person-near-mark line of the
## heads fold, R3 the feet ↔ mark point of the tracking camera calibration.

const PM := preload("res://features/previs/tracking/person_mark_model.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
var t

const MARK := {"id": 2, "name": "Mark 2", "x": 1.0, "y": 3.0, "z": 0.0}


func _snap(persons: Array, world := {}) -> Dictionary:
	return {"enabled": true, "running": true, "cameras": [{"id": "cam_1", "stale": false, "persons": persons}], "world": world}


func test_near_mark_picks_the_nearest_fresh_person() -> void:
	var snap := _snap([{"tid": 1, "box": [0, 0, 1, 1], "age_s": 0.0, "floor": [4.0, 3.0, 0.0]},
		{"tid": 2, "box": [0, 0, 1, 1], "age_s": 0.0, "floor": [1.3, 3.4, 0.0]},
		{"tid": 3, "box": [0, 0, 1, 1], "age_s": 0.4, "floor": [1.0, 3.0, 0.0]},  # coasting: not seen this frame
		{"tid": 4, "box": [0, 0, 1, 1], "age_s": 0.0, "floor": null}])  # unsolved camera: no floor point
	var r := PM.nearest(snap, MARK)
	t.eq(r.n, 2, "fresh persons with a floor point")
	t.eq(snappedf(r.d, 0.001), 0.5, "0.3, 0.4 off → 0.5 m")
	t.eq(PM.near_line(snap, MARK), "Person 0.50 m off Mark 2 (nearest of 2)")
	var one := _snap([{"tid": 2, "box": [0, 0, 1, 1], "age_s": 0.0, "floor": [1.3, 3.0, 0.0]}])
	t.eq(PM.near_line(one, MARK), "Person 0.30 m off Mark 2")
	var far := _snap([{"tid": 2, "box": [0, 0, 1, 1], "age_s": 0.0, "floor": [3.0, 3.0, 0.0]}])
	t.ok(PM.near_line(far, MARK).ends_with("is someone on the mark?"), "2 m off: probably not on the mark")


func test_near_mark_uses_fused_world_persons() -> void:
	# 2+ solved cameras fuse: the world persons are the floor spots (no double count of one person in two cameras)
	var snap := _snap([{"tid": 1, "box": [0, 0, 1, 1], "age_s": 0.0, "floor": [9.0, 9.0, 0.0]}],
		{"fused": true, "persons": [{"id": 1, "x": 1.0, "y": 3.1, "age_s": 0.0}]})
	var r := PM.nearest(snap, MARK)
	t.eq(r.n, 1)
	t.eq(snappedf(r.d, 0.001), 0.1)


func test_near_line_quiet_without_detection() -> void:
	t.eq(PM.near_line({}, MARK), "", "no snapshot")
	t.eq(PM.near_line({"enabled": true, "running": false}, MARK), "", "detector starting")
	t.eq(PM.near_line(_snap([]), {}), "", "no mark picked")
	t.eq(PM.near_line(_snap([]), MARK), "Detection sees nobody on the floor (a solved camera places them)")
	t.ok(is_inf(float(PM.nearest(_snap([]), MARK).d)), "nobody: INF")


func test_feet_pixel_is_the_box_bottom_centre_in_raster_px() -> void:
	var px := PM.feet_px([0.25, 0.1, 0.35, 0.8], Vector2(1920, 1080))
	t.eq(snappedf(px.x, 0.001), 576.0, "(0.25 + 0.35) / 2 × 1920")
	t.eq(snappedf(px.y, 0.001), 864.0, "0.8 × 1080")


func test_person_point_with_exactly_one_person() -> void:
	var ce := T.new_camera([])
	ce["raster"] = [3840, 2160]
	var snap := _snap([{"tid": 7, "box": [0.5, 0.2, 0.6, 0.9], "age_s": 0.0}])
	var r := PM.person_point(snap, ce, MARK)
	t.eq(r.ok, true)
	t.eq(r.point.id, "person:2")
	t.eq(r.point.label, "Person on Mark 2")
	t.eq(r.point.world, [1.0, 3.0, 0.0], "the mark on the floor")
	t.eq(r.point.screen, [2112.0, 1944.0], "feet: 0.55 × 3840, 0.9 × 2160")
	# a coasting second track does not count
	snap.cameras[0].persons.append({"tid": 8, "box": [0.1, 0.1, 0.2, 0.5], "age_s": 0.3})
	t.eq(PM.person_point(snap, ce, MARK).ok, true)


func test_person_point_refuses_zero_or_several() -> void:
	var ce := T.new_camera([])
	var none := PM.person_point(_snap([]), ce, MARK)
	t.eq(none.ok, false)
	t.ok(str(none.error).contains("detects nobody"), none.error)
	var two := PM.person_point(_snap([{"tid": 1, "box": [0, 0, 0.1, 0.5], "age_s": 0.0},
		{"tid": 2, "box": [0.5, 0, 0.6, 0.5], "age_s": 0.0}]), ce, MARK)
	t.eq(two.ok, false)
	t.ok(str(two.error).contains("detects 2 persons"), two.error)
	t.ok(str(PM.person_point({}, ce, MARK).error).contains("not running"))
	t.ok(str(PM.person_point(_snap([]), ce, {}).error).contains("Pick a stage mark"))
	var cut := PM.person_point(_snap([{"tid": 1, "box": [0.4, 0.3, 0.5, 1.0], "age_s": 0.0}]), ce, MARK)
	t.ok(str(cut.error).contains("feet are cut off"), "a box clipped at the bottom edge has no feet")
	var stale := _snap([])
	stale.cameras[0].stale = true
	t.ok(str(PM.person_point(stale, ce, MARK).error).contains("No detection frames"))
	var other := _snap([])
	other.cameras[0].id = "cam_9"
	t.ok(str(PM.person_point(other, ce, MARK).error).contains("does not watch"))


func test_with_point_replaces_the_same_mark() -> void:
	var pts := [{"id": "grid:DSR", "label": "Grid corner DSR", "world": [0, 0, 0], "screen": [1, 2]},
		{"id": "person:2", "label": "Person on Mark 2", "world": [0, 0, 0], "screen": [5, 5]}]
	var p := {"id": "person:2", "label": "Person on Mark 2", "world": [1.0, 3.0, 0.0], "screen": [9.0, 9.0]}
	var out := PM.with_point(pts, p)
	t.eq(out.size(), 2)
	t.eq(out[1].screen, [9.0, 9.0])
	t.eq(out[1].world, [1.0, 3.0, 0.0], "the mark's current spot")
	t.eq(pts.size(), 2, "input untouched")
	var ce := T.normalize_camera({"points": out})
	t.eq(T.clicked(ce).size(), 2, "a person point counts for Solve like a clicked one")


func test_summary_counts_person_pins() -> void:
	var sess := {"points": [{"pan": 1, "tilt": 2, "x": 0, "y": 3, "z": 1.4, "height": 1.4}, {"pan": 5, "tilt": 2, "x": 2, "y": 3, "z": 0}],
		"solve": {"ok": true, "map": [], "rms_deg": 0.0}}
	t.eq(F.calib_summary(sess), "2 marks pinned (1 on a person) — the digital beam is on each.")
