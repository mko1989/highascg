// WO-666 — a tracked person's mannequin, painted by projective texturing from up to 3 solved tracking cameras.
// Each surface point is projected into every camera (cam_uv = person_dummy_model.project_uv, line for line); a camera
// counts where the point lands inside that person's seg mask, weighted by how squarely the camera faces the surface
// (N·V², so the frontal view wins and grazing views fade out). The mannequin is close to convex, so N·V > 0 stands in
// for the research doc's per-camera depth maps (deferred: only another person or a raised arm would need them).
// What no camera paints takes the person's mean colour, sampled from the best camera, lightly shaded so the shape reads.
shader_type spatial;
render_mode unshaded, cull_back;

uniform int n_cams = 0;
uniform mat3 rot[3];
uniform vec3 pos[3];
uniform vec4 lens[3];  // f, aspect, k1, k2
uniform vec2 raster[3];
uniform vec4 box[3];  // x1, y1, x2, y2 in 0..1 raster units
uniform bool has_mask[3];
uniform sampler2D video0 : source_color, filter_linear, repeat_disable;
uniform sampler2D video1 : source_color, filter_linear, repeat_disable;
uniform sampler2D video2 : source_color, filter_linear, repeat_disable;
uniform sampler2D mask0 : filter_linear, repeat_disable;
uniform sampler2D mask1 : filter_linear, repeat_disable;
uniform sampler2D mask2 : filter_linear, repeat_disable;

varying vec3 world_pos;
varying vec3 world_nrm;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_nrm = normalize(mat3(MODEL_MATRIX) * NORMAL);
}

// 0..1 raster position of p in camera i (pinhole + k1/k2), or (-1, -1) at / behind it.
vec2 cam_uv(int i, vec3 p) {
	vec3 t = p - pos[i];
	vec3 v = transpose(rot[i]) * t;
	if (v.z >= -1e-9) {
		return vec2(-1.0);
	}
	vec2 uv = vec2(((lens[i].x / lens[i].y) * (v.x / -v.z) + 1.0) / 2.0, (1.0 - lens[i].x * (v.y / -v.z)) / 2.0);
	vec2 d = (uv - 0.5) * raster[i] / (0.5 * length(raster[i]));
	float r2 = dot(d, d);
	return 0.5 + (uv - 0.5) * (1.0 + lens[i].z * r2 + lens[i].w * r2 * r2);
}

// How much of camera i's picture belongs on this point: inside the box, inside the person's mask.
float coverage(int i, vec2 uv, sampler2D m) {
	vec2 b = (uv - box[i].xy) / max(box[i].zw - box[i].xy, vec2(1e-6));
	if (uv.x < 0.0 || any(lessThan(b, vec2(0.0))) || any(greaterThan(b, vec2(1.0)))) {
		return 0.0;
	}
	return has_mask[i] ? smoothstep(0.35, 0.65, texture(m, b).r) : 1.0;
}

vec3 mean_colour() {
	vec3 sum = vec3(0.0);
	float n = 0.0;
	for (int k = 0; k < 8; k++) {
		vec2 b = vec2(0.5 + 0.12 * sin(float(k) * 2.4), 0.18 + 0.09 * float(k));
		float m = has_mask[0] ? step(0.5, texture(mask0, b).r) : 1.0;
		sum += texture(video0, mix(box[0].xy, box[0].zw, b)).rgb * m;
		n += m;
	}
	return n > 0.0 ? sum / n : vec3(0.45);
}

void fragment() {
	vec3 acc = vec3(0.0);
	float wsum = 0.0;
	for (int i = 0; i < 3; i++) {
		if (i >= n_cams) {
			break;
		}
		float facing = dot(normalize(world_nrm), normalize(pos[i] - world_pos));
		if (facing <= 0.0) {
			continue;
		}
		vec2 uv = cam_uv(i, world_pos);
		float c;
		vec3 col;
		if (i == 0) {
			c = coverage(0, uv, mask0);
			col = texture(video0, uv).rgb;
		} else if (i == 1) {
			c = coverage(1, uv, mask1);
			col = texture(video1, uv).rgb;
		} else {
			c = coverage(2, uv, mask2);
			col = texture(video2, uv).rgb;
		}
		float w = c * facing * facing;
		acc += col * w;
		wsum += w;
	}
	vec3 base = (n_cams > 0 ? mean_colour() : vec3(0.45)) * (0.7 + 0.3 * clamp(normalize(world_nrm).y + 0.5, 0.0, 1.0));
	float cover = clamp(wsum * 4.0, 0.0, 1.0);
	ALBEDO = mix(base, wsum > 0.0 ? acc / wsum : base, cover);
}
