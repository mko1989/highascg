extends RefCounted
## WO-874 — Shadertoy code → Vulkan GLSL for the Visuals' shader scene (shadertoy_rd.gd runs it). The library's configs
## (GET /api/shaders/:id, WO-266/586: `common` + passes image / bufferA–D, each `{source, channels[4]}`) were written for
## WebGL2 (GLSL ES 3.00); GLSL 450 accepts that code nearly as is, so the wrapper only declares Shadertoy's inputs and calls
## mainImage. Rows are stored the Shadertoy way up (fragCoord.y = memory row), so buffer reads, texelFetch and the 512×2 audio
## texture (row 0 FFT, row 1 wave — player.js) line up; only the final display flips (scenes/shader.gd).

const BUFFERS := ["bufferA", "bufferB", "bufferC", "bufferD"]

## The std140 block below, byte for byte (shadertoy_rd.gd packs it).
const UBO_SIZE := 192

const HEADER := """#version 450
#define HW_PERFORMANCE 1
layout(set = 0, binding = 0, std140) uniform ShaderToy {
	vec3 iResolution;
	float iTime;
	vec4 iMouse;
	vec4 iDate;
	float iTimeDelta;
	float iFrameRate;
	int iFrame;
	float iSampleRate;
	vec3 iChannelResolution[4];
	float iChannelTime[4];
};
layout(set = 0, binding = 1) uniform sampler2D iChannel0;
layout(set = 0, binding = 2) uniform sampler2D iChannel1;
layout(set = 0, binding = 3) uniform sampler2D iChannel2;
layout(set = 0, binding = 4) uniform sampler2D iChannel3;
layout(location = 0) out vec4 st_FragColor;
"""

const FOOTER := """
void main() {
	vec4 c = vec4(0.0);
	mainImage(c, gl_FragCoord.xy);
	st_FragColor = c;
}
"""
## The library's Alpha flag (player.js alphaKeyImageSource): near-black keys out, authored alpha < 1 is kept; premultiplied.
const FOOTER_ALPHA := """
void main() {
	vec4 c = vec4(0.0);
	mainImage(c, gl_FragCoord.xy);
	float a = c.a < 1.0 ? max(c.a, 0.0) : smoothstep(0.0, 0.06, max(c.r, max(c.g, c.b)));
	st_FragColor = vec4(c.rgb * a, a);
}
"""

const VERTEX := """#version 450
void main() {
	vec2 p = vec2((gl_VertexIndex << 1) & 2, gl_VertexIndex & 2);
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
"""

## Identifiers that are free in GLSL ES 3.00 but keywords in Vulkan GLSL 450 (texture2D etc. are its separate-texture types).
const RENAMES := ["buffer", "shared", "precise", "sampler", "texture1D", "texture3D", "textureCube", "texture2DArray",
	"min3", "max3", "mid3"]  # the last three: glslang built-ins (AMD trinary min/max) a shader may define itself
const ZERO_TYPES := "float|int|uint|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|uvec2|uvec3|uvec4|bvec2|bvec3|bvec4|mat2|mat3|mat4"
## three.js's WebGL1 spellings (ShaderAmp, WO-586) → the GLSL 3 functions.
const FUNCS := {"texture2D": "texture", "texture2DLod": "textureLod", "textureCubeLod": "textureLod"}


## The fragment source of one pass: header, common, the pass, main(). `alpha`: the image pass of an Alpha-flagged shader.
## mainImage's `out vec4` becomes `inout`: WebGL zeroes it, SPIR-V leaves it undefined, and `O -= O` / `O += …` openers
## (sh-bg-slowstars-2) went white.
static func fragment(common: String, source: String, alpha := false) -> String:
	var src := RegEx.create_from_string("(\\bmainImage\\s*\\(\\s*)out\\b").sub(_rename(source), "$1inout", true)
	return HEADER + "#line 1\n" + _rename(common) + "\n#line 1\n" + src + (FOOTER_ALPHA if alpha else FOOTER)


static func _rename(code: String) -> String:
	# Precision is meaningless on desktop, but glslang still rejects overloads that differ only in it (a forward-declared
	# mainImage with highp args — sh-sa-turbulent-flame-vs-glasshawk); statements and qualifiers go.
	code = RegEx.create_from_string("\\bprecision\\s+\\w+\\s+\\w+\\s*;").sub(code, "", true)
	code = RegEx.create_from_string("\\b(highp|mediump|lowp)\\s+").sub(code, "", true)
	for f in FUNCS:
		code = RegEx.create_from_string("\\b" + f + "(\\s*\\()").sub(code, FUNCS[f] + "$1", true)
	return _zero_init(RegEx.create_from_string("\\b(" + "|".join(RENAMES) + ")\\b").sub(code, "st_$1", true))


## WebGL (ANGLE) zeroes every uninitialised variable; SPIR-V leaves them undefined, and `vec3 col; col += …` rendered
## black or white on the GPU (sh-sa-cheshire-cat…, sh-waveform-microphone; the same shaders are fine in Chrome). Bare
## declarations — `vec3 a;`, `float a, b;` — get `= T(0)`; struct bodies (members cannot have initialisers) are left alone.
static func _zero_init(code: String) -> String:
	var structs := RegEx.create_from_string("\\bstruct\\s+\\w*\\s*\\{[^}]*\\}")
	var decl := RegEx.create_from_string("(?<![\\w.])(" + ZERO_TYPES + ")\\s+([A-Za-z_]\\w*(?:\\s*,\\s*[A-Za-z_]\\w*)*)\\s*;")
	var out := ""
	var at := 0
	for m in structs.search_all(code) + [null]:
		var end: int = m.get_start() if m != null else code.length()
		var part := code.substr(at, end - at)
		var done := ""
		var i := 0
		for d in decl.search_all(part):
			var t := d.get_string(1)
			var names := Array(d.get_string(2).split(",")).map(func(n: String) -> String: return "%s = %s(0)" % [n.strip_edges(), t])
			done += part.substr(i, d.get_start() - i) + t + " " + ", ".join(names) + ";"
			i = d.get_end()
		out += done + part.substr(i) + (m.get_string() if m != null else "")
		at = m.get_end() if m != null else code.length()
	return out


## A channel entry → "audio", "A".."D" or "" (unbound: a black texel). Store values are "audio", "A".., or "bufferA"...
static func channel(v: Variant) -> String:
	if not v is String:
		return ""
	var s: String = v
	if s == "audio":
		return s
	if s.begins_with("buffer"):
		s = s.substr(6)
	return s if s in ["A", "B", "C", "D"] else ""


## The config's passes in Shadertoy order (buffers A–D, then image), each {name, source, channels[4]}. Empty without an image.
static func passes(cfg: Variant) -> Array:
	var out := []
	if not cfg is Dictionary or not cfg.get("passes") is Dictionary:
		return out
	var ps: Dictionary = cfg.passes
	var image: Variant = ps.get("image")
	if not image is Dictionary or str(image.get("source", "")).strip_edges() == "":
		return out
	for name in BUFFERS + ["image"]:
		var p: Variant = ps.get(name)
		if not p is Dictionary or str(p.get("source", "")).strip_edges() == "":
			continue
		var ch := []
		var raw: Array = p.get("channels") if p.get("channels") is Array else []
		for i in 4:
			ch.append(channel(raw[i]) if i < raw.size() else "")
		var opts: Variant = cfg.get("opts")
		out.append({"name": name, "source": str(p.source), "channels": ch,
			"alpha": name == "image" and opts is Dictionary and opts.get("alpha") == true})
	_repair(out, cfg)
	return out


## Bindings the Caspar player (player.js / ShaderToyLite) supplies or the library lost, filled into `passes` in place:
## - a buffer no other pass reads (an import dropped the image's binding — sh-chillwave-planet, sh-revision-…-cupe) goes on
##   the image's lowest channel that its code samples and nothing binds;
## - `audio.enabled` with no pass binding "audio" → the image's first free channel (player.js ensureAudioChannelBinding).
static func _repair(ps: Array, cfg: Dictionary) -> void:
	var image: Dictionary = ps[-1]
	for p in ps:
		var l := letter(p.name)
		if l == "" or ps.any(func(q: Dictionary) -> bool: return q != p and l in q.channels):
			continue
		for i in 4:
			if image.channels[i] == "" and image.source.contains("iChannel%d" % i):
				image.channels[i] = l
				break
	var audio: Variant = cfg.get("audio")
	if audio is Dictionary and audio.get("enabled") == true and not ps.any(func(q: Dictionary) -> bool: return "audio" in q.channels):
		var free: int = image.channels.find("")
		if free >= 0:
			image.channels[free] = "audio"


## The buffer letter a pass writes ("A".."D"), "" for image.
static func letter(name: String) -> String:
	return name.substr(6) if name.begins_with("buffer") else ""
