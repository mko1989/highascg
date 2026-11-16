extends RefCounted
## WO-1103 — the human puppet bodies (owner 16.11: "try to create a woman and man avatars but try to make them as much
## human like as possible"; "the hq avatars are for previz purposes only as a 'puppet'"). Shipped: two avatars of the
## Microsoft Rocketbox library (MIT) — godot/client/assets/people/<body>.scn (a native scene: one skinned mesh with
## LODs, surfaces body / head / opacity, on the 81-bone 3ds Max "Bip01" biped skeleton; no images, no animation inside),
## <body>_<map>.webp textures
## and <body>_moves.res (the Rocketbox motion-capture idle / walks / turns baked for that body:
## tools/people/rocketbox_bake.gd). Licences: assets/people/LICENSES.json, THIRD_PARTY_NOTICES.
##
## Textures are read at RUN time (Image from raw bytes) — the operator client runs from the source tree with no import
## cache; the .webp carry a "keep" .import so an export packs them as they are. One template per body, every
## puppet duplicates it (mesh, materials and moves shared). A body may also be an absolute folder path + name
## ("/x/y/woman": dev probes compare candidates). A missing or broken file → available() false: the pebble stays.

const DIR := "res://assets/people/"
const BODIES := ["woman", "man"]
const SHADER := preload("res://features/previs/tracking/person_human.gdshader")
const CARDS := preload("res://features/previs/tracking/person_human_cards.gdshader")
const House := preload("res://features/previs/house_lights.gd")
const Own := preload("res://features/previs/tracking/human_own.gd")
const TOES := ["Bip01 L Toe0", "Bip01 R Toe0"]
## Per surface (the material name the bake gives it): textures (<body>_<tex>.webp) and the look.
const PARTS := {
	"body": {"tex": "body", "nrm": "body_n", "spec": "body_s", "rough": 0.75, "sheen": 0.3, "wrap": Vector3(0.12, 0.12, 0.12), "sss": 0.0},
	"head": {"tex": "head", "nrm": "head_n", "spec": "head_s", "rough": 0.5, "sheen": 0.6, "wrap": Vector3(0.3, 0.14, 0.08), "sss": 0.25},
	"opacity": {"tex": "hair", "rough": 0.55, "sheen": 0.35, "wrap": Vector3(0.3, 0.3, 0.3), "cards": true, "cut": 0.35},
}

static var _templates := {}  # body → {root, height, moves} | {} when it failed
static var _mats := {}  # "body:part" → ShaderMaterial
static var _house_hooked := false


## A body name the human node takes: woman / man, "own:<slug>" (an operator's own model, human_own.gd), or an
## absolute "<dir>/<name>" of a baked body (dev probes).
static func is_body(body: String) -> bool:
	return body in BODIES or body.begins_with("/") or (body.begins_with("own:") and body.length() > 4)


## The body's files are there and load.
static func available(body: String) -> bool:
	return is_body(body) and not template(body).is_empty()


static func _path(body: String) -> String:
	return body if body.begins_with("/") else DIR + body


## The body as loaded: {root (Node3D: the skeleton "Skeleton3D" under it), height (m, soles to the top of the head),
## moves (AnimationLibrary)}.
static func template(body: String) -> Dictionary:
	if _templates.has(body) and not (body.begins_with("own:") and (_templates[body] as Dictionary).is_empty() and Own.stale(body.substr(4))):
		return _templates[body]
	if body.begins_with("own:"):
		_templates[body] = {}  # a failed import is not retried every frame
		_templates[body] = Own.template(body.substr(4), func(n: String) -> Dictionary: return template(n))
		return _templates[body]
	var out := {}
	var p := _path(body)
	var scene: Variant = _res(p + ".scn")
	var moves: Variant = _res(p + "_moves.res")
	if scene is PackedScene and moves is AnimationLibrary:
		var root: Node = (scene as PackedScene).instantiate()
		var sk := _skeleton(root) if root != null else null
		if root is Node3D and sk != null and sk.get_parent() == root and sk.name == "Skeleton3D":
			out = {"root": root, "height": _height(sk), "moves": moves, "toes": TOES}
		elif root != null:
			root.free()
	if out.is_empty():
		push_warning("[human_body] %s: %s.scn / _moves.res missing or unreadable — the puppet stays a pebble avatar" % [body, p])
	_templates[body] = out
	return out


static func _res(path: String) -> Variant:
	if path.begins_with("res://") and not ResourceLoader.exists(path):
		return null
	if not path.begins_with("res://") and not FileAccess.file_exists(path):
		return null
	return ResourceLoader.load(path)


## A new copy of the body: {root (Node3D, feet at y 0, front +Z, the person's left +X, metres), skeleton, meshes [],
## height, moves}. Materials are shared per body. {} when unavailable.
static func instance(body: String) -> Dictionary:
	var tpl := template(body)
	if tpl.is_empty():
		return {}
	var root: Node3D = (tpl.root as Node3D).duplicate()
	var sk: Skeleton3D = root.get_node(tpl.skeleton_path) if tpl.has("skeleton_path") else _skeleton(root)
	var out := {"root": root, "skeleton": sk, "meshes": _meshes(root), "height": tpl.height, "moves": tpl.moves, "toes": tpl.toes}
	if tpl.get("own", false):
		return out  # its own materials (human_own.gd)
	for mi: MeshInstance3D in out.meshes:
		for i in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(i)
			mi.set_surface_override_material(i, material(body, m.resource_name if m != null else "body"))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	return out


## The shared material of one surface.
static func material(body: String, part: String) -> ShaderMaterial:
	var key := "%s:%s" % [body, part]
	if _mats.has(key):
		return _mats[key]
	var spec: Dictionary = PARTS.get(part, PARTS.body)
	var m := ShaderMaterial.new()
	m.shader = CARDS if spec.get("cards", false) else SHADER
	var p := _path(body)
	m.set_shader_parameter("albedo_tex", texture(p + "_" + str(spec.tex)))
	if spec.has("nrm"):
		var n: Variant = texture(p + "_" + str(spec.nrm))
		if n != null:
			m.set_shader_parameter("normal_tex", n)
			m.set_shader_parameter("normal_depth", 1.0)
	if spec.has("spec"):
		var s: Variant = texture(p + "_" + str(spec.spec))
		if s != null:
			m.set_shader_parameter("spec_tex", s)
			m.set_shader_parameter("spec_map", 1.0)
	m.set_shader_parameter("roughness", float(spec.rough))
	m.set_shader_parameter("sheen", float(spec.sheen))
	m.set_shader_parameter("wrap", spec.wrap)
	m.set_shader_parameter("sss", float(spec.get("sss", 0.0)))
	m.set_shader_parameter("alpha_cut", float(spec.get("cut", 0.5)))
	_mats[key] = m
	if not _house_hooked:
		_house_hooked = true
		# a static method, never a lambda: a lambda made in a static func and left on the static House singleton
		# corrupted the heap at exit (CI exit 134 from 5e9c8fb2; WO-1103)
		House.shared().changed.connect(_on_house)
	m.set_shader_parameter("self_light", self_light())
	return m


## WO-1099: house lights on → the room's ambient lights the puppet like everything else (no glow of its own); down →
## only the readability floor (ui.cfg [previs] avatar_floor) is left, fading in as the room goes dark.
static func self_light() -> float:
	var hs: RefCounted = House.shared()
	return float(hs.avatar_floor) * (1.0 - House.gain(float(hs.level)))


static func _on_house(_h: float) -> void:
	house()


static func house() -> void:
	var sl := self_light()
	for m: ShaderMaterial in _mats.values():
		m.set_shader_parameter("self_light", sl)


## <path>.webp as a mipmapped texture, or null.
static func texture(path: String) -> Variant:
	var bytes := FileAccess.get_file_as_bytes(path + ".webp")
	if bytes.is_empty():
		return null
	var img := Image.new()
	if img.load_webp_from_buffer(bytes) != OK:
		return null
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func _skeleton(n: Node) -> Skeleton3D:
	if n is Skeleton3D:
		return n
	for c in n.get_children():
		var s := _skeleton(c)
		if s != null:
			return s
	return null


static func _meshes(n: Node, into: Array = []) -> Array:
	if n is MeshInstance3D:
		into.append(n)
	for c in n.get_children():
		_meshes(c, into)
	return into


## Soles to the top of the head: the eyes' rest height + the skull above them (≈ 0.105 m on an adult).
static func _height(sk: Skeleton3D) -> float:
	var e := sk.find_bone("Bip01 LEye")
	if e < 0:
		return 1.7
	return sk.get_bone_global_rest(e).origin.y + 0.105
