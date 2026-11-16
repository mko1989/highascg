// WO-1087 / WO-1103 — the people layer's one light response (pebble avatars: person_avatar.gdshader; the human
// puppets: person_human.gdshaderinc). Each light only fills part of the headroom left under PERSON_LIGHT_MAX, so any
// number of spots (three front spots, a beam overhead) can never add up past it: a pale skin or blonde hair stays its
// colour inside a beam instead of blowing out to white (seen on the box, 15.11). `wrap` per channel softens the
// terminator (lambert wrap; a skin wraps red a little further than blue: cheap subsurface).
const float PERSON_LIGHT_MAX = 0.75;  // direct light ceiling (× the albedo)

void person_diffuse(vec3 n, vec3 l, vec3 light_colour, float attenuation, vec3 wrap_by, inout vec3 diffuse) {
	vec3 w = clamp((vec3(dot(n, l)) + wrap_by) / (vec3(1.0) + wrap_by), vec3(0.0), vec3(1.0));
	vec3 c = light_colour * attenuation * w / PI;
	vec3 room = max(vec3(PERSON_LIGHT_MAX) - diffuse, vec3(0.0));
	diffuse += room * c / (vec3(0.5) + c);  // a fraction of the headroom: the sum tends to the ceiling, never past
}
