extends RefCounted
## WO-863 — the Visuals tab's pure half: the WO-861 audio parts as flat 0..1 buses, the Flow graph (WO-858 §6.2 binding table
## as nodes: Audio bus → Shape → Parameter), its per-frame evaluation, the scene parameters and the `project.visuals` slice.

const Auto := preload("res://features/visuals/visuals_autopilot.gd")
const PARAMS := ["pulse", "spin", "hue", "glow", "flash", "speed", "amount", "burst"]
const PARAM_DEFAULTS := {"pulse": 0.2, "spin": 0.15, "hue": 0.55, "glow": 0.3, "flash": 0.0, "speed": 0.3, "amount": 0.5, "burst": 0.0}
## WO-873 scene library (visuals_stage.gd SCENES): [id, label]. `burst` is the event parameter — its rising edge fires the scenes.
const SCENES := [["rings", "Rings"], ["particles", "Particles"], ["starfield", "Starfield"], ["tunnel", "Tunnel"],
	["shader", "Shader"], ["spectrum", "Spectrum"], ["game", "Game"]]  # WO-874: a library shader (`shader` in the slice);
	# WO-875 the live spectrum; WO-876 the operator's game (`game` in the slice: the ROM path)
## Bus names the Flow view offers, in menu order. Drum and drop buses are pulses (1 on the hit, decaying); the rest are levels.
const BUSES := ["kick", "snare", "hats", "kick.level", "snare.level", "hats.level", "bass", "mid", "high", "tonal", "loudness",
	"onset", "density", "arousal", "valence", "energy", "drop", "beat", "section.build", "section.peak", "section.quiet"]
const DROP_PULSE_MS := 1000.0
const RING := "visuals"
const RENDER_SIZES := [Vector2i(1280, 720), Vector2i(1920, 1080), Vector2i(960, 540)]
const SIZE_SCREEN := 3  # WO-883: output.size past the presets = the screen destination's own resolution (1:1, no scaling)


## The WS `audio_fft` frame → {bus: 0..1}. Missing parts read 0 (no FFT source routed).
static func buses_of(frame: Variant) -> Dictionary:
	var out := {}
	for b in BUSES:
		out[b] = 0.0
	if not frame is Dictionary:
		return out
	var p: Variant = frame.get("parts")
	if p is Dictionary:
		for d in ["kick", "snare", "hats"]:
			var hit: Variant = p.get(d)
			if hit is Dictionary:
				out[d] = _f(hit.get("onset"))
				out[d + ".level"] = _f(hit.get("level"))
		for k in ["bass", "mid", "high", "tonal", "loudness", "onset", "density", "arousal", "valence", "energy"]:
			out[k] = _f(p.get(k))
		var drop: Variant = p.get("drop")
		if drop is Dictionary and int(_num(drop.get("n"))) > 0:
			out["drop"] = clampf(1.0 - _num(drop.get("age")) / DROP_PULSE_MS, 0.0, 1.0)
		var sec := str(p.get("section", ""))
		for s in ["build", "peak", "quiet"]:
			out["section." + s] = 1.0 if sec == s else 0.0
	var beat: Variant = frame.get("beat")
	if beat is Dictionary:  # WO-662 phase 0..1 from the last beat → a pulse that is 1 on the beat
		var ph := _num(beat.get("phase"))
		# WO-872: only while locked — the tempo is held through silence, where the dropped grid reads phase 0 (a stuck 1)
		var on := _num(beat.get("bpm")) > 0.0 and bool(beat.get("locked", true))
		out["beat"] = clampf(1.0 - ph * 4.0, 0.0, 1.0) if on else 0.0
	return out


## The starter graph: kick pumps the rings and bursts (WO-873), energy spins them, valence tints, loudness glows, snare flashes.
static func default_graph() -> Dictionary:
	return {"nodes": [
		_node("b1", "bus", 20, 20, {"bus": "kick"}), _node("s1", "shape", 240, 20, {"gain": 1.0, "attack": 5, "release": 180}),
		_node("p1", "param", 470, 20, {"param": "pulse"}),
		_node("b2", "bus", 20, 160, {"bus": "energy"}), _node("p2", "param", 470, 160, {"param": "spin"}),
		_node("b3", "bus", 20, 260, {"bus": "valence"}), _node("s3", "shape", 240, 260, {"gain": 0.4, "attack": 400, "release": 1500}),
		_node("p3", "param", 470, 260, {"param": "hue"}),
		_node("b4", "bus", 20, 400, {"bus": "loudness"}), _node("p4", "param", 470, 400, {"param": "glow"}),
		_node("b5", "bus", 20, 500, {"bus": "snare"}), _node("s5", "shape", 240, 500, {"gain": 0.8, "attack": 0, "release": 120}),
		_node("p5", "param", 470, 500, {"param": "flash"}),
		_node("p6", "param", 470, 90, {"param": "burst"}),
	], "links": [["b1", "s1"], ["s1", "p1"], ["s1", "p6"], ["b2", "p2"], ["b3", "s3"], ["s3", "p3"], ["b4", "p4"], ["b5", "s5"],
		["s5", "p5"]]}


static func _node(id: String, type: String, x: float, y: float, props: Dictionary) -> Dictionary:
	var n := {"id": id, "type": type, "x": x, "y": y}
	n.merge(props)
	return n


## A stored or hand-edited graph made safe: known types only, unique ids, links between existing nodes in the
## bus/shape → shape/param direction, one link per target input pair.
static func normalize_graph(g: Variant) -> Dictionary:
	if not g is Dictionary or not g.get("nodes") is Array:
		return default_graph()
	var nodes := []
	var types := {}
	for n in g.nodes:
		if not n is Dictionary or str(n.get("id", "")) == "" or types.has(str(n.id)):
			continue
		var t := str(n.get("type", ""))
		var c := {"id": str(n.id), "type": t, "x": _num(n.get("x")), "y": _num(n.get("y"))}
		match t:
			"bus":
				c.bus = str(n.get("bus", "")) if str(n.get("bus", "")) in BUSES else "loudness"
			"shape":
				c.gain = clampf(_num(n.get("gain", 1.0)), -4.0, 4.0)
				c.attack = clampf(_num(n.get("attack")), 0.0, 5000.0)
				c.release = clampf(_num(n.get("release")), 0.0, 10000.0)
			"param":
				c.param = str(n.get("param", "")) if str(n.get("param", "")) in PARAMS else "pulse"
			_:
				continue
		types[c.id] = t
		nodes.append(c)
	var links := []
	var seen := {}
	for l in (g.get("links") if g.get("links") is Array else []):
		if not l is Array or l.size() != 2:
			continue
		var a := str(l[0])
		var b := str(l[1])
		if not types.has(a) or not types.has(b) or types[a] == "param" or types[b] == "bus" or seen.has(a + ">" + b):
			continue
		seen[a + ">" + b] = true
		links.append([a, b])
	return {"nodes": nodes, "links": links}


## One frame: {param: base + Σ bound audio}, clamped 0..1 (hue wraps). `env` carries each Shape's follower between frames;
## `trace` (optional) receives every node's value this frame — the Flow view's meters.
static func evaluate(graph: Dictionary, buses: Dictionary, base: Dictionary, env: Dictionary, dt: float, trace := {}) -> Dictionary:
	var by_id := {}
	for n in graph.nodes:
		by_id[n.id] = n
	var inputs := {}
	for l in graph.links:
		if not inputs.has(l[1]):
			inputs[l[1]] = []
		inputs[l[1]].append(l[0])
	var memo := {}
	var out := params_of(base)
	for n in graph.nodes:
		if n.type != "param":
			continue
		var add := 0.0
		for src in inputs.get(n.id, []):
			add += _value(src, by_id, inputs, buses, env, dt, memo, 0)
		out[n.param] = out[n.param] + add
		trace[n.id] = clampf(add, 0.0, 1.0)
	for p in PARAMS:
		out[p] = fposmod(out[p], 1.0) if p == "hue" else clampf(out[p], 0.0, 1.0)
	for id in memo:
		trace[id] = clampf(absf(memo[id]), 0.0, 1.0)
	return out


static func _value(id: String, by_id: Dictionary, inputs: Dictionary, buses: Dictionary, env: Dictionary, dt: float,
		memo: Dictionary, depth: int) -> float:
	if memo.has(id):
		return memo[id]
	var n: Dictionary = by_id.get(id, {})
	var v := 0.0
	if depth > 16:  # a shape loop: cut it, never recurse forever
		return 0.0
	if n.get("type") == "bus":
		v = float(buses.get(n.bus, 0.0))
	elif n.get("type") == "shape":
		var x := 0.0
		for src in inputs.get(id, []):
			x += _value(src, by_id, inputs, buses, env, dt, memo, depth + 1)
		v = follow(float(env.get(id, 0.0)), x, n.attack, n.release, dt)
		env[id] = v
		v *= n.gain
	memo[id] = v
	return v


## Envelope follower: rises with `attack_ms`, falls with `release_ms` (0 = jump).
static func follow(prev: float, x: float, attack_ms: float, release_ms: float, dt: float) -> float:
	var ms := attack_ms if x > prev else release_ms
	if ms <= 0.0:
		return x
	return prev + (x - prev) * (1.0 - exp(-dt * 1000.0 / ms))


static func params_of(v: Variant) -> Dictionary:
	var out := PARAM_DEFAULTS.duplicate()
	if v is Dictionary:
		for p in PARAMS:
			if v.has(p):
				out[p] = clampf(_num(v[p]), 0.0, 1.0)
	return out


## `project.visuals` → {graph, params, output: {screen, layer, size, ring}, sync, scene, overlay} with every field present
## (`ring`, WO-883: the canvas is published as the Live source shm://visuals even when not sent to a screen). `sync`
## (WO-866): ms the drum pulses move against the room sound, −300..300 (visuals_sync.gd). `scene` / `overlay` (WO-873): the main
## scene and the second layer ("" = none, never the main scene twice). `shader` (WO-874): the library shader id the Shader scene
## runs ("" = none picked). `game` (WO-876): the ROM the Game scene's Play opens ("" = none). `fade` (WO-877): seconds a scene
## change crossfades (0 = cut); `looks`: the stored looks, raw (visuals_looks.gd normalize() makes them safe). `auto` (WO-878):
## {bars, drops, quantise} — looks changing by themselves and landing on the beat (visuals_autopilot.gd).
static func slice_of(project: Variant) -> Dictionary:
	var v: Variant = project.get("visuals") if project is Dictionary else null
	var d: Dictionary = v if v is Dictionary else {}
	var o: Dictionary = d.get("output") if d.get("output") is Dictionary else {}
	var main := str(d.get("scene", "")) if scene_ids().has(str(d.get("scene", ""))) else "rings"
	var over := str(d.get("overlay", "")) if scene_ids().has(str(d.get("overlay", ""))) and str(d.get("overlay", "")) != main else ""
	return {"graph": normalize_graph(d.get("graph")), "params": params_of(d.get("params")),
		"output": {"screen": maxi(0, int(_num(o.get("screen")))), "layer": clampi(int(_num(o.get("layer", 1))), 1, 9999),
			"size": clampi(int(_num(o.get("size"))), 0, SIZE_SCREEN), "ring": o.get("ring") is bool and o.ring},
		"sync": clampf(roundf(_num(d.get("sync"))), -300.0, 300.0), "scene": main, "overlay": over,
		"shader": str(d.get("shader", "")) if d.get("shader") is String else "",
		"game": str(d.get("game", "")) if d.get("game") is String else "",
		"fade": clampf(_num(d.get("fade", 1.0)), 0.0, 10.0), "looks": d.get("looks") if d.get("looks") is Array else [],
		"auto": Auto.cfg_of(d.get("auto"))}


static func scene_ids() -> Array:
	return SCENES.map(func(s: Array) -> String: return s[0])


## The screens Send can target: [{label, channel}] from channelMap.programChannels + screenLabels.
static func screens(cm: Variant) -> Array:
	var out := []
	var c: Dictionary = cm if cm is Dictionary else {}
	var progs: Array = c.get("programChannels") if c.get("programChannels") is Array else []
	var labels: Array = c.get("screenLabels") if c.get("screenLabels") is Array else []
	for i in progs.size():
		var own := str(labels[i]) if i < labels.size() and labels[i] != null and str(labels[i]) != "" else "Screen %d" % (i + 1)
		out.append({"label": "%s PGM (ch %d)" % [own, int(_num(progs[i]))], "channel": int(_num(progs[i]))})
	return out


## The render size for a screen of `w`×`h`: the chosen preset's height at the screen's aspect (Caspar scales to the channel);
## SIZE_SCREEN (WO-883) is the screen itself, even-rounded and at most 8192 wide (1080 p until the screen is known).
static func render_size(preset: int, w: float, h: float) -> Vector2i:
	if preset == SIZE_SCREEN and w > 0.0 and h > 0.0:
		var k := minf(1.0, 8192.0 / w)
		return Vector2i(maxi(16, roundi(w * k / 2.0) * 2), maxi(16, roundi(h * k / 2.0) * 2))
	var p: Vector2i = RENDER_SIZES[clampi(preset, 0, RENDER_SIZES.size() - 1) if preset != SIZE_SCREEN else 1]
	if w <= 0.0 or h <= 0.0:
		return p
	return Vector2i(maxi(16, roundi(p.y * w / h / 2.0) * 2), p.y)


static func play_body(channel: int, layer: int, ring := RING) -> Dictionary:
	return {"channel": channel, "layer": layer, "clip": "shm://" + ring, "loop": false}


static func stop_body(channel: int, layer: int) -> Dictionary:
	return {"channel": channel, "layer": layer}


static func _f(v: Variant) -> float:
	return clampf(_num(v), 0.0, 1.0)


static func _num(v: Variant) -> float:
	if v is float or v is int:
		return float(v)
	if v is String and (v as String).is_valid_float():
		return (v as String).to_float()
	return 0.0
