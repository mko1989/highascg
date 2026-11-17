extends RefCounted
## WO-1110 — cell_batch.gd: the cells of one built fixture become a few MultiMeshInstance3D (lenses, bodies), each
## cell's light goes to its instance colour; real beams and small rigs are left alone.

const B := preload("res://features/previs/fixtures/cell_batch.gd")
var t


## A head: root → pan (axis) → 8 cells in a row, each a beam node with a prim body + a lens; plus one real beam.
func _fixture(cells := 8) -> Array:
	var root := Node3D.new()
	var pan := Node3D.new()
	pan.position = Vector3(0, -0.2, 0)
	root.add_child(pan)
	var parts := {"axes": {"pan": [pan, pan.transform, "Pan"]}, "beams": {}}
	var body_mesh := BoxMesh.new()
	for i in cells:
		var node := Node3D.new()
		node.position = Vector3(0.1 * i, 0, 0)
		pan.add_child(node)
		var body := MeshInstance3D.new()
		body.mesh = body_mesh
		body.material_override = StandardMaterial3D.new()
		node.add_child(body)
		var lens := MeshInstance3D.new()
		var lm := BoxMesh.new()
		lm.size = Vector3(0.05, 0.002, 0.05)
		lens.mesh = lm
		lens.position = Vector3(0, -0.01, 0)
		lens.set_meta("no_tint", true)
		node.add_child(lens)
		parts.beams["c%d" % i] = {"lens": StandardMaterial3D.new(), "lens_mi": lens, "body": body}
	var spot := Node3D.new()
	pan.add_child(spot)
	var sl := MeshInstance3D.new()
	sl.mesh = CylinderMesh.new()
	spot.add_child(sl)
	parts.beams["spot"] = {"lens": StandardMaterial3D.new(), "lens_mi": sl, "body": null, "cone": MeshInstance3D.new()}
	return [root, parts, pan]


func test_cells_become_two_batches_under_the_moving_part() -> void:
	var f := _fixture()
	var root: Node3D = f[0]
	var parts: Dictionary = f[1]
	var replaced := B.run(root, parts)
	t.eq(replaced, 16, "8 lenses + 8 bodies replaced")
	var batches: Array = root.find_children("*", "MultiMeshInstance3D", true, false)
	t.eq(batches.size(), 2, "one lens batch, one body batch")
	for b in batches:
		t.eq((b as Node).get_parent(), f[2], "the batch hangs under the cells' moving part (it turns with the head)")
		t.eq((b as MultiMeshInstance3D).multimesh.instance_count, 8, "8 cells each")
		t.ok((b as Node).has_meta("no_tint"), "lit by instance colour: a type tint leaves it alone")
	t.eq(root.find_children("*", "MeshInstance3D", true, false).size(), 1, "only the real beam's lens is still a node")
	var c3: Dictionary = parts.beams.c3
	t.ok(c3.has("cell") and not c3.has("lens") and not c3.has("lens_mi"), "a batched beam is lit through `cell`")
	t.eq((c3.cell as Array).size(), 2, "its lens and its glowing body")
	t.ok(parts.beams.spot.has("lens") and not parts.beams.spot.has("cell"), "a real beam (cone) is left as it was")
	root.free()
	(parts.beams.spot.cone as Node).free()


func test_plain_lights_the_unbatched_lens_material() -> void:
	var f := _fixture()
	B.run(f[0], f[1])
	var tint := Color(0.1, 0.2, 0.9, 0.5)
	B.light(f[1].beams.c0.cell, tint)  # instance colours cannot be read back under the headless renderer: seen on glass
	B.plain(f[1].beams.spot, tint)
	var lm := f[1].beams.spot.lens as StandardMaterial3D
	t.ok(lm.emission.is_equal_approx(Color(0.1, 0.2, 0.9)) and is_equal_approx(lm.emission_energy_multiplier, 2.0), "the unbatched lens as before")
	(f[0] as Node).free()
	(f[1].beams.spot.cone as Node).free()


func test_a_small_rig_is_not_batched() -> void:
	var f := _fixture(3)
	t.eq(B.run(f[0], f[1]), 0, "under MIN_CELLS nothing changes")
	t.eq((f[0] as Node).find_children("*", "MultiMeshInstance3D", true, false).size(), 0, "no batch")
	t.ok(f[1].beams.c0.has("lens") and not f[1].beams.c0.has("lens_mi"), "the lens material stays; the build-time handle is dropped")
	(f[0] as Node).free()
	(f[1].beams.spot.cone as Node).free()
