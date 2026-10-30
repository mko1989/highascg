extends Node3D
## WO-873 scene "Tunnel": a shader on an inverted cylinder around the camera axis; rings rush toward the camera.
## speed = travel (the shader's clock is integrated here, so a speed change never jumps the phase — the WO-580 lesson),
## amount = spokes (4..24), pulse = brightness and ring width, spin = twist + roll, hue / glow = colour and HDR brightness,
## burst = a bright ring launched down the tunnel.

const LENGTH := 200.0
const RADIUS := 4.0
const NEAR := 94.0  # the stage camera (z 14) in the cylinder's local axis (centre at z −80)

const SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never;
uniform float travel;
uniform float roll;
uniform float twist;
uniform float spokes = 8.0;
uniform float pulse = 0.2;
uniform float hue = 0.55;
uniform float energy = 1.0;
uniform float ring_at = -1000.0;
varying vec3 lp;
varying vec3 wp;
vec3 hsv(float h, float s, float v) {
	vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
	return v * mix(vec3(1.0), k, s);
}
void vertex() {
	lp = VERTEX;
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
	float d = lp.y;
	float a = atan(lp.z, lp.x) / 6.28318 + roll + d * twist * 0.004;
	float band = 1.0 - abs(fract(d * 0.12 - travel) - 0.5) * 2.0;  // 1 at a ring's centre, 0 halfway between rings
	float rings = smoothstep(0.75 - pulse * 0.45, 1.0, band);
	float spoke = pow(0.5 + 0.5 * cos(a * 6.28318 * spokes), 6.0);
	float fog = exp(-distance(wp, CAMERA_POSITION_WORLD) * 0.025);
	float flash = exp(-abs(d - ring_at) * 1.5) * 4.0;
	vec3 c = hsv(fract(hue + d * 0.002), 0.75, 1.0);
	float v = (0.04 + 0.96 * rings) * (0.35 + 0.65 * spoke) * (0.5 + pulse);
	ALBEDO = (c * v * energy + vec3(flash)) * fog;
}
"""

var _mat: ShaderMaterial
var _travel := 0.0
var _roll := 0.0
var _ring := -1000.0


func _init() -> void:  # built up front: the stage may step a scene before it enters the tree
	var cyl := CylinderMesh.new()
	cyl.top_radius = RADIUS
	cyl.bottom_radius = RADIUS
	cyl.height = LENGTH
	cyl.radial_segments = 96
	cyl.rings = 64
	cyl.cap_top = false
	cyl.cap_bottom = false
	var sh := Shader.new()
	sh.code = SHADER
	_mat = ShaderMaterial.new()
	_mat.shader = sh
	cyl.material = _mat
	var mi := MeshInstance3D.new()
	mi.mesh = cyl
	mi.rotation.x = PI / 2  # cylinder axis (local y) along world z; local +y points at the camera
	mi.position = Vector3(0, 0, -80)
	mi.extra_cull_margin = LENGTH
	add_child(mi)


func step(p: Dictionary, delta: float, burst: bool) -> void:
	var speed := float(p.get("speed", 0.3))
	var spin := float(p.get("spin", 0.15))
	_travel += delta * (0.2 + 3.0 * speed)
	_roll += delta * spin * 0.25
	if burst:
		_ring = NEAR
	if _ring > -LENGTH:
		_ring -= delta * (40.0 + 80.0 * speed)
	_mat.set_shader_parameter("travel", _travel)
	_mat.set_shader_parameter("roll", _roll)
	_mat.set_shader_parameter("twist", spin * 30.0)
	_mat.set_shader_parameter("spokes", roundf(4.0 + 20.0 * float(p.get("amount", 0.5))))
	_mat.set_shader_parameter("pulse", float(p.get("pulse", 0.2)))
	_mat.set_shader_parameter("hue", float(p.get("hue", 0.55)))
	_mat.set_shader_parameter("energy", 0.8 + float(p.get("glow", 0.3)) * 3.0)
	_mat.set_shader_parameter("ring_at", _ring)
