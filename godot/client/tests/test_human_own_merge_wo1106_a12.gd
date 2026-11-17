extends RefCounted
## WO-1106 A12 — an own puppet folder with a body file AND a head file on one skeleton (the Unreal / MetaHuman export)
## is joined into one puppet by bone name (human_own_merge.gd), instead of loading one file (a headless puppet) or
## refusing the folder. In memory: a shared 3-bone skeleton (root → spine → head) whose second file adds bones
## (a jaw under the head, a collar under the spine), lists its bones in another order and sits elsewhere in its own
## space; its skinned mesh is remapped onto the main skeleton and lands where it was authored; the refusals (no shared
## bone, a used bone under an unknown parent) name what is wrong. On disk: the synthetic humanoid body
## (test_human_own_wo1103) + a head GLB written here load as one ok puppet, also through the A39 worker thread.
## Every fixture is made in code (ours); scratch folders only under user://wo1106_a12_* (removed before and after).

const Own := preload("res://features/previs/tracking/human_own.gd")
const Merge := preload("res://features/previs/tracking/human_own_merge.gd")
const Body := preload("res://features/previs/tracking/human_body.gd")
const Synth := preload("res://tests/test_human_own_wo1103.gd")
var t


## An imported-looking file: root Node3D → Skeleton3D → MeshInstance3D skinned by bone index (as GLTFDocument makes
## it), one quad per bone in `skinned`. bones: [[name, parent name, local offset]]; `shift` moves the whole skeleton
## inside its own space.
func _part(bones: Array, skinned: Array, shift := Vector3.ZERO, mesh_name := "Mesh") -> Node3D:
	var root := Node3D.new()
	var sk := Skeleton3D.new()
	sk.name = "Skeleton3D"
	root.add_child(sk)
	for b: Array in bones:
		var i := sk.add_bone(b[0])
		if b[1] != "":
			sk.set_bone_parent(i, sk.find_bone(b[1]))
		sk.set_bone_rest(i, Transform3D(Basis.IDENTITY, (b[2] as Vector3) + (shift if b[1] == "" else Vector3.ZERO)))
	sk.reset_bone_poses()
	if skinned.is_empty():
		return root
	var verts := PackedVector3Array()
	var bw := PackedInt32Array()
	var ww := PackedFloat32Array()
	var skin := Skin.new()
	for n: String in skinned:
		var g := sk.get_bone_global_rest(sk.find_bone(n))
		skin.add_bind(sk.find_bone(n), g.affine_inverse())  # the importer binds by the file's own bone index
		for o in [Vector3(-0.02, 0, 0), Vector3(0.02, 0, 0), Vector3(0, 0.02, 0)]:
			verts.append(g.origin + o)
			bw.append_array([skin.get_bind_count() - 1, 0, 0, 0])
			ww.append_array([1.0, 0.0, 0.0, 0.0])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_BONES] = bw
	arr[Mesh.ARRAY_WEIGHTS] = ww
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.name = mesh_name
	mi.mesh = mesh
	mi.skin = skin
	sk.add_child(mi)
	mi.skeleton = NodePath("..")
	return root


func _sk(n: Node) -> Skeleton3D:
	return n.get_node("Skeleton3D")


## Where the skin puts a mesh's vertex at rest, in its skeleton's space.
func _rest_vertex(mi: MeshInstance3D, sk: Skeleton3D, v: int) -> Vector3:
	var a: Array = mi.mesh.surface_get_arrays(0)
	var bind: int = (a[Mesh.ARRAY_BONES] as PackedInt32Array)[v * 4]
	var b := sk.find_bone(mi.skin.get_bind_name(bind)) if mi.skin.get_bind_name(bind) != StringName() else mi.skin.get_bind_bone(bind)
	return sk.get_bone_global_rest(b) * mi.skin.get_bind_pose(bind) * (a[Mesh.ARRAY_VERTEX] as PackedVector3Array)[v]


const BODY := [["root", "", Vector3.ZERO], ["spine", "root", Vector3(0, 1.0, 0)], ["head", "spine", Vector3(0, 0.6, 0)]]
const HEAD := [["root", "", Vector3.ZERO], ["spine", "root", Vector3(0, 1.0, 0)], ["collar", "spine", Vector3(0.1, 0.4, 0)],
	["head", "spine", Vector3(0, 0.6, 0)], ["jaw", "head", Vector3(0, -0.05, 0.08)]]


func test_head_file_joins_the_body_skeleton_by_bone_name() -> void:
	var body := _part(BODY, ["root", "spine", "head"], Vector3.ZERO, "Body")
	var head := _part(HEAD, ["head", "jaw"], Vector3(2.0, 0.0, 0.0), "Head")  # another bone order, another origin
	var msk := _sk(body)
	var hmi: MeshInstance3D = _sk(head).get_node("Head")
	var want := [_rest_vertex(hmi, _sk(head), 0) - Vector3(2, 0, 0), _rest_vertex(hmi, _sk(head), 3) - Vector3(2, 0, 0)]
	t.eq(_sk(head).find_bone("head"), 3, "the head file's 'head' is its bone 3 (the body's bone 3 does not exist yet)")
	var r := Merge.join(msk, head, _sk(head), "/x/head.glb", "/x/body.glb")
	t.ok(r.ok, "joined: %s" % r)
	t.eq(msk.get_bone_count(), 5, "the body's 3 bones + collar + jaw")
	t.eq(r.added, ["collar", "jaw"], "the added bones, parents first")
	t.eq(msk.get_bone_name(msk.get_bone_parent(msk.find_bone("jaw"))), "head", "the jaw hangs under the body's head")
	t.eq(msk.get_bone_name(msk.get_bone_parent(msk.find_bone("collar"))), "spine", "the collar under the spine")
	t.ok(msk.get_bone_global_rest(msk.find_bone("jaw")).origin.is_equal_approx(Vector3(0, 1.55, 0.08)),
		"the jaw where the head file put it, in the body's space: %s" % msk.get_bone_global_rest(msk.find_bone("jaw")).origin)
	t.eq(r.meshes, 1, "one mesh moved")
	t.ok(hmi.get_parent() == msk and hmi.get_node_or_null(hmi.skeleton) == msk, "the head mesh is skinned to the body's skeleton")
	var names := []
	for i in hmi.skin.get_bind_count():
		names.append(str(msk.get_bone_name(hmi.skin.get_bind_bone(i))))
		t.eq(str(hmi.skin.get_bind_name(i)), names[i], "bind %d is named after its main bone" % i)
	t.eq(names, ["head", "jaw"], "binds remapped by name onto the main skeleton's indices")
	t.ok(_rest_vertex(hmi, msk, 0).is_equal_approx(want[0]) and _rest_vertex(hmi, msk, 3).is_equal_approx(want[1]),
		"at rest the head mesh is where it was authored: %s / %s" % [_rest_vertex(hmi, msk, 0), want[0]])
	t.ok(_sk(body).has_node("Body") and _sk(body).has_node("Head"), "the body keeps its mesh, the head's sits beside it")
	head.free()
	body.free()


func test_shared_skin_and_name_clash() -> void:
	var body := _part(BODY, ["root", "spine", "head"], Vector3.ZERO, "Mesh")
	var head := _part(HEAD, ["head", "jaw"], Vector3.ZERO, "Mesh")
	var hsk := _sk(head)
	var twin := MeshInstance3D.new()  # a second mesh on the same Skin resource (lashes on the head's skin)
	twin.name = "Lashes"
	twin.mesh = (hsk.get_node("Mesh") as MeshInstance3D).mesh
	twin.skin = (hsk.get_node("Mesh") as MeshInstance3D).skin
	hsk.add_child(twin)
	twin.skeleton = NodePath("..")
	var r := Merge.join(_sk(body), head, hsk, "/x/head.glb", "/x/body.glb")
	t.ok(r.ok and r.meshes == 2, "both meshes moved: %s" % r)
	t.ok(_sk(body).has_node("Mesh") and _sk(body).has_node("Mesh_2"), "a clashing name gets a suffix, the body's keeps its own")
	t.ok(twin.skin == (_sk(body).get_node("Mesh_2") as MeshInstance3D).skin, "one remapped Skin for the meshes that shared one")
	t.eq(str(_sk(body).get_bone_name(twin.skin.get_bind_bone(1))), "jaw", "remapped once (not twice)")
	head.free()
	body.free()


func test_rigid_and_unskinned_meshes_move_with_their_bone() -> void:
	var body := _part(BODY, ["root", "spine", "head"])
	var head := _part(HEAD, ["head"], Vector3(1, 0, 0))
	var hsk := _sk(head)
	var att := BoneAttachment3D.new()
	att.name = "EyeAttach"
	hsk.add_child(att)
	att.bone_name = "jaw"
	var eye := MeshInstance3D.new()
	eye.mesh = SphereMesh.new()
	att.add_child(eye)
	var hat := MeshInstance3D.new()  # not skinned, not on a bone: keeps its place
	hat.name = "Hat"
	hat.mesh = BoxMesh.new()
	head.add_child(hat)
	hat.position = Vector3(1, 1.8, 0)
	var r := Merge.join(_sk(body), head, hsk, "/x/head.glb", "/x/body.glb")
	t.ok(r.ok and r.meshes == 3, "skinned + attached + loose: %s" % r)
	t.ok(att.get_parent() == _sk(body) and att.bone_name == "jaw" and att.bone_idx == _sk(body).find_bone("jaw"), "the attachment follows the body's jaw")
	t.ok(eye.get_parent() == att, "with its mesh")
	t.ok(hat.get_parent() == _sk(body) and hat.position.is_equal_approx(Vector3(0, 1.8, 0)), "the hat where it was, in the body's space: %s" % hat.position)
	head.free()
	body.free()


func test_refusals_name_the_problem() -> void:
	var body := _part(BODY, ["root", "spine", "head"])
	var prop := _part([["base", "", Vector3.ZERO], ["lid", "base", Vector3(0, 0.1, 0)]], ["lid"])
	var r := Merge.join(_sk(body), prop, _sk(prop), "/x/prop.glb", "/x/body.glb")
	t.ok(not r.ok and str(r.error).contains("prop.glb") and str(r.error).contains("shares no bone"), "no shared bone: %s" % r.error)
	prop.free()
	var stray := _part([["head", "", Vector3(0, 1.6, 0)], ["face_root", "", Vector3.ZERO], ["brow", "face_root", Vector3(0, 1.7, 0.1)]], ["head", "brow"])
	r = Merge.join(_sk(body), stray, _sk(stray), "/x/face.glb", "/x/body.glb")
	t.ok(not r.ok and str(r.error).contains("face.glb") and str(r.error).contains("\"face_root\"") and str(r.error).contains("root bone"),
		"a used bone whose chain reaches no body bone: refused, named — %s" % r.error)
	t.eq((_sk(stray).get_node("Mesh") as Node).get_parent(), _sk(stray), "nothing moved on a refusal")
	stray.free()
	var spare := _part([["head", "", Vector3(0, 1.6, 0)], ["helper", "", Vector3.ZERO]], ["head"])
	r = Merge.join(_sk(body), spare, _sk(spare), "/x/hat.glb", "/x/body.glb")
	t.ok(r.ok and str(r.warnings).contains("unused"), "an unused stray bone is left out with a warning: %s" % r)
	t.eq(_sk(body).find_bone("helper"), -1, "and not added")
	spare.free()
	body.free()


func test_main_file_most_bones_then_name() -> void:
	var mk := func(n: int) -> Skeleton3D:
		var s := Skeleton3D.new()
		for i in n:
			s.add_bone("b%d" % i)
		return s
	var parts := [{"file": "/x/head.fbx", "sk": mk.call(5)}, {"file": "/x/body.fbx", "sk": mk.call(3)}]
	t.eq(Merge.pick_main(parts), 0, "the most bones")
	parts.append({"file": "/x/a_body.fbx", "sk": mk.call(5)})
	t.eq(Merge.pick_main(parts), 2, "a tie: the file name")
	t.eq(Merge.pick_main([parts[2], parts[0]]), 0, "in any order")
	for p: Dictionary in parts:
		(p.sk as Node).free()


## The real path: body.glb (the synthetic humanoid) + head.glb (its neck chain in another order, a jaw, a skinned head
## mesh) → one puppet reported ok, joined; a folder with an unrelated rigged file is refused and says why.
func test_body_and_head_files_load_as_one_puppet() -> void:
	var dir := OS.get_user_data_dir().path_join("wo1106_a12_disk")
	_rm_tree(dir)
	Synth.new()._synthetic(dir.path_join("ada/body.glb"))
	_write_head(dir.path_join("ada/head.glb"))
	t.eq(Own.list(dir).size(), 1, "one character")
	var tpl := Own.template("ada", func(n: String) -> Dictionary: return Body.template(n), dir)
	var rep := Own.report("ada")
	t.ok(not tpl.is_empty() and rep.get("ok", false), "body + head: one ok puppet — %s" % rep)
	t.eq(str(rep.get("file", "")).get_file(), "body.glb", "the body (most bones) is the main file")
	t.eq(rep.get("joined", []), ["head.glb"], "the head file joined")
	if not tpl.is_empty():
		var sk: Skeleton3D = (tpl.root as Node).get_node(tpl.skeleton_path)
		t.eq(int(rep.bones), 24, "23 body bones + the jaw")
		t.eq(sk.get_bone_name(sk.get_bone_parent(sk.find_bone("mixamorig_Jaw"))), "mixamorig_Head", "the jaw under the head")
		var head: MeshInstance3D = null
		for mi: MeshInstance3D in (tpl.root as Node).find_children("*", "MeshInstance3D", true, false):
			if str(mi.name).begins_with("HeadMesh"):
				head = mi
		t.ok(head != null and head.get_node_or_null(head.skeleton) == sk, "the head mesh is on the puppet's skeleton")
		if head != null:
			var bound := {}
			for i in head.skin.get_bind_count():
				bound[str(sk.get_bone_name(head.skin.get_bind_bone(i)))] = true
			t.ok(bound.has("mixamorig_Head") and bound.has("mixamorig_Jaw") and bound.has("mixamorig_Neck"), "bound by name: %s" % [bound.keys()])
		(tpl.root as Node).free()
	# A13: the merged folder's look covers both files — touching the head file reloads it
	Own._looked.erase("ada")
	t.ok(not Own.stale("ada"), "nothing changed")
	DirAccess.remove_absolute(dir.path_join("ada/head.glb"))
	Own._looked.erase("ada")
	t.ok(Own.stale("ada"), "the head file removed: load again")
	# refused: a second rigged file on an unrelated skeleton
	_write_prop(dir.path_join("ada/prop.glb"))
	t.ok(Own.template("ada", func(n: String) -> Dictionary: return Body.template(n), dir).is_empty(), "an unrelated rig: not loaded")
	t.ok(str(Own.report("ada").get("error", "")).contains("prop.glb") and str(Own.report("ada").get("error", "")).contains("shares no bone"),
		"says why: %s" % Own.report("ada").get("error", ""))
	for k in ["ada"]:
		Own._reports.erase(k)
		Own._sigs.erase(k)
		Own._looked.erase(k)
	_rm_tree(dir)


## A39 kept: the joined import runs on the WorkerThreadPool and lands on a later frame.
func test_joined_import_runs_on_the_worker() -> void:
	var dir := OS.get_user_data_dir().path_join("wo1106_a12_async")
	_rm_tree(dir)
	Synth.new()._synthetic(dir.path_join("bea/body.glb"))
	_write_head(dir.path_join("bea/head.glb"))
	Body.own_root = dir
	await t.process_frame  # the runner's tree is the main loop only once _init() has yielded (a filtered run starts here)
	t.eq(Body.template("own:bea"), {}, "the first ask returns at once")
	t.ok(Body._loading.has("own:bea"), "an import task runs")
	var until := Time.get_ticks_msec() + 10000
	while Body._loading.has("own:bea") and Time.get_ticks_msec() < until:
		await t.process_frame
	var tpl := Body.template("own:bea")
	t.ok(not tpl.is_empty() and Own.report("bea").get("ok", false) and Own.report("bea").get("joined", []) == ["head.glb"],
		"landed joined: %s" % Own.report("bea"))
	if tpl.has("root") and is_instance_valid(tpl.root):
		(tpl.root as Node).free()
	Body._templates.erase("own:bea")
	Body.own_root = ""
	Own._reports.erase("bea")
	Own._sigs.erase("bea")
	Own._looked.erase("bea")
	_rm_tree(dir)


## The synthetic body's neck chain (Mixamo names as imported), listed in another order than the body's, plus a jaw;
## one skinned head mesh bound to the neck, the head and the jaw.
func _write_head(path: String) -> void:
	var bones := [["Hips", "", Vector3(0, 0.95, 0)], ["Spine", "Hips", Vector3(0, 0.1, 0)], ["Spine1", "Spine", Vector3(0, 0.12, 0)],
		["Spine2", "Spine1", Vector3(0, 0.12, 0)], ["LeftShoulder", "Spine2", Vector3(-0.05, 0.1, 0)], ["Neck", "Spine2", Vector3(0, 0.16, 0)],
		["Head", "Neck", Vector3(0, 0.1, 0)], ["Jaw", "Head", Vector3(0, 0.02, -0.08)]]
	for b: Array in bones:
		b[0] = "mixamorig_" + str(b[0])
		b[1] = ("mixamorig_" + str(b[1])) if str(b[1]) != "" else ""
	var names := bones.map(func(b: Array) -> String: return b[0])
	_save(_part(bones, names, Vector3.ZERO, "HeadMesh"), path)


func _write_prop(path: String) -> void:
	_save(_part([["base", "", Vector3.ZERO], ["lid", "base", Vector3(0, 0.1, 0)]], ["base", "lid"], Vector3.ZERO, "Prop"), path)


func _save(root: Node3D, path: String) -> void:
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	doc.append_from_scene(root, st)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	doc.write_to_filesystem(st, path)
	root.free()


## Removes one of this file's own scratch folders under user:// (never anything else).
func _rm_tree(path: String) -> void:
	if not path.begins_with(OS.get_user_data_dir().path_join("wo1106_a12_")) or not DirAccess.dir_exists_absolute(path):
		return
	for d in DirAccess.get_directories_at(path):
		_rm_tree(path.path_join(d))
	for f in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(f))
	DirAccess.remove_absolute(path)
