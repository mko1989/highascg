// WO-1104 — stage drape cloth (drape_geometry.gd builds the mesh): matte, double-sided, lit like any room surface (the
// rig's spots, the house ambient and sun — never emissive). Fold shading = the mesh's COLOR.r (how far forward the fold
// is) as ambient occlusion, a soft velvet sheen at grazing angles, and a faint procedural grain in metres (UV) so a large
// flat molton is not one flat colour. No textures.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

uniform vec4 albedo : source_color = vec4(0.08, 0.08, 0.08, 1.0);
uniform float sheen = 0.35;
uniform float fold_ao = 0.75; // how dark the back of a fold gets in ambient light

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	// streaks run down the cloth (u across in metres, v down): long in v, narrow in u
	float g = vnoise(UV * vec2(9.0, 0.8)) * 0.6 + vnoise(UV * vec2(37.0, 3.0)) * 0.4;
	float front = FRONT_FACING ? COLOR.r : 1.0 - COLOR.r;
	ALBEDO = albedo.rgb * (0.92 + 0.12 * g);
	ROUGHNESS = 0.9;
	SPECULAR = 0.2;
	METALLIC = 0.0;
	RIM = sheen;
	RIM_TINT = 0.65;
	AO = mix(1.0 - fold_ao, 1.0, smoothstep(0.0, 1.0, front));
	AO_LIGHT_AFFECT = 0.4;
}
