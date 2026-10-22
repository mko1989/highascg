extends RefCounted
## WO-667 — the posed dummy: person_pose_model.gd turns 17 world joints into ellipsoid body parts.

const P := preload("res://features/previs/tracking/person_pose_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
var t


## A 1.75 m person standing at (1, 2) facing downstage (−y), arms down. PSN [x, y, z].
func _standing() -> Array:
	var j := []
	j.resize(17)
	j[0] = [1.0, 1.9, 1.62]
	j[1] = [0.97, 1.92, 1.66]
	j[2] = [1.03, 1.92, 1.66]
	j[3] = [0.93, 2.0, 1.64]
	j[4] = [1.07, 2.0, 1.64]
	j[5] = [0.8, 2.0, 1.45]
	j[6] = [1.2, 2.0, 1.45]
	j[7] = [0.78, 2.0, 1.15]
	j[8] = [1.22, 2.0, 1.15]
	j[9] = [0.78, 2.0, 0.88]
	j[10] = [1.22, 2.0, 0.88]
	j[11] = [0.9, 2.0, 0.95]
	j[12] = [1.1, 2.0, 0.95]
	j[13] = [0.9, 2.0, 0.5]
	j[14] = [1.1, 2.0, 0.5]
	j[15] = [0.9, 2.0, 0.08]
	j[16] = [1.1, 2.0, 0.08]
	return j


func test_usable_needs_shoulders_and_hips() -> void:
	var j := _standing()
	t.ok(P.usable(j), "full skeleton")
	j[11] = null
	t.ok(not P.usable(j), "a missing hip")
	t.ok(not P.usable(null), "no joints")
	t.ok(not P.usable([1, 2]), "wrong length")


func test_parts_cover_the_body() -> void:
	var ps := P.parts(_standing(), 1.75)
	var names := ps.map(func(p: Dictionary) -> String: return p.name)
	t.eq(names.size(), 11, "torso, neck, head + 8 limbs (%s)" % str(names))
	var j := _standing()
	j[9] = null  # left wrist unseen
	t.eq(P.parts(j, 1.75).size(), 10, "a missing wrist drops the forearm only")


func test_limb_ellipsoid_spans_its_joints() -> void:
	var j := _standing()
	var thigh: Dictionary = P.parts(j, 1.75).filter(func(p: Dictionary) -> bool: return p.name == "limb11_13")[0]
	var xf: Transform3D = thigh.xf
	var hip := C.psn_to_godot(j[11])
	var knee := C.psn_to_godot(j[13])
	var tip_a := xf * Vector3(0, -0.5, 0)
	var tip_b := xf * Vector3(0, 0.5, 0)
	t.ok(tip_a.distance_to(hip) < 0.06 and tip_b.distance_to(knee) < 0.06, "ends at the hip and the knee (± overlap): %s %s" % [tip_a, tip_b])
	t.ok(absf(xf.basis.x.length() - 0.15) < 1e-4, "thigh 15 cm thick at 1.75 m")


func test_head_from_face_points_else_above_shoulders() -> void:
	var head: Dictionary = P.parts(_standing(), 1.75).filter(func(p: Dictionary) -> bool: return p.name == "head")[0]
	t.ok((head.xf as Transform3D).origin.distance_to(C.psn_to_godot([1.0, 1.948, 1.644])) < 0.01, "mean of nose, eyes, ears")
	var j := _standing()
	for i in 5:
		j[i] = null
	var h2: Dictionary = P.parts(j, 1.75).filter(func(p: Dictionary) -> bool: return p.name == "head")[0]
	t.ok((h2.xf as Transform3D).origin.y > 1.45 + 0.2, "no face seen: above the shoulders")


func test_segment_degenerate_side_still_orthonormal_directions() -> void:
	var xf := P.segment(Vector3.ZERO, Vector3(0, 1, 0), 0.1, 0.1, Vector3.UP)  # side along the bone
	var b := xf.basis
	t.ok(absf(b.x.normalized().dot(b.y.normalized())) < 1e-4 and absf(b.z.normalized().dot(b.y.normalized())) < 1e-4, "axes stay perpendicular")
