extends RefCounted
## WO-874 Shadertoy → Vulkan GLSL: pass order and channel normalisation, the bindings player.js supplies or the library lost,
## the GLSL ES → 450 rewrites (keywords, precision, `out` mainImage, zero-initialised locals) and the Alpha footer. The GPU
## compile of the whole library is a probe (WO-874 §4), not a unit test: the headless runner has no RenderingDevice.

const G := preload("res://features/visuals/shadertoy_glsl.gd")
const ShaderScene := preload("res://features/visuals/scenes/shader.gd")
var t


func test_passes_order_and_channels() -> void:
	var ps := G.passes({"passes": {"image": {"source": "void mainImage(out vec4 c, in vec2 f) { c = texture(iChannel0, f); }",
		"channels": ["A", "audio", "bufferB", "weird"]}, "bufferB": {"source": "x", "channels": ["B"]},
		"bufferA": {"source": "y", "channels": [null, "A"]}, "bufferC": null, "bufferD": {"source": "  "}}})
	t.eq(ps.map(func(p: Dictionary) -> String: return p.name), ["bufferA", "bufferB", "image"], "buffers A–D then image; empty skipped")
	t.eq(ps[2].channels, ["A", "audio", "B", ""], "bufferB → B, unknown → unbound")
	t.eq(ps[0].channels, ["", "A", "", ""], "short channel lists pad to four")
	t.eq(G.letter("bufferC"), "C", "buffer letter")
	t.eq(G.letter("image"), "", "image writes no buffer")
	t.eq(G.passes({"passes": {"bufferA": {"source": "x"}}}), [], "no image pass → nothing")
	t.eq(G.passes(null), [], "not a config → nothing")


func test_repairs_lost_bindings() -> void:
	# sh-chillwave-planet: bufferA is read by nobody and the image samples iChannel0 unbound
	var ps := G.passes({"passes": {"image": {"source": "texture(iChannel0, uv)", "channels": [null, null, null, null]},
		"bufferA": {"source": "a", "channels": [null, null, null, "audio"]}}})
	t.eq(ps[1].channels[0], "A", "an orphan buffer goes on the image channel its code samples")
	# sh-revision-…-cupe: three self-feeding buffers, image binds only audio
	var cupe := G.passes({"passes": {"image": {"source": "iChannel0 iChannel1 iChannel2 iChannel3", "channels": ["audio"]},
		"bufferA": {"source": "a", "channels": ["A"]}, "bufferB": {"source": "b", "channels": ["B"]},
		"bufferC": {"source": "c", "channels": ["C"]}}})
	t.eq(cupe[3].channels, ["audio", "A", "B", "C"], "orphans fill the image's free sampled channels in order")
	var used := G.passes({"passes": {"image": {"source": "iChannel0 iChannel1", "channels": ["A", null]},
		"bufferA": {"source": "a", "channels": []}}})
	t.eq(used[1].channels, ["A", "", "", ""], "a buffer someone reads is left alone")
	var audio := G.passes({"audio": {"enabled": true}, "passes": {"image": {"source": "x", "channels": ["A", null]},
		"bufferA": {"source": "a", "channels": []}}})
	t.eq(audio[1].channels, ["A", "audio", "", ""], "audio.enabled without a binding → first free image channel")
	var off := G.passes({"audio": {"enabled": false}, "passes": {"image": {"source": "x"}}})
	t.eq(off[0].channels, ["", "", "", ""], "audio off → nothing bound")


func test_glsl_rewrites() -> void:
	var f := G.fragment("float buffer = 1.0;", "precision highp float;\nvoid mainImage( out vec4 O, vec2 U ) { O -= O; }\n" +
		"float max3(float a, float b, float c) { return max(a, max(b, c)); }\nvec4 s = texture2D(iChannel0, vec2(0));")
	t.ok(f.begins_with("#version 450"), "Vulkan GLSL 450")
	t.ok(f.contains("float st_buffer = 1.0;"), "GLSL 450 keywords in common renamed")
	t.ok(not f.contains("precision highp"), "precision statements dropped")
	t.ok(f.contains("void mainImage( inout vec4 O"), "mainImage's out → inout (WebGL zeroes it; `O -= O` openers)")
	t.ok(f.contains("float st_max3("), "AMD trinary built-in names renamed")
	t.ok(f.contains("texture(iChannel0"), "texture2D( → texture(")
	t.ok(f.contains("mainImage(c, gl_FragCoord.xy)") and not f.contains("smoothstep(0.0, 0.06"), "plain footer")
	t.ok(G.fragment("", "void mainImage(out vec4 c, in vec2 f) {}", true).contains("smoothstep(0.0, 0.06"), "Alpha footer keys")


func test_zero_init() -> void:
	var code := "struct Hit { float d; vec3 n; };\nvec3 col;\nfloat a, b;\nfloat c = 2.0;\nint i;\nvec3 f(vec3 p);\nx.vec3 q;"
	var z := G._zero_init(code)
	t.ok(z.contains("struct Hit { float d; vec3 n; }"), "struct members untouched (no initialisers allowed)")
	t.ok(z.contains("vec3 col = vec3(0);"), "bare declaration zeroed")
	t.ok(z.contains("float a = float(0), b = float(0);"), "each name of a list zeroed")
	t.ok(z.contains("float c = 2.0;"), "initialised declaration untouched")
	t.ok(z.contains("int i = int(0);"), "ints too")
	t.ok(z.contains("vec3 f(vec3 p);"), "a prototype is not a declaration")


func test_shader_scene_headless() -> void:
	var s: Node3D = ShaderScene.new()
	t.ok(s.set_shader({"passes": {"image": {"source": "void mainImage(out vec4 c, in vec2 f) { c = vec4(1); }"}}}) != "",
		"no RenderingDevice headless → says so instead of crashing")
	t.ok(s.set_shader(null) != "", "no config → an error, not a crash")
	s.set_audio(PackedByteArray([1, 2, 3]))  # wrong size → silence
	s.step({"speed": 0.6}, 0.5, false)
	t.ok(absf(s._time - 1.0) < 1e-6, "speed 0.6 = twice real time (0.3 = 1×)")
	s.step({"speed": 0.3}, 0.1, true)
	t.ok(s._time > 1.1, "a burst surges the clock")
	s.set_overlay(true)
	t.ok(s._mat.shader.code.contains("blend_add"), "layer 2 is additive")
	s.free()
