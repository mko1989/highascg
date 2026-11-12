extends RefCounted
## WO-863 — the Visuals tab's pure half: the WO-861 audio parts as flat 0..1 buses, the Flow graph (WO-858 §6.2 binding table
## as nodes: Audio bus → Shape → Parameter), its per-frame evaluation, the scene parameters and the `project.visuals` slice.
const SC := preload("res://core/screen_channels.gd")

const Auto := preload("res://features/visuals/visuals_autopilot.gd")
const Layers := preload("res://features/visuals/visuals_layers.gd")
const Cam := preload("res://features/visuals/visuals_camera.gd")
const Nodes := preload("res://features/visuals/flow_nodes.gd")  # WO-1011: the Flow node library (cables.gl ops)
const Eval := preload("res://features/visuals/flow_eval.gd")
const Presets := preload("res://features/visuals/flow_presets.gd")
const PARAMS := ["pulse", "spin", "hue", "glow", "flash", "speed", "amount", "burst",
	"cam_yaw", "cam_pitch", "cam_zoom", "strobe"]  # WO-896: cam_* orbit the output camera (0.5 = no offset, visuals_camera.gd)
const PARAM_DEFAULTS := {"pulse": 0.2, "spin": 0.15, "hue": 0.55, "glow": 0.3, "flash": 0.0, "speed": 0.3, "amount": 0.5, "burst": 0.0,
	"cam_yaw": 0.5, "cam_pitch": 0.5, "cam_zoom": 0.5, "strobe": 0.0}
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
		if on:
			out["_bpm"] = _num(beat.get("bpm"))  # WO-1011: the LFO's beat clock (not a bus in the menu)
	return out


## The starter graph (WO-863): kick pumps the rings and bursts (WO-873), energy spins them, valence tints, loudness glows,
## snare flashes. WO-1011: one of the Flow presets (flow_presets.gd).
static func default_graph() -> Dictionary:
	return Presets.starter()


## A stored or hand-edited graph made safe (WO-1011: the node library flow_nodes.gd — known types, clamped properties,
## links `[a, b]` / `[a, b, port]` from an output to an existing input port, no duplicates); not a graph → the starter.
static func normalize_graph(g: Variant) -> Dictionary:
	var out: Variant = Nodes.normalize(g, BUSES, PARAMS)
	return out if out is Dictionary else default_graph()


## One frame: {param: base + Σ bound values}, clamped 0..1 (hue wraps). `env` carries each node's state between frames
## (plain data: {id: {…}}); `trace` (optional) receives every evaluated node's value — the Flow view's meters. A loop
## reads the node's previous-frame output (a one-frame feedback), never recursing forever.
static func evaluate(graph: Dictionary, buses: Dictionary, base: Dictionary, env: Dictionary, dt: float, trace := {}) -> Dictionary:
	var by_id := {}
	for n in graph.nodes:
		by_id[n.id] = n
	var inputs := {}  # id → {port: [source id…]}
	for l in graph.links:
		(inputs.get_or_add(l[1], {}) as Dictionary).get_or_add(Nodes.port_of(l), []).append(l[0])
	var memo := {}
	var out := params_of(base)
	for n in graph.nodes:
		if n.type != "param":
			continue
		var add := 0.0
		for src in (inputs.get(n.id, {}) as Dictionary).get(0, []):
			add += _value(src, by_id, inputs, buses, env, dt, memo)
		out[n.param] = out[n.param] + add
		trace[n.id] = clampf(add, 0.0, 1.0)
	for p in PARAMS:
		out[p] = fposmod(out[p], 1.0) if p == "hue" else clampf(out[p], 0.0, 1.0)
	for id in memo:
		trace[id] = clampf(absf(memo[id]), 0.0, 1.0)
	return out


static func _value(id: String, by_id: Dictionary, inputs: Dictionary, buses: Dictionary, env: Dictionary, dt: float,
		memo: Dictionary) -> float:
	if memo.has(id):
		return memo[id]
	var n: Dictionary = by_id.get(id, {})
	if n.is_empty() or n.type == "param":
		return 0.0
	var st: Dictionary = env[id] if env.get(id) is Dictionary else {}
	memo[id] = float(st.get("o", 0.0))  # while its inputs evaluate: a loop back here reads last frame's output
	var ports: Dictionary = inputs.get(id, {})
	var x := []
	var spec: Array = Nodes.ins(n.type)
	for i in spec.size():
		if ports.has(i):
			var sum := 0.0
			for src in ports[i]:
				sum += _value(src, by_id, inputs, buses, env, dt, memo)
			x.append(sum)
		else:
			var fb: Variant = spec[i][1]
			x.append(float(n.get(fb, 0.0)) if fb is String else float(fb))
	var v := Eval.step(n, x, st, buses, dt)
	if is_nan(v) or is_inf(v):
		v = 0.0
	st.o = v
	env[id] = st
	memo[id] = v
	return v


## Envelope follower: rises with `attack_ms`, falls with `release_ms` (0 = jump).
static func follow(prev: float, x: float, attack_ms: float, release_ms: float, dt: float) -> float:
	return Eval.follow(prev, x, attack_ms, release_ms, dt)


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
## {bars, drops, quantise} — looks changing by themselves and landing on the beat (visuals_autopilot.gd). `layers` (WO-890):
## the layer stack, bottom → top (visuals_layers.gd); an older slice without it migrates from scene / overlay / shader / game,
## and those four are always derived back from the layers (what an older client still reads). `camera` (WO-896): {drive, yaw,
## pitch, dist} — the output stage camera's orbit pose and whether the 3D view drives it (visuals_camera.gd).
## `playlists` (WO-895): the visual playlists, raw (visuals_playlist.gd); `auto.playlist` names the one Auto runs.
## `output2` (WO-1049): {screen, layer} — where the layers routed to output 2 (visuals_layers.gd `out`) play, keyed.
static func slice_of(project: Variant) -> Dictionary:
	var v: Variant = project.get("visuals") if project is Dictionary else null
	var d: Dictionary = v if v is Dictionary else {}
	var o: Dictionary = d.get("output") if d.get("output") is Dictionary else {}
	var layers: Array = Layers.normalize(d.layers) if d.get("layers") is Array else Layers.migrate(d)
	var c := Layers.compat(layers)
	var layer := clampi(int(_num(o.get("layer", 1))), 1, 9999)
	return {"graph": normalize_graph(d.get("graph")), "params": params_of(d.get("params")),
		"output": {"screen": maxi(0, int(_num(o.get("screen")))), "layer": layer,
			"size": clampi(int(_num(o.get("size"))), 0, SIZE_SCREEN), "ring": o.get("ring") is bool and o.ring},
		"output2": output2_of(d.get("output2"), layer),
		"sync": clampf(roundf(_num(d.get("sync"))), -300.0, 300.0), "layers": layers, "scene": c.scene, "overlay": c.overlay,
		"shader": c.shader, "game": c.game, "fade": clampf(_num(d.get("fade", 1.0)), 0.0, 10.0),
		"playlists": d.get("playlists") if d.get("playlists") is Array else [],  # WO-895: raw, like looks (visuals_playlist.gd normalize)
		"dj": d.get("dj") if d.get("dj") is Dictionary else {},  # WO-908: raw, visuals_dj.gd normalizes
		"looks": d.get("looks") if d.get("looks") is Array else [], "auto": Auto.cfg_of(d.get("auto")), "camera": Cam.normalize(d.get("camera"))}


## WO-890: `slice` (changed in place, and returned) with the layer stack `layers` and the fields derived from it.
static func with_layers(slice: Dictionary, layers: Array) -> Dictionary:
	slice.layers = layers
	slice.merge(Layers.compat(layers), true)
	return slice


## The screens Send can target: [{label, channel}] from channelMap.programChannels + screenLabels.
static func screens(cm: Variant) -> Array:
	var out := []
	var c: Dictionary = cm if cm is Dictionary else {}
	var progs: Array = c.get("programChannels") if c.get("programChannels") is Array else []
	var labels: Array = c.get("screenLabels") if c.get("screenLabels") is Array else []
	for i in progs.size():
		if SC.pgm(c, i) < 0:
			continue  # WO-1029: a screen on another linked server cannot be sent to from here
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


## WO-1049: output 2's target, stored or not. Default screen 1 (the second main; output2_target() falls back to the first
## screen when there is none) and the same Caspar layer number as output 1.
static func output2_of(v: Variant, layer1 := 1) -> Dictionary:
	var o: Dictionary = v if v is Dictionary else {}
	return {"screen": maxi(0, int(_num(o.get("screen", 1)))), "layer": clampi(int(_num(o.get("layer", layer1))), 1, 9999)}


## WO-1049: output 2's shm ring — `visuals-2` (a dev --visuals-ring=<n> → `<n>-2`).
static func ring2(ring := RING) -> String:
	return ring + "-2"


## WO-1049: where output 2 PLAYs — {channel, layer} on this server (channel 0 = no screen). `screen` indexes screens(cm),
## the list Send's picker shows; past its end → the first screen (one main only). The same channel AND layer as output 1
## would replace output 1's PLAY, so output 2 then goes one layer up.
static func output2_target(cm: Variant, slice: Dictionary) -> Dictionary:
	var sc := screens(cm)
	var o2: Dictionary = output2_of(slice.get("output2"), int(slice.get("output", {}).get("layer", 1)))
	if sc.is_empty():
		return {"channel": 0, "layer": o2.layer}
	var o1: Dictionary = slice.get("output", {})
	var ch := int(sc[o2.screen if o2.screen < sc.size() else 0].channel)
	var ch1 := int(sc[clampi(int(o1.get("screen", 0)), 0, sc.size() - 1)].channel)
	var layer := int(o2.layer)
	if ch == ch1 and layer == int(o1.get("layer", 1)):
		layer += 1
	return {"channel": ch, "layer": layer}


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
