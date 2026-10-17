extends Node3D
## WO-607 T3/T4/T6 — the 3D stage: environment, runtime glTF model (bytes from /api/previs/models/:id),
## "screen" meshes carrying the live channel texture (emissive LED material), orbit camera + presets.
## Screen tagging: name heuristic (*screen*/*led*) until WO-607 T1 moves the web client's tags
## (browser localStorage today) to the server; manual toggles are kept per loaded model for now.

signal model_loaded(meshes: Array)

const PRESETS := {"Front": Vector3(0.0, 0.12, 12.0), "Top": Vector3(0.0, 1.45, 14.0), "ISO": Vector3(-0.75, 0.45, 13.0)}

var live_texture: Texture2D
var screens := {}  # MeshInstance3D -> true
var _model: Node3D
var _cam: Camera3D
var _yaw := -0.35
var _pitch := 0.18
var _dist := 12.0
var _target := Vector3(0, 2.2, 0)
var _orbiting := false
var _idle := 0.0
var _fly_tween: Tween


func _ready() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.02, 0.02, 0.03)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.25, 0.25, 0.3)
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR  # keep LED colours true (filmic washed them out, WO-595)
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	sun.light_energy = 0.6
	add_child(sun)
	var floor_mi := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(40, 40)
	floor_mi.mesh = plane
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.11, 0.11, 0.13)
	floor_mi.material_override = fm
	add_child(floor_mi)
	_cam = Camera3D.new()
	_cam.fov = 50
	add_child(_cam)
	_cam.current = true
	_update_camera()


func load_glb_bytes(bytes: PackedByteArray) -> bool:
	if _model != null:
		_model.queue_free()
		_model = null
	screens.clear()
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_buffer(bytes, "", state) != OK:
		return false
	_model = doc.generate_scene(state)
	if _model == null:
		return false
	add_child(_model)
	var meshes: Array = []
	_collect(_model, meshes)
	for mi in meshes:
		var n: String = (mi as MeshInstance3D).name.to_lower()
		if n.contains("screen") or n.contains("led"):
			set_screen(mi, true)
	_frame_model(meshes)
	model_loaded.emit(meshes)
	return true


func set_screen(mi: MeshInstance3D, on: bool) -> void:
	if on:
		screens[mi] = true
		mi.material_override = led_material(live_texture)
	else:
		screens.erase(mi)
		mi.material_override = null


func set_live_texture(tex: Texture2D) -> void:
	live_texture = tex
	for mi in screens.keys():
		(mi as MeshInstance3D).material_override = led_material(tex)


func fly_to_preset(name: String) -> void:
	var p: Vector3 = PRESETS.get(name, PRESETS["Front"])
	if _fly_tween != null:
		_fly_tween.kill()
	_fly_tween = create_tween().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_fly_tween.tween_method(func(v: Vector3) -> void:
		_yaw = v.x
		_pitch = v.y
		_dist = v.z
		_update_camera(), Vector3(_yaw, _pitch, _dist), p, 0.5)  # 500 ms, as WO-17 T4.1


static func led_material(tex: Texture2D) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color.BLACK
	m.emission_enabled = true
	m.emission_texture = tex
	m.emission_energy_multiplier = 1.0
	m.roughness = 0.5
	return m


func _process(delta: float) -> void:
	if not _orbiting:
		_idle += delta
		if _idle > 4.0:
			_yaw += delta * 0.1
			_update_camera()


func handle_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb != null:
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_orbiting = mb.pressed
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_dist = maxf(2.0, _dist * 0.9)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_dist = minf(80.0, _dist * 1.1)
		_idle = 0.0
		_update_camera()
	var mm := event as InputEventMouseMotion
	if mm != null and _orbiting:
		_yaw -= mm.relative.x * 0.005
		_pitch = clampf(_pitch + mm.relative.y * 0.005, -0.2, 1.5)
		_idle = 0.0
		_update_camera()


func _update_camera() -> void:
	if _cam == null:
		return
	var off := Vector3(sin(_yaw) * cos(_pitch), sin(_pitch), cos(_yaw) * cos(_pitch)) * _dist
	_cam.position = _target + off
	_cam.look_at(_target, Vector3.UP)


## Aim the orbit camera at a world box (stage builder objects, WO-614).
func frame_box(box: AABB) -> void:
	if box.size == Vector3.ZERO:
		return
	_target = box.get_center()
	_dist = maxf(4.0, box.get_longest_axis_size() * 1.4)
	_update_camera()


func _frame_model(meshes: Array) -> void:
	if meshes.is_empty():
		return
	var box := AABB()
	var first := true
	for mi in meshes:
		var b: AABB = (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
		box = b if first else box.merge(b)
		first = false
	_target = box.get_center()
	_dist = maxf(4.0, box.get_longest_axis_size() * 1.4)
	_update_camera()


func _collect(node: Node, out: Array) -> void:
	if node is MeshInstance3D:
		out.append(node)
	for c in node.get_children():
		_collect(c, out)
