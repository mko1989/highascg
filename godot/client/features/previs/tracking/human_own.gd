extends RefCounted
## WO-1103 — "bring your own" test puppet: a rigged humanoid character the operator owns (a MetaHuman exported from
## Unreal, a Mixamo / Character Creator / Blender character, a Rocketbox avatar …) dropped into this machine's
## ~/.local/share/highascg/puppets/<name>/ as .glb / .gltf / .fbx (with its textures). NEVER shipped: the folder is
## outside the repo, excluded from the ISO / stick / bridge copies (WO-1094 lines + verify-iso-detection-runtime.sh),
## and nothing is written back into the repo, media/ or projects/. Each machine has its own.
##
## Read at run time (GLTFDocument / FBXDocument), then: textures over 2048 px scaled down, LODs generated, over
## WARN_TRIS triangles a warning (over MAX_TRIS refused), the humanoid bones found by name (human_rig_map.gd) — a model
## without hips / legs / feet / spine / head is refused with the missing ones named —, turned to face +Z with its soles
## on the floor, and the shipped puppet's motion-capture moves retargeted onto it (human_retarget.gd), so it idles,
## walks and turns like the shipped bodies and is lit by the same rig (its own materials, hair / lashes alpha-cut,
## skin with a little subsurface scattering). Optional <name>/puppet.json: {"name": "…", "moves": "woman" | "man"}.
## Every load leaves a report (report(slug)): file, triangles, bones mapped / missing, warnings, milliseconds.

const Map := preload("res://features/previs/tracking/human_rig_map.gd")
const Retarget := preload("res://features/previs/tracking/human_retarget.gd")
const Tex := preload("res://features/previs/tracking/human_own_tex.gd")
const EXT := ["glb", "gltf", "fbx"]
const MAX_TEX := 2048
const WARN_TRIS := 150000
const MAX_TRIS := 1000000
const CARDS_RE := "hair|lash|brow|fuzz|card|beard|groom"
const HIDE_RE := "eyeedge|eye_edge|eyeshell|eye_shell|occlusion|cartilage|tearline|tear_line|eyelashes_?shadow"
const SKIN_RE := "skin|head|face|body|torso|arm|leg"

static var _reports := {}


## The folder: always under $HOME (not $XDG_DATA_HOME: run-xr.sh moves that) — the ISO / sync excludes name exactly this folder.
static func dir() -> String:
	return OS.get_environment("HOME").path_join(".local/share/highascg/puppets")


## A body name for the server / the Look list: "own:<slug>".
static func slug_of(name: String) -> String:
	var s := ""
	for ch in name.to_lower():
		s += ch if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9") or ch in ["-", "_", "."] else "-"
	return s.lstrip("-._").left(48)


## The own puppets on this machine: [{slug, name, file}] — one per sub-folder holding a model, or per loose model file.
static func list(root := "") -> Array:
	var d := root if root != "" else dir()
	var out := []
	var da := DirAccess.open(d)
	if da == null:
		return out
	for sub in da.get_directories():
		var f := _model_in(d.path_join(sub))
		if f != "":
			out.append({"slug": slug_of(sub), "name": _meta(d.path_join(sub)).get("name", sub), "file": f})
	for f in da.get_files():
		if f.get_extension().to_lower() in EXT:
			out.append({"slug": slug_of(f.get_basename()), "name": f.get_basename(), "file": d.path_join(f)})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.slug) < str(b.slug))
	return out


static func _model_in(folder: String) -> String:
	var da := DirAccess.open(folder)
	if da == null:
		return ""
	var files := Array(da.get_files())
	files.sort()
	for ext in EXT:  # glb first
		for f: String in files:
			if f.get_extension().to_lower() == ext:
				return folder.path_join(f)
	return ""


static func _meta(folder: String) -> Dictionary:
	if not FileAccess.file_exists(folder.path_join("puppet.json")):
		return {}
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(folder.path_join("puppet.json")))
	return v if v is Dictionary else {}


static func report(slug: String) -> Dictionary:
	return _reports.get(slug, {})


## Load `slug` (from `root`, default dir()) and retarget `moves_of.call(name)` → {root, height, moves, toes, own,
## report} or {} (report(slug) says why).
static func template(slug: String, moves_of: Callable, root := "") -> Dictionary:
	var t0 := Time.get_ticks_msec()
	var rep := {"slug": slug, "ok": false, "warnings": []}
	_reports[slug] = rep
	var entry := {}
	for e: Dictionary in list(root):
		if e.slug == slug:
			entry = e
	if entry.is_empty():
		rep.error = "no model for %s in %s" % [slug, root if root != "" else dir()]
		return _fail(rep)
	rep.file = entry.file
	var fbx := str(entry.file).get_extension().to_lower() == "fbx"
	var doc: GLTFDocument = FBXDocument.new() if fbx else GLTFDocument.new()
	var st: GLTFState = FBXState.new() if fbx else GLTFState.new()
	if doc.append_from_file(entry.file, st) != OK:
		rep.error = "cannot read %s" % entry.file
		return _fail(rep)
	rep.tris = _tris(st)
	if rep.tris > MAX_TRIS:
		rep.error = "%d triangles — over the %d limit for a previs puppet (export a lower LOD)" % [rep.tris, MAX_TRIS]
		return _fail(rep)
	if rep.tris > WARN_TRIS:
		rep.warnings.append("%d triangles — heavy for a previs puppet (LODs are generated; consider exporting a lower LOD)" % rep.tris)
	var scaled := _cap_textures(st)
	if scaled > 0:
		rep.warnings.append("%d texture(s) over %d px scaled down" % [scaled, MAX_TEX])
	for gm: GLTFMesh in st.get_meshes():
		if gm.mesh != null and gm.mesh.get_surface_count() > 0:
			gm.mesh.generate_lods(25.0, 60.0, [])
	var scene: Node = doc.generate_scene(st)
	var sk := _biggest_skeleton(scene) if scene != null else null
	if sk == null:
		rep.error = "no skeleton (the model must be rigged)"
		if scene != null:
			scene.free()
		return _fail(rep)
	var m := Map.map(sk)
	rep.bones = sk.get_bone_count()
	rep.mapped = m.bones.keys()
	rep.missing = m.missing
	if not m.ok:
		rep.error = "not a humanoid skeleton the puppet's motion can drive — missing: %s" % ", ".join(m.missing)
		scene.free()
		return _fail(rep)
	for n in scene.find_children("*", "", true, false):  # the importer's helpers: not ours to play
		if is_instance_valid(n) and (n is AnimationPlayer or n is BoneAttachment3D):
			n.get_parent().remove_child(n)
			n.free()
	var own := _place(scene, sk, m.bones)
	if fbx:
		var found := Tex.fill(own.root, str(entry.file).get_base_dir())
		if found > 0:
			rep.warnings.append("FBX: %d texture(s) matched by file name (a GLB carries its own — preferred)" % found)
	var meta := _meta(str(entry.file).get_base_dir())
	var moves_name := str(meta.get("moves", "woman" if float(own.height) < 1.75 else "man"))
	var src: Dictionary = moves_of.call(moves_name)
	if src.is_empty():
		rep.error = "the shipped moves (%s) are missing" % moves_name
		(own.root as Node).free()
		return _fail(rep)
	var ssk: Skeleton3D = (src.root as Node).get_node("Skeleton3D")
	var res := Retarget.bake(ssk, _space(src.root, ssk), src.moves, sk, _space(own.root, sk), str((own.root as Node).get_path_to(sk)))
	if not res.ok:
		rep.error = "retarget failed — missing: %s" % ", ".join(res.missing)
		(own.root as Node).free()
		return _fail(rep)
	_materials(own.root, rep)
	rep.ok = true
	rep.moves = moves_name
	rep.height = snappedf(float(own.height), 0.01)
	rep.ms = Time.get_ticks_msec() - t0
	print("[human_own] %s: %s, %d triangles, %d bones (%d mapped), %.2f m, moves %s, %d ms%s" % [slug, str(entry.file).get_file(), rep.tris,
		rep.bones, rep.mapped.size(), rep.height, moves_name, rep.ms, ("; " + "; ".join(rep.warnings)) if not rep.warnings.is_empty() else ""])
	var toes := []
	for side in ["Left", "Right"]:
		toes.append(sk.get_bone_name(int(m.bones.get(side + "Toes", m.bones[side + "Foot"]))))
	return {"root": own.root, "height": own.height, "moves": res.lib, "toes": toes, "own": true, "skeleton_path": (own.root as Node).get_path_to(sk)}


static func _fail(rep: Dictionary) -> Dictionary:
	push_warning("[human_own] %s: %s — the puppet stays a pebble avatar" % [rep.slug, rep.error])
	return {}


static func _tris(st: GLTFState) -> int:
	var n := 0
	for gm: GLTFMesh in st.get_meshes():
		var im: ImporterMesh = gm.mesh
		if im == null:
			continue
		for s in im.get_surface_count():
			var a: Array = im.get_surface_arrays(s)
			var idx: Variant = a[Mesh.ARRAY_INDEX]
			n += ((idx as PackedInt32Array).size() if idx != null else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	return n


static func _cap_textures(st: GLTFState) -> int:
	var n := 0
	for tex in st.get_images():
		if tex is ImageTexture and maxi(tex.get_width(), tex.get_height()) > MAX_TEX:
			var img: Image = tex.get_image()
			if img.is_compressed():
				img.decompress()
			var k := float(MAX_TEX) / maxi(img.get_width(), img.get_height())
			img.resize(maxi(int(img.get_width() * k), 1), maxi(int(img.get_height() * k), 1), Image.INTERPOLATE_LANCZOS)
			img.generate_mipmaps()
			(tex as ImageTexture).set_image(img)
			n += 1
	return n


static func _biggest_skeleton(n: Node) -> Skeleton3D:
	var best: Skeleton3D = null
	for s in n.find_children("*", "Skeleton3D", true, false):
		if best == null or (s as Skeleton3D).get_bone_count() > best.get_bone_count():
			best = s
	return best


## node → descendant transform (the chain of local transforms; works outside the scene tree).
static func _space(root: Node, n: Node) -> Transform3D:
	var t := Transform3D.IDENTITY
	var c := n
	while c != null and c != root:
		if c is Node3D:
			t = (c as Node3D).transform * t
		c = c.get_parent()
	return t


## Wrap the scene: front to +Z (the left hip on +X), soles at y 0, the hips over the origin. → {root, height}
static func _place(scene: Node, sk: Skeleton3D, bones: Dictionary) -> Dictionary:
	var root := Node3D.new()
	root.name = "Own"
	var pivot := Node3D.new()
	pivot.name = "Pivot"
	root.add_child(pivot)
	scene.name = "Model"
	pivot.add_child(scene)
	var k := 0
	for n in scene.find_children("*", "", true, false):  # generated "@Node3D@27" names change on duplicate(): the
		if str(n.name).begins_with("@"):  # moves' track paths must not
			k += 1
			n.name = "N%d" % k
	var to_body := _space(root, sk)
	var l: Vector3 = to_body * sk.get_bone_global_rest(int(bones.LeftUpperLeg)).origin
	var r: Vector3 = to_body * sk.get_bone_global_rest(int(bones.RightUpperLeg)).origin
	if l.x < r.x:
		pivot.rotate_y(PI)
	var box := _bounds(root)
	var hips: Vector3 = _space(root, sk) * sk.get_bone_global_rest(int(bones.Hips)).origin
	pivot.position = Vector3(-hips.x, -box.position.y, -hips.z)
	return {"root": root, "height": box.size.y}


## The rest-pose bounds in `root` space. A skinned mesh's own AABB is in its bind space (often Z-up, centimetres), so
## its vertices are put where the skin puts them at rest (the most weighted bone; ≤ ~20k samples per mesh).
static func _bounds(root: Node) -> AABB:
	var pts := PackedVector3Array()
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		var sk := mi.get_node_or_null(mi.skeleton) as Skeleton3D if mi.skin != null else null
		for s in mi.mesh.get_surface_count():
			var a: Array = mi.mesh.surface_get_arrays(s)
			var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
			var step := maxi(v.size() / 20000, 1)
			if sk == null:
				var to := _space(root, mi)
				for i in range(0, v.size(), step):
					pts.append(to * v[i])
				continue
			var bones: PackedInt32Array = a[Mesh.ARRAY_BONES]
			var wts: PackedFloat32Array = a[Mesh.ARRAY_WEIGHTS]
			var per := bones.size() / maxi(v.size(), 1)
			var to_root := _space(root, sk)
			var rest := {}
			for i in range(0, v.size(), step):
				var best := 0
				for j in per:
					if wts[i * per + j] > wts[i * per + best]:
						best = j
				var bind := bones[i * per + best]
				if not rest.has(bind):
					var b := mi.skin.get_bind_bone(bind)
					if b < 0:
						b = sk.find_bone(mi.skin.get_bind_name(bind))
					rest[bind] = to_root * sk.get_bone_global_rest(maxi(b, 0)) * mi.skin.get_bind_pose(bind)
				pts.append((rest[bind] as Transform3D) * v[i])
	if pts.is_empty():
		return AABB()
	var box := AABB(pts[0], Vector3.ZERO)
	for p in pts:
		box = box.expand(p)
	return box


## Its own materials, with what a real-time previs can do: hair / lashes / brows alpha-cut both sides (alpha to
## coverage under MSAA), Unreal's eye-edge / occlusion / tear-line overlay shells hidden (they need Unreal's shaders),
## skin with a little subsurface scattering; every mesh casts shadows.
static func _materials(root: Node, rep: Dictionary) -> void:
	var cards := RegEx.create_from_string("(?i)" + CARDS_RE)
	var hider := RegEx.create_from_string("(?i)" + HIDE_RE)
	var skin := RegEx.create_from_string("(?i)" + SKIN_RE)
	var hidden := 0
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		for s in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(s)
			var name := (m.resource_name if m != null else "") + " " + mi.name
			if hider.search(name) != null:
				var off := StandardMaterial3D.new()
				off.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
				off.albedo_color = Color(0, 0, 0, 0)
				mi.set_surface_override_material(s, off)
				hidden += 1
			elif m is BaseMaterial3D:
				var c := (m as BaseMaterial3D).duplicate() as BaseMaterial3D
				if cards.search(name) != null:
					c.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
					c.alpha_scissor_threshold = 0.35
					c.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
					c.cull_mode = BaseMaterial3D.CULL_DISABLED
				elif skin.search(name) != null and c.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED:
					c.subsurf_scatter_enabled = true
					c.subsurf_scatter_strength = 0.25
				mi.set_surface_override_material(s, c)
	if hidden > 0:
		rep.warnings.append("%d overlay surface(s) hidden (eye edge / occlusion / tear line: Unreal-only shading)" % hidden)
