extends Node3D
## WO-873 scene "Starfield": stars stream out of the distance past the camera (GPUParticles3D).
## speed = warp, amount = how many stars, pulse = star size, spin = the field rolls, hue / glow = tint and brightness,
## burst = a hyperspace kick (warp ×4, decaying over ~1 s).

const Particles := preload("res://features/visuals/scenes/particles.gd")
const MAX := 12000
const DEPTH := 90.0  # emission plane this far in front of the camera (the stage camera sits at z 14)

var _stars: GPUParticles3D
var _mat: ParticleProcessMaterial
var _draw: StandardMaterial3D
var _warp := 0.0


func _init() -> void:  # built up front: the stage may step a scene before it enters the tree
	_draw = Particles.dot_material()
	_mat = ParticleProcessMaterial.new()
	_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	_mat.emission_box_extents = Vector3(30, 18, 12)
	_mat.direction = Vector3(0, 0, 1)
	_mat.spread = 0.0
	_mat.gravity = Vector3.ZERO
	_mat.initial_velocity_min = 28.0
	_mat.initial_velocity_max = 34.0
	var grow := Curve.new()  # stars fade in out of the distance instead of popping
	grow.add_point(Vector2(0.0, 0.0))
	grow.add_point(Vector2(0.12, 1.0))
	grow.add_point(Vector2(1.0, 1.0))
	var grow_tex := CurveTexture.new()
	grow_tex.curve = grow
	_mat.scale_curve = grow_tex
	_stars = Particles.emitter(MAX, _mat, _draw, 8.0)
	_stars.position = Vector3(0, 0, 14.0 - DEPTH)
	_stars.visibility_aabb = AABB(Vector3(-40, -30, -20), Vector3(80, 60, DEPTH + 30))
	_stars.preprocess = 8.0  # the field is full from the first frame
	add_child(_stars)


func step(p: Dictionary, delta: float, burst: bool) -> void:
	if burst:
		_warp = 3.0
	_warp = maxf(0.0, _warp - delta * 3.0)
	var pulse := float(p.get("pulse", 0.2))
	var glow := float(p.get("glow", 0.3))
	_stars.amount_ratio = clampf(float(p.get("amount", 0.5)), 0.05, 1.0)
	_stars.speed_scale = (0.15 + 1.6 * float(p.get("speed", 0.3))) * (1.0 + _warp)
	rotation.z += delta * 1.2 * float(p.get("spin", 0.15))
	_mat.scale_min = 0.5 + pulse * 1.5
	_mat.scale_max = 1.0 + pulse * 3.0
	_mat.color = Color.from_hsv(float(p.get("hue", 0.55)), 0.25, 1.0)
	var e := 0.8 + glow * 2.0 + _warp
	_draw.albedo_color = Color(e, e, e, 1.0)
