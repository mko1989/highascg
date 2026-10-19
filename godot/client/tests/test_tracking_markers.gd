extends RefCounted
## WO-616 T5b — operator marker input (marker_input.gd, ported from OpenFollow shaping / control_frame / input.md)
## and the marker definitions in tracking_model.

const MI := preload("res://features/previs/tracking/marker_input.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const O := preload("res://features/previs/tracking/tracking_overlay.gd")
var t


func _near(a: float, b: float, eps := 1e-6) -> bool:
	return absf(a - b) < eps


func test_shaping_matches_openfollow() -> void:
	t.eq(MI.shape_axis(0.1, 0.15, "linear"), 0.0, "inside the deadzone")
	t.ok(_near(MI.shape_axis(0.575, 0.15, "linear"), 0.5), "rescaled above the band")
	t.ok(_near(MI.shape_axis(-1.0, 0.15, "s-law"), -1.0), "full deflection = 1, sign kept")
	t.ok(_near(MI.apply_curve(0.5, "quadratic"), 0.25))
	t.ok(_near(MI.apply_curve(0.5, "s-law"), 0.5))
	t.ok(_near(MI.apply_curve(0.1, "logarithmic"), log(1.9) / log(10.0)))
	t.ok(_near(MI.apply_curve(0.3, "nonsense"), 0.3), "unknown curve = linear")
	t.eq(MI.shape_axis(0.9, 1.0, "linear"), 0.0, "deadzone ≥ 1 = inert")


func test_camera_relative_axes() -> void:
	var front := MI.ground_axes(C.camera(0.0, -10.0, 5.0, -20.0, 0.0, 0.0, 60.0))  # looking upstage
	t.ok(front[0].distance_to(Vector2(1, 0)) < 1e-6 and front[1].distance_to(Vector2(0, 1)) < 1e-6, "FOH: right = stage left, forward = upstage")
	var back := MI.ground_axes(C.camera(0.0, 12.0, 5.0, -20.0, 180.0, 0.0, 60.0))
	t.ok(back[0].distance_to(Vector2(-1, 0)) < 1e-6 and back[1].distance_to(Vector2(0, -1)) < 1e-6, "from upstage everything flips")
	var side := MI.ground_axes(C.camera(-10.0, 3.0, 5.0, -20.0, 90.0, 0.0, 60.0))
	t.ok(side[1].distance_to(Vector2(1, 0)) < 1e-6, "yaw 90 looks stage left: forward = +X (%s)" % side[1])
	t.ok(side[0].distance_to(Vector2(0, -1)) < 1e-6, "…and right = downstage")
	t.eq(MI.ground_axes({}), MI.STAGE_AXES)
	var o := MI.orient(side, Vector2(0.6, 0.8))
	t.ok(_near(o.length(), 1.0), "orient keeps the input magnitude")
	t.ok(o.distance_to(Vector2(0.8, -0.6)) < 1e-6)
	t.eq(MI.orient(side, Vector2.ZERO), Vector2.ZERO)
	# the screen agrees: moving "right" on the stick moves the marker right in the camera picture
	var ce := T.new_camera([])
	ce.cam = C.camera(3.0, -8.0, 6.0, -35.0, 25.0, 0.0, 60.0)
	var ax := MI.ground_axes(ce.cam)
	var p0 := [0.0, 3.0, 0.0]
	var p1 := [ax[0].x, 3.0 + ax[0].y, 0.0]
	var px := O.shown(ce, [p0, p1])
	t.ok(px[1][0] > px[0][0] + 10.0 and absf(px[1][1] - px[0][1]) < 0.5 * (px[1][0] - px[0][0]), "right on the stick = right in the picture %s" % [px])


func test_speed_steps_and_glide() -> void:
	t.ok(_near(MI.step_speed(1.0, 1), 1.1))
	t.ok(_near(MI.step_speed(0.1, -1), 0.1), "floor 0.1 m/s")
	t.ok(_near(MI.step_speed(3.0, 1), 3.0), "cap 3.0 m/s")
	t.eq(MI.glide(Vector2.ZERO, Vector2(10, 0), 0.0), Vector2(10, 0), "smoothing 0 jumps")
	t.ok(MI.glide(Vector2.ZERO, Vector2(10, 0), 1.0).distance_to(Vector2(0.5, 0)) < 1e-6, "max smoothing still moves (5 %)")


func test_floor_point_round_trips_through_the_lens() -> void:
	var ce := T.new_camera([])
	ce.cam = C.camera(0.0, -11.0, 6.0, -22.0, 0.0, 0.0, 60.0)
	ce.cam["lens_k1"] = -0.2
	ce.cam["lens_k2"] = 0.03
	for w in [[2.5, 4.0, 0.0], [-3.0, 1.5, 0.0], [0.0, 6.0, 0.4]]:
		var s: Array = O.shown(ce, [w])[0]
		var back: Variant = MI.floor_point(ce, Vector2(s[0], s[1]), w[2])
		t.ok(back != null and Vector3(back[0], back[1], back[2]).distance_to(Vector3(w[0], w[1], w[2])) < 1e-4, "%s → %s → %s" % [w, s, back])
	t.eq(MI.floor_point(ce, Vector2(960, -5000), 0.0), null, "above the horizon: no floor")
	t.eq(MI.floor_point({}, Vector2(1, 1), 0.0), null)


func test_ground_ring_and_grab() -> void:
	var ce := T.new_camera([])
	var ring := MI.ground_ring(ce, [0.0, 3.0, 0.0], 0.4)
	t.eq(ring.size(), 25)
	var c: Array = O.shown(ce, [[0.0, 3.0, 0.0]])[0]
	var centre := Vector2(c[0], c[1])
	t.ok(Geometry2D.is_point_in_polygon(centre, ring), "the circle surrounds its centre")
	var c2: Array = O.shown(ce, [[1.0, 3.0, 0.0]])[0]
	var marks := [{"id": 1, "centre": centre, "ring": ring}, {"id": 2, "centre": Vector2(c2[0], c2[1]), "ring": PackedVector2Array()},
		{"id": 3, "centre": null, "ring": PackedVector2Array()}]
	t.eq(MI.grab_target(marks, centre + Vector2(2, 1), 4.0), 1, "inside the circle")
	t.eq(MI.grab_target(marks, Vector2(c2[0], c2[1]) + Vector2(3, 0), 4.0), 2, "ring off-picture: centre radius fallback")
	t.eq(MI.grab_target(marks, Vector2(-900, -900), 4.0), 0, "empty stage: nothing")
	t.eq(MI.ground_ring(ce, [0.0, -30.0, 0.0], 0.4).size(), 0, "behind the camera: no ring")


func test_marker_definitions() -> void:
	var tr := T.normalize({"markers": [{"id": 2, "name": "Lead"}, {"id": 2, "name": "dupe"}, {"id": 0}, {"id": 70000},
		{"id": "x"}, {"id": 5.0, "color": "#123456"}, {"id": 3, "color": "not a colour"}]})
	t.eq(tr.markers.map(func(m: Dictionary) -> int: return m.id), [2, 5, 3], "valid, unique 1..65535 ids")
	t.eq(tr.markers[0].name, "Lead")
	t.eq(tr.markers[1].color, "#123456")
	t.eq(tr.markers[2].color, T.MARKER_COLORS[2], "bad colour → palette")
	t.eq(tr.markers[1].name, "Marker 5")
	t.eq(T.new_marker(tr.markers).id, 1, "lowest free id")
	t.eq(T.normalize({}).markers, [])
