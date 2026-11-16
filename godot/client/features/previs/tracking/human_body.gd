extends RefCounted
## WO-1103 — the two human puppet bodies (owner 16.11: "try to create a woman and man avatars but try to make them as
## much human like as possible"; "the hq avatars are for previz purposes only as a 'puppet'"). Built from the MakeHuman
## CC0 system assets with MPFB (tools/people/: recipe, specs and the build scripts) and shipped as
## godot/client/assets/people/<body>.glb (a skinned mesh on MPFB's 53-bone "game_engine" skeleton, two levels of
## detail: lod0_* and lod1_* meshes, one material per part, no images inside) + <body>_<part>.webp textures. Licences:
## assets/people/LICENSES.json, THIRD_PARTY_NOTICES.
##
## Both are read at RUN time (GLTFDocument + Image from raw bytes), never through the editor's import pipeline: the
## operator client runs from the source tree with no import cache, and the files carry a "keep" .import so an export
## packs them as they are. Loaded once per body (~10 ms each), then every puppet duplicates the template (meshes and
## materials are shared). A missing or broken file → available() false and the puppet stays a pebble avatar.

const DIR := "res://assets/people/"
const BODIES := ["woman", "man"]
const SHADER := preload("res://features/previs/tracking/person_human.gdshader")
const CARDS := preload("res://features/previs/tracking/person_human_cards.gdshader")
const House := preload("res://features/previs/house_lights.gd")
## Per part: the material's look. tex = <body>_<tex>.webp (skin: <body>_skin_<tone>), nrm = its normal map, if any.
const PARTS := {
	"skin": {"rough": 0.52, "sheen": 0.35, "wrap": Vector3(0.32, 0.14, 0.08)},
	"clothes": {"rough": 0.85, "sheen": 0.12, "wrap": Vector3(0.12, 0.12, 0.12), "nrm": "clothes_n", "depth": 1.0},
	"shoes": {"rough": 0.4, "sheen": 0.7, "wrap": Vector3(0.05, 0.05, 0.05), "nrm": "shoes_n", "depth": 1.0},
	"eyes": {"rough": 0.12, "sheen": 1.0, "wrap": Vector3(0.1, 0.1, 0.1)},
	"hair": {"rough": 0.5, "sheen": 0.4, "wrap": Vector3(0.3, 0.3, 0.3), "cards": true, "cut": 0.42, "nrm": "hair_n", "depth": 0.6},
	"eyebrows": {"rough": 0.8, "sheen": 0.0, "wrap": Vector3(0.3, 0.3, 0.3), "cards": true, "cut": 0.3},
	"eyelashes": {"rough": 0.8, "sheen": 0.0, "wrap": Vector3(0.3, 0.3, 0.3), "cards": true, "cut": 0.3},
}
const TONES := ["light", "mid", "dark"]
## The skin textures' own lightness (mean sRGB luminance of the skin texels, measured when packed; mid = light + dark) — a puppet's skin trait
## picks the nearest one.
const TONE_LUMA := {"light": 0.67, "mid": 0.46, "dark": 0.25}

static var _templates := {}  # body → {root: Node3D, height: float} | {} when it failed
static var _mats := {}  # "body:part[:tone]" → ShaderMaterial
static var _house_hooked := false


## The body's files are there and load.
static func available(body: String) -> bool:
	return body in BODIES and not template(body).is_empty()


## The body as loaded (the template every instance copies): {root, height (m, soles to the top of the head/hair)}.
static func template(body: String) -> Dictionary:
	if _templates.has(body):
		return _templates[body]
	var out := {}
	var bytes := FileAccess.get_file_as_bytes(DIR + body + ".glb")
	if not bytes.is_empty():
		var doc := GLTFDocument.new()
		var st := GLTFState.new()
		if doc.append_from_buffer(bytes, DIR, st) == OK:
			var root: Node = doc.generate_scene(st)
			if root is Node3D and _skeleton(root) != null:
				out = {"root": root, "height": _height(root)}
			elif root != null:
				root.free()
	if out.is_empty():
		push_warning("[human_body] %s: %s missing or unreadable — the puppet stays a pebble avatar" % [body, DIR + body + ".glb"])
	_templates[body] = out
	return out


## A new copy of the body: {root (Node3D, feet at y 0, front +Z, the person's left +X, metres), skeleton, lod0 [],
## lod1 [] (MeshInstance3D), height}. Materials are shared per body (skin per tone). {} when unavailable.
static func instance(body: String, tone := "light") -> Dictionary:
	var tpl := template(body)
	if tpl.is_empty():
		return {}
	var root: Node3D = (tpl.root as Node3D).duplicate()
	var out := {"root": root, "skeleton": _skeleton(root), "lod0": [], "lod1": [], "height": tpl.height}
	for mi: MeshInstance3D in _meshes(root):
		var part := part_of(mi)
		mi.material_override = material(body, part, tone)
		var lod := "lod1" if mi.name.begins_with("lod1") else "lod0"
		(out[lod] as Array).append(mi)
		var small := part in ["eyes", "eyebrows", "eyelashes"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if small else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	return out


## "lod0_hair" → "hair" (the material name the build gives every part).
static func part_of(mi: MeshInstance3D) -> String:
	var n := str(mi.name)
	return n.get_slice("_", 1) if n.contains("_") else n


## The skin tone for a skin colour (a trait / palette Color): the nearest TONE_LUMA.
static func tone_for(skin: Variant) -> String:
	if not (skin is Color):
		return "light"
	var l := (skin as Color).get_luminance()
	var best := "light"
	for t in TONES:
		if absf(l - TONE_LUMA[t]) < absf(l - TONE_LUMA[best]):
			best = t
	return best


## The shared material of one part (skin: per tone).
static func material(body: String, part: String, tone := "light") -> ShaderMaterial:
	var key := "%s:%s" % [body, part] + (":" + tone if part == "skin" else "")
	if _mats.has(key):
		return _mats[key]
	var spec: Dictionary = PARTS.get(part, PARTS.clothes)
	var m := ShaderMaterial.new()
	m.shader = CARDS if spec.get("cards", false) else SHADER
	m.set_shader_parameter("albedo_tex", texture("%s_skin_%s" % [body, tone] if part == "skin" else "%s_%s" % [body, part]))
	if spec.has("nrm"):
		var n: Variant = texture("%s_%s" % [body, spec.nrm])
		if n != null:
			m.set_shader_parameter("normal_tex", n)
			m.set_shader_parameter("normal_depth", float(spec.depth))
	m.set_shader_parameter("roughness", float(spec.rough))
	m.set_shader_parameter("sheen", float(spec.sheen))
	m.set_shader_parameter("wrap", spec.wrap)
	m.set_shader_parameter("alpha_cut", float(spec.get("cut", 0.5)))
	_mats[key] = m
	if not _house_hooked:
		_house_hooked = true
		House.shared().changed.connect(func(_h: float) -> void: house())
	m.set_shader_parameter("self_light", self_light())
	return m


## WO-1099: house lights on → the room's ambient lights the puppet like everything else (no glow of its own); down →
## only the readability floor (ui.cfg [previs] avatar_floor) is left, fading in as the room goes dark.
static func self_light() -> float:
	var hs: RefCounted = House.shared()
	return float(hs.avatar_floor) * (1.0 - House.gain(float(hs.level)))


static func house() -> void:
	var sl := self_light()
	for m: ShaderMaterial in _mats.values():
		m.set_shader_parameter("self_light", sl)


## <DIR><name>.webp as a mipmapped texture, or null.
static func texture(name: String) -> Variant:
	var bytes := FileAccess.get_file_as_bytes(DIR + name + ".webp")
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


## Soles to the top of the head (lod0 meshes' bind-pose bounds).
static func _height(root: Node) -> float:
	var top := 0.0
	for mi: MeshInstance3D in _meshes(root):
		if mi.name.begins_with("lod0") and mi.mesh != null:
			var b := mi.mesh.get_aabb()
			top = maxf(top, b.position.y + b.size.y)
	return top if top > 0.5 else 1.7
