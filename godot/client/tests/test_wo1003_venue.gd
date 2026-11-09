extends RefCounted
## WO-1003 — a Capture venue .glb draws the MVR scene's objects by uuid (mvr_venue.gd): MVR objects take the .glb meshes
## of their uuid, fixtures and bound video screens keep their own, .glb-only objects join their Capture layer.

const Venue := preload("res://features/previs/mvr_venue.gd")
var t


## A Capture-like glTF json: a group node 0 on layer L1 holding mesh nodes 1 (uuid "a") and 2 (uuid "fx"); node 3
## (uuid "c", layer L2) a mesh at the root; node 4 a mesh without a uuid.
func _json() -> Dictionary:
	var ext := func(id: String, layer := "") -> Dictionary:
		var e := {"identifier": id}
		if layer != "":
			e["layer_identifier"] = layer
		return {"CAPTURE_model": e}
	return {
		"asset": {"extensions": {"CAPTURE_model": {"layers": [{"identifier": "L1", "name": "Truss"}, {"identifier": "L2", "name": "Klimat"}]}}},
		"nodes": [{"children": [1, 2], "extensions": ext.call("G", "L1")}, {"mesh": 0, "extensions": ext.call("A")},
			{"mesh": 0, "extensions": ext.call("fx")}, {"mesh": 0, "extensions": ext.call("c", "L2")}, {"mesh": 0}]}


## The GLTFNodes for _json(): group 0 moved by +1 x, every mesh node at +2 y; one BoxMesh (mesh index 0).
func _gnodes() -> Array:
	var out: Array = []
	for i in 5:
		var g := GLTFNode.new()
		g.parent = 0 if i in [1, 2] else -1
		g.mesh = -1 if i == 0 else 0
		g.xform = Transform3D(Basis.IDENTITY, Vector3(1, 0, 0) if i == 0 else Vector3(0, 2, 0))
		out.append(g)
	return out


func test_meshes_by_uuid_keys_layers_and_frame() -> void:
	var r := Venue.meshes_by_uuid(_json(), _gnodes(), [BoxMesh.new()])
	t.eq(r.meshes, 4, "every mesh node counted")
	t.eq(r.by.keys(), ["a", "fx", "c", "glb:4"], "uuids lower-cased; no uuid → glb:<index>")
	t.eq(r.by.a[0].layer, "Truss", "a mesh inherits its group's Capture layer")
	t.eq(r.by.c[0].layer, "Klimat", "its own layer")
	t.eq(r.by.a[0].xf.origin, Vector3(1, 2, 0), "in the file's frame (parent transforms applied)")
	t.eq(r.by.c[0].xf.origin, Vector3(0, 2, 0), "a root node: its own transform")
	t.eq(Venue.meshes_by_uuid(_json(), _gnodes(), [null]).meshes, 0, "a mesh that did not build is skipped")


func test_apply_swaps_objects_keeps_fixtures_and_screens() -> void:
	var v := Venue.meshes_by_uuid(_json(), _gnodes(), [BoxMesh.new()])
	var scene := Node3D.new()
	for spec in [["a", "SceneObject"], ["fx", "Fixture"], ["c", "SceneObject"], ["z", "SceneObject"]]:
		var o := Node3D.new()
		o.set_meta("uuid", spec[0])
		o.set_meta("kind", spec[1])
		o.set_meta("layer", "MVR")
		var part := MeshInstance3D.new()
		part.name = "mvr_part"
		o.add_child(part)
		scene.add_child(o)
	scene.get_child(2).set_meta("screen", true)
	scene.add_child(Node3D.new())  # a selection mark: no uuid, left alone
	var r := Venue.apply(scene, v)
	t.eq(r.swapped, 1, "only the plain scene object is swapped")
	t.eq(scene.get_child(0).get_child(0).name != &"mvr_part", true, "object a now draws the .glb mesh")
	t.ok(str(scene.get_child(0).get_meta("model")).begins_with("glb:"), "its model key is the .glb mesh")
	t.eq(scene.get_child(1).get_child(0).name, &"mvr_part", "the fixture keeps the MVR's part")
	t.eq(scene.get_child(2).get_child(0).name, &"mvr_part", "a bound video screen keeps its part")
	t.eq(scene.get_child(3).get_child(0).name, &"mvr_part", "an object the .glb lacks keeps its part")
	t.eq(r.extra, 1, "the uuid-less mesh is a new object; the fixture's .glb mesh is dropped")
	var extra := scene.get_child(scene.get_child_count() - 1)
	t.eq(extra.get_meta("uuid"), "glb:4", "the new object carries its key as uuid")
	t.eq(r.layers, {"": 1}, "…on its (here: no) Capture layer")
	scene.free()


func test_summary() -> void:
	var M := preload("res://features/previs/mvr_model.gd")
	var base := {"name": "N", "objects": 1}
	t.ok(M.summary(base.merged({"venue_name": "v.glb", "venue": {"swapped": 3, "extra": 2}})).contains(
		"Venue model v.glb: 3 objects drawn from it, 2 more only in it"), "counts")
	t.ok(M.summary(base.merged({"venue": {"error": "boom"}})).ends_with("\nboom"), "an error is the line")
	t.ok(not M.summary(base).contains("Venue"), "no venue, no line")
