// WO-665 — a tracked person's cut-out card: the best camera's live picture cropped to the person's box, keyed by
// the sidecar's segmentation mask (bilinear-upsampled, cut at 0.5 → a smooth contour from a 48×96 grid).
// Without a mask (a detection-only model) the whole box shows, with soft edges so it reads as a card, not a wall.
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform sampler2D video : source_color, filter_linear, repeat_disable;
uniform sampler2D mask : filter_linear, repeat_disable;
uniform bool has_mask = false;
uniform vec4 box = vec4(0.0, 0.0, 1.0, 1.0);  // x1, y1, x2, y2 in the camera raster, 0..1

void fragment() {
	ALBEDO = texture(video, mix(box.xy, box.zw, UV)).rgb;
	float a;
	if (has_mask) {
		a = texture(mask, UV).r;
	} else {
		vec2 e = min(UV, 1.0 - UV);
		a = smoothstep(0.0, 0.06, min(e.x, e.y)) * 0.9 + 0.1 * step(0.03, min(e.x, e.y));
	}
	ALPHA = a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
