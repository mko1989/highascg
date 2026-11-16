extends RefCounted
## WO-1103 — "bring your own" test puppet (human_own.gd): bone names of every exporter convention map onto the humanoid
## the motion needs (and a non-humanoid is refused with what is missing), the folder listing, and a tiny synthetic
## Mixamo-named T-pose character of our own (made here, written as GLB — never an excerpt of anyone's asset) that faces
## −Z: it is turned to +Z, its soles put on the floor, its height measured from the skinned rest pose, and the shipped
## motion retargeted onto it walks it with its toes standing on the floor.

const Map := preload("res://features/previs/tracking/human_rig_map.gd")
const Own := preload("res://features/previs/tracking/human_own.gd")
const Body := preload("res://features/previs/tracking/human_body.gd")
const Human := preload("res://features/previs/tracking/person_human.gd")
var t


func _sk(names: Array) -> Skeleton3D:
	var sk := Skeleton3D.new()
	for n: Array in names:  # [name, parent name]
		var b := sk.add_bone(n[0])
		if n[1] != "":
			sk.set_bone_parent(b, sk.find_bone(n[1]))
	return sk


func test_bone_names_of_every_convention() -> void:
	t.eq(Map.norm("mixamorig:LeftUpLeg"), "leftupleg", "mixamo")
	t.eq(Map.norm("Bip01 L Thigh"), "lthigh", "3ds Max biped")
	t.eq(Map.norm("thigh_l"), "thighl", "unreal")
	t.eq(Map.norm("DEF-thigh.L"), "thighl", "rigify")
	t.eq(Map.norm("Armature|J_Bip_L_UpperLeg"), "lupperleg", "vrm")
	var conv := {
		"unreal / metahuman": [["root", ""], ["pelvis", "root"], ["spine_01", "pelvis"], ["spine_02", "spine_01"], ["spine_03", "spine_02"],
			["spine_04", "spine_03"], ["spine_05", "spine_04"], ["neck_01", "spine_05"], ["neck_02", "neck_01"], ["head", "neck_02"],
			["thigh_l", "pelvis"], ["calf_l", "thigh_l"], ["foot_l", "calf_l"], ["ball_l", "foot_l"], ["thigh_r", "pelvis"], ["calf_r", "thigh_r"],
			["foot_r", "calf_r"], ["ball_r", "foot_r"], ["clavicle_l", "spine_05"], ["upperarm_l", "clavicle_l"], ["lowerarm_l", "upperarm_l"],
			["hand_l", "lowerarm_l"], ["thigh_twist_01_l", "thigh_l"]],
		"godot humanoid": [["Hips", ""], ["Spine", "Hips"], ["Chest", "Spine"], ["UpperChest", "Chest"], ["Neck", "UpperChest"], ["Head", "Neck"],
			["LeftUpperLeg", "Hips"], ["LeftLowerLeg", "LeftUpperLeg"], ["LeftFoot", "LeftLowerLeg"], ["LeftToes", "LeftFoot"],
			["RightUpperLeg", "Hips"], ["RightLowerLeg", "RightUpperLeg"], ["RightFoot", "RightLowerLeg"], ["RightToes", "RightFoot"]],
	}
	for k: String in conv:
		var sk := _sk(conv[k])
		var m := Map.map(sk)
		t.ok(m.ok, "%s: maps (missing %s)" % [k, m.missing])
		t.eq(sk.get_bone_name(m.bones.LeftLowerLeg), "calf_l" if k.begins_with("unreal") else "LeftLowerLeg", "%s: the left shin" % k)
		sk.free()
	var mh := _sk(conv["unreal / metahuman"])
	var m := Map.map(mh)
	t.eq([mh.get_bone_name(m.bones.Spine), mh.get_bone_name(m.bones.Chest), mh.get_bone_name(m.bones.UpperChest), mh.get_bone_name(m.bones.Neck)],
		["spine_01", "spine_03", "spine_05", "neck_01"], "metahuman: five spine bones → Spine / Chest / UpperChest, the lower neck")
	t.ok(not m.bones.values().has(mh.find_bone("thigh_twist_01_l")), "twist bones left alone")
	mh.free()
	var quad := _sk([["body", ""], ["leg1", "body"], ["leg2", "body"], ["head", "body"]])
	var q := Map.map(quad)
	t.ok(not q.ok and q.missing.has("LeftUpperLeg") and q.missing.has("Hips"), "a non-humanoid is refused, missing named: %s" % [q.missing])
	quad.free()


## A tiny humanoid of our own: Mixamo names (as Godot imports them: "mixamorig_…"), T-pose, facing −Z (its left on −X), a 4-vertex patch per bone.
func _synthetic(path: String) -> void:
	var f := -1.0  # facing −Z
	var bones := [["Hips", "", Vector3(0, 0.95, 0)], ["Spine", "Hips", Vector3(0, 0.1, 0)], ["Spine1", "Spine", Vector3(0, 0.12, 0)],
		["Spine2", "Spine1", Vector3(0, 0.12, 0)], ["Neck", "Spine2", Vector3(0, 0.16, 0)], ["Head", "Neck", Vector3(0, 0.1, 0)],
		["HeadTop_End", "Head", Vector3(0, 0.22, 0)]]
	for side in [["Left", 1.0], ["Right", -1.0]]:
		var s: float = side[1] * f  # the person's left is −X when facing −Z
		var n: String = side[0]
		bones.append_array([[n + "UpLeg", "Hips", Vector3(0.09 * s, -0.05, 0)], [n + "Leg", n + "UpLeg", Vector3(0, -0.42, 0)],
			[n + "Foot", n + "Leg", Vector3(0, -0.4, 0)], [n + "ToeBase", n + "Foot", Vector3(0, -0.07, 0.13 * f)],
			[n + "Shoulder", "Spine2", Vector3(0.05 * s, 0.1, 0)], [n + "Arm", n + "Shoulder", Vector3(0.12 * s, 0, 0)],
			[n + "ForeArm", n + "Arm", Vector3(0.27 * s, 0, 0)], [n + "Hand", n + "ForeArm", Vector3(0.25 * s, 0, 0)]])
	var root := Node3D.new()
	root.name = "Synth"
	var sk := Skeleton3D.new()
	sk.name = "Skeleton3D"
	root.add_child(sk)
	for b: Array in bones:
		var i := sk.add_bone("mixamorig_" + str(b[0]))
		if b[1] != "":
			sk.set_bone_parent(i, sk.find_bone("mixamorig_" + str(b[1])))
		sk.set_bone_rest(i, Transform3D(Basis.IDENTITY, b[2]))
	sk.reset_bone_poses()
	var verts := PackedVector3Array()
	var idx := PackedInt32Array()
	var bw := PackedInt32Array()
	var ww := PackedFloat32Array()
	var skin := Skin.new()
	for i in sk.get_bone_count():
		var g := sk.get_bone_global_rest(i)
		skin.add_named_bind(sk.get_bone_name(i), g.affine_inverse())
		var base := verts.size()
		for o in [Vector3(-0.03, 0, -0.03), Vector3(0.03, 0, -0.03), Vector3(0.03, 0, 0.03), Vector3(-0.03, 0, 0.03)]:
			verts.append(g.origin + o)
			bw.append_array([i, 0, 0, 0])
			ww.append_array([1.0, 0.0, 0.0, 0.0])
		idx.append_array([base, base + 1, base + 2, base, base + 2, base + 3])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_INDEX] = idx
	arr[Mesh.ARRAY_BONES] = bw
	arr[Mesh.ARRAY_WEIGHTS] = ww
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = mesh
	mi.skin = skin
	sk.add_child(mi)
	mi.skeleton = NodePath("..")
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	doc.append_from_scene(root, st)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	doc.write_to_filesystem(st, path)
	root.free()


func test_own_synthetic_humanoid_is_placed_and_walks() -> void:
	var dir := OS.get_user_data_dir().path_join("wo1103_own")
	_synthetic(dir.path_join("synth/synth.glb"))
	var ls := Own.list(dir)
	t.eq(ls.map(func(e: Dictionary) -> String: return e.slug), ["synth"], "the folder lists it")
	var tpl := Own.template("synth", func(n: String) -> Dictionary: return Body.template(n), dir)
	var rep := Own.report("synth")
	t.ok(rep.get("ok", false), "imported: %s" % rep)
	if tpl.is_empty():
		return
	t.ok(absf(float(tpl.height) - 1.76) < 0.02, "height from the skinned rest pose %.2f m (toe patch 0.01 → head top patch 1.77)" % tpl.height)
	t.ok((rep.mapped as Array).has("LeftUpperArm") and (rep.mapped as Array).has("UpperChest"), "arms and the spine mapped")
	Body._templates["own:synth"] = tpl
	var h := Human.new("own:synth")
	(t.root as Node).add_child(h)
	h.set_process(false)
	t.ok(h.ok(), "a human node wears it")
	var sk: Skeleton3D = h._sk
	h.set_target(Vector3.ZERO, 1.8, {}, null, 0.0)
	h.step(1.0 / 60.0)
	var to := h.transform.affine_inverse() * h.transform * h._root.transform  # model root space (the node is not drawn here)
	var lf: Vector3 = to * h._bone_global(sk.find_bone("mixamorig_LeftFoot")).origin
	var lt: Vector3 = to * h._bone_global(sk.find_bone("mixamorig_LeftToeBase")).origin
	t.ok(lt.z > lf.z + 0.02, "turned to face +Z: the toes in front of the ankle (%.2f > %.2f)" % [lt.z, lf.z])
	t.ok(lf.x > 0.03, "its left foot on +X (%.2f)" % lf.x)
	var dt := 1.0 / 60.0
	var tt := 0.0
	var nx := 0.0
	var anchor: Variant = null
	var drift := 0.0
	var plants := 0
	var low := 9.0
	for i in 480:
		if tt >= nx:
			h.set_target(Vector3(1.2 * tt, 0.0, 0.0), 1.8, {}, null, tt)
			nx += 1.0 / 15.0
		h.step(dt)
		tt += dt
		var p: Vector3 = h.shown().feet[0]
		low = minf(low, p.y)
		if tt < 2.0:
			continue
		if p.y > 0.05:
			anchor = null
		elif p.y < 0.03:
			if anchor == null:
				anchor = p
				plants += 1
			drift = maxf(drift, Vector2(p.x - anchor.x, p.z - anchor.z).length())
	t.ok(absf(low) < 0.03, "its toes reach the floor (lowest %.3f m)" % low)
	t.ok(plants >= 3, "%d left-foot plants in 6 s" % plants)
	t.ok(drift < 0.08, "a planted toe drifts %.3f m at most (other proportions than the clips' actor)" % drift)
	h.free()
	Body._templates.erase("own:synth")
