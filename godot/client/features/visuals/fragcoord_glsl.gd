extends RefCounted
## WO-999 step 2 — FragCoord code → Vulkan GLSL for the Visuals (fragcoord_rd.gd runs it). FragCoord shaders are GLSL ES
## 3.00 without `#version` / `precision`, reading the runtime's `u_*` uniforms and writing a predeclared `fragColor` from
## `void main()` — or Shadertoy-style `mainImage(out vec4, in vec2)`. Config (library, step 3):
## `{dialect: "fragcoord", common, passes: {main: {source, format?}, pass1..N: {...}}, opts: {alpha}, values: {u_x: …}}`.
## - Built-in values live in one std140 block (HEADER); a shader's own redeclarations of them are dropped.
## - Custom `uniform float u_x; //default, [min, max]` (and vec2/3/4, int, bool) become slots of `_hgC` in the same block,
##   so slider values move without a recompile; `uniform sampler2D u_tex; //url` becomes a sampler (black until step 3
##   fetches URL textures).
## - Samplers (u_audio, u_main, u_pass1…, u_keyboard, u_webcam, custom) are declared only where the pass's code names them,
##   bindings 1.. in that order; the runner binds exactly those.
## - Rows run bottom-up as on Shadertoy (memory row = gl_FragCoord.y): u_audio's row 0 is uv.y 0, the display flips.
## The ES→450 fixes (precision, keyword renames, zero-init) are shadertoy_glsl.gd's.

const G := preload("res://features/visuals/shadertoy_glsl.gd")

const MAX_PASSES := 8
const SLOTS := 16
## The std140 block below, byte for byte (fragcoord_rd.gd packs it): 44 floats of built-ins, then SLOTS vec4s.
const UBO_SIZE := 176 + SLOTS * 16
const C_AT := 44  # float index of _hgC[0]

const BLOCK := """layout(set = 0, binding = 0, std140) uniform FragCoord {
	vec2 u_resolution;
	float u_time;
	float u_time_delta;
	vec4 u_mouse;
	vec4 u_date;
	vec3 u_camera_pos;
	float u_refresh_rate;
	vec3 u_camera_dir;
	float u_scroll;
	mat4 u_camera_view;
	vec2 u_drag;
	int u_frame;
	int u_color_gamut;
	int u_recursion;
	int u_max_recursion;
	float _hgPad0;
	float _hgPad1;
	vec4 _hgC[%d];
};
"""

const BUILTINS := ["u_resolution", "u_time", "u_time_delta", "u_mouse", "u_date", "u_camera_pos", "u_refresh_rate",
	"u_camera_dir", "u_scroll", "u_camera_view", "u_drag", "u_frame", "u_color_gamut", "u_recursion", "u_max_recursion",
	"u_audio", "u_keyboard", "u_webcam", "u_main", "fragColor"]
const SAMPLERS := ["u_audio", "u_keyboard", "u_webcam", "u_main"]
const TEXTURE_TYPES := ["sampler2D", "sampler3D", "samplerCube"]
const VALUE_TYPES := {"float": 1, "int": 1, "bool": 1, "vec2": 2, "vec3": 3, "vec4": 4}
const FORMATS := ["rgba8", "rgba16f", "rgba32f", "rgb16f", "rgb32f", "rg16f", "rg32f", "r16f", "r32f", "rgb8", "rg8", "r8"]

const FOOTER := """
void main() {
	fragColor = vec4(0.0);
	%s
%s}
"""
## The library's Alpha flag (shadertoy_glsl.gd FOOTER_ALPHA): near-black keys out, authored alpha < 1 is kept; premultiplied.
const KEY := """	float a = fragColor.a < 1.0 ? max(fragColor.a, 0.0) : smoothstep(0.0, 0.06, max(fragColor.r, max(fragColor.g, fragColor.b)));
	fragColor = vec4(fragColor.rgb * a, a);
"""

static var _uniform := RegEx.create_from_string(
	"(?m)^[ \\t]*uniform\\s+(?:(?:highp|mediump|lowp)\\s+)?(\\w+)\\s+(\\w+)\\s*(?:=\\s*([^;]*))?;[ \\t]*(?://([^\\n]*))?")
static var _num := RegEx.create_from_string("(?<![\\w.])[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?")
static var _range := RegEx.create_from_string("\\[\\s*([^\\],]+),\\s*([^\\]]+)\\]")


## The config's passes in FragCoord order (pass1..N, then main), each {name, source, format, alpha}. Empty without main.
static func passes(cfg: Variant) -> Array:
	var out := []
	if not cfg is Dictionary or not cfg.get("passes") is Dictionary:
		return out
	var ps: Dictionary = cfg.passes
	if _src(ps.get("main")) == "":
		return out
	var opts: Variant = cfg.get("opts")
	for i in range(1, MAX_PASSES + 1):
		var name := "pass%d" % i
		if _src(ps.get(name)) != "":
			out.append({"name": name, "source": _src(ps[name]), "format": _format(ps[name]), "alpha": false})
	out.append({"name": "main", "source": _src(ps.main), "format": _format(ps.main),
		"alpha": opts is Dictionary and opts.get("alpha") == true})
	return out


## Custom uniforms over common + every pass, first appearance wins: [{name, type, n, values, min, max, slot}] for
## values (slot = their _hgC index, at most SLOTS), [{name, type: "sampler2D", url}] for textures.
static func uniforms(cfg: Variant) -> Array:
	var texts := [str(cfg.get("common", ""))] if cfg is Dictionary else []
	for p in passes(cfg):
		texts.append(p.source)
	var out := []
	var seen := {}
	var slot := 0
	for t in texts:
		for m in _uniform.search_all(t):
			var type := m.get_string(1)
			var name := m.get_string(2)
			if name in BUILTINS or name.begins_with("u_pass") or seen.has(name):
				continue
			var note := m.get_string(4)
			if type in TEXTURE_TYPES:
				seen[name] = true
				var url := note.strip_edges().split(" ")[0] if note.strip_edges() != "" else ""
				out.append({"name": name, "type": type, "url": url})
				continue
			if not VALUE_TYPES.has(type) or slot >= SLOTS:
				continue
			seen[name] = true
			var n: int = VALUE_TYPES[type]
			var head := note.split("[")[0]
			var vals := _nums(m.get_string(3) if m.get_string(3) != "" else head)
			var r := _range.search(note)
			if vals.is_empty() and r != null:  # no default: GLSL's 0, pulled into the slider range
				vals.append(clampf(0.0, r.get_string(1).to_float(), r.get_string(2).to_float()))
			while vals.size() < n:  # one number for a vector fills it, as vec3(1.0) does
				vals.append(vals[-1] if vals.size() > 0 else 0.0)
			var u := {"name": name, "type": type, "n": n, "values": vals.slice(0, n), "slot": slot}
			if r != null:
				u.min = r.get_string(1).to_float()
				u.max = r.get_string(2).to_float()
			out.append(u)
			slot += 1
	return out


## The fragment source of one pass. `us` = uniforms(cfg); returns {code, samplers: [names in binding order 1..], types: [their
## GLSL sampler types]}.
static func fragment(common: String, p: Dictionary, us: Array) -> Dictionary:
	var c := _strip(common)
	var s := _strip(p.source)
	var image := RegEx.create_from_string("\\bvoid\\s+mainImage\\s*\\(").search(s) != null
	if image:
		s = RegEx.create_from_string("(\\bmainImage\\s*\\(\\s*)out\\b").sub(s, "$1inout", true)
	else:
		s = RegEx.create_from_string("\\bvoid\\s+main\\s*\\(\\s*(?:void\\s*)?\\)").sub(s, "void fc_user_main()", true)
	var both := c + "\n" + s
	var samplers := []
	var types := []
	var names := {}
	for n in SAMPLERS:
		names[n] = "sampler2D"
	for i in range(1, MAX_PASSES + 1):
		names["u_pass%d" % i] = "sampler2D"
	for u in us:
		if u.type in TEXTURE_TYPES:
			names[u.name] = u.type
	for n in names:
		if RegEx.create_from_string("\\b" + n + "\\b").search(both) != null:
			samplers.append(n)
			types.append(names[n])
	var head := "#version 450\n" + BLOCK % SLOTS + "layout(location = 0) out vec4 fragColor;\n"
	for i in samplers.size():
		head += "layout(set = 0, binding = %d) uniform %s %s;\n" % [i + 1, types[i], samplers[i]]
	for u in us:
		if not u.type in TEXTURE_TYPES:
			head += "#define %s %s\n" % [u.name, _slot_expr(u)]
	var call := "mainImage(fragColor, gl_FragCoord.xy);" if image else "fc_user_main();"
	var code := head + "#line 1\n" + c + "\n#line 1\n" + s + FOOTER % [call, KEY if p.get("alpha") == true else ""]
	return {"code": code, "samplers": samplers, "types": types}


## The _hgC floats for `us` (defaults, then `values` overrides: {u_x: number | [numbers]}), SLOTS × 4.
static func slot_values(us: Array, values: Variant) -> PackedFloat32Array:
	var f := PackedFloat32Array()
	f.resize(SLOTS * 4)
	for u in us:
		if u.type in TEXTURE_TYPES:
			continue
		var v: Array = u["values"]
		var o: Variant = values.get(u.name) if values is Dictionary else null
		if o is float or o is int:
			v = [float(o)]
		elif o is Array:
			v = o
		for i in int(u.n):
			f[u.slot * 4 + i] = float(v[i]) if i < v.size() and (v[i] is float or v[i] is int) else float(u["values"][i])
	return f


## "rgba8" (FragCoord's default) unless the pass names another known format.
static func _format(p: Variant) -> String:
	var f := str(p.get("format", "")) if p is Dictionary else ""
	return f if f in FORMATS else "rgba8"


static func _src(p: Variant) -> String:
	return str(p.get("source", "")).strip_edges() if p is Dictionary else ""


## A pass or common, ready for the block: no #version, no fragColor / built-in / custom uniform declarations (the custom
## ones are slots or samplers now; the line stays, empty, so error line numbers match the editor), then the ES fixes.
static func _strip(code: String) -> String:
	code = RegEx.create_from_string("(?m)^[ \\t]*#version[^\\n]*").sub(code, "", true)
	code = RegEx.create_from_string("(?:layout\\s*\\([^)]*\\)\\s*)?\\bout\\s+(?:(?:highp|mediump|lowp)\\s+)?vec4\\s+fragColor\\s*;").sub(code, "", true)
	code = _uniform.sub(code, "", true)
	return G._rename(code)


static func _slot_expr(u: Dictionary) -> String:
	var at := "_hgC[%d]" % u.slot
	match u.type:
		"float": return "(%s.x)" % at
		"int": return "int(%s.x)" % at
		"bool": return "(%s.x != 0.0)" % at
		"vec2": return "(%s.xy)" % at
		"vec3": return "(%s.xyz)" % at
	return "(%s)" % at


static func _nums(s: String) -> Array:
	var out := []
	for m in _num.search_all(s):
		out.append(m.get_string().to_float())
	return out
