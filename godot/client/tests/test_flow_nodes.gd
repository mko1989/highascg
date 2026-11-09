extends RefCounted
## WO-1011 — the Flow node library (flow_nodes.gd), its per-frame logic (flow_eval.gd, after cables.gl ops) and the
## preset patches (flow_presets.gd).

const M := preload("res://features/visuals/visuals_model.gd")
const N := preload("res://features/visuals/flow_nodes.gd")
const E := preload("res://features/visuals/flow_eval.gd")
const P := preload("res://features/visuals/flow_presets.gd")
var t


## Run node `n` for `frames` frames of `dt` with inputs `x` (an Array, or a Callable(frame) → Array). → outputs.
func _run(n: Dictionary, x: Variant, frames := 1, dt := 0.02, buses := {}) -> Array:
	var st := {}
	var out := []
	for f in frames:
		out.append(E.step(n, x.call(f) if x is Callable else x, st, buses, dt))
	return out


func test_library_is_big_and_every_type_runs() -> void:
	t.ok(N.TYPES.size() >= 40, "way more nodes: %d types" % N.TYPES.size())
	for cat in N.CATS:
		t.ok(not N.of_cat(cat).is_empty(), "category %s has nodes" % cat)
	for type in N.TYPES:
		var n := N.make(type, "n", 0, 0)
		t.eq(N.clean(n, M.BUSES, M.PARAMS), n, "%s: make() is already clean" % type)
		var ins: Array = N.ins(type)
		var outs := _run(n, func(f: int) -> Array:
			var x := []
			for i in ins.size():
				x.append(float((f + i) % 3) * 0.5)
			return x, 60)
		t.ok(outs.all(func(v: float) -> bool: return not is_nan(v) and not is_inf(v)), "%s: finite for a minute of input" % type)


func test_lfo_waves_and_beat_clock() -> void:
	var sine := N.make("lfo", "l", 0, 0, {"rate": 1.0})
	var o := _run(sine, [0.0], 25, 0.02)
	t.ok(absf(o[24] - 1.0) < 1e-6, "sine 1 Hz: the top at half a cycle (0..1 range)")
	var sq := N.make("lfo", "l", 0, 0, {"wave": "square", "rate": 1.0, "width": 0.25})
	o = _run(sq, [0.0], 50, 0.02)
	t.eq([o[10], o[45]], [0.0, 1.0], "square: high for the last quarter (pulse width)")
	var beat := N.make("lfo", "l", 0, 0, {"wave": "ramp up", "clock": "beat", "beats": 4.0})
	o = _run(beat, [0.0], 1, 1.0, {"_bpm": 120.0})
	t.ok(absf(o[0] - 0.5) < 1e-6, "120 BPM, 4 beats/cycle: half a cycle in 1 s")
	o = _run(beat, [0.0], 1, 1.0, {})
	t.ok(absf(o[0] - 0.5) < 1e-6, "no tempo lock → 120 BPM")
	var rnd := N.make("lfo", "l", 0, 0, {"wave": "random", "rate": 1.0, "seed": 3.0})
	t.eq(_run(rnd, [0.0], 3, 0.3), _run(rnd, [0.0], 3, 0.3), "random is seeded (repeatable)")


func test_math() -> void:
	var map := N.make("map", "m", 0, 0, {"in_lo": 0.0, "in_hi": 2.0, "out_lo": 10.0, "out_hi": 20.0})
	t.eq(_run(map, [1.0])[0], 15.0, "map range")
	t.eq(_run(map, [5.0])[0], 20.0, "clamped")
	map.clamp = "off"
	t.eq(_run(map, [4.0])[0], 30.0, "unclamped extrapolates")
	t.eq(_run(N.make("mix", "x", 0, 0), [0.0, 1.0, 0.25])[0], 0.25, "mix")
	t.eq(_run(N.make("steps", "s", 0, 0, {"steps": 4.0}), [0.3])[0], 0.25, "quantize to quarters")
	t.eq(_run(N.make("curve", "c", 0, 0), [0.5])[0], 0.5, "Schlick gain keeps the middle")
	t.eq(_run(N.make("ease", "e", 0, 0), [1.0])[0], 1.0, "ease ends at 1")
	t.eq(_run(N.make("compare", "c", 0, 0, {"at": 0.5, "dir": "below"}), [0.2])[0], 1.0, "below the threshold")
	t.eq(_run(N.make("switch", "s", 0, 0), [2.0 / 3.0, 10.0, 20.0, 30.0, 40.0])[0], 30.0, "select ⅔ → input 3")


func test_triggers() -> void:
	var beats := func(f: int) -> Array: return [1.0 if f % 2 == 0 else 0.0, 0.0]  # a hit every other frame
	t.eq(_run(N.make("counter", "c", 0, 0, {"steps": 3.0}), beats, 7), [0.5, 0.5, 1.0, 1.0, 0.0, 0.0, 0.5], "counter loops 0..1")
	t.eq(_run(N.make("nth", "n", 0, 0, {"n": 2.0}), beats, 6), [0.0, 0.0, 1.0, 0.0, 0.0, 0.0], "every 2nd hit passes once")
	t.eq(_run(N.make("toggle", "t", 0, 0), beats, 4), [1.0, 1.0, 0.0, 0.0], "toggle flips per hit")
	var held := _run(N.make("hold", "h", 0, 0, {"ms": 50.0}), func(f: int) -> Array: return [1.0 if f == 0 else 0.0], 4, 0.02)
	t.eq(held, [1.0, 1.0, 1.0, 0.0], "monoflop holds 50 ms")
	var p := _run(N.make("pulse", "p", 0, 0, {"release": 100.0}), func(f: int) -> Array: return [1.0 if f == 0 else 0.0], 3, 0.05)
	t.ok(absf(p[1] - 0.5) < 1e-6 and p[2] == 0.0, "pulse decays linearly over 100 ms")
	var steady := _run(N.make("counter", "c", 0, 0), [1.0, 0.0], 5)
	t.eq(steady[4], steady[0], "a held input is one trigger (edge, not level)")
	var sh := _run(N.make("sample", "s", 0, 0), func(f: int) -> Array: return [float(f), 1.0 if f == 2 else 0.0], 5)
	t.eq(sh, [0.0, 0.0, 2.0, 2.0, 2.0], "sample & hold on the trigger")
	var ch := N.make("chance", "c", 0, 0, {"p": 0.5})
	var hits: float = _run(ch, beats, 400).reduce(func(a: float, v: float) -> float: return a + v, 0.0)
	t.ok(hits > 60 and hits < 140, "chance ≈ half of 200 triggers (%d)" % hits)


func test_animate() -> void:
	var d := _run(N.make("delay", "d", 0, 0, {"ms": 100.0}), func(f: int) -> Array: return [float(f)], 12, 0.02)
	t.eq(d[11], 6.0, "delay 100 ms = 5 frames behind")
	var av := _run(N.make("average", "a", 0, 0, {"ms": 100.0}), func(f: int) -> Array: return [1.0 if f >= 10 else 0.0], 30, 0.02)
	t.ok(av[11] > 0.0 and av[11] < 1.0 and av[29] == 1.0, "average ramps over the window")
	var sp := _run(N.make("spring", "s", 0, 0), func(f: int) -> Array: return [0.0 if f == 0 else 1.0], 600, 0.016)
	t.ok(absf(sp[599] - 1.0) < 0.01 and sp.max() > 1.0, "spring overshoots, then settles on the target")
	var sl := _run(N.make("slew", "s", 0, 0, {"up": 1.0}), func(f: int) -> Array: return [0.0 if f == 0 else 1.0], 11, 0.05)
	t.ok(absf(sl[10] - 0.5) < 1e-6, "slew 1/s: half way after 0.5 s")
	var pk := _run(N.make("peak", "p", 0, 0, {"hold": 100.0, "release": 0.0}), func(f: int) -> Array: return [1.0 if f == 0 else 0.2, 0.0], 8, 0.02)
	t.eq([pk[3], pk[7]], [1.0, 0.2], "peak holds 100 ms, then falls")


func test_ports_links_and_feedback() -> void:
	var g := M.normalize_graph({"nodes": [{"id": "a", "type": "value", "value": 0.25}, {"id": "b", "type": "value", "value": 1.0},
		{"id": "m", "type": "mix", "t": 0.0}, {"id": "p", "type": "param", "param": "glow"}],
		"links": [["a", "m"], ["b", "m", 1], ["b", "m", 7], ["b", "m", 1], ["m", "p"], ["p", "m", 2]]})
	t.eq(g.links, [["a", "m"], ["b", "m", 1], ["m", "p"]], "ports kept, out-of-range / duplicate / from-param dropped")
	t.eq(M.evaluate(g, {}, {"glow": 0.0}, {}, 0.02).glow, 0.25, "Mix fallback 0 → A")
	g.nodes[2].t = 1.0
	t.eq(M.evaluate(g, {}, {"glow": 0.0}, {}, 0.02).glow, 1.0, "Mix field 1 → B")
	var fb := M.normalize_graph({"nodes": [{"id": "v", "type": "value", "value": 0.1}, {"id": "s", "type": "add"},
		{"id": "p", "type": "param", "param": "glow"}], "links": [["v", "s"], ["s", "s", 1], ["s", "p"]]})
	var env := {}
	var glows := []
	for f in 3:
		glows.append(M.evaluate(fb, {}, {"glow": 0.0}, env, 0.02).glow)
	t.ok(absf(glows[0] - 0.1) + absf(glows[1] - 0.2) + absf(glows[2] - 0.3) < 1e-6, "a loop is one-frame feedback (an accumulator), never a hang: %s" % [glows])


func test_presets() -> void:
	t.ok(P.LIST.size() >= 25, "way more presets: %d" % P.LIST.size())
	t.eq(M.default_graph(), P.starter(), "the starter graph is preset 0")
	var buses := M.buses_of({"parts": {"kick": {"onset": 1, "level": 1}, "snare": {"onset": 1}, "energy": 0.7, "bass": 0.5},
		"beat": {"phase": 0.0, "bpm": 128}})
	for i in P.LIST.size():
		var raw := P.graph(i)
		var g := M.normalize_graph(raw)
		t.eq([g.nodes.size(), g.links.size()], [raw.nodes.size(), raw.links.size()], "%s: every node and link is valid" % P.LIST[i][0])
		t.ok(g.nodes.any(func(n: Dictionary) -> bool: return n.type == "param"), "%s drives a parameter" % P.LIST[i][0])
		var env := {}
		var out := {}
		for f in 30:
			out = M.evaluate(g, buses, {}, env, 0.02)
		t.ok(out.values().all(func(v: float) -> bool: return v >= 0.0 and v <= 1.0), "%s: params stay 0..1" % P.LIST[i][0])
	var both := P.add_to(P.graph(1), P.index_of("Camera orbit"))
	var ids: Array = both.nodes.map(func(n: Dictionary) -> String: return n.id)
	t.eq(ids.size(), P.graph(1).nodes.size() + P.graph(P.index_of("Camera orbit")).nodes.size(), "Add keeps both")
	var uniq := {}
	for id in ids:
		uniq[id] = true
	t.eq(uniq.size(), ids.size(), "ids stay unique")
	t.ok(both.nodes[-1].y > P.graph(1).nodes.map(func(n: Dictionary) -> float: return n.y).max(), "the added patch sits below")


func test_preset_layout_has_no_overlaps() -> void:
	for i in P.LIST.size():
		var g := P.graph(i)
		for a in g.nodes:
			for b in g.nodes:
				if a.id < b.id and absf(a.x - b.x) < 1.0:
					var lo: Dictionary = a if a.y <= b.y else b
					var hi: Dictionary = b if lo == a else a
					t.ok(hi.y >= lo.y + P.height(lo.type), "%s: %s and %s do not overlap" % [P.LIST[i][0], a.id, b.id])
