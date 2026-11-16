extends RefCounted
## WO-1103 — the shipped puppet's motion (the Rocketbox clips, human_body.gd moves) put onto another humanoid skeleton
## (an operator's own model, human_own.gd), baked once into a new AnimationLibrary for that skeleton, so the same
## AnimationTree (human_motion.gd) drives it. Per clip frame and per mapped bone (human_rig_map.gd), in a common body
## space (front +Z, up +Y, the person's left +X, metres):
##   target global rotation = Δ · A · target rest,  Δ = source pose · source rest⁻¹  (how far the source bone turned),
##   A = the turn that lays the target's rest bone onto the source's rest bone (a T-pose arm onto the A-pose one);
## the hips also carry the source's hip travel, scaled by the hip heights. Unmapped bones (fingers, twists, face) keep
## their rest pose under whatever their parent does. Speed / stride metadata are scaled with the hips, so the cycle
## rate still locks the planted feet to the ground (legs of other proportions slide a little: honest limit).

const Map := preload("res://features/previs/tracking/human_rig_map.gd")
const FPS := 30.0


## A library for `tgt` (its NodePath from the model root: `tgt_path`) from `lib` on `src`. `src_space` / `tgt_space`
## carry each skeleton's bone space into the common body space. {} when either skeleton cannot be mapped.
static func bake(src: Skeleton3D, src_space: Transform3D, lib: AnimationLibrary, tgt: Skeleton3D, tgt_space: Transform3D, tgt_path: String) -> Dictionary:
	var ms := Map.map(src)
	var mt := Map.map(tgt)
	if not ms.ok or not mt.ok:
		return {"ok": false, "missing": mt.missing}
	var pairs := []  # [canonical, src bone, tgt bone] parent-first (by target bone index order)
	for c: String in mt.bones:
		if ms.bones.has(c):
			pairs.append([c, int(ms.bones[c]), int(mt.bones[c])])
	pairs.sort_custom(func(a: Array, b: Array) -> bool: return a[2] < b[2])
	var s_rest := _rest_globals(src, src_space)
	var t_rest := _rest_globals(tgt, tgt_space)
	var align := {}
	for p: Array in pairs:
		align[p[0]] = _align(p[0], ms.bones, mt.bones, s_rest, t_rest)
	var k: float = t_rest[int(mt.bones.Hips)].origin.y / maxf(s_rest[int(ms.bones.Hips)].origin.y, 0.01)
	var out := AnimationLibrary.new()
	for name: StringName in lib.get_animation_list():
		out.add_animation(name, _clip(lib.get_animation(name), src, src_space, s_rest, tgt, tgt_space, t_rest, pairs, align, k, tgt_path, int(mt.bones.Hips)))
	var mapped := pairs.map(func(p: Array) -> String: return p[0])
	return {"ok": true, "lib": out, "mapped": mapped, "scale": k}


## Every bone's rest in body space.
static func _rest_globals(sk: Skeleton3D, space: Transform3D) -> Array:
	var g := []
	g.resize(sk.get_bone_count())
	for i in sk.get_bone_count():
		var p := sk.get_bone_parent(i)
		var l := sk.get_bone_rest(i)
		g[i] = (g[p] * l) if p >= 0 else (space * l)
	return g


## The rotation laying the target's rest bone direction (to its next canonical bone) onto the source's.
static func _align(c: String, sb: Dictionary, tb: Dictionary, s_rest: Array, t_rest: Array) -> Basis:
	var nx: String = Map.NEXT.get(c, "")
	if nx == "" or not sb.has(nx) or not tb.has(nx):
		return Basis.IDENTITY
	var ds: Vector3 = (s_rest[int(sb[nx])].origin - s_rest[int(sb[c])].origin).normalized()
	var dt: Vector3 = (t_rest[int(tb[nx])].origin - t_rest[int(tb[c])].origin).normalized()
	if ds.length() < 0.5 or dt.length() < 0.5:
		return Basis.IDENTITY
	return Basis(Quaternion(dt, ds))


static func _clip(a: Animation, src: Skeleton3D, src_space: Transform3D, s_rest: Array, tgt: Skeleton3D, tgt_space: Transform3D, t_rest: Array,
		pairs: Array, align: Dictionary, k: float, tgt_path: String, hips: int) -> Animation:
	var rot := {}  # src bone → track
	var pos := {}
	for t in a.get_track_count():
		var b := src.find_bone(str(a.track_get_path(t).get_concatenated_subnames()))
		if b < 0:
			continue
		if a.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			rot[b] = t
		elif a.track_get_type(t) == Animation.TYPE_POSITION_3D:
			pos[b] = t
	var o := Animation.new()
	o.length = a.length
	o.loop_mode = a.loop_mode
	for m in a.get_meta_list():
		var v: Variant = a.get_meta(m)
		o.set_meta(m, float(v) * k if m in [&"speed", &"stride"] else v)
	var tr := {}
	for p: Array in pairs:
		var t := o.add_track(Animation.TYPE_ROTATION_3D)
		o.track_set_path(t, "%s:%s" % [tgt_path, tgt.get_bone_name(p[2])])
		tr[p[2]] = t
	var tp := o.add_track(Animation.TYPE_POSITION_3D)
	o.track_set_path(tp, "%s:%s" % [tgt_path, tgt.get_bone_name(hips)])
	var n := maxi(int(round(a.length * FPS)), 1)
	for f in n + (0 if a.loop_mode == Animation.LOOP_LINEAR else 1):
		var time := minf(f / FPS, a.length)
		var sg := _pose_globals(src, src_space, a, rot, pos, time)
		var tg := {}  # tgt bone → body-space global this frame (mapped bones and their ancestors as needed)
		for p: Array in pairs:
			var b: int = p[2]
			var delta: Basis = sg[p[1]].basis * (s_rest[p[1]] as Transform3D).basis.inverse()
			var parent := _parent_global(tgt, tgt_space, b, tg)
			var origin: Vector3 = (parent * tgt.get_bone_rest(b)).origin
			if b == hips:
				origin = Vector3(sg[p[1]].origin.x, sg[p[1]].origin.y, sg[p[1]].origin.z) * k
			var g := Transform3D((delta * align[p[0]] * (t_rest[b] as Transform3D).basis).orthonormalized(), origin)
			tg[b] = g
			var local := parent.affine_inverse() * g
			o.rotation_track_insert_key(tr[b], time, local.basis.get_rotation_quaternion())
			if b == hips:
				o.position_track_insert_key(tp, time, local.origin)
	return o


## The target bone's parent global this frame: a mapped parent's from `tg`, else its rest under its own parent.
static func _parent_global(sk: Skeleton3D, space: Transform3D, b: int, tg: Dictionary) -> Transform3D:
	var p := sk.get_bone_parent(b)
	if p < 0:
		return space
	if tg.has(p):
		return tg[p]
	var g := _parent_global(sk, space, p, tg) * sk.get_bone_rest(p)
	tg[p] = g
	return g


## The source skeleton's body-space globals at `time` of clip `a`.
static func _pose_globals(sk: Skeleton3D, space: Transform3D, a: Animation, rot: Dictionary, pos: Dictionary, time: float) -> Array:
	var g := []
	g.resize(sk.get_bone_count())
	for i in sk.get_bone_count():
		var l := sk.get_bone_rest(i)
		if rot.has(i):
			l.basis = Basis(a.rotation_track_interpolate(rot[i], time))
		if pos.has(i):
			l.origin = a.position_track_interpolate(pos[i], time)
		var p := sk.get_bone_parent(i)
		g[i] = (g[p] * l) if p >= 0 else (space * l)
	return g
