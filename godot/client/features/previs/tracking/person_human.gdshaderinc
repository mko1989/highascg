// WO-1103 — the human puppets' material (person_human.gdshader opaque: skin, clothes, shoes, eyes;
// person_human_cards.gdshader alpha-cut and two-sided: hair, eyebrows, eyelashes). Textured from the MakeHuman CC0
// assets (godot/client/assets/people), lit by the rig like everything else through the people layer's one light
// response (person_light.gdshaderinc: lights saturate under a ceiling, so a white profile never blows a face out to
// white) plus a small, rough specular sheen. No self-glow with the house lights on (the room's ambient lights them);
// with the house lights down only `self_light` — the small readability floor (house_lights.gd avatar_floor) — is left.
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap, repeat_enable;
uniform float normal_depth = 0.0;  // 0 = no normal map
uniform vec3 tint = vec3(1.0);
uniform float roughness = 0.7;
uniform float sheen = 0.25;  // specular strength (skin ~0.3, cloth ~0.1, eyes ~0.8)
uniform vec3 wrap = vec3(0.15);  // per channel: a skin wraps red further (cheap subsurface)
uniform float self_light = 0.0;
uniform float alpha_cut = 0.5;
#include "res://features/previs/tracking/person_light.gdshaderinc"

const float SPEC_MAX = 0.35;

void fragment() {
	vec4 t = texture(albedo_tex, UV);
	ALBEDO = t.rgb * tint;
	ROUGHNESS = roughness;
	if (normal_depth > 0.0) {
		NORMAL_MAP = texture(normal_tex, UV).rgb;
		NORMAL_MAP_DEPTH = normal_depth;
	}
	EMISSION = ALBEDO * self_light;
#ifdef HUMAN_CARDS
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = alpha_cut;
	ALPHA_ANTIALIASING_EDGE = 0.25;
#endif
}

void light() {
	person_diffuse(NORMAL, LIGHT, LIGHT_COLOR, ATTENUATION, wrap, DIFFUSE_LIGHT);
	// GGX highlight, also saturating (several spots never stack into a white patch)
	vec3 h = normalize(LIGHT + VIEW);
	float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float a = roughness * roughness;
	float d = pow(clamp(dot(NORMAL, h), 0.0, 1.0), 2.0) * (a * a - 1.0) + 1.0;
	vec3 s = LIGHT_COLOR * ATTENUATION * ndl * sheen * 0.04 * a * a / (PI * d * d + 1e-4);
	vec3 room = max(vec3(SPEC_MAX) - SPECULAR_LIGHT, vec3(0.0));
	SPECULAR_LIGHT += room * s / (vec3(0.5) + s);
}
