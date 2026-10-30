extends RefCounted
## WO-863 Visuals tab — the WO-861 parts as buses, the Flow graph (normalise, evaluate, envelopes), the project slice, the
## screens Send can target, the render size, the send bodies; and the tab itself built headless (canvas, Flow, page).

const M := preload("res://features/visuals/visuals_model.gd")
const Tab := preload("res://features/visuals/visuals_tab.gd")
var t

const FRAME := {"parts": {"kick": {"level": 0.7, "onset": 1.0, "n": 12}, "snare": {"level": 0.2, "onset": 0.0, "n": 4},
	"bass": 0.8, "loudness": 0.6, "energy": 0.9, "valence": 0.4, "section": "peak", "drop": {"n": 1, "age": 250}},
	"beat": {"bpm": 120, "phase": 0.05}}


func test_buses_of_parts() -> void:
	var b := M.buses_of(FRAME)
	t.eq(b.kick, 1.0, "kick onset pulse")
	t.eq(b["kick.level"], 0.7, "kick level")
	t.eq(b.bass, 0.8, "bass level")
	t.eq(b["section.peak"], 1.0, "section flag")
	t.eq(b["section.build"], 0.0, "other sections 0")
	t.ok(absf(b.drop - 0.75) < 1e-6, "drop pulse decays over 1 s (age 250 ms → 0.75)")
	t.ok(absf(b.beat - 0.8) < 1e-6, "beat pulse 1 − 4·phase")
	t.eq(M.buses_of({"parts": {"drop": {"n": 0, "age": 0}}}).drop, 0.0, "no drop yet → 0")
	var silent := M.buses_of(null)
	t.eq(silent.size(), M.BUSES.size(), "every bus present without a frame")
	t.eq(silent.loudness, 0.0, "no frame → 0")


func test_normalize_graph() -> void:
	t.eq(M.normalize_graph(null), M.default_graph(), "missing → starter graph")
	var g := M.normalize_graph({"nodes": [
		{"id": "a", "type": "bus", "bus": "nope"}, {"id": "a", "type": "param"}, {"id": "s", "type": "shape", "gain": 99},
		{"id": "p", "type": "param", "param": "glow"}, {"id": "x", "type": "weird"}],
		"links": [["a", "s"], ["s", "p"], ["p", "a"], ["s", "a"], ["a", "s"], ["a", "ghost"], ["a"]]})
	t.eq(g.nodes.size(), 3, "duplicate id and unknown type dropped")
	t.eq(g.nodes[0].bus, "loudness", "unknown bus → loudness")
	t.eq(g.nodes[1].gain, 4.0, "gain clamped")
	t.eq(g.links, [["a", "s"], ["s", "p"]], "param → x, x → bus, duplicates and dangling links dropped")


func test_evaluate_binds_audio_onto_base() -> void:
	var g := M.normalize_graph({"nodes": [{"id": "b", "type": "bus", "bus": "bass"}, {"id": "p", "type": "param", "param": "glow"},
		{"id": "b2", "type": "bus", "bus": "energy"}, {"id": "p2", "type": "param", "param": "hue"}],
		"links": [["b", "p"], ["b2", "p2"]]})
	var trace := {}
	var out := M.evaluate(g, M.buses_of(FRAME), {"glow": 0.1, "hue": 0.5}, {}, 0.02, trace)
	t.ok(absf(out.glow - 0.9) < 1e-6, "base 0.1 + bass 0.8")
	t.ok(absf(out.hue - 0.4) < 1e-6, "hue wraps: 0.5 + 0.9 → 0.4")
	t.eq(out.pulse, M.PARAM_DEFAULTS.pulse, "unbound params keep the default base")
	t.eq(trace.b, 0.8, "trace carries the bus value")
	var none := M.evaluate(g, M.buses_of(null), {"glow": 0.1}, {}, 0.02)
	t.eq(none.glow, 0.1, "no audio → the slider's base")


func test_shape_envelope() -> void:
	var g := M.normalize_graph({"nodes": [{"id": "b", "type": "bus", "bus": "kick"},
		{"id": "s", "type": "shape", "gain": 1.0, "attack": 0, "release": 100}, {"id": "p", "type": "param", "param": "pulse"}],
		"links": [["b", "s"], ["s", "p"]]})
	var env := {}
	var hit := M.evaluate(g, M.buses_of(FRAME), {"pulse": 0.0}, env, 0.02)
	t.eq(hit.pulse, 1.0, "attack 0 jumps to the hit")
	var after := M.evaluate(g, M.buses_of(null), {"pulse": 0.0}, env, 0.1)
	t.ok(absf(after.pulse - exp(-1.0)) < 1e-6, "release 100 ms: one time constant later → e^-1")
	var loop := M.normalize_graph({"nodes": [{"id": "s1", "type": "shape"}, {"id": "s2", "type": "shape"},
		{"id": "p", "type": "param"}], "links": [["s1", "s2"], ["s2", "s1"], ["s2", "p"]]})
	t.eq(M.evaluate(loop, {}, {"pulse": 0.3}, {}, 0.02).pulse, 0.3, "a shape loop evaluates (cut), no hang")


func test_slice_screens_and_bodies() -> void:
	var s := M.slice_of({"visuals": {"params": {"glow": 2}, "output": {"screen": 1, "layer": 0, "size": 9}}})
	t.eq(s.params.glow, 1.0, "params clamped")
	t.eq(s.output, {"screen": 1, "layer": 1, "size": M.RENDER_SIZES.size() - 1}, "output clamped")
	t.eq(M.slice_of({}).graph, M.default_graph(), "a project without visuals gets the starter graph")
	var sc := M.screens({"programChannels": [1, 3], "screenLabels": ["Dioda", ""]})
	t.eq(sc, [{"label": "Dioda PGM (ch 1)", "channel": 1}, {"label": "Screen 2 PGM (ch 3)", "channel": 3}], "screens by label")
	t.eq(M.render_size(0, 3840, 1792), Vector2i(1542, 720), "720 p at the LED wall's aspect, even width")
	t.eq(M.render_size(1, 1920, 1080), Vector2i(1920, 1080), "1080 p at 16:9")
	t.eq(M.render_size(0, 0, 0), M.RENDER_SIZES[0], "unknown screen → the preset")
	t.eq(M.play_body(3, 1), {"channel": 3, "layer": 1, "clip": "shm://visuals", "loop": false}, "PLAY body → SHM NAME visuals")
	t.eq(M.stop_body(3, 1), {"channel": 3, "layer": 1}, "STOP body")


func test_tab_builds_headless() -> void:
	var tab: Control = Tab.new()
	tab._ready()  # the runner's root is not inside a tree yet (test_inspector_panel.gd does the same)
	t.ok(tab.out_vp.get_child(0) == tab.scene, "the scene renders in the output viewport")
	t.eq(tab.flow.get_children().filter(func(c: Node) -> bool: return c is GraphNode).size(), M.default_graph().nodes.size(),
		"Flow view shows the starter graph")
	t.ok(tab.can_send() != "" or tab.page.screen_channel() > 0, "send refuses with a reason when it cannot")
	tab._process(0.02)
	t.ok(tab.scene.params.has("pulse"), "a frame evaluates the graph into the scene")
	tab.free()
