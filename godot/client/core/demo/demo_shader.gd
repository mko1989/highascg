extends RefCounted
## WO-865 — the one CanvasItem shader of the demo display engine. A layer is a TextureRect with this material: it draws the
## `uv_rect` window of its texture (look_thumb_math.gd's crop / cover window), fades by `alpha`, optionally clipped to
## `clip` (a wipe), and for the synthetic "video" stand-ins (`motion` = 1) adds motion that a still image has not: a slow
## zoom + pan, a light band sweeping across and a gentle colour drift, each seeded by the clip name so two clips never
## move alike. Real clips (Ogg Theora, `motion` = 0) are drawn as they are. `t` is the layer's own running time in seconds
## (small numbers: float32 stays exact).

const CODE := """
shader_type canvas_item;
uniform vec4 uv_rect = vec4(0.0, 0.0, 1.0, 1.0);
uniform float alpha = 1.0;
uniform float motion = 0.0;
uniform float t = 0.0;
uniform float seed = 0.0;
uniform bool clipped = false;
uniform vec4 clip = vec4(0.0, 0.0, 1.0, 1.0);

void fragment() {
	if (clipped && (UV.x < clip.x || UV.y < clip.y || UV.x > clip.z || UV.y > clip.w)) {
		discard;
	}
	vec2 uv = UV;
	float glow = 0.0;
	float drift = 0.0;
	if (motion > 0.5) {
		float zoom = 1.07 + 0.03 * sin(t * 0.45 + seed * 6.2832);
		vec2 pan = vec2(0.02 * sin(t * 0.31 + seed * 11.0), 0.018 * cos(t * 0.23 + seed * 5.0));
		uv = vec2(0.5) + (UV - vec2(0.5)) / zoom + pan;
		float d = (fract(UV.x * 0.8 - UV.y * 0.3 - t * 0.10 - seed) - 0.5) * 7.0;
		glow = 0.08 * exp(-d * d);
		drift = 0.22 * (0.5 + 0.5 * sin(t * 0.4 + seed * 6.2832));
	}
	vec4 c = texture(TEXTURE, uv_rect.xy + clamp(uv, vec2(0.0), vec2(1.0)) * uv_rect.zw);
	vec3 rgb = mix(c.rgb, c.gbr, drift) + vec3(glow);
	COLOR = vec4(rgb, c.a * alpha);
}
"""

static var _shader: Shader = null


static func shader() -> Shader:
	if _shader == null:
		_shader = Shader.new()
		_shader.code = CODE
	return _shader
