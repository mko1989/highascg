extends RefCounted
## WO-1003 — a venue .glb (a project file, project.previs.mvr.venue_glb) drawn through the MVR scene: the MVR keeps the
## patch, the fixtures and every per-object feature, the .glb gives the rest of the room its look.
## Capture writes each MVR object's uuid into its glTF node (extensions.CAPTURE_model.identifier; layers by uuid too) and
## exports both files in one frame — the .glb is the MVR's (x, z, −y) in metres, the frame the server converts the MVR
## into (GET /api/stage/mvr/<id>). Measured on the Narvil files (09.11): all 5614 glTF nodes are MVR objects or groups,
## the 4245 mesh nodes are its 4104 scene objects + 90 fixtures + 51 trusses, fixture positions equal to the mm, and 853
## scene objects that Capture wrote with an empty <Geometries/> (561 "Klimat ledowy", 199 "Krata na dole") exist only in
## the .glb. So, per uuid:
##   - an MVR object (not a fixture, not a bound video screen) draws the .glb meshes of its uuid instead of its own parts;
##   - a fixture keeps the MVR's (the live rig hides it once patched); its .glb model is dropped;
##   - a .glb mesh no MVR object owns becomes an object of its Capture layer (eye, colour, pick, move like the others).
## Matching is by uuid only — no distance guessing (the WO-1003 design's fallback, not needed for a Capture export).

const PF := preload("res://core/project_files.gd")

static var _cache := {}  # name → bytes: the Previs page and the Live 3D view share one download (one file at a time)


## The .glb `name` (in the open project's folder) parsed → {by: {uuid: [{mesh, xf, layer}]}, meshes: n} or {error}.
## `host` (in the tree) keeps the frames running while the file parses on a worker thread.
static func fetch(host: Node, name: String) -> Dictionary:
	var bytes: PackedByteArray = _cache.get(name, PackedByteArray())
	if bytes.is_empty():
		var res: Dictionary = await Api.get_bytes(PF.url(name))
		if not res.ok:
			return {"error": "Venue model %s: %s" % [name, res.get("error", "download failed")]}
		bytes = res.bytes
		_cache = {name: bytes}
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	var err := [FAILED]
	var task := WorkerThreadPool.add_task(func() -> void: err[0] = doc.append_from_buffer(bytes, "", st))
	while host.is_inside_tree() and not WorkerThreadPool.is_task_completed(task):
		await host.get_tree().process_frame
	WorkerThreadPool.wait_for_task_completion(task)
	if err[0] != OK:
		return {"error": "Venue model %s is not a glTF/GLB the runtime can read" % name}
	# Not generate_scene(): it swaps the nodes it first builds, and GLTFState.get_scene_node() then hands back freed
	# objects (seen live 09.11). The meshes and the node transforms come straight from the parsed state instead.
	var meshes: Array = st.get_meshes().map(func(m: GLTFMesh) -> Mesh: return m.mesh.get_mesh() if m.mesh else null)
	return meshes_by_uuid(st.json, st.get_nodes(), meshes)


## glTF json + its GLTFNodes + the Mesh per glTF mesh index → {by: {uuid (lower case): [{mesh, xf (in the file's frame),
## layer}]}, meshes}. A node without a uuid (not a Capture export) is keyed "glb:<index>" — drawn as its own object.
static func meshes_by_uuid(json: Dictionary, gnodes: Array, meshes: Array) -> Dictionary:
	var nodes: Array = json.get("nodes", []) if json.get("nodes") is Array else []
	var names := {}
	for l in _ext(json.get("asset", {})).get("layers", []):
		names[str(l.get("identifier", "")).to_lower()] = str(l.get("name", ""))
	var by := {}
	var count := 0
	for i in gnodes.size():
		var g := gnodes[i] as GLTFNode
		if g.mesh < 0 or g.mesh >= meshes.size() or meshes[g.mesh] == null:
			continue
		var uuid := str(_ext(nodes[i] if i < nodes.size() else {}).get("identifier", "")).to_lower()
		if uuid == "":
			uuid = "glb:%d" % i
		var layer := ""
		var xf := Transform3D.IDENTITY
		var at := i
		while at >= 0 and at < gnodes.size():
			xf = (gnodes[at] as GLTFNode).xform * xf
			if layer == "" and at < nodes.size():
				layer = names.get(str(_ext(nodes[at]).get("layer_identifier", "")).to_lower(), "")
			at = (gnodes[at] as GLTFNode).parent
		if not by.has(uuid):
			by[uuid] = []
		by[uuid].append({"mesh": meshes[g.mesh], "xf": xf, "layer": layer})
		count += 1
	return {"by": by, "meshes": count}


## A Capture export (its glTF JSON names the CAPTURE_model extension) — the bytes of a .glb, first chunk only.
static func is_capture(bytes: PackedByteArray) -> bool:
	if bytes.size() < 20 or bytes.slice(0, 4).get_string_from_ascii() != "glTF":
		return false
	return bytes.slice(20, 20 + mini(bytes.decode_u32(12), 65536)).get_string_from_utf8().contains("\"CAPTURE_model\"")


## project.previs.mvr.venue_glb = `name` ("" = none); the MVR section and the 3D views follow on project_changed.
## → false when no MVR scene is picked (nothing to draw it through); true when it is (now) the venue.
static func save_venue(name: String) -> bool:
	var previs: Variant = Store.project.get("previs")
	var c: Variant = (previs as Dictionary).get("mvr") if previs is Dictionary else null
	if not (c is Dictionary) or not (c as Dictionary).has("id"):
		return false
	if str(c.get("venue_glb", "")) == name:
		return true
	if name == "":
		(c as Dictionary).erase("venue_glb")
	else:
		c["venue_glb"] = name
	ProjectSync.mark_dirty()
	Store.project_changed.emit(Store.project)
	return true


## Swap `scene`'s (mvr_scene.gd) object meshes for the venue's `v` (fetch()) → {swapped, extra, layers: {name: added}}.
static func apply(scene: Node3D, v: Dictionary) -> Dictionary:
	var by: Dictionary = (v.get("by", {}) as Dictionary).duplicate()
	var swapped := 0
	for node in scene.get_children():
		if not node.has_meta("uuid"):
			continue  # the selection marks
		var parts: Array = by.get(str(node.get_meta("uuid")), [])
		by.erase(str(node.get_meta("uuid")))
		if parts.is_empty() or str(node.get_meta("kind", "")) == "Fixture" or node.has_meta("screen"):
			continue
		for c in node.get_children():
			c.free()  # the MVR's own parts
		_fill(node, parts)
		swapped += 1
	var layers := {}
	for uuid in by:
		var node := Node3D.new()
		var layer := str(by[uuid][0].layer)
		node.name = ("glb " + str(uuid)).validate_node_name()
		node.set_meta("layer", layer)
		node.set_meta("kind", "SceneObject")
		node.set_meta("uuid", str(uuid))
		scene.add_child(node)
		_fill(node, by[uuid])
		layers[layer] = int(layers.get(layer, 0)) + 1
	return {"swapped": swapped, "extra": by.size(), "layers": layers}


static func _fill(node: Node3D, parts: Array) -> void:
	var keys := []
	for p in parts:
		var mi := MeshInstance3D.new()
		mi.mesh = p.mesh
		mi.transform = p.xf
		node.add_child(mi)
		keys.append(str(p.mesh.get_instance_id()))
	node.set_meta("model", "glb:" + ",".join(keys))  # WO-634: same .glb mesh = same model (one LED panel type)


static func _ext(d: Variant) -> Dictionary:
	var e: Variant = (d as Dictionary).get("extensions", {}) if d is Dictionary else {}
	var c: Variant = (e as Dictionary).get("CAPTURE_model", {}) if e is Dictionary else {}
	return c if c is Dictionary else {}
