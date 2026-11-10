extends RefCounted
## The `strobe` look parameter (the whole picture towards white, in the mixer's final composite) and the Strobe Flow presets.

const M := preload("res://features/visuals/visuals_model.gd")
const P := preload("res://features/visuals/flow_presets.gd")
const Mixer := preload("res://features/visuals/visuals_mixer.gd")
var t


func _targets(name: String) -> Array:
	var g := P.graph(P.index_of(name))
	return g.nodes.filter(func(n: Dictionary) -> bool: return n.type == "param").map(func(n: Dictionary) -> String: return n.param)


func test_param_tables() -> void:
	t.ok(M.PARAMS.has("strobe"), "strobe is a Flow / MIDI / page parameter")
	t.eq(M.PARAM_DEFAULTS.strobe, 0.0, "default off")
	t.eq(M.params_of({"glow": 0.5}).strobe, 0.0, "a look saved without strobe loads with 0")
	t.eq(M.params_of({"strobe": 3}).strobe, 1.0, "clamped 0..1")
	t.ok(M.slice_of({"visuals": {"params": {"glow": 0.2}}}).params.has("strobe"), "an old project slice gets it")


func test_presets() -> void:
	for n in ["Four on the floor strobe", "Build-up tension", "Peak strobe"]:
		t.ok(_targets(n).has("strobe") and not _targets(n).has("flash"), "%s drives strobe, not flash" % n)
	for n in ["Starter", "Snare flash"]:
		t.ok(_targets(n).has("flash"), "%s keeps the flash glow" % n)
	var grp: Array = P.groups().get("Strobe", [])
	var names: Array = grp.map(func(i: int) -> String: return P.LIST[i][0])
	for n in ["Strobe", "Beat strobe 1/4", "Beat strobe 1/8", "Beat strobe 1/16", "Kick strobe", "Snare strobe"]:
		t.ok(names.has(n), "%s is in the Strobe group" % n)
		t.eq(_targets(n), ["strobe"], "%s drives strobe only" % n)
	# a free strobe at 4 Hz, 15 %: on for ~3 of 20 frames per cycle at 50 fps
	var g := M.normalize_graph(P.graph(P.index_of("Strobe")))
	var env := {}
	var on := 0
	for f in 250:
		on += 1 if M.evaluate(g, {}, {}, env, 0.02).strobe > 0.5 else 0
	t.ok(on > 20 and on < 50, "free strobe duty ~15 %%: %d of 250 frames" % on)
	var kick := M.normalize_graph(P.graph(P.index_of("Kick strobe")))
	var e2 := {}
	t.eq(M.evaluate(kick, {"kick": 1.0}, {}, e2, 0.02).strobe, 1.0, "a kick flashes")
	t.eq(M.evaluate(kick, {"kick": 0.0}, {}, e2, 0.2).strobe, 0.0, "and lets go")


func test_mixer_overlay() -> void:
	var m: Node = Mixer.new()
	m.go([{"scene": "rings"}], {}, 0.0, true)
	m.deck().params = M.PARAM_DEFAULTS.duplicate()
	m.step(0.02)
	t.eq(m.strobe, 0.0, "strobe 0: no white")
	var p: Dictionary = M.PARAM_DEFAULTS.duplicate()
	p.strobe = 1.0
	m.deck().params = p
	m.step(0.02)
	t.eq([m.strobe, m._mat.get_shader_parameter("strobe")], [1.0, 1.0], "strobe 1: full white in the final composite")
	t.ok(m._mat.shader.code.contains("mix(c, vec3(1.0), strobe) * master"), "applied above both decks, before the master")
