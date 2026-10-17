extends SceneTree
## WO-595: write a small test stage .glb for the previs scene (runtime glTF import check).
## godot --headless --path godot/spikes/m0 --script res://tools/make_test_stage.gd -- <out.glb>
## Meshes: "Floor", "Truss", "LED_Screen_Main" (16:9), "LED_Screen_Side" — the *screen* meshes get the
## live material in mode_previs.gd.


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0] if args.size() > 0 else "test_stage.glb"
	var root := Node3D.new()
	root.name = "Stage"
	_add_box(root, "Floor", Vector3(16, 0.2, 10), Vector3(0, -0.1, 0), Color(0.15, 0.15, 0.17))
	_add_box(root, "Truss", Vector3(9, 0.3, 0.3), Vector3(0, 4.6, 0), Color(0.3, 0.3, 0.32))
	_add_box(root, "LED_Screen_Main", Vector3(7.2, 4.05, 0.12), Vector3(0, 2.4, -0.5), Color(0.1, 0.1, 0.1))
	var side := _add_box(root, "LED_Screen_Side", Vector3(2.4, 1.35, 0.1), Vector3(5.5, 1.8, 1.5), Color(0.1, 0.1, 0.1))
	side.rotation_degrees = Vector3(0, -35, 0)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_scene(root, state)
	if err == OK:
		err = doc.write_to_filesystem(state, out)
	print("[make_test_stage] ", out, " -> ", error_string(err))
	root.free()
	quit(0 if err == OK else 1)


func _add_box(parent: Node3D, mesh_name: String, size: Vector3, pos: Vector3, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = mesh_name
	var box := BoxMesh.new()
	box.size = size
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	box.material = mat
	mi.mesh = box
	mi.position = pos
	parent.add_child(mi)
	return mi
