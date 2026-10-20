extends Node3D
## WO-612 — an imported MVR scene in the previs stage. The server (GET /api/stage/mvr/<id>) has already walked the MVR
## and placed every part in Godot's frame (Y-up metres), so this only fetches each mesh once as GLB and instances it
## per part. One child per MVR object, tagged with its layer, so layers can be hidden.

const M := preload("res://features/previs/mvr_model.gd")

signal loaded(info: Dictionary)  ## {} when cleared; else {name, objects, fixtures, parts, meshes, failed, report} or {error}

var scene_id := ""
var layers: Array = []  ## layer names in file order
var _gen := 0  # a newer show_scene() cancels an older one still fetching
var _hidden := {}


func show_scene(id: String) -> void:
	if id == scene_id:
		return
	scene_id = id
	_gen += 1
	var gen := _gen
	for c in get_children():
		c.queue_free()
	layers = []
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
		node.visible = not _hidden.has(str(o.get("layer", "")))
		add_child(node)
		fixtures += 1 if o.has("fixture") else 0
		for p in o.get("parts", []):
			var t: Node3D = templates.get(p.mesh)
			if t != null:
				var inst := t.duplicate() as Node3D
				inst.transform = M.xform(p.xform)
				node.add_child(inst)
				parts += 1
	for t in templates.values():
		(t as Node).free()
	for l in sc.get("layers", []):
		layers.append(str(l.get("name", "")))
	loaded.emit({"name": rec.get("name", ""), "objects": sc.get("objects", []).size(), "fixtures": fixtures, "parts": parts,
		"meshes": templates.size(), "failed": failed, "report": sc.get("report", {})})


func set_hidden_layers(names: Array) -> void:
	_hidden = {}
	for n in names:
		_hidden[str(n)] = true
	for c in get_children():
		(c as Node3D).visible = not _hidden.has(str(c.get_meta("layer", "")))


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
