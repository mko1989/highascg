// WO-1086 / WO-1087 — the avatar's one material (person_avatar.gd): a flat colour, matte, a little self-light and a
// soft rim so it reads in a dark venue, and a light response that SATURATES: each light only fills part of what is
// left below LIGHT_MAX, so any number of spots (three front spots, a beam overhead) can never add up past it. A pale
// skin or blonde hair stays its colour inside a beam instead of blowing out to white (seen on the box, 15.11).
// No texture.
shader_type spatial;
render_mode cull_back;

uniform vec4 albedo : source_color = vec4(0.7, 0.7, 0.7, 1.0);
uniform float self_light = 0.3;
uniform float rim = 0.2;
const float LIGHT_MAX = 0.75;  // direct light ceiling (+ self_light + rim ≈ 1.1 × colour at most)

void fragment() {
	ALBEDO = albedo.rgb;
	ROUGHNESS = 0.9;
	float r = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	EMISSION = albedo.rgb * (self_light + rim * r);
}

void light() {
	float wrap = clamp((dot(NORMAL, LIGHT) + 0.4) / 1.4, 0.0, 1.0);  // lambert wrap: no hard terminator
	vec3 l = LIGHT_COLOR * ATTENUATION * wrap / PI;
	vec3 room = max(vec3(LIGHT_MAX) - DIFFUSE_LIGHT, vec3(0.0));
	DIFFUSE_LIGHT += room * l / (vec3(0.5) + l);  // a fraction of the headroom: the sum tends to LIGHT_MAX, never past
}
