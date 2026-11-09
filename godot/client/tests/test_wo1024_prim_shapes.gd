extends RefCounted
## WO-1024 — GDTF built-in primitives drawn as their shape (prim_shapes.gd) inside the unit size box.

const P := preload("res://features/previs/fixtures/prim_shapes.gd")
var t


func test_shapes_fill_the_unit_box() -> void:
	for key in ["prim:box", "prim:cylinder", "prim:sphere", "prim:yoke"]:
		var a := P.mesh(key).get_aabb()
		var fits := (a.size - Vector3.ONE).abs().length() < 0.03 and a.get_center().length() < 0.01  # a sphere's facets
		t.ok(fits, "%s fills the unit box" % key)
	t.ok(P.mesh("prim:cylinder") is CylinderMesh, "a cylinder")
	t.ok(P.mesh("prim:unknown") is BoxMesh, "an unknown key is a box")
	t.ok(P.mesh("prim:yoke") == P.mesh("prim:yoke"), "shared")


func test_yoke_is_open_below() -> void:
	var tri := P.mesh("prim:yoke").get_faces()
	var low_middle := false  # a vertex in the middle of the lower half = the U is closed there
	for v in tri:
		if absf(v.x) < 0.3 and v.y < 0.0:
			low_middle = true
	t.ok(not low_middle, "the bar is at the top, the arms hang down (GDTF fixtures hang)")
