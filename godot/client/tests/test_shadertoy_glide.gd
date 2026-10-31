extends RefCounted
## WO-894 phase 2: Visuals ▸ Shader values glide through UBO slots — literal parsing, eligibility, the plan (one compile
## for a new literal, none for a drag on the same one, the plain source for anything structural), easing and the UBO tail.

const Glide := preload("res://features/visuals/shadertoy_glide.gd")
const G := preload("res://features/visuals/shadertoy_glsl.gd")
var t

const SRC := """// zoom 2.0 in a comment
const float K = 0.5;
#define GAIN 1.5
float g = 3.0;
void mainImage(out vec4 o, in vec2 f) {
	vec2 uv = f / 400.0 * 2.0;
	int n = 3;
	o = vec4(vec3(uv.x * 0.25 * GAIN), 1.0) * K * g;
}
"""


func _src(zoom := "2.0", tint := "0.25") -> String:
	return SRC.replace("f / 400.0 * 2.0", "f / 400.0 * " + zoom).replace("uv.x * 0.25", "uv.x * " + tint)


func _lit(src: String, text: String) -> int:  # the index of the literal at `text`'s first occurrence after the comment
	var p := Glide.parse(src)
	var at := src.find(text, src.find("\n"))
	for i in p.lits.size():
		if p.lits[i].at == at:
			return i
	return -1


func test_parse_skips_comments_and_ints() -> void:
	var p := Glide.parse(SRC)
	t.eq(p.lits.map(func(l: Dictionary) -> float: return l.v), [0.5, 1.5, 3.0, 400.0, 2.0, 0.25, 1.0], "floats only, comment masked")
	t.eq(p.m.length(), SRC.length(), "the mask keeps every offset")


func test_eligible() -> void:
	var m: String = Glide.parse(SRC).m
	t.eq(Glide.eligible(m, SRC.find("0.5;")), false, "a const initialiser: no")
	t.eq(Glide.eligible(m, SRC.find("3.0;")), false, "a global initialiser: no")
	t.eq(Glide.eligible(m, SRC.find("2.0;")), true, "in the function body: yes")
	t.eq(Glide.eligible(m, SRC.find("1.5")), true, "a #define used only in functions: yes")
	var used_global := "#define R 0.5\nfloat q = R;\nvoid f() { float a = R; }\n"
	t.eq(Glide.eligible(Glide.parse(used_global).m, used_global.find("0.5")), false, "a #define also used globally: no")


func test_diff() -> void:
	t.eq(Glide.diff(_src(), _src("2.5")).changed, [_lit(_src(), "2.0;")], "one literal")
	t.eq(Glide.diff(_src(), _src().replace("uv.x", "uv.y")), {}, "structural → none")
	t.eq(Glide.diff(_src(), _src().replace("zoom 2.0", "zoom 3.0")), {}, "a comment edit is structural too")


func test_plan_drag_compiles_once() -> void:
	var gl := Glide.new()
	var first := gl.plan({"common": "", "image": _src()})
	t.eq([first.compile, first.sources.image], [true, _src()], "first: the plain source compiles")
	var a := gl.plan({"common": "", "image": _src("2.5")})
	t.eq(a.compile, true, "a new literal: one compile")
	t.ok(a.sources.image.contains("f / 400.0 * _hgG[0][0];"), "it reads slot 0")
	t.eq(gl.values("image")[0], 2.0, "starting from the old value")
	var b := gl.plan({"common": "", "image": _src("3.0")})
	t.eq(b.compile, false, "the same literal again: no compile")
	for i in 200:
		gl.frame(0.05)
	t.eq(gl.values("image")[0], 3.0, "eased onto the target")
	var c := gl.plan({"common": "", "image": _src("3.0", "0.5")})
	t.eq(c.compile, true, "a second literal: one more slot")
	t.ok(c.sources.image.contains("f / 400.0 * _hgG[0][0];") and c.sources.image.contains("uv.x * _hgG[0][1] * GAIN"), "slots 0 and 1")
	t.eq(gl.values("image").size(), 2 * Glide.SLOTS, "pass slots then common's")


func test_plan_hard_paths() -> void:
	var gl := Glide.new()
	gl.plan({"common": "", "image": _src()})
	gl.plan({"common": "", "image": _src("2.5")})
	var s := gl.plan({"common": "", "image": _src().replace("uv.x", "uv.y")})
	t.eq([s.compile, s.sources.image.contains("_hgG")], [true, false], "structural → plain source, slots dropped")
	var k := gl.plan({"common": "", "image": _src().replace("uv.x", "uv.y").replace("K = 0.5", "K = 0.7")})
	t.eq([k.compile, k.sources.image.contains("_hgG")], [true, false], "a const value → plain source")


func test_common_slots() -> void:
	var gl := Glide.new()
	var common := "float shade(float x) { return x * 0.5; }\n"
	gl.plan({"common": common, "image": _src()})
	var p := gl.plan({"common": common.replace("0.5", "0.8"), "image": _src()})
	t.eq(p.compile, true, "a common literal: one compile")
	t.ok(p.sources.common.contains("x * _hgG[8][0]"), "common's slots start at 32 (_hgG[8])")
	t.eq(p.sources.image, _src(), "the pass is untouched")
	t.eq(gl.values("image")[Glide.SLOTS], 0.5, "every pass's UBO carries common's slots")


func test_save_restore_and_header() -> void:
	var gl := Glide.new()
	gl.plan({"common": "", "image": _src()})
	gl.plan({"common": "", "image": _src("2.5")})
	var saved := gl.save()
	gl.plan({"common": "", "image": _src().replace("uv.x", "uv.y")})
	gl.restore(saved)
	t.eq(gl.plan({"common": "", "image": _src("2.7")}).compile, false, "restored: the running slots still drive")
	t.ok(G.HEADER.contains("vec4 _hgG[16];"), "the UBO declares the slots")
	t.eq(G.UBO_SIZE, (48 + 2 * Glide.SLOTS) * 4, "UBO size = ShaderToy block + 64 slots")
