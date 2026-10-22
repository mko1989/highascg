extends RefCounted
## WO-666 — textured dummies: person_dummy_model.gd's projection (the shader's twin) against camera_model, the
## cameras that paint a person, and the mannequin mesh's frame.

const PD := preload("res://features/previs/tracking/person_dummy_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const DummyMesh := preload("res://features/previs/tracking/person_dummy_mesh.gd")
var t


func _ce(id: String, cam: Dictionary, w := 1920.0, h := 1080.0) -> Dictionary:
	return {"id": id, "role": "r_" + id, "raster": [w, h], "cam": cam}


func test_project_uv_matches_camera_model() -> void:
	var cams := [C.camera(0.0, -10.0, 5.0, -20.0), C.camera(-6.0, -4.0, 3.0, -12.0, 55.0, 3.0, 42.0)]
	cams[1].lens_k1 = -0.12
	cams[1].lens_k2 = 0.03
	var pts := [[0.0, 0.0, 0.0], [0.4, 1.2, 1.7], [-1.0, 2.0, 0.9]]
	for cam in cams:
		var u := PD.cam_uniforms(_ce("a", cam, 1280.0, 720.0))
		var want := C.apply_distortion(C.project(cam, pts, 1280.0, 720.0), 1280.0, 720.0, cam.lens_k1, cam.lens_k2)
		for i in pts.size():
			var got: Variant = PD.project_uv(u, C.psn_to_godot(pts[i]))
			t.ok(got != null and absf(got.x * 1280.0 - want[i][0]) < 0.01 and absf(got.y * 720.0 - want[i][1]) < 0.01,
				"point %d: %s px vs camera_model %s" % [i, str(got * Vector2(1280, 720)) if got != null else "null", str(want[i])])


func test_project_uv_behind_is_null() -> void:
	var u := PD.cam_uniforms(_ce("a", C.camera(0.0, -10.0, 5.0, -20.0)))
	t.eq(PD.project_uv(u, C.psn_to_godot([0.0, -20.0, 1.0])), null, "a point behind the camera")


func test_views_for_biggest_first_capped_and_solved_only() -> void:
	var by_id := {}
	var views := {}
	var keys := []
	for i in 5:
		var id := "c%d" % i
		by_id[id] = _ce(id, C.camera())
		views["%s:1" % id] = {"cam": {"id": id, "role": "in%d" % i}, "person": {"box": [0.4, 0.4, 0.4 + 0.02 * (i + 1), 0.6]}}
		keys.append("%s:1" % id)
	by_id["c4"] = _ce("c4", {"pos_x": 0, "pos_y": 0, "pos_z": 0, "pitch": 0, "yaw": 0, "roll": 0, "fov": 0})
	var got := PD.views_for({"keys": keys}, views, by_id)
	t.eq(got.map(func(v: Dictionary) -> String: return v.cam_id), ["c3", "c2", "c1"], "3 biggest, unsolved c4 skipped")
	t.eq(got[0].role, "in3", "role from the snapshot camera")
	t.eq(PD.views_for({"keys": []}, views, by_id), [], "nobody sees them")


func test_face_yaw_turns_front_to_camera() -> void:
	var feet := Vector3(1, 0, 2)
	for cam_pos in [Vector3(1, 3, 10), Vector3(-5, 2, 2), Vector3(4, 1, -3)]:
		var front := Basis(Vector3.UP, PD.face_yaw(feet, cam_pos)) * Vector3(0, 0, 1)
		var to := Vector3(cam_pos.x - feet.x, 0, cam_pos.z - feet.z).normalized()
		t.ok(front.dot(to) > 0.999, "front (+Z) faces the camera at %s" % str(cam_pos))


func test_mannequin_is_one_metre_feet_at_zero() -> void:
	var aabb := DummyMesh.build().get_aabb()
	t.ok(absf(aabb.position.y) < 0.01, "feet at y = 0 (%.3f)" % aabb.position.y)
	t.ok(absf(aabb.end.y - 1.0) < 0.02, "top of the head at 1 m (%.3f)" % aabb.end.y)
	t.ok(aabb.size.x > 0.35 and aabb.size.x < 0.5, "shoulder-to-hand width (%.3f)" % aabb.size.x)
	t.ok(aabb.size.z < 0.2, "flattened front-to-back (%.3f)" % aabb.size.z)
