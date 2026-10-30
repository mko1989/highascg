extends Node3D
## WO-873 scene "Particles": a GPU particle cloud (GPUParticles3D, turbulence) and a one-shot burst emitter.
## amount = density (amount_ratio of MAX), pulse = particle size and outward speed, spin = the cloud swirls, speed = simulation
## rate, hue / glow = colour and HDR brightness (the stage's bloom picks it up), burst = an explosion of BURST particles.

const MAX := 40000
const BURST := 6000

var _cloud: GPUParticles3D
var _burst: GPUParticles3D
var _cloud_mat: ParticleProcessMaterial
var _burst_mat: ParticleProcessMaterial
var _draw: StandardMaterial3D


## Soft additive dots: a radial-gradient sprite, billboarded, coloured per particle (COLOR), HDR via albedo > 1.
static func dot_material() -> StandardMaterial3D:
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	tex.width = 64
	tex.height = 64
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = tex
	return m


static func emitter(amount: int, mat: ParticleProcessMaterial, draw: Material, lifetime: float) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = lifetime
	p.process_material = mat
	p.visibility_aabb = AABB(Vector3(-40, -40, -40), Vector3(80, 80, 80))
	var q := QuadMesh.new()
	q.size = Vector2(0.07, 0.07)
	q.material = draw
	p.draw_pass_1 = q
	return p


func _init() -> void:  # built up front: the stage may step a scene before it enters the tree
	_draw = dot_material()
	_cloud_mat = ParticleProcessMaterial.new()
	_cloud_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	_cloud_mat.emission_sphere_radius = 2.5
	_cloud_mat.direction = Vector3(0, 0, 1)
	_cloud_mat.spread = 180.0
	_cloud_mat.gravity = Vector3.ZERO
	_cloud_mat.damping_min = 0.1
	_cloud_mat.damping_max = 0.4
	_cloud_mat.turbulence_enabled = true
	_cloud_mat.turbulence_noise_scale = 4.0
	_cloud_mat.turbulence_noise_speed_random = 0.4
	_cloud_mat.hue_variation_min = -0.04
	_cloud_mat.hue_variation_max = 0.04
	var fade := Curve.new()  # grow in, shrink out
	fade.add_point(Vector2(0.0, 0.0))
	fade.add_point(Vector2(0.15, 1.0))
	fade.add_point(Vector2(1.0, 0.0))
	var fade_tex := CurveTexture.new()
	fade_tex.curve = fade
	_cloud_mat.scale_curve = fade_tex
	_cloud = emitter(MAX, _cloud_mat, _draw, 5.0)
	_cloud.local_coords = true  # spin turns the whole cloud: a swirl
	add_child(_cloud)

	_burst_mat = ParticleProcessMaterial.new()
	_burst_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	_burst_mat.emission_sphere_radius = 0.3
	_burst_mat.direction = Vector3(0, 0, 1)
	_burst_mat.spread = 180.0
	_burst_mat.gravity = Vector3.ZERO
	_burst_mat.initial_velocity_min = 10.0
	_burst_mat.initial_velocity_max = 24.0
	_burst_mat.damping_min = 3.0
	_burst_mat.damping_max = 6.0
	_burst_mat.scale_curve = fade_tex
	_burst = emitter(BURST, _burst_mat, _draw, 1.6)
	_burst.one_shot = true
	_burst.explosiveness = 1.0
	_burst.emitting = false
	add_child(_burst)


func step(p: Dictionary, delta: float, burst: bool) -> void:
	var pulse := float(p.get("pulse", 0.2))
	var hue := float(p.get("hue", 0.55))
	var glow := float(p.get("glow", 0.3))
	_cloud.amount_ratio = clampf(float(p.get("amount", 0.5)), 0.02, 1.0)
	_cloud.speed_scale = 0.2 + 2.0 * float(p.get("speed", 0.3))
	_cloud.rotation.z += delta * 1.6 * float(p.get("spin", 0.15))
	_cloud_mat.initial_velocity_min = 1.0 + pulse * 3.0
	_cloud_mat.initial_velocity_max = 2.5 + pulse * 8.0
	_cloud_mat.scale_min = 0.6 + pulse * 1.5
	_cloud_mat.scale_max = 1.2 + pulse * 3.0
	_cloud_mat.turbulence_noise_strength = 1.5 + pulse * 3.0
	_cloud_mat.color = Color.from_hsv(hue, 0.7, 1.0)
	_burst_mat.color = Color.from_hsv(fposmod(hue + 0.08, 1.0), 0.35, 1.0)
	_burst_mat.scale_min = 1.0 + pulse
	_burst_mat.scale_max = 2.5 + pulse * 2.0
	var e := 0.35 + glow * 1.2  # additive: thousands of dots overlap at the core, so each one stays dim
	_draw.albedo_color = Color(e, e, e, 1.0)
	if burst:
		_burst.restart()
