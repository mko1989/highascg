extends SceneTree
## WO-1103 build step (not shipped; run by tools/people/rocketbox_build.sh in a throw-away Godot project):
##   godot --headless --path <tmp project> --script rocketbox_bake.gd -- <spec.json> <out dir>
## Per body in the spec: the Microsoft Rocketbox avatar FBX (MIT) → <out>/<body>.scn (a Godot scene: the skinned mesh
## with generated LODs on its 81-bone "Bip01" biped skeleton, no images, no animation; a native scene, not GLB — a glTF
## round trip turns the unweighted root bone into a node and the clips lose it) and the Rocketbox motion-capture clips (same skeleton, MIT) →
## <out>/<body>_moves.res (an AnimationLibrary):
##   - rotation tracks of the avatar's bones; the only position track is the root (Bip01), its height scaled to this
##     body (the clip actor's hip height → the avatar's);
##   - root motion taken out: walks keep their in-stride bob and sway but not the forward travel (the puppet node
##     moves at the tracked speed; the clip's stride is metadata), turns lose their yaw (metadata curve: the node turns);
##   - walks cut to start at the left heel strike and stretched to a 1 s cycle, so the blend of slow / normal / fast
##     walks stays in phase (feet land together whatever the mix).
## Metadata per animation: speed (m/s as recorded, scaled), stride (m per cycle), yaw (turns: total rad), src (file).

const KEYS := 32  # keys per walk cycle

var _fwd_axis := 2  # Bip01 local axis (0 x, 1 y, 2 z) that points to the avatar's front at rest
var _fwd_sign := 1.0


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var spec: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	var out: String = args[1]
	for body: String in spec.bodies:
		var b: Dictionary = spec.bodies[body]
		var av := _load(str(b.fbx), true)
		var sk: Skeleton3D = av.find_children("*", "Skeleton3D", true, false)[0]
		var hip := sk.get_bone_global_rest(sk.find_bone("Bip01")).origin.y
		_pick_forward(sk)
		var lib := AnimationLibrary.new()
		for clip: String in b.clips:
			var c: Dictionary = b.clips[clip]
			var a := _clip(str(c.file), sk, hip, str(c.kind))
			a.set_meta("src", str(c.file).get_file())
			lib.add_animation(clip, a)
			print("[bake] %s %s: %s len %.2f speed %.3f stride %.3f yaw %.3f" % [body, clip, a.get_meta("src"), a.length,
				a.get_meta("speed", 0.0), a.get_meta("stride", 0.0), a.get_meta("yaw", 0.0)])
		ResourceSaver.save(lib, "%s/%s_moves.res" % [out, body], ResourceSaver.FLAG_COMPRESS)
		_export(av, sk, "%s/%s.scn" % [out, body], str(b.prefix))
	quit()


func _load(path: String, lods := false) -> Node3D:
	var doc := FBXDocument.new()
	var st := FBXState.new()
	if doc.append_from_file(path, st) != OK:
		push_error("cannot read " + path)
		quit(1)
	if lods:
		for gm: GLTFMesh in st.get_meshes():
			if gm.mesh != null:
				gm.mesh.generate_lods(25.0, 60.0, [])
	return doc.generate_scene(st)


## The Bip01 axis that faces +Z (the avatar's front) at rest.
func _pick_forward(sk: Skeleton3D) -> void:
	var bs := sk.get_bone_global_rest(sk.find_bone("Bip01")).basis
	var best := 0.0
	for i in 3:
		var z := bs[i].normalized().z
		if absf(z) > best:
			best = absf(z)
			_fwd_axis = i
			_fwd_sign = signf(z)


func _yaw_of(q: Quaternion) -> float:
	var f := Basis(q)[_fwd_axis] * _fwd_sign
	return atan2(f.x, f.z)


## One clip as the avatar plays it (see the header). kind: walk | idle | turn.
func _clip(path: String, avsk: Skeleton3D, hip: float, kind: String) -> Animation:
	var src_root := _load(path)
	var ap: AnimationPlayer = src_root.find_children("*", "AnimationPlayer", true, false)[0]
	var a: Animation = ap.get_animation(ap.get_animation_list()[0])
	var srcsk: Skeleton3D = src_root.find_children("*", "Skeleton3D", true, false)[0]
	var rot := {}
	var root_pos := -1
	for t in a.get_track_count():
		var p := str(a.track_get_path(t))
		if not p.begins_with("Skeleton3D:"):
			continue
		var bone := p.substr(11)
		if avsk.find_bone(bone) < 0:
			continue
		if a.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			rot[bone] = t
		elif a.track_get_type(t) == Animation.TYPE_POSITION_3D and bone == "Bip01":
			root_pos = t
	var L := a.length
	var src_hip := srcsk.get_bone_global_rest(srcsk.find_bone("Bip01")).origin.y
	var k := hip / src_hip
	var p0: Vector3 = a.position_track_interpolate(root_pos, 0.0)
	var travel: Vector3 = a.position_track_interpolate(root_pos, L) - p0
	var y0 := _yaw_of(a.rotation_track_interpolate(rot["Bip01"], 0.0))
	var out := Animation.new()
	var times := []
	var t0 := 0.0
	if kind == "walk":
		t0 = _heel_strike(a, rot, root_pos, srcsk, travel)
		for i in KEYS:
			times.append(i / float(KEYS))
		out.length = 1.0
		out.loop_mode = Animation.LOOP_LINEAR
		out.set_meta("speed", travel.length() * k / L)
		out.set_meta("stride", travel.length() * k)
	else:
		var n := int(round(L * 30.0))
		for i in n + 1:
			times.append(minf(i / 30.0, L))
		out.length = L
		out.loop_mode = Animation.LOOP_LINEAR if kind == "idle" else Animation.LOOP_NONE
	var yaw_end := _yaw_of(a.rotation_track_interpolate(rot["Bip01"], L)) - y0
	if kind == "turn":
		out.set_meta("yaw", wrapf(yaw_end, -PI, PI))
	var yaw_curve := PackedFloat32Array()
	for bone: String in rot:
		var tr := out.add_track(Animation.TYPE_ROTATION_3D)
		out.track_set_path(tr, NodePath("Skeleton3D:" + bone))
		for u: float in times:
			var ts := _src_time(u, t0, L, kind)
			var q: Quaternion = a.rotation_track_interpolate(rot[bone], ts)
			if bone == "Bip01":
				var yw := 0.0
				if kind == "turn":
					yw = wrapf(_yaw_of(q) - y0, -PI, PI)
					yaw_curve.append(yw)
				if kind == "turn":
					q = Quaternion(Vector3.UP, -yw) * q
			out.rotation_track_insert_key(tr, u, q.normalized())
	var pt := out.add_track(Animation.TYPE_POSITION_3D)
	out.track_set_path(pt, NodePath("Skeleton3D:Bip01"))
	var keys := []
	for u: float in times:
		var ts := _src_time(u, t0, L, kind)
		var p: Vector3 = a.position_track_interpolate(root_pos, ts)
		var d := p - p0
		if kind == "walk":
			d -= travel * ((ts - t0) / L)  # the linear travel out (a wrap's travel cancels), the bob and sway kept
		elif kind == "idle":
			d -= travel * (ts / L)  # an idle's drift out
		else:
			d = Basis(Vector3.UP, -_yaw_of(a.rotation_track_interpolate(rot["Bip01"], ts)) + y0) * Vector3(d.x, 0.0, d.z) + Vector3(0.0, d.y, 0.0)
		keys.append(Vector3(d.x * k, p.y * k, d.z * k))
	var mid := Vector3.ZERO
	if kind == "walk":  # the hips over the middle of the stride, on average
		for v: Vector3 in keys:
			mid += Vector3(v.x, 0.0, v.z) / keys.size()
	for i in keys.size():
		out.position_track_insert_key(pt, times[i], keys[i] - mid)
	if kind == "turn":
		out.set_meta("yaw_curve", yaw_curve)
	src_root.free()
	return out


func _src_time(u: float, t0: float, L: float, kind: String) -> float:
	if kind != "walk":
		return u
	return fmod(t0 + u * L, L)


## The left heel strike: the left foot furthest ahead of the hips (travel taken out).
func _heel_strike(a: Animation, rot: Dictionary, root_pos: int, sk: Skeleton3D, travel: Vector3) -> float:
	var L := a.length
	var best := -INF
	var at := 0.0
	var foot := sk.find_bone("Bip01 L Foot")
	for i in int(L * 60.0):
		var t := i / 60.0
		for bone: String in rot:
			var b := sk.find_bone(bone)
			if b >= 0:
				sk.set_bone_pose_rotation(b, a.rotation_track_interpolate(rot[bone], t))
		sk.set_bone_pose_position(sk.find_bone("Bip01"), a.position_track_interpolate(root_pos, t))
		var g := _global(sk, foot).origin - _global(sk, sk.find_bone("Bip01")).origin
		var ahead := g.dot(travel.normalized())
		if ahead > best:
			best = ahead
			at = t
	return at


func _global(sk: Skeleton3D, b: int) -> Transform3D:
	var t := sk.get_bone_pose(b)
	var p := sk.get_bone_parent(b)
	while p >= 0:
		t = sk.get_bone_pose(p) * t
		p = sk.get_bone_parent(p)
	return t


## The avatar alone (no animation player, no footstep helper) as a compressed scene; materials renamed body / head /
## opacity (placeholders: the client builds the real ones).
func _export(av: Node3D, sk: Skeleton3D, path: String, prefix: String) -> void:
	for n in av.find_children("*", "AnimationPlayer", true, false) + av.find_children("*", "BoneAttachment3D", true, false):
		n.get_parent().remove_child(n)
		n.free()
	for mi: MeshInstance3D in av.find_children("*", "MeshInstance3D", true, false):
		mi.name = "body"
		var m := mi.mesh
		for i in m.get_surface_count():
			var old := m.surface_get_material(i)
			var mat := StandardMaterial3D.new()
			mat.resource_name = old.resource_name.trim_prefix(prefix + "_") if old != null else "part%d" % i
			m.surface_set_material(i, mat)
	sk.name = "Skeleton3D"
	av.name = "Body"
	for n in av.find_children("*", "", true, false):
		n.owner = av
	var ps := PackedScene.new()
	ps.pack(av)
	ResourceSaver.save(ps, path, ResourceSaver.FLAG_COMPRESS)
	print("[bake] wrote ", path)
