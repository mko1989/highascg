extends Node3D
## WO-876 scene "Game": the operator's game (WO-745's window, opened by game_launcher.gd, publishing shm ring
## `visuals-game`) as a screen in the Visuals world, with effects. The game itself plays in its own window on the operator's
## monitor (keyboard / gamepad, sound); this only reads its pictures, so a crashing core never reaches the GUI.
## speed = CRT (scanlines on the game's own lines, curvature, vignette), pulse = zoom, spin = the screen floats and tilts,
## amount = opacity, glow = brightness (whites bloom), burst = a glitch (row jitter + colour split); the bass splits the
## colours a little all the time. hue is not used: a game keeps its palette. As layer 2 black is keyed out, so the sprites
## float over the main scene. No game running = nothing drawn.

const ShmNative := preload("res://video/shm_native.gd")
const ShmReader := preload("res://video/shm_reader.gd")
const ShmTexture := preload("res://video/shm_texture.gd")
const Launcher := preload("res://features/visuals/game_launcher.gd")
const CAM_Z := 14.0  # the stage camera (visuals_stage.gd): z 14 looking down −z, fov 60
const FOV := 60.0
const DIST := 20.0
const CONSOLE_LINES := [240, 239, 224, 192, 160, 144]
const SRC := """
shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, shadows_disabled%s;
uniform sampler2D tex : filter_nearest, repeat_disable;
uniform float lines = 240.0;
uniform float crt = 0.3;
uniform float glitch = 0.0;
uniform float split = 0.0;
uniform float gain = 1.0;
uniform float opacity = 1.0;
uniform float t = 0.0;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void fragment() {
	vec2 c = UV * 2.0 - 1.0;
	c *= 1.0 + crt * 0.07 * dot(c.yx, c.yx);  // barrel
	vec2 uv = c * 0.5 + 0.5;
	float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
	uv.x += glitch * (hash(floor(uv.y * 48.0) + floor(t * 24.0)) - 0.5) * 0.12;
	float s = split + glitch * 0.02;
	vec3 col = vec3(texture(tex, uv + vec2(s, 0.0)).r, texture(tex, uv).g, texture(tex, uv - vec2(s, 0.0)).b);
	col *= 1.0 - crt * 0.45 * (0.5 - 0.5 * cos(uv.y * lines * 6.2831853));  // a dark line between the game's lines
	col *= 1.0 - crt * 0.6 * dot(c * 0.5, c * 0.5);  // vignette
	col = mix(col / 12.92, pow((col + 0.055) / 1.055, vec3(2.4)), step(0.04045, col));  // sRGB game → linear stage
	ALBEDO = col * gain * inside * %s;
	%s
}
"""

var overlay := false
var _quad: MeshInstance3D
var _mat: ShaderMaterial
var _reader: Variant  # ShmNative or ShmReader (same interface)
var _native := false
var _tex := ShmTexture.new()
var _live := false
var _t := 0.0
var _kick := 0.0
var _bass := 0.0


func _init() -> void:  # built up front: the stage may step a scene before it enters the tree
	_mat = ShaderMaterial.new()
	_quad = MeshInstance3D.new()
	_quad.mesh = QuadMesh.new()
	_quad.material_override = _mat
	_quad.visible = false
	add_child(_quad)
	set_overlay(false)
	var path := "/dev/shm/highascg-" + Launcher.RING
	_native = ShmNative.available()
	_reader = ShmNative.new(path) if _native else ShmReader.new(path)


## Backdrop (main, opaque) or layer 2 (black keyed out, drawn over the main scene).
func set_overlay(on: bool) -> void:
	overlay = on
	var sh := Shader.new()
	if on:
		sh.code = SRC % [", blend_mix, depth_draw_never", "1.0",
			"ALPHA = opacity * smoothstep(0.015, 0.06, max(col.r, max(col.g, col.b)));"]
	else:
		sh.code = SRC % ["", "opacity", ""]
	_mat.shader = sh
	_mat.render_priority = 10 if on else 0
	_mat.set_shader_parameter("tex", _tex.texture)


## The stage's audio (smoothed FFT row first): the bass (≈ 50–280 Hz) drives the colour split.
func set_audio(bytes: PackedByteArray) -> void:
	var s := 0.0
	if bytes.size() >= 7:
		for k in range(1, 7):
			s += bytes[k]
	_bass = clampf((s / 6.0 / 255.0 - 0.45) / 0.55, 0.0, 1.0)


## The game's own line count from the ring size. The window enlarges by a whole factor (WO-745), and 720 = 240 × 3 = 144 × 5
## = 90 × 8, so the factor is the one that gives a console's line count and divides both sides (NES 768×720 → 240,
## Game Boy 800×720 → 144, SNES / Genesis ×4 → 224). Anything else: the ring's own height.
static func source_lines(w: int, h: int) -> int:
	for n in range(1, 9):
		if w % n == 0 and h % n == 0 and h / n in CONSOLE_LINES:
			return h / n
	return h


func step(p: Dictionary, delta: float, burst: bool) -> void:
	if _reader.poll():
		if _native:
			_tex.update_native(_reader.src)
		else:
			_tex.update(_reader.frame, _reader.width, _reader.height)
	_live = _reader.width > 0 and not _reader.signal_lost
	_quad.visible = _live
	if burst:
		_kick = 1.0
	_kick = maxf(0.0, _kick - delta * 3.0)
	_t += delta
	var w := maxf(1.0, _reader.width)
	var h := maxf(1.0, _reader.height)
	var zoom := clampf(1.0 + (float(p.get("pulse", 0.2)) - 0.2) * 0.3, 0.8, 1.3)
	var view_h := 2.0 * DIST * tan(deg_to_rad(FOV * 0.5)) * 0.92 * zoom
	_quad.scale = Vector3(view_h * w / h, view_h, 1.0)
	_quad.position.z = CAM_Z - DIST
	var spin := float(p.get("spin", 0.15))
	_quad.rotation = Vector3(cos(_t * 0.37) * spin * 0.3, sin(_t * 0.5) * spin * 0.7, sin(_t * 0.23) * spin * 0.08)
	_mat.set_shader_parameter("lines", float(source_lines(int(w), int(h))))
	_mat.set_shader_parameter("crt", clampf(float(p.get("speed", 0.3)), 0.0, 1.0))
	_mat.set_shader_parameter("glitch", _kick)
	_mat.set_shader_parameter("split", 0.0006 + _bass * 0.004)
	_mat.set_shader_parameter("gain", 0.85 + float(p.get("glow", 0.3)) * 0.8)
	_mat.set_shader_parameter("opacity", clampf(float(p.get("amount", 0.5)) * 2.0, 0.0, 1.0))
	_mat.set_shader_parameter("t", _t)


## Whether a game is on the ring now (the page's status line).
func live() -> bool:
	return _live
