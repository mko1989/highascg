extends Node3D
## WO-874 scene "Shader": a library shader (the box's Shadertoy library, GET /api/shaders — the same code Caspar's HTML
## templates run, WO-266/586) rendered by shadertoy_rd.gd at the canvas size and shown on a quad that fills the stage camera.
## As the main scene it is the backdrop (far, opaque); as layer 2 it is added over the other scene (near, additive).
## speed = the shader's clock (0.3 = real time; integrated, so changes never jump — WO-580), pulse / glow = gain, amount =
## opacity, burst = a flash plus a short time surge. hue and spin are not used: a shader keeps its own palette (rotating it
## by the hue parameter recoloured every shader — the graph's valence sits at 0.5 even in silence, WO-874 §1).

const Runner := preload("res://features/visuals/shadertoy_rd.gd")
const CAM_Z := 14.0  # the stage camera (visuals_stage.gd): at z 14, looking down −z, fov 60
const FOV := 60.0
const FAR := 300.0  # behind every other scene (the tunnel ends 194 away)
const NEAR := 2.0
const SRC := """
shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, shadows_disabled%s;
uniform sampler2D tex : filter_linear, repeat_disable;
uniform float gain = 1.0;
uniform float flash;
uniform float opacity = 1.0;
void fragment() {
	vec3 c = max(texture(tex, vec2(UV.x, 1.0 - UV.y)).rgb, 0.0);  // Shadertoy rows run bottom-up
	c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));  // the shader wrote sRGB; the stage is linear
	ALBEDO = (c * gain + flash) * opacity;
}
"""

var runner := Runner.new()
var overlay := false
var _quad: MeshInstance3D
var _mat: ShaderMaterial
var _audio := PackedByteArray()
var _time := 0.0
var _kick := 0.0


func _init() -> void:  # built up front: the stage may step a scene before it enters the tree
	_mat = ShaderMaterial.new()
	_quad = MeshInstance3D.new()
	_quad.mesh = QuadMesh.new()
	_quad.material_override = _mat
	_quad.extra_cull_margin = 16384.0
	add_child(_quad)
	set_overlay(false)
	_audio.resize(Runner.AUDIO_W * 2)
	set_audio(PackedByteArray())


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		runner.release()


## Backdrop (main) or additive layer over the other scene (layer 2).
func set_overlay(on: bool) -> void:
	overlay = on
	var sh := Shader.new()
	sh.code = SRC % (", blend_add, depth_draw_never, depth_test_disabled" if on else "")
	_mat.shader = sh
	_mat.render_priority = 10 if on else 0
	_mat.set_shader_parameter("tex", runner.texture)
	_quad.position.z = CAM_Z - (NEAR if on else FAR)


## A shader config (GET /api/shaders/:id); "" or the compile error.
func set_shader(cfg: Variant) -> String:
	var e := runner.use(cfg)
	_time = 0.0
	return e


## 1024 bytes: the FFT row then the wave row (empty = silence).
func set_audio(bytes: PackedByteArray) -> void:
	if bytes.size() == _audio.size():
		_audio = bytes
		return
	_audio.fill(0)
	for i in Runner.AUDIO_W:
		_audio[Runner.AUDIO_W + i] = 128


func step(p: Dictionary, delta: float, burst: bool) -> void:
	if burst:
		_kick = 1.0
	_kick = maxf(0.0, _kick - delta * 4.0)
	_time += delta * (float(p.get("speed", 0.3)) / 0.3 + 3.0 * _kick)
	var size := Vector2i(1280, 720)
	if is_inside_tree():
		size = get_viewport().size
	var dist := absf(CAM_Z - _quad.position.z)
	var h := 2.0 * dist * tan(deg_to_rad(FOV * 0.5))
	_quad.scale = Vector3(h * size.x / maxf(1.0, size.y), h, 1.0)
	# 1 at the defaults, at most ~1.7: shaders are already graded, a bright sky clips white well before 2×
	_mat.set_shader_parameter("gain", 1.0 + 0.5 * (float(p.get("glow", 0.3)) - 0.3) + 0.4 * (float(p.get("pulse", 0.2)) - 0.2))
	_mat.set_shader_parameter("flash", _kick * 0.5)
	_mat.set_shader_parameter("opacity", clampf(float(p.get("amount", 0.5)) * 2.0, 0.0, 1.0))
	if is_inside_tree():
		runner.render(size, _time, delta, _audio)
