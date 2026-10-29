extends RefCounted
## WO-614 T3 — stage builder: one node per object, LED strip geometry per panel column, edit/remove.
## Texture provider injected (no VideoSurfaces / RenderingDevice in headless runs).

const B := preload("res://features/previs/stage_builder.gd")
const S := preload("res://features/previs/stage_objects.gd")
var t


func _builder() -> Node3D:
	return B.new(func(_role: String) -> Texture2D: return null)


func _meshes(n: Node) -> Array:
	return n.find_children("*", "MeshInstance3D", true, false)


func test_builds_each_type() -> void:
	var b := _builder()
	b.set_objects([S.new_object("led_wall"), S.new_object("tv"), S.new_object("projection")])
	t.eq(b.objects.size(), 3, "three objects")
	t.eq(_meshes(b.node_for("led_wall_1")).size(), 2, "LED wall: picture strip + cabinet back")
	t.eq(_meshes(b.node_for("tv_1")).size(), 2, "TV: screen + cabinet")
	t.eq(_meshes(b.node_for("projection_1")).size(), 3, "projection: screen + projector + frustum")
	b.free()


func test_strip_has_quad_per_column_and_uvs_span() -> void:
	var o := S.normalize({"type": "led_wall", "panels": [8, 3], "curve_deg": 6.0})
	var m: ArrayMesh = B._strip(S.column_edges(o), S.size_m(o).y, 0.0)
	var arr := m.surface_get_arrays(0)
	var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var uvs: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
	t.eq(verts.size(), 8 * 6, "two triangles per panel column")
	var umin := 1.0
	var umax := 0.0
	for uv in uvs:
		umin = minf(umin, uv.x)
		umax = maxf(umax, uv.x)
	t.ok(umin == 0.0 and umax == 1.0, "u spans the whole picture")
	var top := 0.0
	for v in verts:
		top = maxf(top, v.y)
	t.ok(absf(top - 1.5) < 1e-5, "height 3 × 0.5 m")


func test_upsert_and_remove() -> void:
	var b := _builder()
	b.set_objects([S.new_object("led_wall")])
	var o: Dictionary = b.objects[0].duplicate(true)
	o["panels"] = [4, 2]
	o["position"] = [3.0, 1.0, 0.0]
	b.upsert(o)
	t.eq(b.objects.size(), 1, "upsert replaces by id")
	t.eq(b.objects[0].panels, [4, 2], "edit applied (normalised)")
	t.eq(b.node_for("led_wall_1").position, Vector3(3, 1, 0), "node moved")
	b.remove("led_wall_1")
	t.eq(b.objects.size(), 0, "removed")
	t.ok(b.node_for("led_wall_1") == null, "node gone")
	b.free()


func test_front_yaw_faces_the_pictures() -> void:
	var b := _builder()
	var w := S.new_object("led_wall")
	b.set_objects([w])
	t.ok(is_equal_approx(b.front_yaw(), -0.35), "rotation 0 → picture faces +Z → the default view")
	w.rotation = [0, 180, 0]
	b.set_objects([w])
	t.ok(is_equal_approx(b.front_yaw(), PI - 0.35), "turned 180° → look from −Z")
	var hidden := S.new_object("tv")
	hidden.rotation = [0, 90, 0]
	hidden.visible = false
	b.set_objects([w, hidden])
	t.ok(is_equal_approx(b.front_yaw(), PI - 0.35), "hidden objects don't count")
	b.set_objects([])
	t.ok(is_equal_approx(b.front_yaw(), -0.35), "empty stage → the default view")
	b.free()


func _visible(n: Node) -> int:
	var c := 0
	for m in _meshes(n):
		if (m as Node3D).visible:
			c += 1
	return c


func test_projector_beams_hide_in_place_and_survive_a_rebuild() -> void:
	var b := _builder()
	b.set_objects([S.new_object("projection")])
	t.eq(_visible(b.node_for("projection_1")), 3, "beams on: screen + projector + frustum")
	b.set_beams(false)
	t.eq(_visible(b.node_for("projection_1")), 2, "beams off in place: only the frustum hidden")
	b.set_objects([S.new_object("projection")])
	t.eq(_visible(b.node_for("projection_1")), 2, "a rebuild keeps the beams off")
	b.set_beams(true)
	t.eq(_visible(b.node_for("projection_1")), 3, "beams back on")
	b.free()
