extends Node3D
## WO-595 Scene C "previs": the live shm texture on an LED wall in 3D (WO-607 preview).
## --model=<file.glb|.gltf>: runtime glTF import (GLTFDocument); meshes named *screen*/*led* (else the
## largest mesh) get the live material. Without a model: a procedural stage with a main wall and a
## side screen that samples one quadrant (UV scale) — two meshes, one upload per frame.
## Mouse drag orbits, wheel zooms; the camera auto-orbits when idle.

var _tex: Texture2D
var _cam: Camera3D
var _yaw := -0.35
var _pitch := 0.18
var _dist := 11.0
var _idle := 0.0
var _orbiting := false
var _status: Label


func setup(tex: Texture2D, model_path: String) -> void:
	_tex = tex
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.02, 0.02, 0.03)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.25, 0.25, 0.3)
	env.glow_enabled = true
	env.glow_intensity = 0.8
	env.glow_bloom = 0.15
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	sun.light_energy = 0.6
	add_child(sun)

	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(30, 30)
	floor_mesh.mesh = plane
	var floor_mat := StandardMaterial3D.new()
	floor_mat.albedo_color = Color(0.12, 0.12, 0.14)
	floor_mat.roughness = 0.35
	floor_mesh.material_override = floor_mat
	add_child(floor_mesh)

	var loaded := false
	if model_path != "":
		loaded = _load_model(model_path)
	if not loaded:
		_build_procedural_stage()

	_cam = Camera3D.new()
	_cam.fov = 50
	add_child(_cam)
	_cam.current = true
	_update_camera()

	var layer := CanvasLayer.new()
	add_child(layer)
	_status = Label.new()
	_status.anchor_top = 1.0
	_status.anchor_bottom = 1.0
	_status.position = Vector2(16, -40)
	_status.text = ("model: %s" % model_path) if loaded else "procedural stage (pass --model=<file.glb> for a real one)"
	layer.add_child(_status)


func tick(delta: float, reader) -> void:
	if not _orbiting:
		_idle += delta
		if _idle > 2.0:
			_yaw += delta * 0.15
			_update_camera()


func _unhandled_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb != null:
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_orbiting = mb.pressed
			_idle = 0.0
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_dist = max(3.0, _dist * 0.9)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_dist = min(40.0, _dist * 1.1)
		_update_camera()
	var mm := event as InputEventMouseMotion
	if mm != null and _orbiting:
		_yaw -= mm.relative.x * 0.005
		_pitch = clamp(_pitch + mm.relative.y * 0.005, -0.2, 1.3)
		_idle = 0.0
		_update_camera()


func _update_camera() -> void:
	if _cam == null:
		return
	var target := Vector3(0, 2.2, 0)
	var offset := Vector3(sin(_yaw) * cos(_pitch), sin(_pitch), cos(_yaw) * cos(_pitch)) * _dist
	_cam.position = target + offset
	_cam.look_at(target, Vector3.UP)


func _led_material(tex: Texture2D) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0, 0, 0)
	m.emission_enabled = true
	m.emission_texture = tex
	m.emission_energy_multiplier = 1.4
	m.roughness = 0.6
	return m


func _build_procedural_stage() -> void:
	var frame := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(6.8, 4.0, 0.3)
	frame.mesh = box
	frame.position = Vector3(0, 2.2, -0.2)
	var frame_mat := StandardMaterial3D.new()
	frame_mat.albedo_color = Color(0.06, 0.06, 0.07)
	frame.material_override = frame_mat
	add_child(frame)

	var wall := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(6.4, 3.6)
	wall.mesh = quad
	wall.position = Vector3(0, 2.2, -0.04)
	wall.material_override = _led_material(_tex)
	add_child(wall)

	var side := MeshInstance3D.new()
	var side_quad := QuadMesh.new()
	side_quad.size = Vector2(2.4, 1.35)
	side.mesh = side_quad
	side.position = Vector3(5.2, 1.6, 1.2)
	side.rotation_degrees = Vector3(0, -35, 0)
	# AtlasTexture regions are ignored by 3D materials → sample the top-left quadrant via UV scale.
	var side_mat := _led_material(_tex)
	side_mat.uv1_scale = Vector3(0.5, 0.5, 1.0)
	side.material_override = side_mat
	add_child(side)


func _load_model(path: String) -> bool:
	var doc: GLTFDocument = GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(path, state) != OK:
		push_warning("[m0] glTF load failed: " + path)
		return false
	var scene := doc.generate_scene(state)
	if scene == null:
		return false
	add_child(scene)
	var meshes: Array[MeshInstance3D] = []
	_collect_meshes(scene, meshes)
	var tagged: Array[MeshInstance3D] = []
	for mi in meshes:
		var n := mi.name.to_lower()
		if n.contains("screen") or n.contains("led"):
			tagged.append(mi)
	if tagged.is_empty() and not meshes.is_empty():
		var best := meshes[0]
		for mi in meshes:
			if mi.get_aabb().get_volume() + mi.get_aabb().get_longest_axis_size() > best.get_aabb().get_volume() + best.get_aabb().get_longest_axis_size():
				best = mi
		tagged.append(best)
	for mi in tagged:
		mi.material_override = _led_material(_tex)
	print("[m0] glTF %s: %d meshes, %d tagged as screens" % [path, meshes.size(), tagged.size()])
	return true


func _collect_meshes(node: Node, out: Array[MeshInstance3D]) -> void:
	var mi := node as MeshInstance3D
	if mi != null:
		out.append(mi)
	for c in node.get_children():
		_collect_meshes(c, out)
