// WO-607 T4 / WO-614 T3 — emissive picture surface for LED walls, TVs and projection screens.
// UV (0,0) = top-left of the object's picture; uv_rect crops the source raster (x, y, w, h in 0..1).
// LED look: dark seams between panels and an optional LED pixel grid, both anti-aliased with fwidth
// so they fade out instead of shimmering when the camera is far away.
shader_type spatial;
render_mode cull_disabled;

uniform sampler2D video : source_color, filter_linear, repeat_disable;
uniform bool has_video = false;
uniform vec4 uv_rect = vec4(0.0, 0.0, 1.0, 1.0);
uniform vec2 panels = vec2(1.0, 1.0);
uniform vec2 panel_px = vec2(192.0, 192.0);
uniform float seam_px = 0.0;       // seam width in LED pixels (0 = none: TVs, projection)
uniform float pixel_grid = 0.0;    // 0..1 strength of the dark gaps between LEDs
uniform float energy = 1.0;

void fragment() {
	vec2 st = UV;
	vec3 c = has_video ? texture(video, uv_rect.xy + st * uv_rect.zw).rgb : vec3(0.05, 0.05, 0.07);
	vec2 px = st * panels * panel_px;
	vec2 fw = max(fwidth(px), vec2(1e-4));
	if (seam_px > 0.0) {
		vec2 in_panel = mod(px, panel_px);
		vec2 d = min(in_panel, panel_px - in_panel);
		vec2 half_w = max(vec2(seam_px * 0.5), fw * 0.6);
		float seam = max(1.0 - smoothstep(half_w.x - fw.x, half_w.x + fw.x, d.x),
				1.0 - smoothstep(half_w.y - fw.y, half_w.y + fw.y, d.y));
		c *= 1.0 - 0.85 * seam;
	}
	if (pixel_grid > 0.0) {
		vec2 q = fract(px);
		float g = smoothstep(0.0, 0.2, q.x) * smoothstep(1.0, 0.8, q.x) * smoothstep(0.0, 0.2, q.y) * smoothstep(1.0, 0.8, q.y);
		float visible = clamp(1.0 / max(fw.x, fw.y) / 4.0 - 0.25, 0.0, 1.0);  // only when an LED is > ~2 screen px
		c *= mix(1.0, g, pixel_grid * visible);
	}
	ALBEDO = vec3(0.0);
	EMISSION = c * energy;
	ROUGHNESS = 0.35;
}
