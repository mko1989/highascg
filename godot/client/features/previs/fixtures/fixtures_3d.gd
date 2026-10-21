extends Node3D
## WO-615 T5 — the patch's GDTF fixtures on the 3D stage: each built from its type's rig (server-instanced geometry,
## GET /api/fixtures/types/<id>/rig, meshes from /model as GLB, else a box of the model size), placed by its patch
## pose, with axes turned and beams lit from the server's decode of the DMX it sends (WS `tracking:fixtures`,
## first state from GET /api/tracking/fixtures). A beam is an additive cone + an emissive lens, and a shadowless
## SpotLight3D while the light budget lasts (fixtures_3d_model.gd) projecting the beam's gobo wheel slot. Rebuilt only
## when typed fixtures or poses change. WO-615 T6: a click picks a fixture into the programmer selection
## (fixture_selection.gd; selected bodies get a box) or, while Point at is on, aims the selection at the floor.

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const M := preload("res://features/previs/mvr_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")

const CONE_SHADER := """
shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;
uniform vec4 tint : source_color;
varying float along;
void vertex() {
	along = clamp(0.5 - VERTEX.y, 0.0, 1.0);  // 0 at the lens (top of the unit cone), 1 at its far end
}
void fragment() {
	float edge = pow(abs(dot(normalize(NORMAL), normalize(VIEW))), 1.5);
	ALBEDO = tint.rgb;
	ALPHA = tint.a * (1.0 - along) * (1.0 - along) * edge * %s;
}
""" % F.CONE_ALPHA

var _key := ""
var _gen := 0
var _rigs := {}  # "typeId|mode" → rig Dictionary (or {} = failed)
var _meshes := {}  # "typeId|path" → Node3D template (null = failed)
var _gobos := {}  # "typeId|wheel/media" → Texture2D (null = none / failed)
var _gobo_wait := {}  # key → [SpotLight3D] waiting for that image
var _fx := {}  # fixture id → {axes: {node id → [Node3D, rest Transform3D, kind]}, beams: {node id → parts}}
var _last: Dictionary = {}  # last tracking:fixtures payload (re-applied after a rebuild)
var _shader: Shader
var _cone: CylinderMesh
var lights := 0
var gobo_lights := 0
var sel: RefCounted = Sel.shared()


func _ready() -> void:
	_shader = Shader.new()
	_shader.code = CONE_SHADER
	_cone = CylinderMesh.new()
	_cone.top_radius = 0.004
	_cone.bottom_radius = 1.0
	_cone.height = 1.0
	_cone.radial_segments = 24
	_cone.rings = 1
	_cone.cap_top = false
	_cone.cap_bottom = false
	Store.project_changed.connect(_on_project)
	Ws.message.connect(_on_ws)
	sel.changed.connect(_show_selection)
	_on_project(Store.project)
	var res: Dictionary = await Api.get_json("/api/tracking/fixtures")
	if res.ok and res.data is Dictionary and _last.is_empty():
		apply(res.data)


func _on_ws(type: String, data: Variant) -> void:
	if type == "tracking:fixtures" and data is Dictionary:
		apply(data)


func _on_project(project: Variant) -> void:
	var list := F.typed((project as Dictionary).get("fixtures") if project is Dictionary else null)
	var key := JSON.stringify(list.map(func(f: Dictionary) -> Array:
		return [f.get("id"), F.rig_key(f), f.get("pose"), f.get("enabled", true)]))
	if key == _key:
		return
	_key = key
	_rebuild(list)


func _rebuild(list: Array) -> void:
	_gen += 1
	var gen := _gen
	for k in list.map(func(f: Dictionary) -> String: return F.rig_key(f)):
		if _rigs.has(k):
			continue
		var parts: PackedStringArray = k.split("|", true, 1)
		var r: Dictionary = await Api.get_json("/api/fixtures/types/%s/rig?mode=%s" % [parts[0], parts[1].uri_encode()])
		if gen != _gen:
			return
		_rigs[k] = r.data if r.ok and r.data is Dictionary else {}
		for path in (_rigs[k] as Dictionary).get("meshes", []):
			var mk := "%s|%s" % [parts[0], path]
			if _meshes.has(mk):
				continue
			var b: Dictionary = await Api.get_bytes("/api/fixtures/types/%s/model?path=%s" % [parts[0], str(path).uri_encode()])
			if gen != _gen:
				return
			_meshes[mk] = _from_glb(b.bytes) if b.ok else null
	for c in get_children():
		c.queue_free()
	_fx = {}
	lights = 0
	gobo_lights = 0
	for f in list:
		if f.get("enabled", true) == false:
			continue
		var rig: Dictionary = _rigs.get(F.rig_key(f), {})
		if not rig.get("nodes") is Array:
			continue
		_build(f, rig)
	if not _last.is_empty():
		apply(_last)
	_show_selection()


func _build(f: Dictionary, rig: Dictionary) -> void:
	var root := Node3D.new()
	root.name = str(f.get("id", "fx")).validate_node_name()
	root.transform = F.pose_xform(f.get("pose"))
	add_child(root)
	var made: Array = []
	var parts := {"axes": {}, "beams": {}}
	var cells := F.is_cell_rig(rig)
	for n in rig.nodes:
		var node := Node3D.new()
		node.transform = M.xform(n.get("xf", []))
		var parent: int = int(n.get("parent", -1))
		(made[parent] if parent >= 0 and parent < made.size() else root).add_child(node)
		made.append(node)
		var mesh := _mesh(str(f.typeId), str(n.get("mesh", "")))
		if mesh != null:
			mesh.transform = M.xform(n.get("mesh_xf", []))
			node.add_child(mesh)
		if str(n.get("axis", "")) != "":
			parts.axes[str(n.id)] = [node, node.transform, str(n.axis)]
		if n.get("kind") == "Beam":
			var beam: Dictionary = n.get("beam", {}) if n.get("beam") is Dictionary else {}
			parts.beams[str(n.id)] = _beam(node, {"beamType": "Glow", "radius": beam.get("radius", 0.05)} if cells else beam, mesh)
			parts.beams[str(n.id)].type = str(f.typeId)
	parts.root = root
	parts.box = _body_box(root)
	parts.mark = _mark(parts.box)
	root.add_child(parts.mark)
	_fx[str(f.id)] = parts


## The fixture's body (not its cones) in its own frame, at rest — what a click hits.
func _body_box(root: Node3D) -> AABB:
	var inv := root.global_transform.affine_inverse()
	var box := AABB(Vector3(-0.15, -0.15, -0.15), Vector3(0.3, 0.3, 0.3))
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh != _cone:
			box = box.merge(inv * m.global_transform * m.get_aabb())
	return box


## Selection mark: the body box's edges, drawn over everything.
func _mark(box: AABB) -> MeshInstance3D:
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	for e in [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]:
		for i in e:
			im.surface_add_vertex(box.get_endpoint(i))
	im.surface_end()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.no_depth_test = true
	mat.albedo_color = Color(1.0, 0.8, 0.2)
	var mi := MeshInstance3D.new()
	mi.mesh = im
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	return mi


func _show_selection() -> void:
	for id in _fx:
		(_fx[id].mark as MeshInstance3D).visible = sel.ids.has(id)


## A click (no drag) in the 3D view. Point at on: a floor hit aims the selection there. Else the nearest fixture
## body under the mouse is picked (`add`: shift toggles it). → whether the click was used (else the stage picks).
func click(cam: Camera3D, pos: Vector2, add: bool) -> bool:
	var from := cam.project_ray_origin(pos)
	var dir := cam.project_ray_normal(pos)
	if sel.point_at and not sel.ids.is_empty():
		var floor_hit: Variant = F.floor_hit(from, dir)
		if floor_hit != null:
			sel.aim_at.emit([floor_hit.x, -floor_hit.z, 0.0])
		return floor_hit != null
	var best := ""
	var near := INF
	for id in _fx:
		var root := _fx[id].root as Node3D
		var inv := root.global_transform.affine_inverse()
		var hit: Variant = (_fx[id].box as AABB).intersects_ray(inv * from, inv.basis * dir)
		if hit != null and from.distance_to(root.global_transform * (hit as Vector3)) < near:
			near = from.distance_to(root.global_transform * (hit as Vector3))
			best = id
	if best != "":
		sel.pick(best, add)
	return best != ""


func _mesh(type_id: String, key: String) -> Node3D:
	if key == "prim:box":
		var mi := MeshInstance3D.new()
		mi.mesh = BoxMesh.new()
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.22, 0.22, 0.24)
		mi.material_override = mat
		return mi
	var t: Node3D = _meshes.get("%s|%s" % [type_id, key])
	return t.duplicate() as Node3D if t != null else null


## Lens (emissive disc), cone and maybe a light under a Beam node — all along its −Y (GDTF −Z).
func _beam(node: Node3D, beam: Dictionary, body: Node3D) -> Dictionary:
	var lens := MeshInstance3D.new()
	var disc := CylinderMesh.new()
	var r := clampf(float(beam.get("radius", 0.05)), 0.005, 1.0)
	disc.top_radius = r
	disc.bottom_radius = r
	disc.height = 0.004
	lens.mesh = disc
	var lmat := StandardMaterial3D.new()
	lmat.albedo_color = Color(0.05, 0.05, 0.05)
	lmat.emission_enabled = true
	lens.material_override = lmat
	node.add_child(lens)
	var out := {"lens": lmat, "body": body if beam.get("beamType") == "Glow" else null}
	if beam.get("beamType") == "Glow":
		return out
	var cone := MeshInstance3D.new()
	cone.mesh = _cone
	var cmat := ShaderMaterial.new()
	cmat.shader = _shader
	cone.material_override = cmat
	cone.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	cone.visible = false
	node.add_child(cone)
	out.cone = cone
	out.cmat = cmat
	if F.wants_light(beam, lights):
		lights += 1
		var sl := SpotLight3D.new()
		sl.basis = Basis(Vector3.RIGHT, -PI / 2.0)  # −Z (light) → −Y (beam)
		sl.shadow_enabled = false
		sl.spot_range = F.CONE_LENGTH * 2.0
		sl.spot_angle_attenuation = 0.35  # a hard-edged spot (gobos read)
		sl.spot_attenuation = 0.0  # no distance falloff: a 12 m throw reads as bright as a 3 m one
		sl.visible = false
		node.add_child(sl)
		out.light = sl
	return out


## One tracking:fixtures payload → axes and beams of every built fixture.
func apply(data: Dictionary) -> void:
	_last = data
	for v in data.get("fixtures", []):
		if not v is Dictionary or not _fx.has(str(v.get("id", ""))):
			continue
		var parts: Dictionary = _fx[str(v.id)]
		var axes: Dictionary = v.get("axes", {}) if v.get("axes") is Dictionary else {}
		for id in parts.axes:
			var a: Array = parts.axes[id]
			(a[0] as Node3D).transform = (a[1] as Transform3D) * Transform3D(F.axis_basis(a[2], float(axes.get(id, 0.0))), Vector3.ZERO)
		var beams: Dictionary = v.get("beams", {}) if v.get("beams") is Dictionary else {}
		for id in parts.beams:
			_light(parts.beams[id], beams.get(id, {}) if beams.get(id) is Dictionary else {})


func _light(p: Dictionary, b: Dictionary) -> void:
	var t := F.tint(b)
	var lit := t.a > 0.004
	(p.lens as StandardMaterial3D).emission = Color(t.r, t.g, t.b)
	(p.lens as StandardMaterial3D).emission_energy_multiplier = t.a * 4.0
	if p.get("body") is GeometryInstance3D:
		var mi := p.body as GeometryInstance3D
		if mi.material_override is StandardMaterial3D:
			(mi.material_override as StandardMaterial3D).emission_enabled = true
			(mi.material_override as StandardMaterial3D).emission = Color(t.r, t.g, t.b) * t.a
	if p.has("cone"):
		(p.cone as MeshInstance3D).visible = lit
		(p.cmat as ShaderMaterial).set_shader_parameter("tint", t)
		var s := F.cone_scale(float(b.get("zoom", 25.0)))
		(p.cone as MeshInstance3D).transform = Transform3D(Basis.from_scale(s), Vector3(0, -s.y * 0.5, 0))
	if p.has("light"):
		var sl := p.light as SpotLight3D
		sl.visible = lit
		sl.light_color = Color(t.r, t.g, t.b)
		sl.light_energy = t.a * 8.0
		sl.spot_angle = clampf(float(b.get("zoom", 25.0)) * 0.5, 0.5, 89.0)
		var gobo := str(b.get("gobo", ""))
		if gobo != str(p.get("gobo", "")):
			p.gobo = gobo
			_project(sl, str(p.type), gobo)


## A gobo wheel slot's image (wheels/<media>.png in the archive) as the spot's projector texture. Lights asking for an
## image still loading wait for it (a whole rig picks the same gobo at once).
func _project(sl: SpotLight3D, type_id: String, gobo: String) -> void:
	var key := "%s|%s" % [type_id, gobo]
	sl.set_meta("gobo", key)
	if gobo == "" or _gobos.has(key):
		_assign(sl, key)
		return
	if _gobo_wait.has(key):
		(_gobo_wait[key] as Array).append(sl)
		return
	_gobo_wait[key] = [sl]
	var path := "wheels/%s.png" % gobo.get_slice("/", 1)
	var b: Dictionary = await Api.get_bytes("/api/fixtures/types/%s/file?path=%s" % [type_id, path.uri_encode()])
	var img := Image.new()
	var tex: Texture2D = null
	if b.ok and img.load_png_from_buffer(b.bytes) == OK:
		img.convert(Image.FORMAT_RGBA8)
		img.generate_mipmaps()
		tex = ImageTexture.create_from_image(img)
	_gobos[key] = tex
	for w in _gobo_wait[key]:
		if is_instance_valid(w):
			_assign(w, key)
	_gobo_wait.erase(key)


func _assign(sl: SpotLight3D, key: String) -> void:
	if str(sl.get_meta("gobo", "")) != key:
		return  # changed gobo while the image loaded
	var was := sl.light_projector != null
	var tex: Texture2D = _gobos.get(key)
	if tex != null and not was and gobo_lights >= F.MAX_GOBOS:
		tex = null
	sl.light_projector = tex
	sl.shadow_enabled = tex != null  # Godot projects through the shadow map: no shadows → a black spot
	gobo_lights += int(tex != null) - int(was)


## World AABB of the fixture bodies (Fit) — not the 12 m beam cones.
func bounds() -> AABB:
	var box := AABB()
	var first := true
	for mi in find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh == _cone or m.mesh is ImmediateMesh or not m.is_visible_in_tree():
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


func _exit_tree() -> void:
	for t in _meshes.values():
		if t != null:
			(t as Node).free()
	_meshes = {}
