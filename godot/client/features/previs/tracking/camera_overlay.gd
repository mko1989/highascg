extends SubViewport
## WO-616 T12 — the previs 3D stage seen through a tracking camera's solved pose: a SubViewport sharing the stage's
## World3D (LED walls with their live pictures, TVs, models — not the floor plane, culled by layer), a Camera3D at
## camera_model.godot_transform with the solved fov, transparent background. The lens is applied when it is drawn:
## `material` (canvas shader) maps each picture pixel through the inverse k1/k2 radial model (camera_model._radial,
## half-diagonal normalised) into the pinhole render, which is overscanned so a barrel lens's corners have pixels.
## Rendered only while active (tracking_view shows it in the Camera mode when the operator turns it on).

const C := preload("res://features/previs/tracking/camera_model.gd")
const Quality := preload("res://features/previs/previs_quality.gd")  # WO-892

const MAX_W := 2048  # render width cap (the overlay is a ghost, not the programme picture)
const MAX_OVERSCAN := 2.0

const SHADER := """
shader_type canvas_item;
uniform vec2 raster = vec2(1920.0, 1080.0);
uniform float k1 = 0.0;
uniform float k2 = 0.0;
uniform float r_max = 4.0;
uniform float overscan = 1.0;
uniform float opacity = 0.6;

float pinhole_radius(float rd) {
	float r = min(rd, r_max);
	for (int i = 0; i < 12; i++) {
		float r2 = r * r;
		float h = r * (1.0 + k1 * r2 + k2 * r2 * r2) - rd;
		float s = 1.0 + 3.0 * k1 * r2 + 5.0 * k2 * r2 * r2;
		if (s < 1e-6) break;
		r = clamp(r - h / s, 0.0, r_max);
	}
	return r;
}

void fragment() {
	vec2 c = raster * 0.5;
	float hd = 0.5 * length(raster);
	vec2 d = (UV * raster - c) / hd;
	float rd = length(d);
	vec2 pu = rd > 1e-9 ? c + d * (pinhole_radius(rd) / rd) * hd : UV * raster;
	vec2 uv = 0.5 + (pu / raster - 0.5) / overscan;
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
		COLOR = vec4(0.0);
	} else {
		vec4 t = texture(TEXTURE, uv);
		COLOR = vec4(t.rgb, t.a * opacity);
	}
}
"""

var cam: Camera3D
var material: ShaderMaterial
var overscan := 1.0


func _init() -> void:
	transparent_bg = true
	render_target_update_mode = SubViewport.UPDATE_DISABLED
	size = Vector2i(16, 16)
	cam = Camera3D.new()
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	cam.near = 0.05
	cam.far = 1000.0
	add_child(cam)
	cam.current = true
	material = ShaderMaterial.new()
	material.shader = Shader.new()
	material.shader.code = SHADER


## Share the stage's world; its environment minus the background (and glow, which would haze the picture).
func attach(world: World3D, env: Environment, hide_layers: int) -> void:
	world_3d = world
	var e: Environment = env.duplicate() if env != null else Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.glow_enabled = false
	cam.environment = e
	if not Quality.shared().changed.is_connected(_on_quality):  # WO-892
		Quality.shared().changed.connect(_on_quality)
	_on_quality()
	cam.cull_mask = 0xFFFFF & ~hide_layers


## WO-892: the render quality — anti-aliasing and the Environment's effects (not glow, which would haze the picture).
func _on_quality(_level := 0) -> void:
	var p: Dictionary = Quality.shared().current()
	Quality.apply_viewport(self, p, true)
	Quality.apply_env(cam.environment as Environment, p, false)


## Pose / fov / lens from a tracking camera entry (tracking_model). → false when the camera is not usable.
func set_camera(ce: Dictionary) -> bool:
	if ce.is_empty():
		return false
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var c: Dictionary = ce.cam
	if not C.valid_view(c, w, h):
		return false
	var k1 := float(c.lens_k1)
	var k2 := float(c.lens_k2)
	overscan = clampf(C.invert_radius(1.0, k1, k2), 1.0, MAX_OVERSCAN) if (k1 != 0.0 or k2 != 0.0) else 1.0
	cam.transform = C.godot_transform(c)
	var v := deg_to_rad(C.hfov_to_vfov(float(c.fov), w / h))
	cam.fov = rad_to_deg(2.0 * atan(overscan * tan(v / 2.0)))
	var sc := minf(1.0, MAX_W / (w * overscan))
	size = Vector2i(maxi(16, roundi(w * overscan * sc)), maxi(16, roundi(h * overscan * sc)))
	material.set_shader_parameter("raster", Vector2(w, h))
	material.set_shader_parameter("k1", k1)
	material.set_shader_parameter("k2", k2)
	material.set_shader_parameter("r_max", minf(C.lens_fold_radius(k1, k2), 4.0))
	material.set_shader_parameter("overscan", overscan)
	return true


func set_opacity(a: float) -> void:
	material.set_shader_parameter("opacity", clampf(a, 0.0, 1.0))


func set_active(on: bool) -> void:
	render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
