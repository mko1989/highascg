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
const Dna := preload("res://features/previs/tracking/human_own_dna.gd")
const EXT := ["glb", "gltf", "fbx"]
const MAX_TEX := 2048
const WARN_TRIS := 150000
const MAX_TRIS := 1000000
const CARDS_RE := "hair|lash|brow|fuzz|card|beard|groom|opacity|alpha"
const HIDE_RE := "eyeedge|eye_edge|eyeshell|eye_shell|occlusion|cartilage|tearline|tear_line|eyelashes_?shadow"
const SKIN_RE := "skin|head|face|body|torso|arm|leg"
const MOVES := ["woman", "man"]  ## whose shipped moves an own puppet may borrow: human_body.gd BODIES (WO-1106 A41)

static var _reports := {}
static var _looked := {}  # slug → msec of the last stale() look
static var _sigs := {}  # slug → {path, sig}: its files when template() last read them (WO-1106 A13)


## The folder: always under $HOME (not $XDG_DATA_HOME: run-xr.sh moves that) — the ISO / sync excludes name exactly this folder.
static func dir() -> String:
	return OS.get_environment("HOME").path_join(".local/share/highascg/puppets")


## A body name for the server / the Look list: "own:<slug>".
static func slug_of(name: String) -> String:
	var s := ""
	for ch in name.to_lower():
		s += ch if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9") or ch in ["-", "_", "."] else "-"
	s = s.lstrip("-._").left(48)
	# WO-1106 A44: a name with no ASCII letter or digit (e.g. kanji only) gave "own:", which the server refuses — a stable hash
	return s if s != "" else "puppet-%08x" % name.hash()


## The own puppets on this machine: [{slug, name, file}] — one per sub-folder holding a model, or per loose model file.
static func list(root := "") -> Array:
	var d := root if root != "" else dir()
	var out := []
	var da := DirAccess.open(d)
	if da == null:
		return out
	for sub in da.get_directories():
		var f := _model_in(d.path_join(sub))
		if f != "" or not Dna.files(d.path_join(sub)).is_empty():  # a MetaHuman DNA folder: converted when picked
			out.append({"slug": slug_of(sub), "name": _meta(d.path_join(sub)).get("name", sub), "file": f, "folder": d.path_join(sub)})
	for f in da.get_files():
		if f.get_extension().to_lower() in EXT:
			out.append({"slug": slug_of(f.get_basename()), "name": f.get_basename(), "file": d.path_join(f)})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.slug) < str(b.slug))
	return out


static func _model_in(folder: String) -> String:
	var found := _models_in(folder)
	return str(found[0]) if not found.is_empty() else ""


## Every model file directly in `folder`, glb first.
static func _models_in(folder: String) -> Array:
	var out := []
	var da := DirAccess.open(folder)
	if da == null:
		return out
	var files := Array(da.get_files())
	files.sort()
	for ext in EXT:  # glb first
		for f: String in files:
			if f.get_extension().to_lower() == ext:
				out.append(folder.path_join(f))
	return out


static func _meta(folder: String) -> Dictionary:
	if not FileAccess.file_exists(folder.path_join("puppet.json")):
		return {}
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(folder.path_join("puppet.json")))
	return v if v is Dictionary else {}


static func report(slug: String) -> Dictionary:
	var r: Dictionary = _reports.get(slug, {})
	if r.has("dna_folder"):  # a conversion in progress: its live state
		var s := Dna.status(str(r.dna_folder))
		if s != "":
			r.error = s
		elif _model_in(str(r.dna_folder)) != "":
			r.error = "converted — loading"
	return r


## `slug`'s files changed since template() last read them (human_body.gd then loads it again): a DNA conversion
## finished, the operator deleted the converted GLB or convert.json (the help's "to try again"), replaced the model or
## edited puppet.json. WO-1106 A13: it used to see only a finished conversion of a failed DNA folder.
static func stale(slug: String) -> bool:
	if not _sigs.has(slug) or Time.get_ticks_msec() - int(_looked.get(slug, -10000)) < 1000:  # asked every frame
		return false
	_looked[slug] = Time.get_ticks_msec()
	return _sig(str(_sigs[slug].path)) != str(_sigs[slug].sig)


## A folder's (or a loose model's) look: its file names, the model files' and puppet.json's modification times; ""
## when it is gone. Cheap (one listing), so stale() can ask it once a second.
static func _sig(path: String) -> String:
	if path == "":
		return ""
	if FileAccess.file_exists(path):
		return "%s@%d" % [path, FileAccess.get_modified_time(path)]
	var da := DirAccess.open(path)
	if da == null:
		return ""
	var parts := []
	for f in da.get_files():
		var timed: bool = f.get_extension().to_lower() in EXT or f == "puppet.json"
		parts.append("%s@%d" % [f, FileAccess.get_modified_time(path.path_join(f))] if timed else f)
	parts.sort()
	return "|".join(PackedStringArray(parts))


## Load `slug` (from `root`, default dir()) and retarget `moves_of.call(name)` → {root, height, moves, toes, own,
## report} or {} (report(slug) says why). WO-1106 A39: three steps, so human_body.gd can run the slow one on a worker
## thread — prepare() and finish() on the main thread (they touch the statics: reports, file looks, a DNA conversion),
## build() reads files and makes nodes / resources outside the tree only (~130 ms for the 9 k-triangle test puppet).
static func template(slug: String, moves_of: Callable, root := "") -> Dictionary:
	var job := prepare(slug, root)
	if job.has("out"):
		return job.out
	return finish(job, build(job, moves_of))


## Main thread: find `slug`'s model → a job for build(), or {out: {}} when there is nothing to build (report says why).
## Until finish(), report(slug) says it is loading.
static func prepare(slug: String, root := "") -> Dictionary:
	var t0 := Time.get_ticks_msec()
	var rep := {"slug": slug, "ok": false, "warnings": []}
	_reports[slug] = rep
	var entry := {}
	for e: Dictionary in list(root):
		if e.slug == slug:
			entry = e
	var src_path: String = str(entry.get("folder", entry.get("file", ""))) if not entry.is_empty() else (root if root != "" else dir())
	_sigs[slug] = {"path": src_path, "sig": _sig(src_path)}
	if entry.is_empty():
		rep.error = "no model for %s in %s" % [slug, root if root != "" else dir()]
		return {"out": _fail(rep)}
	if str(entry.file) == "":  # MetaHuman DNA, not converted yet
		rep.dna_folder = entry.folder
		var why := Dna.start(str(entry.folder))
		rep.error = why if why != "" else "converting the MetaHuman DNA (started)"
		return {"out": _fail(rep)}
	rep.file = entry.file
	var models: Array = _models_in(str(entry.folder)) if entry.has("folder") else []
	if models.size() > 1:
		# WO-1106 A12: only one file loads (a body FBX + a head FBX gave a headless puppet reported "ok")
		rep.error = "%d model files in the folder (%s) — only one can load: put the body and the head in one file" % [models.size(),
			", ".join(PackedStringArray(models.map(func(f: String) -> String: return f.get_file())))]
		return {"out": _fail(rep)}
	_reports[slug] = {"slug": slug, "ok": false, "loading": true, "file": entry.file, "warnings": []}  # build()'s rep is its own
	return {"slug": slug, "entry": entry, "rep": rep, "t0": t0}


## Main thread: the job's report becomes report(slug); `out` = build()'s answer.
static func finish(job: Dictionary, out: Dictionary) -> Dictionary:
	_reports[str(job.slug)] = job.rep
	return out


## Any thread: import, place, texture and retarget the job's model. Touches no static and no node in the tree;
## `moves_of` must be safe to call from the thread too (human_body.gd hands it private copies of the shipped bodies).
static func build(job: Dictionary, moves_of: Callable) -> Dictionary:
	var rep: Dictionary = job.rep
	var entry: Dictionary = job.entry
	var t0 := int(job.t0)
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
	_strip_helpers(scene)
	var own := _place(scene, sk, m.bones)
	var found := Tex.fill(own.root, str(entry.file).get_base_dir())  # FBX / DNA-converted: textures by file name
	if found > 0:
		rep.warnings.append("%d texture(s) matched by file name" % found)
	var meta := _meta(str(entry.file).get_base_dir())
	var moves_name := "woman" if float(own.height) < 1.75 else "man"
	if meta.has("moves"):
		if str(meta.moves) in MOVES:
			moves_name = str(meta.moves)
		else:  # WO-1106 A41: "own:x" / a path loaded another body as the moves (a null skeleton → script errors)
			rep.warnings.append("puppet.json moves \"%s\" is not woman or man — using %s" % [str(meta.moves), moves_name])
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
	print("[human_own] %s: %s, %d triangles, %d bones (%d mapped), %.2f m, moves %s, %d ms%s" % [rep.slug, str(entry.file).get_file(), rep.tris,
		rep.bones, rep.mapped.size(), rep.height, moves_name, rep.ms, ("; " + "; ".join(rep.warnings)) if not rep.warnings.is_empty() else ""])
	var toes := []
	for side in ["Left", "Right"]:
		toes.append(sk.get_bone_name(int(m.bones.get(side + "Toes", m.bones[side + "Foot"]))))
	return {"root": own.root, "height": own.height, "moves": res.lib, "toes": toes, "own": true, "skeleton_path": (own.root as Node).get_path_to(sk)}


## The importer's helpers are not ours to play: its AnimationPlayers, and bone attachments that carry no mesh.
## WO-1106 A40: an attachment holding a mesh (rigid eyes, glasses, a hat) stays — it follows its bone.
static func _strip_helpers(scene: Node) -> void:
	for n in scene.find_children("*", "", true, false):
		if not is_instance_valid(n):
			continue
		if n is AnimationPlayer or (n is BoneAttachment3D and n.find_children("*", "MeshInstance3D", true, false).is_empty()):
			n.get_parent().remove_child(n)
			n.free()


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
			var m := mi.get_surface_override_material(s)  # Tex.fill's, if it gave the surface its maps
			if m == null:
				m = mi.mesh.surface_get_material(s)
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
