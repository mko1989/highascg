extends RefCounted
## WO-892 — the beam cone of fixtures_3d.gd: its shader (two variants) and what a render quality changes on the rig.
## Plain: additive, unshaded, no depth read — today's look (Low). Soft (Medium and up): the cone fades where scene
## geometry (floor, walls, models) is just behind its surface (soft-particle style, hint_depth_texture) instead of
## ending in a hard line, and fades out as the camera moves inside it.

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")

const SOFT_M := 0.8  ## metres over which a cone fades into geometry behind it

const SHADER := """
shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;
uniform vec4 tint : source_color;
uniform float haze = 0.0;  // WO-786
//SOFT_UNIFORM
varying float along;
//SOFT_VARYING
void vertex() {
	along = clamp(0.5 - VERTEX.y, 0.0, 1.0);  // 0 at the lens (top of the unit cone), 1 at its far end
//SOFT_VERTEX
}
void fragment() {
	float edge = pow(abs(dot(normalize(NORMAL), normalize(VIEW))), 1.5);
	// max(): with MSAA `along` is extrapolated past 1 at a triangle's edge, and pow(<0) is NaN (a white glow blob)
	float a = tint.a * pow(max(1.0 - along, 0.0), 2.0 - 1.2 * haze) * edge * %s * (1.0 + 2.2 * haze);
//SOFT_FRAGMENT
	ALBEDO = tint.rgb;
	ALPHA = a;
}
"""

const SOFT_UNIFORM := "uniform sampler2D depth_tex : hint_depth_texture, repeat_disable, filter_nearest;"
const SOFT_VARYING := "varying vec3 cam_local;  // the camera in the unit cone's frame"
const SOFT_VERTEX := "	cam_local = (inverse(MODEL_MATRIX) * vec4(CAMERA_POSITION_WORLD, 1.0)).xyz;"
const SOFT_FRAGMENT := """
	float depth = textureLod(depth_tex, SCREEN_UV, 0.0).r;
	vec4 up = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	a *= clamp((VERTEX.z - up.z / up.w) / %s, 0.0, 1.0);
	float rad = max(0.004 + (0.5 - cam_local.y) * 0.996, 0.001);  // cone radius at the camera's height
	float inside = 1.0 - smoothstep(0.5, 0.56, abs(cam_local.y));
	a *= mix(1.0, smoothstep(0.3, 1.0, length(cam_local.xz) / rad), inside);
"""


static func code(soft: bool) -> String:
	var s: String = SHADER % F.CONE_ALPHA
	return s.replace("//SOFT_UNIFORM", SOFT_UNIFORM if soft else "") \
		.replace("//SOFT_VARYING", SOFT_VARYING if soft else "") \
		.replace("//SOFT_VERTEX", SOFT_VERTEX if soft else "") \
		.replace("//SOFT_FRAGMENT", (SOFT_FRAGMENT % str(SOFT_M)) if soft else "")


## Quality `p` (previs_quality.gd) onto a rig: the shader variant, the cone's segments, and shadows on the first
## spot_shadow_budget lights (a gobo spot keeps its shadow — its projection needs it). `fx` is fixtures_3d.gd's _fx.
static func apply(fx: Dictionary, cone: CylinderMesh, shader: Shader, budget: int, p: Dictionary) -> void:
	var c := code(bool(p.soft_cone))
	if shader.code != c:
		shader.code = c
	cone.radial_segments = int(p.cone_segs)
	var n := 0
	for id in fx:
		for b: Dictionary in (fx[id].beams as Dictionary).values():
			if b.has("light"):
				var sl := b.light as SpotLight3D
				sl.set_meta("qshadow", n < budget)
				sl.shadow_enabled = n < budget or sl.light_projector != null
				n += 1
