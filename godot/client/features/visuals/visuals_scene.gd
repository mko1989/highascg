extends Node3D
## WO-863 — the built-in visual: three rings of emissive bars around the camera axis. Parameters 0..1 (visuals_model.gd PARAMS):
## pulse = bar length, spin = rotation speed, hue = colour, glow = emission + bloom, flash = background flash. The scene owns its
## camera, light-free emissive look and WorldEnvironment, so the same World3D also shows in the 3D view's orbit camera.

const RINGS := [[24, 3.0], [36, 5.0], [48, 7.5]]  # [bars, radius]
const SPIN_MAX := 1.6  # rad/s at spin 1

var params := {}
var camera: Camera3D
var _mm: Array[MultiMeshInstance3D] = []
var _mat: StandardMaterial3D
var _env: Environment
var _angle := 0.0
var _t := 0.0


func _ready() -> void:
	_mat = StandardMaterial3D.new()
	_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat.emission_enabled = true
	var bar := BoxMesh.new()
	bar.size = Vector3(0.18, 1.0, 0.18)
	bar.material = _mat
	for r in RINGS:
		var mmi := MultiMeshInstance3D.new()
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = bar
		mm.instance_count = r[0]
		mmi.multimesh = mm
		add_child(mmi)
		_mm.append(mmi)
	camera = Camera3D.new()
	camera.position = Vector3(0, 0, 14)
	camera.fov = 60
	add_child(camera)
	var we := WorldEnvironment.new()
	_env = Environment.new()
	_env.background_mode = Environment.BG_COLOR
	_env.glow_enabled = true
	_env.glow_hdr_threshold = 0.9  # only the bars bloom, never the background
	_env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	we.environment = _env
	add_child(we)
	_draw_frame(0.0)


func _process(delta: float) -> void:
	_draw_frame(delta)


func _draw_frame(delta: float) -> void:
	var p := params
	var pulse := float(p.get("pulse", 0.2))
	var hue := float(p.get("hue", 0.55))
	var glow := float(p.get("glow", 0.3))
	var flash := float(p.get("flash", 0.0))
	_t += delta
	_angle += delta * SPIN_MAX * float(p.get("spin", 0.15))
	for i in _mm.size():
		var mm := _mm[i].multimesh
		var n: int = RINGS[i][0]
		var radius: float = RINGS[i][1]
		var dir := 1.0 if i % 2 == 0 else -1.0
		for k in n:
			var a := TAU * k / n + _angle * dir * (1.0 + i * 0.35)
			var wave := 0.5 + 0.5 * sin(_t * 2.0 + k * 0.7 + i)
			var length := 0.4 + pulse * (2.5 + i) * (0.6 + 0.4 * wave)
			var basis := Basis(Vector3.FORWARD, a).scaled(Vector3(1, length, 1))
			mm.set_instance_transform(k, Transform3D(basis, Vector3(cos(a + PI / 2), sin(a + PI / 2), -i * 1.5) * radius))
	var c := Color.from_hsv(hue, 0.75, 1.0)
	_mat.albedo_color = c
	_mat.emission = c
	_mat.emission_energy_multiplier = 0.5 + glow * 3.0
	_env.glow_intensity = 0.4 + glow * 1.6
	_env.background_color = Color.from_hsv(fposmod(hue + 0.5, 1.0), 0.6, 0.02 + flash * 0.25)
