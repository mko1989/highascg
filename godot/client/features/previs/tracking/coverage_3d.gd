extends Node3D
## WO-616 T10c — the tracking cameras on the 3D stage (two-camera workflow step 1, placement): each camera's frustum
## to its floor hits (lens-correct corners) with its floor footprint outline, and the tracking grid tinted per cell
## by who sees a person standing there (coverage_model.gd: feet and head in the picture) — one camera in its colour,
## two or more in green. `summary` is the one-line verdict previs_tab shows under the 3D view.

const V := preload("res://features/previs/tracking/coverage_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")

const CAM_COLORS := ["#4fc3ff", "#ffb74d", "#ce93d8", "#fff176", "#f48fb1", "#80cbc4"]
const OVERLAP := Color(0.3, 0.9, 0.45, 0.45)
const SINGLE_ALPHA := 0.22
const LIFT := 0.04  # metres above the floor plane for lines (less z-fights with it from across the stage)

var summary := ""
var box := AABB()  # cameras + grid (Godot frame), for Fit
var _key := ""


## data = tracking_model.normalize(...) — rebuilt only when cameras or grid change.
func set_tracking(data: Dictionary) -> void:
	var cams: Array = data.cameras
	var key := JSON.stringify([cams.map(func(c: Dictionary) -> Array: return [c.id, c.name, c.raster, c.cam]), data.grid])
	if key == _key:
		return
	_key = key
	for n in get_children():
		n.queue_free()
	var g: Dictionary = data.grid
	add_child(_outline(g))
	box = AABB(C.psn_to_godot([g.x_offset - g.width / 2.0, g.y_offset + g.depth / 2.0, g.z_offset]), Vector3(g.width, 0.01, g.depth))
	if cams.is_empty():
		summary = "No tracking cameras — add one in the Camera view."
		return
	var cov := V.coverage(cams, g)
	add_child(_cells(cov))
	var lines := ImmediateMesh.new()
	lines.surface_begin(Mesh.PRIMITIVE_LINES)
	for i in cams.size():
		var ce: Dictionary = cams[i]
		var col := color(i)
		var apex := C.psn_to_godot([ce.cam.pos_x, ce.cam.pos_y, ce.cam.pos_z])
		box = box.expand(apex)
		var ends: Array = V.frustum(ce, g.z_offset + LIFT)
		for k in 4:
			_seg(lines, col, apex, C.psn_to_godot(ends[k]))
			_seg(lines, col, C.psn_to_godot(ends[k]), C.psn_to_godot(ends[(k + 1) % 4]))
		for pl in V.footprint(ce, g.z_offset + LIFT):
			for k in (pl as Array).size() - 1:
				_seg(lines, col, C.psn_to_godot(pl[k]), C.psn_to_godot(pl[k + 1]))
		var tag := Label3D.new()
		tag.text = str(ce.name)
		tag.modulate = col
		tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		tag.no_depth_test = true
		tag.pixel_size = 0.02
		tag.position = apex + Vector3(0, 0.35, 0)
		add_child(tag)
	lines.surface_end()
	add_child(_instance(lines, _material(false)))
	summary = text(cov, V.pairs(cams, g), g, cams.size())


static func color(i: int) -> Color:
	return Color(CAM_COLORS[i % CAM_COLORS.size()])


## "Grid 10 × 6 m — a standing person is seen by 2+ cameras on 45 %, by one on 40 %, by none on 15 % · Camera 1 ↔
## Camera 2 87° apart". A pair under ADVISED_DEG gets the advice.
static func text(cov: Dictionary, prs: Array, g: Dictionary, n: int) -> String:
	var tot: float = maxf(cov.total, 1e-9)
	var two := roundi(100.0 * cov.two / tot)
	var any := roundi(100.0 * (cov.one + cov.two) / tot)  # cumulative rounding: the three always sum to 100
	var s := "Grid %s × %s m — a standing person is seen by " % [_m(g.width), _m(g.depth)]
	if n >= 2:
		s += "2+ cameras on %d %%, " % two
	s += "one camera on %d %%, none on %d %%" % [any - two, 100 - any]
	for p in prs:
		s += " · %s ↔ %s %d° apart" % [p.a, p.b, roundi(p.deg)]
		if p.deg < V.ADVISED_DEG:
			s += " (%d°+ advised for fusion)" % roundi(V.ADVISED_DEG)
	if n == 1:
		s += " · add a second camera for fused tracking"
	return s


static func _m(v: float) -> String:
	return str(snappedf(v, 0.1)).trim_suffix(".0")


func _cells(cov: Dictionary) -> MeshInstance3D:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var z: float = cov.z + LIFT * 0.25
	for j in int(cov.ny):
		for i in int(cov.nx):
			var m: int = cov.masks[j * int(cov.nx) + i]
			if m == 0:
				continue
			var col := OVERLAP
			if m & (m - 1) == 0:  # one bit: one camera
				col = color(_bit(m))
				col.a = SINGLE_ALPHA
			var x0: float = cov.x0 + i * cov.cx
			var y0: float = cov.y0 + j * cov.cy
			var q := [C.psn_to_godot([x0, y0, z]), C.psn_to_godot([x0 + cov.cx, y0, z]),
				C.psn_to_godot([x0 + cov.cx, y0 + cov.cy, z]), C.psn_to_godot([x0, y0 + cov.cy, z])]
			for k in [0, 1, 2, 0, 2, 3]:
				st.set_color(col)
				st.add_vertex(q[k])
	var mi := _instance(st.commit(), _material(true))
	return mi


func _outline(g: Dictionary) -> MeshInstance3D:
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	var hw: float = g.width / 2.0
	var z: float = g.z_offset + LIFT
	var c := [[g.x_offset - hw, g.y_offset - g.depth / 2.0], [g.x_offset + hw, g.y_offset - g.depth / 2.0],
		[g.x_offset + hw, g.y_offset + g.depth / 2.0], [g.x_offset - hw, g.y_offset + g.depth / 2.0]]
	for k in 4:
		_seg(im, Color(1, 1, 1, 0.5), C.psn_to_godot([c[k][0], c[k][1], z]), C.psn_to_godot([c[(k + 1) % 4][0], c[(k + 1) % 4][1], z]))
	im.surface_end()
	return _instance(im, _material(true))


static func _seg(im: ImmediateMesh, col: Color, a: Vector3, b: Vector3) -> void:
	im.surface_set_color(col)
	im.surface_add_vertex(a)
	im.surface_set_color(col)
	im.surface_add_vertex(b)


static func _bit(m: int) -> int:
	var i := 0
	while m > 1:
		m >>= 1
		i += 1
	return i


static func _instance(mesh: Mesh, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


static func _material(alpha: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	if alpha:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m
