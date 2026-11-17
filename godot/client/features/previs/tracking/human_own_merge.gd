extends RefCounted
## WO-1106 A12 — an own puppet exported as several model files on one skeleton (Unreal / MetaHuman: the body and the
## head as two FBX; the face's extra joints only in the head file) becomes ONE puppet, joined by bone name:
## - the main file is the one whose skeleton has the most bones (ties: the file name, ascending) — deterministic;
## - every other file's bones that the main skeleton lacks are added under their parent (by name), placed where that
##   file put them; a bone the file's meshes use whose chain reaches no bone of the main skeleton is refused, named;
## - its skinned meshes move under the main skeleton with their Skin's binds remapped onto the main skeleton's bones
##   (the importer binds by the file's own bone index, which means another bone in the main skeleton), the bind poses
##   carried over so the mesh stays where the file put it; its rigid attachments (eyes, glasses) move with their bone;
##   its unskinned meshes keep their place.
## Runs on human_body.gd's worker thread (WO-1106 A39): it touches only the nodes it is given (none in the tree) and
## no static.


## The main part of `parts` ([{file, sk}]): the most bones, ties broken by the file name.
static func pick_main(parts: Array) -> int:
	var best := -1
	for i in parts.size():
		if best < 0:
			best = i
			continue
		var n := (parts[i].sk as Skeleton3D).get_bone_count()
		var b := (parts[best].sk as Skeleton3D).get_bone_count()
		if n > b or (n == b and str(parts[i].file).get_file() < str(parts[best].file).get_file()):
			best = i
	return best


## Join `scene` (its skeleton `esk`, read from `file`) onto the main skeleton `msk` (read from `main_file`). The joined
## nodes leave `scene` (the caller frees what is left). → {ok, error, added (bone names), meshes, warnings}. On a
## refusal nothing has been moved yet (the bones are checked first); bones may have been added to `msk`.
static func join(msk: Skeleton3D, scene: Node, esk: Skeleton3D, file: String, main_file: String) -> Dictionary:
	var out := {"ok": false, "error": "", "added": [], "meshes": 0, "warnings": []}
	var fname := file.get_file()
	var mname := main_file.get_file()
	var found := _collect(scene, esk)
	if found.other > 0:
		out.warnings.append("%s: %d mesh(es) skinned to another skeleton left out" % [fname, found.other])
	var x := _space_map(msk, esk)
	if x.is_empty():
		out.error = "%s shares no bone name with %s — cannot join them into one puppet (export both with the same skeleton)" % [fname, mname]
		return out
	var xf: Transform3D = x.xf
	# the bones the file's meshes use: skin binds, rigid attachments
	var need := {}
	for mi: MeshInstance3D in found.skinned:
		var skin := _skin_of(mi, esk)
		for i in skin.get_bind_count():
			need[_bind_bone(skin, i, esk)] = true
	for a: BoneAttachment3D in found.attached:
		need[esk.find_bone(a.bone_name)] = true
	need.erase(-1)
	# map every bone of the file onto the main skeleton: same name, or added under its (mapped) parent
	var map := {}
	var lost := []
	for b in _parents_first(esk):
		var name := esk.get_bone_name(b)
		var m := msk.find_bone(name)
		if m >= 0:
			map[b] = m
			continue
		var p := esk.get_bone_parent(b)
		if p >= 0 and map.has(p):
			var g := xf * esk.get_bone_global_rest(b)
			var nb := msk.add_bone(name)
			msk.set_bone_parent(nb, int(map[p]))
			msk.set_bone_rest(nb, msk.get_bone_global_rest(int(map[p])).affine_inverse() * g)
			msk.reset_bone_pose(nb)
			map[b] = nb
			out.added.append(name)
		else:
			lost.append(b)
	for b: int in lost:
		if need.has(b) or _has_needed_below(esk, b, need, map):
			var p := esk.get_bone_parent(b)
			var under := ("under \"%s\", which is not there either" % esk.get_bone_name(p)) if p >= 0 else "a root bone"
			out.error = "%s: bone \"%s\" (%s) is not in %s's skeleton — cannot join them into one puppet" % [fname, esk.get_bone_name(b), under, mname]
			return out
	if not lost.is_empty():
		out.warnings.append("%s: %d unused bone(s) without a parent in %s left out" % [fname, lost.size(), mname])
	# move the meshes
	var skins := {}  # the file's Skin → its remapped copy (one Skin may serve several meshes)
	for mi: MeshInstance3D in found.skinned:
		var skin := _skin_of(mi, esk)
		if not skins.has(skin):
			skins[skin] = _remap_skin(skin, esk, msk, map, xf)
		_move(mi, msk, Transform3D.IDENTITY)
		mi.skin = skins[skin]
		mi.skeleton = NodePath("..")
		out.meshes += 1
	for a: BoneAttachment3D in found.attached:
		var bone := msk.get_bone_name(int(map[esk.find_bone(a.bone_name)]))
		a.use_external_skeleton = false
		_move(a, msk, a.transform)
		a.bone_name = bone
		a.bone_idx = msk.find_bone(bone)
		out.meshes += a.find_children("*", "MeshInstance3D", true, false).size()
	var to_esk := _space(scene, esk).affine_inverse()
	for mi: MeshInstance3D in found.loose:
		_move(mi, msk, xf * to_esk * _space(scene, mi))
		out.meshes += 1
	out.ok = true
	return out


## The file's meshes: {skinned (on esk), attached (BoneAttachment3D of esk carrying a mesh), loose (unskinned, not
## inside one of those; an attachment to a bone the skeleton lacks counts as loose), other (skinned to another
## skeleton: count)}. A node inside one already taken moves with it.
static func _collect(scene: Node, esk: Skeleton3D) -> Dictionary:
	var found := {"skinned": [], "attached": [], "loose": [], "other": 0}
	var taken := {}
	for n in scene.find_children("*", "", true, false):
		if _inside(n, taken):
			continue
		if n is BoneAttachment3D and _attached_to(n, esk) and esk.find_bone((n as BoneAttachment3D).bone_name) >= 0 and not n.find_children("*", "MeshInstance3D", true, false).is_empty():
			found.attached.append(n)
			taken[n] = true
		elif n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
			var mi := n as MeshInstance3D
			if not _skinned(mi):
				found.loose.append(mi)
			elif mi.get_node_or_null(mi.skeleton) == esk:
				found.skinned.append(mi)
			else:
				found.other += 1
				continue
			taken[n] = true
	return found


static func _inside(n: Node, taken: Dictionary) -> bool:
	var p := n.get_parent()
	while p != null:
		if taken.has(p):
			return true
		p = p.get_parent()
	return false


static func _attached_to(a: BoneAttachment3D, esk: Skeleton3D) -> bool:
	if a.use_external_skeleton:
		return a.get_node_or_null(a.external_skeleton) == esk
	return a.get_parent() == esk


static func _skinned(mi: MeshInstance3D) -> bool:
	if mi.skin != null:
		return true
	var am := mi.mesh as ArrayMesh  # a PrimitiveMesh (a box, a sphere) carries no bones
	return am != null and am.get_surface_count() > 0 and (am.surface_get_format(0) & Mesh.ARRAY_FORMAT_BONES) != 0


## Its Skin; a skinned mesh without one is bound to the skeleton's bones in index order (as Godot does).
static func _skin_of(mi: MeshInstance3D, esk: Skeleton3D) -> Skin:
	if mi.skin == null:
		mi.skin = esk.create_skin_from_rest_transforms()
	return mi.skin


static func _bind_bone(skin: Skin, i: int, sk: Skeleton3D) -> int:
	var nm := skin.get_bind_name(i)
	return sk.find_bone(nm) if nm != StringName() else skin.get_bind_bone(i)


## A copy of `skin` bound by name to `msk`'s bones. Bind poses: at rest the vertex lands where the file put it,
## carried into the main skeleton's space (Gm⁻¹ · X · Ge · bind; the same bind when the two skeletons agree).
static func _remap_skin(skin: Skin, esk: Skeleton3D, msk: Skeleton3D, map: Dictionary, xf: Transform3D) -> Skin:
	var s := Skin.new()
	s.resource_name = skin.resource_name
	for i in skin.get_bind_count():
		var eb := _bind_bone(skin, i, esk)
		var mb := int(map.get(eb, -1))
		var bind := skin.get_bind_pose(i)
		if eb >= 0 and mb >= 0:
			bind = msk.get_bone_global_rest(mb).affine_inverse() * xf * esk.get_bone_global_rest(eb) * bind
		s.add_named_bind(msk.get_bone_name(mb) if mb >= 0 else "", bind)
		s.set_bind_bone(i, mb)
	return s


## The file's skeleton space → the main skeleton's space, from the root-most bone both have: {xf, bone} or {}.
static func _space_map(msk: Skeleton3D, esk: Skeleton3D) -> Dictionary:
	var best := -1
	var depth := 1 << 30
	for b in esk.get_bone_count():
		if msk.find_bone(esk.get_bone_name(b)) < 0:
			continue
		var d := 0
		var p := esk.get_bone_parent(b)
		while p >= 0:
			d += 1
			p = esk.get_bone_parent(p)
		if d < depth:
			depth = d
			best = b
	if best < 0:
		return {}
	var m := msk.find_bone(esk.get_bone_name(best))
	return {"xf": msk.get_bone_global_rest(m) * esk.get_bone_global_rest(best).affine_inverse(), "bone": esk.get_bone_name(best)}


## The skeleton's bones, every parent before its children.
static func _parents_first(sk: Skeleton3D) -> Array:
	var out := []
	var todo: Array = Array(sk.get_parentless_bones())
	while not todo.is_empty():
		var b: int = todo.pop_front()
		out.append(b)
		todo.append_array(Array(sk.get_bone_children(b)))
	return out


## A bone below `b` that a mesh uses and that found no place either.
static func _has_needed_below(sk: Skeleton3D, b: int, need: Dictionary, map: Dictionary) -> bool:
	for c in sk.get_bone_children(b):
		if (need.has(c) and not map.has(c)) or _has_needed_below(sk, c, need, map):
			return true
	return false


## Reparent `n` under `msk` with transform `xf` (relative to the skeleton), its name kept unless taken; it and its
## children then belong to the main file's scene (the importer set owners).
static func _move(n: Node3D, msk: Skeleton3D, xf: Transform3D) -> void:
	var old := n.owner
	var mine: Array = [n] + n.find_children("*", "", true, false).filter(func(c: Node) -> bool: return c.owner == old)
	for c: Node in mine:
		c.owner = null
	n.get_parent().remove_child(n)
	var base := str(n.name)
	var nm := base
	var k := 1
	while msk.get_node_or_null(NodePath(nm)) != null:
		k += 1
		nm = "%s_%d" % [base, k]
	n.name = nm
	msk.add_child(n)
	n.transform = xf
	var to: Node = msk.owner if msk.owner != null else msk
	for c: Node in mine:
		c.owner = to


## node → descendant transform (the chain of local transforms; works outside the scene tree).
static func _space(root: Node, n: Node) -> Transform3D:
	var t := Transform3D.IDENTITY
	var c := n
	while c != null and c != root:
		if c is Node3D:
			t = (c as Node3D).transform * t
		c = c.get_parent()
	return t
