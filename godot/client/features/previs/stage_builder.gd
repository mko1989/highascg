extends Node3D
## WO-614 T3 — turns stage objects (stage_objects.gd data) into meshes on the previs stage, each showing
## its crop of a live channel surface (VideoSurfaces role → shared Texture2D, one upload per frame
## however many objects use it). Rebuilds one object on edit; re-derives crops when a raster changes size.

const S := preload("res://features/previs/stage_objects.gd")
const LED_SHADER := preload("res://features/previs/led_screen.gdshader")
const Beams := preload("res://features/previs/projector_beams.gd")

var objects: Array = []          # normalised object dicts, in draw order
var _nodes := {}                 # id -> Node3D
var _mats := {}                  # id -> ShaderMaterial
var _rasters := {}               # role -> Vector2i last seen
var _tex_provider: Callable      # role -> Texture2D (VideoSurfaces.texture by default; tests inject)
var _check := 0.0
var live := true                 # WO-617: false = draw without video, hold no surfaces
var _held := {}                  # role -> true (surfaces this builder holds)
var selected_id := ""
var _sel_box: MeshInstance3D
var show_beams := true           # projector beams (projector_beams.gd): the frustum lines of "projection" objects
var _beams := {}                 # id -> the projection's frustum MeshInstance3D


func _init(tex_provider: Callable = Callable()) -> void:
	_tex_provider = tex_provider
	show_beams = Beams.shared().on
	Beams.shared().changed.connect(set_beams)


func set_objects(list: Array) -> void:
	for n in _nodes.values():
		(n as Node).queue_free()
	_nodes.clear()
	_mats.clear()
	_beams.clear()
	objects = []
	for o in list:
		if o is Dictionary:
			objects.append(S.normalize(o))
	for o in objects:
		_build(o)
	sync_holds()


func upsert(o: Dictionary) -> Dictionary:
	var n := S.normalize(o)
	var i := index_of(n.id)
	if i < 0:
		objects.append(n)
	else:
		objects[i] = n
	if _nodes.has(n.id):
		(_nodes[n.id] as Node).queue_free()
	_build(n)
	sync_holds()
	if n.id == selected_id:
		_update_highlight.call_deferred()
	return n


func remove(id: String) -> void:
	var i := index_of(id)
	if i >= 0:
		objects.remove_at(i)
	if _nodes.has(id):
		(_nodes[id] as Node).queue_free()
		_nodes.erase(id)
		_mats.erase(id)
	_beams.erase(id)
	sync_holds()


func index_of(id: String) -> int:
	for i in objects.size():
		if str(objects[i].id) == id:
			return i
	return -1


func node_for(id: String) -> Node3D:
	return _nodes.get(id)


## World-space bounds of everything built (for camera framing).
## Orbit yaw (PrevisStage frame_box) that looks at the side the visible pictures face — an object's picture faces
## +Z at rotation 0 — a little off-axis (the Previs default 0.35 rad). Owner 20.10: Fit shows the pictures, not
## the cabinet backs (their wall is turned 180°).
func front_yaw() -> float:
	var facing := Vector2.ZERO
	for o in objects:
		if o.visible:
			var ry := deg_to_rad(float(o.rotation[1]))
			facing += Vector2(sin(ry), cos(ry))
	return (atan2(facing.x, facing.y) if facing.length() > 0.01 else 0.0) - 0.35


func bounds() -> AABB:
	var box := AABB()
	var first := true
	for n in _nodes.values():
		for mi in (n as Node).find_children("*", "MeshInstance3D", true, false):
			var b: AABB = (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
			box = b if first else box.merge(b)
			first = false
	return box


func set_selected(id: String) -> void:
	selected_id = id
	_update_highlight.call_deferred()


## Nearest object under a screen point of `cam` (ray against each object's mesh boxes); "" = none.
func pick(cam: Camera3D, at: Vector2) -> String:
	var from := cam.project_ray_origin(at)
	var dir := cam.project_ray_normal(at)
	var best := ""
	var best_d := INF
	for id in _nodes:
		for mi in (_nodes[id] as Node).find_children("*", "MeshInstance3D", true, false):
			var box: AABB = (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
			var hit: Variant = box.grow(0.02).intersects_ray(from, dir)
			if hit != null and from.distance_to(hit) < best_d:
				best_d = from.distance_to(hit)
				best = str(id)
	return best


func _update_highlight() -> void:
	if _sel_box != null:
		_sel_box.queue_free()
		_sel_box = null
	var n: Node3D = _nodes.get(selected_id)
	if n == null or not is_inside_tree():
		return
	var box := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var b: AABB = (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
		box = b if first else box.merge(b)
		first = false
	if first:
		return
	box = box.grow(0.05)
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	for e in [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]:
		im.surface_add_vertex(box.get_endpoint(e[0]))
		im.surface_add_vertex(box.get_endpoint(e[1]))
	im.surface_end()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color("#58a6ff")
	_sel_box = _mesh(im, m)
	_sel_box.top_level = true
	add_child(_sel_box)


func _process(delta: float) -> void:
	_check += delta
	if _check < 0.5 or not live:
		return
	_check = 0.0
	for o in objects:
		var role: String = o.source.role
		var r := _raster(role)
		if r != _rasters.get(role, Vector2i.ZERO):
			_rasters[role] = r
			_apply_source_all(role)


func _build(o: Dictionary) -> void:
	var root := Node3D.new()
	root.name = str(o.id)
	root.position = Vector3(o.position[0], o.position[1], o.position[2])
	root.rotation_degrees = Vector3(o.rotation[0], o.rotation[1], o.rotation[2])
	root.visible = o.visible
	add_child(root)
	_nodes[o.id] = root
	_beams.erase(o.id)
	var mat := ShaderMaterial.new()
	mat.shader = LED_SHADER
	_mats[o.id] = mat
	var size := S.size_m(o)
	match str(o.type):
		"led_wall":
			mat.set_shader_parameter("panels", Vector2(o.panels[0], o.panels[1]))
			mat.set_shader_parameter("panel_px", Vector2(o.panel_px[0], o.panel_px[1]))
			mat.set_shader_parameter("seam_px", 1.5)
			mat.set_shader_parameter("pixel_grid", 0.6)
			var edges := S.column_edges(o)
			root.add_child(_mesh(_strip(edges, size.y, 0.0), mat))
			if float(o.depth_m) > 0.0:
				root.add_child(_mesh(_strip(edges, size.y, float(o.depth_m)), _dark()))
		"tv":
			var b := float(o.bezel_mm) / 1000.0
			root.add_child(_mesh(_quad(size, 0.0), mat))
			var cab := _box(Vector3(size.x + 2.0 * b, size.y + 2.0 * b, maxf(0.01, float(o.depth_m))))
			cab.position = Vector3(0, size.y / 2.0, -maxf(0.01, float(o.depth_m)) / 2.0 - 0.002)
			root.add_child(cab)
		"projection":
			mat.set_shader_parameter("energy", float(o.brightness))
			root.add_child(_mesh(_quad(size, 0.0), mat))
			var p := S.projector_offset(o)
			var body := _box(Vector3(0.45, 0.18, 0.4))
			body.position = p
			root.add_child(body)
			var beam := _frustum(p, size)
			beam.visible = show_beams
			_beams[o.id] = beam
			root.add_child(beam)
	_apply_source(o)


## Projector beams: show or hide every projection's beam lines in place; a rebuild keeps the choice.
func set_beams(on: bool) -> void:
	show_beams = on
	for b in _beams.values():
		(b as Node3D).visible = on


func _apply_source_all(role: String) -> void:
	for o in objects:
		if o.source.role == role:
			_apply_source(o)


func _apply_source(o: Dictionary) -> void:
	var mat: ShaderMaterial = _mats.get(o.id)
	if mat == null:
		return
	var tex := _texture(o.source.role)
	mat.set_shader_parameter("video", tex)
	mat.set_shader_parameter("has_video", tex != null and tex.get_width() > 0)
	mat.set_shader_parameter("uv_rect", S.uv_rect(o, _raster(o.source.role)))


func _texture(role: String) -> Texture2D:
	if _tex_provider.is_valid():
		return _tex_provider.call(role)
	if not live:
		return null
	var vs := get_node_or_null("/root/VideoSurfaces")
	return vs.texture(role) if vs != null else null


## WO-617: 3D mode visible → hold exactly the roles the objects use; otherwise hold nothing.
func set_live(on: bool) -> void:
	live = on
	sync_holds()
	for o in objects:
		_apply_source(o)


func sync_holds() -> void:
	var vs := get_node_or_null("/root/VideoSurfaces")
	if vs == null or _tex_provider.is_valid():
		return
	var want := {}
	if live:
		for o in objects:
			want[str(o.source.role)] = true
	for role in _held.keys():
		if not want.has(role):
			vs.release(role, self)
			_held.erase(role)
	for role in want.keys():
		if not _held.has(role):
			vs.acquire(role, self)
			_held[role] = true


func _raster(role: String) -> Vector2i:
	var t := _texture(role)
	return Vector2i(t.get_width(), t.get_height()) if t != null else Vector2i.ZERO


## Vertical strip through the column edges (x, z) from y = 0 to h, pushed back by `back` metres.
## UV (0,0) = top-left; u runs evenly per panel so seams land on panel boundaries.
static func _strip(edges: PackedVector2Array, h: float, back: float) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var cols := edges.size() - 1
	for j in cols:
		var e0 := edges[j]
		var e1 := edges[j + 1]
		var d := (e1 - e0).normalized()
		var n := Vector3(-d.y, 0.0, d.x)
		var o0 := Vector3(e0.x, 0.0, e0.y) - n * back
		var o1 := Vector3(e1.x, 0.0, e1.y) - n * back
		var u0 := float(j) / cols
		var u1 := float(j + 1) / cols
		var quad := [[o0 + Vector3(0, h, 0), Vector2(u0, 0)], [o1 + Vector3(0, h, 0), Vector2(u1, 0)], [o1, Vector2(u1, 1)],
			[o0 + Vector3(0, h, 0), Vector2(u0, 0)], [o1, Vector2(u1, 1)], [o0, Vector2(u0, 1)]]
		for v in quad:
			st.set_normal(n)
			st.set_uv(v[1])
			st.add_vertex(v[0])
	return st.commit()


static func _quad(size: Vector2, back: float) -> ArrayMesh:
	return _strip(PackedVector2Array([Vector2(-size.x / 2.0, 0.0), Vector2(size.x / 2.0, 0.0)]), size.y, back)


static func _mesh(m: Mesh, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = m
	mi.material_override = mat
	return mi


static func _dark() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.03, 0.03, 0.035)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


static func _box(size: Vector3) -> MeshInstance3D:
	var b := BoxMesh.new()
	b.size = size
	return _mesh(b, _dark())


static func _frustum(p: Vector3, size: Vector2) -> MeshInstance3D:
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	for c in [Vector3(-size.x / 2.0, 0, 0), Vector3(size.x / 2.0, 0, 0), Vector3(size.x / 2.0, size.y, 0), Vector3(-size.x / 2.0, size.y, 0)]:
		im.surface_add_vertex(p)
		im.surface_add_vertex(c)
	im.surface_end()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(0.9, 0.9, 1.0, 0.35)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return _mesh(im, m)
