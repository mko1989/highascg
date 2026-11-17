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
## WO-1106 A39: own bodies import on a WorkerThreadPool task (the ~130 ms import froze the previs on the first frame a
## card wore one): "own:slug" → {task, job, moves}; the card keeps its pebble until the template lands (_poll).
static var _loading := {}
static var own_root := ""  # tests: a temp folder instead of human_own.gd dir()


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
	# WO-1106 A13: an own body loads again once its files change (a failed one and a loaded one alike), so the help's
	# "delete the converted GLB / convert.json to try again" works without a client restart
	if _loading.has(body):
		return {}  # WO-1106 A39: importing on a worker thread
	if _templates.has(body) and not (body.begins_with("own:") and Own.stale(body.substr(4))):
		return _templates[body]
	if body.begins_with("own:"):
		var old: Dictionary = _templates.get(body, {})
		if old.has("root") and is_instance_valid(old.root):
			(old.root as Node).free()  # an orphan template: the puppets wear their own duplicates
		_templates[body] = {}  # a failed import is not retried every frame
		_start(body)
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


## WO-1106 A39: prepare on the main thread, build on a worker with private copies of the shipped bodies (the thread
## touches no node in the tree and no static), land on a later frame. No scene tree (a tool script): all at once.
static func _start(body: String) -> void:
	var job := Own.prepare(body.substr(4), own_root)
	if job.has("out"):
		_templates[body] = job.out
		return
	var moves := {}
	for n in Own.MOVES:
		var tpl := template(n)
		if not tpl.is_empty():
			moves[n] = {"root": (tpl.root as Node).duplicate(), "height": tpl.height, "moves": tpl.moves, "toes": tpl.toes}
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		_templates[body] = Own.finish(job, Own.build(job, _moves_in.bind(moves)))
		_free_moves(moves)
		return
	# static methods, never lambdas, on the tree's signals (see material(): a static lambda corrupted the heap at exit)
	_loading[body] = {"task": WorkerThreadPool.add_task(_build.bind(job, moves), false, "own puppet " + body), "job": job, "moves": moves}
	if not tree.process_frame.is_connected(_poll):
		tree.process_frame.connect(_poll)
	if not tree.root.tree_exiting.is_connected(settle):
		tree.root.tree_exiting.connect(settle)  # quitting mid-import: wait for it, never leave a task running


static func _build(job: Dictionary, moves: Dictionary) -> void:
	job.result = Own.build(job, _moves_in.bind(moves))  # the main thread reads `job` only once the task is done


static func _moves_in(n: String, moves: Dictionary) -> Dictionary:
	return moves.get(n, {})


## Each frame while an import runs: land the finished ones. A card deselected (or its view closed) meanwhile is fine:
## the task holds no node of the view, and the template is kept for the next card that wears it.
static func _poll() -> void:
	for body: String in _loading.keys():
		if WorkerThreadPool.is_task_completed(int(_loading[body].task)):
			_land(body)
	var tree := Engine.get_main_loop() as SceneTree
	if _loading.is_empty() and tree != null and tree.process_frame.is_connected(_poll):
		tree.process_frame.disconnect(_poll)


## Wait for every import in flight and land it (quit, tests).
static func settle() -> void:
	for body: String in _loading.keys():
		_land(body)


static func _land(body: String) -> void:
	var l: Dictionary = _loading[body]
	_loading.erase(body)
	# the task's mesh / texture calls queue on the RenderingServer, which only the main thread flushes: blocking in
	# wait_for_task_completion before it finished deadlocked (settle() at quit) — flush while waiting
	while not WorkerThreadPool.is_task_completed(int(l.task)):
		RenderingServer.force_sync()
		OS.delay_usec(500)
	WorkerThreadPool.wait_for_task_completion(int(l.task))
	_free_moves(l.moves)
	_templates[body] = Own.finish(l.job, l.job.get("result", {}))


static func _free_moves(moves: Dictionary) -> void:
	for m: Dictionary in moves.values():
		if is_instance_valid(m.root):
			(m.root as Node).free()


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
