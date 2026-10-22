extends Node3D
## WO-612 — an imported MVR scene in the previs stage. The server (GET /api/stage/mvr/<id>) has already walked the MVR
## and placed every part in Godot's frame (Y-up metres), so this only fetches each mesh once as GLB and instances it
## per part. One child per MVR object, tagged with its layer, so layers can be hidden.
## WO-612 T5: a VideoScreen bound to a HighAsCG surface (`screen.role`, e.g. our own export) gets the LED shader on its
## picture surface (glTF material "screen", else its first surface) with the live role texture and the mapping crop;
## the role is held only while the 3D view is live (set_live, like the WO-614 stage).

const M := preload("res://features/previs/mvr_model.gd")
const Tint := preload("res://features/previs/model_tint.gd")
const LED_SHADER := preload("res://features/previs/led_screen.gdshader")

signal layer_colors_changed(cols: Dictionary)  ## WO-678: the patched heads (fixtures_3d.gd) follow their layer
signal loaded(info: Dictionary)  ## {} when cleared; else {name, objects, fixtures, parts, meshes, failed, report} or {error}

var scene_id := ""
var layers: Array = []  ## layer names in file order
var _gen := 0  # a newer show_scene() cancels an older one still fetching
var _hidden := {}
var _layer_colors := {}  # WO-641
var _screens: Array = []  # [{role, mat}]
var _live := false
var _held := {}
var _patched := {}  # WO-615 T10: uuid (lower case) → true — the live patch draws these, so the static model hides
var fixture_uuids: Array = []  ## uuids (lower case) of the scene's fixtures, for Unpatch
var _gone := {}  # WO-634: uuid → true — objects an LED screen replaced (project.previs.mvr.hidden_objects)
var _marks: Array = []  # WO-634: selection boxes (top level, stage frame)


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
	_marks = []  # freed with the other children
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
		var keys: Array = o.get("parts", []).map(func(p: Dictionary) -> String: return str(p.get("mesh", "")))
		keys.sort()
		node.set_meta("model", ",".join(keys))  # WO-634: same model = same parts (one LED panel type)
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
		Tint.apply(node, Tint.parse(_layer_colors.get(node.get_meta("layer"))))
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
	target.set_meta("no_tint", true)  # WO-641: a layer colour must not cover the picture
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


## WO-641 — layer name → "#rrggbb"; a layer left out shows the model's own materials.
func set_layer_colors(cols: Dictionary) -> void:
	if cols == _layer_colors:
		return
	_layer_colors = cols.duplicate()
	for c in get_children():
		if c.has_meta("layer"):
			Tint.apply(c, Tint.parse(_layer_colors.get(c.get_meta("layer"))))
	layer_colors_changed.emit(_layer_colors)


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
	var uuid := str(n.get_meta("uuid", ""))
	n.visible = not _hidden.has(str(n.get_meta("layer", ""))) and not _patched.has(uuid) and not _gone.has(uuid)


## WO-634 — objects an LED screen now stands in for (uuids, lower case).
func set_hidden_objects(uuids: Array) -> void:
	_gone = {}
	for u in uuids:
		_gone[str(u).to_lower()] = true
	for c in get_children():
		if c is Node3D and c.has_meta("uuid"):
			_show(c as Node3D)


func _objects() -> Array:
	return get_children().filter(func(c: Node) -> bool: return c is Node3D and c.has_meta("uuid") and (c as Node3D).visible)


## WO-647 — the layer an object is on ("" for none / unknown).
func layer_of(uuid: String) -> String:
	for c in get_children():
		if c.has_meta("uuid") and str(c.get_meta("uuid")) == uuid:
			return str(c.get_meta("layer", ""))
	return ""


## WO-634 — the visible object under a screen point (ray against its mesh boxes, nearest); "" = none.
func pick(cam: Camera3D, at: Vector2) -> String:
	var from := cam.project_ray_origin(at)
	var dir := cam.project_ray_normal(at)
	var best := ""
	var best_d := INF
	for n in _objects():
		for mi in (n as Node).find_children("*", "MeshInstance3D", true, false):
			var hit: Variant = ((mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()).intersects_ray(from, dir)
			if hit != null and from.distance_to(hit) < best_d:
				best_d = from.distance_to(hit)
				best = str(n.get_meta("uuid"))
	return best


## Visible objects as mvr_screen_model.cluster items: {uuid, key (model), box (world AABB)}.
func cluster_items() -> Array:
	var out := []
	for n in _objects():
		var box := AABB()
		var first := true
		for mi in (n as Node).find_children("*", "MeshInstance3D", true, false):
			var b := (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
			box = b if first else box.merge(b)
			first = false
		if not first:
			out.append({"uuid": str(n.get_meta("uuid")), "key": str(n.get_meta("model", "")), "box": box})
	return out


## Per object (in `uuids` order), its boxes in the stage frame (this node's parent — where WO-614 objects live).
func wall_boxes(uuids: Array) -> Array:
	var to_stage := _stage_inv()
	var by := {}
	for n in get_children():
		if n.has_meta("uuid"):
			by[str(n.get_meta("uuid"))] = n
	var out := []
	for u in uuids:
		var boxes := []
		for mi in ((by[u] as Node).find_children("*", "MeshInstance3D", true, false) if by.has(u) else []):
			boxes.append({"xf": to_stage * (mi as MeshInstance3D).global_transform, "aabb": (mi as MeshInstance3D).get_aabb()})
		if not boxes.is_empty():
			out.append(boxes)
	return out


func to_stage(world: Vector3) -> Vector3:
	return _stage_inv() * world


func _stage_inv() -> Transform3D:
	var p := get_parent() as Node3D
	return p.global_transform.affine_inverse() if p != null else Transform3D.IDENTITY


## Selection marks: one translucent box per wall frame (mvr_screen_model.wall_frame, stage frame).
func mark(frames: Array) -> void:
	for m in _marks:
		(m as Node).queue_free()
	_marks = []
	var p := get_parent() as Node3D
	for f in frames:
		var mi := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = Vector3((f.size as Vector2).x + 0.06, (f.size as Vector2).y + 0.06, 0.06)
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.albedo_color = Color(1.0, 0.85, 0.1, 0.35)
		box.material = mat
		mi.mesh = box
		mi.top_level = true
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		var local := Transform3D(f.basis, f.origin) * Transform3D(Basis.IDENTITY, Vector3(0, (f.size as Vector2).y / 2.0, 0.03))
		mi.global_transform = (p.global_transform if p != null else Transform3D.IDENTITY) * local
		_marks.append(mi)


## The scene's placement on our stage (mvr_model place_of): this node's transform; the parts stay in the file's frame.
## WO-649 — apply project.previs.mvr (place, hidden layers / objects, layer colours, the scene) — the Previs section and
## the Live 3D view share it.
func configure(c: Dictionary) -> void:
	set_place(M.place_of(c))
	set_hidden_layers(c.get("hidden_layers", []) if c.get("hidden_layers") is Array else [])
	set_hidden_objects(c.get("hidden_objects", []) if c.get("hidden_objects") is Array else [])
	set_layer_colors(Tint.colors(c, "layer_colors"))
	show_scene(str(c.get("id", "")))


func set_place(place: Dictionary) -> void:
	transform = M.placement(place)


## World AABB of every visible mesh (camera framing); local = in the scene's own, unplaced frame (Fit).
func bounds(local := false) -> AABB:
	var box := AABB()
	var first := true
	var to_local := global_transform.affine_inverse()
	for mi in find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if not m.is_visible_in_tree() or _marks.has(m):
			continue
		var b := (to_local * m.global_transform if local else m.global_transform) * m.get_aabb()
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
