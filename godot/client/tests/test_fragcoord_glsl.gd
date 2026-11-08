extends RefCounted
## WO-999 step 2 — the FragCoord wrapper: pass order and formats, custom uniforms (defaults, ranges, initialisers, vectors,
## samplers) as UBO slots, sampler declarations only where named, both entry forms, the alpha key, dropped redeclarations.

const F := preload("res://features/visuals/fragcoord_glsl.gd")
var t

const MAIN := """uniform float u_speed; //1.5, [0.0, 6.0]
uniform vec3 u_tint;   //1.0, 0.55, 0.2, [0.0, 1.0]
void main() {
	vec2 uv = gl_FragCoord.xy / u_resolution.xy;
	float a = texture(u_audio, vec2(uv.x, 0.0)).r;
	fragColor = vec4(u_tint * a * u_speed, 1.0);
}
"""


func _cfg(passes: Dictionary, extra := {}) -> Dictionary:
	var c := {"dialect": "fragcoord", "common": "", "passes": passes}
	c.merge(extra, true)
	return c


func test_passes_run_aux_first_then_main() -> void:
	var ps := F.passes(_cfg({"main": {"source": MAIN}, "pass2": {"source": "void main(){}", "format": "rgba16f"},
		"pass1": {"source": "void main(){}"}, "pass9": {"source": "void main(){}"}, "pass3": {"source": "  "}}))
	t.eq(ps.map(func(p: Dictionary) -> String: return p.name), ["pass1", "pass2", "main"], "1..N then main; empty and >8 skipped")
	t.eq(ps.map(func(p: Dictionary) -> String: return p.format), ["rgba8", "rgba16f", "rgba8"], "rgba8 unless named")
	t.eq(F.passes(_cfg({"pass1": {"source": "void main(){}"}})), [], "no main, nothing")
	t.eq(F.passes(null), [])
	t.eq(F.passes(_cfg({"main": {"source": MAIN, "format": "bogus"}}))[0].format, "rgba8")
	t.ok(F.passes(_cfg({"main": {"source": MAIN}}, {"opts": {"alpha": true}}))[0].alpha, "the library's alpha flag on main")


func test_custom_uniforms_become_slots() -> void:
	var us := F.uniforms(_cfg({"main": {"source": MAIN + """
uniform float u_gain = 0.25; //[0.0, 5.0]
uniform vec2 u_off = vec2(0.5);
uniform float u_lo; //[2.0, 4.0]
uniform int u_n; //3
uniform sampler2D u_tex; //https://example.com/a.png
uniform vec2 u_resolution;
uniform sampler2D u_pass1;
"""}}, {"common": "uniform float u_speed; //9.0\nuniform bool u_on; //1\n"}))
	var by := {}
	for u in us:
		by[u.name] = u
	t.eq(us.map(func(u: Dictionary) -> String: return u.name), ["u_speed", "u_on", "u_tint", "u_gain", "u_off", "u_lo", "u_n", "u_tex"],
		"common first, built-ins and u_passN left out, first declaration wins")
	t.eq(by.u_speed["values"], [9.0], "common's u_speed wins over main's")
	t.eq(by.u_tint["values"], [1.0, 0.55, 0.2])
	t.eq([by.u_tint.min, by.u_tint.max], [0.0, 1.0])
	t.eq(by.u_gain["values"], [0.25], "an initialiser is the default")
	t.eq(by.u_off["values"], [0.5, 0.5], "vec2(0.5) fills both, and the 2 of vec2 is not a number")
	t.eq(by.u_lo["values"], [2.0], "no default: 0 pulled into the range")
	t.eq(by.u_n["values"], [3.0])
	t.eq(by.u_tex, {"name": "u_tex", "type": "sampler2D", "url": "https://example.com/a.png"})
	t.eq(us.filter(func(u: Dictionary) -> bool: return u.has("slot")).map(func(u: Dictionary) -> int: return u.slot), [0, 1, 2, 3, 4, 5, 6])
	var f := F.slot_values(us, {"u_gain": 2, "u_tint": [0.1, 0.2], "u_n": "junk"})
	t.eq(f.size(), F.SLOTS * 4)
	t.eq(snappedf(f[3 * 4], 0.001), 2.0, "a number override")
	t.eq([snappedf(f[2 * 4], 0.001), snappedf(f[2 * 4 + 1], 0.001), snappedf(f[2 * 4 + 2], 0.001)], [0.1, 0.2, 0.2],
		"a short array keeps the default for the rest")
	t.eq(f[6 * 4], 3.0, "junk keeps the default")
	t.eq(f[1 * 4], 1.0, "bool default")


func test_main_form_wraps_and_declares_what_it_names() -> void:
	var cfg := _cfg({"main": {"source": MAIN}})
	var us := F.uniforms(cfg)
	var fr := F.fragment("", F.passes(cfg)[0], us)
	var code: String = fr.code
	t.eq(fr.samplers, ["u_audio"], "only u_audio is named")
	t.ok(code.begins_with("#version 450\n"))
	t.ok(code.contains("layout(set = 0, binding = 1) uniform sampler2D u_audio;"))
	t.ok(not code.contains("u_main;") and not code.contains("u_keyboard;"), "unnamed samplers are not declared")
	t.ok(code.contains("#define u_speed (_hgC[0].x)") and code.contains("#define u_tint (_hgC[1].xyz)"))
	t.ok(not RegEx.create_from_string("(?m)^\\s*uniform\\s+float\\s+u_speed").search(code), "the uniform line is gone")
	t.ok(code.contains("void fc_user_main()"), "the shader's main is renamed")
	t.ok(code.contains("fragColor = vec4(0.0);\n\tfc_user_main();"), "the wrapper zeroes fragColor, then calls it")
	t.ok(code.contains("layout(location = 0) out vec4 fragColor;"))
	t.ok(not code.contains("smoothstep(0.0, 0.06"), "no alpha key without the flag")
	var lines := code.split("\n")
	var at := lines.find("#line 1", lines.find("#line 1") + 1)
	t.eq(lines[at + 1], "", "line 1 of the pass (the stripped uniform) stays, so error lines match the editor")


func test_mainimage_form_samplers_and_redeclarations() -> void:
	var src := """#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform sampler2D u_main;
void mainImage(out vec4 o, in vec2 c) {
	vec4 prev = texture(u_main, c / u_resolution);
	vec4 a = texture(u_pass2, c / u_resolution) + texture(u_tex, vec2(0.0));
	vec3 col;
	o = mix(prev, a, 0.1) + vec4(col, 0.0);
}
uniform sampler2D u_tex; //https://x/y.png
"""
	var cfg := _cfg({"main": {"source": src}}, {"opts": {"alpha": true}, "common": "float helper() { return 1.0; }"})
	var fr := F.fragment(cfg.common, F.passes(cfg)[0], F.uniforms(cfg))
	var code: String = fr.code
	t.eq(fr.samplers, ["u_main", "u_pass2", "u_tex"], "binding order: built-ins, passes, custom")
	t.ok(code.contains("binding = 3) uniform sampler2D u_tex;"))
	t.ok(code.contains("mainImage(inout vec4 o"), "out → inout (SPIR-V does not zero it)")
	t.ok(code.contains("mainImage(fragColor, gl_FragCoord.xy);"))
	t.eq(code.count("#version"), 1, "the shader's own #version is dropped")
	t.ok(not code.contains("precision highp"), "precision goes")
	t.eq(code.count("out vec4 fragColor;"), 1, "only the wrapper declares fragColor")
	t.eq(code.count("u_resolution;"), 1, "only the block declares u_resolution")
	t.ok(code.contains("vec3 col = vec3(0);"), "zero-init (shadertoy_glsl.gd)")
	t.ok(code.contains("smoothstep(0.0, 0.06"), "the alpha key on main")
	t.ok(code.contains("float helper()"), "common is in")


func test_ubo_layout_constants() -> void:
	t.eq(F.UBO_SIZE, 432, "176 bytes of built-ins + 16 vec4 slots")
	t.eq(F.C_AT * 4, 176, "the slots start where std140 puts _hgC")
	t.ok(F.BLOCK.contains("vec4 _hgC[%d];"))


func test_custom_3d_and_cube_samplers_keep_their_type() -> void:
	var src := """uniform sampler3D u_tex1; //proc3d:lut3d:32:0:0.1:0.6:35:1:0
uniform samplerCube u_sky;
uniform sampler2D u_vid; //https://x/v.mp4 [flip]
void main() { fragColor = texture(u_tex1, vec3(0.5)) * texture(u_sky, vec3(0.0, 0.0, 1.0)); }
"""
	var cfg := _cfg({"main": {"source": src}})
	var us := F.uniforms(cfg)
	t.eq(us.map(func(u: Dictionary) -> String: return u.type), ["sampler3D", "samplerCube", "sampler2D"])
	t.eq(us[0].url, "proc3d:lut3d:32:0:0.1:0.6:35:1:0")
	var fr := F.fragment("", F.passes(cfg)[0], us)
	t.eq(fr.samplers, ["u_tex1", "u_sky"], "u_vid is declared by the shader but never sampled")
	t.eq(fr.types, ["sampler3D", "samplerCube"])
	t.ok(fr.code.contains("binding = 1) uniform sampler3D u_tex1;") and fr.code.contains("binding = 2) uniform samplerCube u_sky;"))
	t.eq(F.slot_values(us, {}).size(), F.SLOTS * 4, "textures take no value slot")
