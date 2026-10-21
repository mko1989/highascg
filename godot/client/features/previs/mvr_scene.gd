extends Node3D
## WO-612 — an imported MVR scene in the previs stage. The server (GET /api/stage/mvr/<id>) has already walked the MVR
## and placed every part in Godot's frame (Y-up metres), so this only fetches each mesh once as GLB and instances it
## per part. One child per MVR object, tagged with its layer, so layers can be hidden.
## WO-612 T5: a VideoScreen bound to a HighAsCG surface (`screen.role`, e.g. our own export) gets the LED shader on its
## picture surface (glTF material "screen", else its first surface) with the live role texture and the mapping crop;
## the role is held only while the 3D view is live (set_live, like the WO-614 stage).

const M := preload("res://features/previs/mvr_model.gd")
const LED_SHADER := preload("res://features/previs/led_screen.gdshader")

signal loaded(info: Dictionary)  ## {} when cleared; else {name, objects, fixtures, parts, meshes, failed, report} or {error}

var scene_id := ""
var layers: Array = []  ## layer names in file order
var _gen := 0  # a newer show_scene() cancels an older one still fetching
var _hidden := {}
var _screens: Array = []  # [{role, mat}]
var _live := false
var _held := {}
var _patched := {}  # WO-615 T10: uuid (lower case) → true — the live patch draws these, so the static model hides
var fixture_uuids: Array = []  ## uuids (lower case) of the scene's fixtures, for Unpatch


func show_scene(id: String) -> void:
	if id == scene_id:
		return
	scene_id = id
	_gen += 1
	var gen := _gen
	for c in get_children():
		c.queue_free()
	layers = []
	fixture_uuids = []
	_screens = []
	_sync_holds()
	if id == "":
		loaded.emit({})
		return
	var res: Dictionary = await Api.get_json("/api/stage/mvr/" + id)
	if gen != _gen:
		return
	var rec: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	var sc: Dictionary = rec.get("scene", {}) if rec.get("scene") is Dictionary else {}
	if sc.is_empty():
		loaded.emit({"error": "MVR scene %s is not on the server (%s)" % [id, res.get("error", "")]})
		return
	var templates := {}
	var failed: Array = []
	for key in sc.get("meshes", []):
		var b: Dictionary = await Api.get_bytes("/api/stage/mvr/%s/mesh?key=%s" % [id, str(key).uri_encode()])
		if gen != _gen:
			for t in templates.values():
				(t as Node).free()
			return
		var t: Node3D = _from_glb(b.bytes) if b.ok else null
		if t == null:
			failed.append(key)
		else:
			templates[key] = t
	var parts := 0
	var fixtures := 0
	for o in sc.get("objects", []):
		var node := Node3D.new()
		node.name = str(o.get("name", "object")).validate_node_name()
		node.set_meta("layer", str(o.get("layer", "")))
		node.set_meta("kind", str(o.get("kind", "")))
		node.set_meta("uuid", str(o.get("uuid", "")).to_lower())
		add_child(node)
		_show(node)
		if o.has("fixture"):
			fixtures += 1
			fixture_uuids.append(str(o.get("uuid", "")).to_lower())
		for p in o.get("parts", []):
			var t: Node3D = templates.get(p.mesh)
			if t != null:
				var inst := t.duplicate() as Node3D
				inst.transform = M.xform(p.xform)
				node.add_child(inst)
				parts += 1
		if M.screen_role(o) != "":
			_bind_screen(node, o.screen)
	for t in templates.values():
		(t as Node).free()
	for l in sc.get("layers", []):
		layers.append(str(l.get("name", "")))
	_sync_holds()
	loaded.emit({"name": rec.get("name", ""), "objects": sc.get("objects", []).size(), "fixtures": fixtures, "parts": parts,
		"meshes": templates.size(), "failed": failed, "report": sc.get("report", {}), "screens": _screens.size()})


## The picture surface of a bound VideoScreen gets the LED shader (no seams: an MVR screen is not our panel grid).
func _bind_screen(node: Node3D, screen: Dictionary) -> void:
	var target: MeshInstance3D = null
	var surface := -1
	for mi in node.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		for i in m.mesh.get_surface_count() if m.mesh else 0:
			var mat := m.mesh.surface_get_material(i)
			if mat != null and mat.resource_name == "screen":
				target = m
				surface = i
			elif target == null:
				target = m
				surface = i
	if target == null:
		return
	var mat := ShaderMaterial.new()
	mat.shader = LED_SHADER
	mat.set_shader_parameter("uv_rect", M.screen_uv(screen))
	target.set_surface_override_material(surface, mat)
	_screens.append({"role": str(screen.role), "mat": mat})
	_apply(_screens[-1])


## 3D view live → hold the bound roles and show them; otherwise release (the screens go dark).
func set_live(on: bool) -> void:
	_live = on
	_sync_holds()


func _sync_holds() -> void:
	var want := {}
	if _live:
		for s in _screens:
			want[s.role] = true
	for role in _held.keys():
		if not want.has(role):
			VideoSurfaces.release(role, self)
			_held.erase(role)
	for role in want.keys():
		if not _held.has(role):
			VideoSurfaces.acquire(role, self)
			_held[role] = true
	for s in _screens:
		_apply(s)


func _apply(s: Dictionary) -> void:
	var tex: Texture2D = VideoSurfaces.texture(s.role) if _live else null
	(s.mat as ShaderMaterial).set_shader_parameter("video", tex)
	(s.mat as ShaderMaterial).set_shader_parameter("has_video", tex != null and tex.get_width() > 0)


func set_hidden_layers(names: Array) -> void:
	_hidden = {}
	for n in names:
		_hidden[str(n)] = true
	for c in get_children():
		_show(c as Node3D)


## WO-615 T10 — fixtures patched from this scene are drawn by the live rig (fixtures_3d.gd): hide their static model.
func set_patched(uuids: Dictionary) -> void:
	_patched = uuids
	for c in get_children():
		_show(c as Node3D)


func _show(n: Node3D) -> void:
	n.visible = not _hidden.has(str(n.get_meta("layer", ""))) and not _patched.has(str(n.get_meta("uuid", "")))


## World AABB of every visible mesh (camera framing).
func bounds() -> AABB:
	var box := AABB()
	var first := true
	for mi in find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if not m.is_visible_in_tree():
			continue
		var b := m.global_transform * m.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


func _from_glb(bytes: PackedByteArray) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if bytes.is_empty() or doc.append_from_buffer(bytes, "", state) != OK:
		return null
	return doc.generate_scene(state) as Node3D


var _check := 0.0


## A surface whose writer starts after the bind has width 0 at first: re-check twice a second while live.
func _process(delta: float) -> void:
	_check += delta
	if _check < 0.5 or not _live or _screens.is_empty():
		return
	_check = 0.0
	for s in _screens:
		_apply(s)
