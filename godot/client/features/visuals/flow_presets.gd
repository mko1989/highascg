extends RefCounted
## WO-1011 — ready-made Flow patches (the Flow view's Presets menu: replace the graph, or add one beside it). Built from
## the flow_nodes.gd library (op logic after cables.gl, see THIRD_PARTY_NOTICES). The parameters they drive are
## visuals_model.gd PARAMS: pulse · spin · hue · glow · flash · speed · amount · burst (a rising edge fires the scenes) ·
## cam_yaw / cam_pitch / cam_zoom (0.5 = no offset).
## A node spec is [id, type, column, row, {props}]; a link is [from, to] or [from, to, input port].

const N := preload("res://features/visuals/flow_nodes.gd")
const COL := 230.0
const ROW := 120.0

## [name, group, what it does, nodes, links]
const LIST := [
	["Starter", "Basics", "Kick pumps and bursts, energy spins, valence tints, loudness glows, snare flashes.", [], []],
	["Kick pump", "Basics", "Every kick swells the pulse and fires a burst.",
		[["b", "bus", 0, 0, {"bus": "kick"}], ["s", "shape", 1, 0, {"attack": 0.0, "release": 220.0}], ["p", "param", 2, 0, {"param": "pulse"}],
		["p2", "param", 2, 1, {"param": "burst"}]], [["b", "s"], ["s", "p"], ["b", "p2"]]],
	["Sidechain dip", "Basics", "The picture ducks on every kick and breathes back, like a sidechained pad.",
		[["b", "bus", 0, 0, {"bus": "kick"}], ["s", "shape", 1, 0, {"attack": 0.0, "release": 350.0}], ["i", "invert", 2, 0, {}],
		["m", "mul", 3, 0, {"b": 0.6}], ["p", "param", 4, 0, {"param": "amount"}]], [["b", "s"], ["s", "i"], ["i", "m"], ["m", "p"]]],
	["Hats shimmer", "Basics", "Hi-hats add a quick glow sparkle.",
		[["b", "bus", 0, 0, {"bus": "hats"}], ["s", "shape", 1, 0, {"attack": 0.0, "release": 90.0, "gain": 0.6}], ["p", "param", 2, 0, {"param": "glow"}]],
		[["b", "s"], ["s", "p"]]],
	["Snare flash", "Basics", "A white flash on every snare.",
		[["b", "bus", 0, 0, {"bus": "snare"}], ["u", "pulse", 1, 0, {"release": 140.0}], ["p", "param", 2, 0, {"param": "flash"}]], [["b", "u"], ["u", "p"]]],
	["Mood colour", "Mood", "Valence picks the hue (sad = blue, happy = warm), arousal drives the glow.",
		[["v", "bus", 0, 0, {"bus": "valence"}], ["sm", "smooth", 1, 0, {"up": 60.0, "down": 60.0}], ["m", "map", 2, 0, {"out_lo": 0.62, "out_hi": 0.05, "ease": "smoothstep"}],
		["p", "param", 3, 0, {"param": "hue"}], ["a", "bus", 0, 1, {"bus": "arousal"}], ["sp", "spring", 1, 1, {"damping": 0.4, "stiffness": 0.3}],
		["p2", "param", 3, 1, {"param": "glow"}]], [["v", "sm"], ["sm", "m"], ["m", "p"], ["a", "sp"], ["sp", "p2"]]],
	["Energy speed", "Mood", "The track's energy, averaged over two seconds, sets the speed and the spin.",
		[["e", "bus", 0, 0, {"bus": "energy"}], ["av", "average", 1, 0, {"ms": 2000.0}], ["m", "map", 2, 0, {"out_lo": 0.15, "out_hi": 0.9}],
		["p", "param", 3, 0, {"param": "speed"}], ["p2", "param", 3, 1, {"param": "spin"}]], [["e", "av"], ["av", "m"], ["m", "p"], ["m", "p2"]]],
	["Tonal glow", "Mood", "Melodic passages bloom: tonal content springs the glow up.",
		[["t", "bus", 0, 0, {"bus": "tonal"}], ["sp", "spring", 1, 0, {"damping": 0.3, "stiffness": 0.4}], ["c", "curve", 2, 0, {"gain": 0.3}],
		["p", "param", 3, 0, {"param": "glow"}]], [["t", "sp"], ["sp", "c"], ["c", "p"]]],
	["Breathing ambient", "Motion", "No audio needed: slow sine breathing on the glow and a drifting hue.",
		[["l", "lfo", 0, 0, {"rate": 0.12, "lo": 0.15, "hi": 0.6}], ["p", "param", 1, 0, {"param": "glow"}],
		["l2", "lfo", 0, 1, {"wave": "smooth random", "rate": 0.05, "lo": -0.15, "hi": 0.15, "seed": 3.0}], ["p2", "param", 1, 1, {"param": "hue"}]],
		[["l", "p"], ["l2", "p2"]]],
	["Hue per bar", "Motion", "The hue walks once round the wheel every 4 beats, locked to the tempo.",
		[["l", "lfo", 0, 0, {"wave": "ramp up", "clock": "beat", "beats": 4.0}], ["p", "param", 1, 0, {"param": "hue"}]], [["l", "p"]]],
	["Camera orbit", "Camera", "The output camera circles every 16 beats and nods every 8.",
		[["l", "lfo", 0, 0, {"clock": "beat", "beats": 16.0, "lo": 0.2, "hi": 0.8}], ["p", "param", 1, 0, {"param": "cam_yaw"}],
		["l2", "lfo", 0, 1, {"wave": "triangle", "clock": "beat", "beats": 8.0, "lo": 0.38, "hi": 0.62}], ["p2", "param", 1, 1, {"param": "cam_pitch"}]],
		[["l", "p"], ["l2", "p2"]]],
	["Bass zoom", "Camera", "Bass pushes the camera in on a spring.",
		[["b", "bus", 0, 0, {"bus": "bass"}], ["sp", "spring", 1, 0, {"damping": 0.25, "stiffness": 0.6}], ["m", "map", 2, 0, {"out_lo": 0.5, "out_hi": 0.25}],
		["p", "param", 3, 0, {"param": "cam_zoom"}]], [["b", "sp"], ["sp", "m"], ["m", "p"]]],
	["Kick camera jump", "Camera", "Each kick throws the camera to a random angle, eased in.",
		[["b", "bus", 0, 0, {"bus": "kick"}], ["r", "random", 1, 0, {"lo": 0.25, "hi": 0.75, "seed": 7.0}], ["sm", "smooth", 2, 0, {"up": 6.0, "down": 6.0}],
		["p", "param", 3, 0, {"param": "cam_yaw"}]], [["b", "r"], ["r", "sm"], ["sm", "p"]]],
	["Noise wander", "Camera", "Slow noise drifts the camera and the spin — never repeats.",
		[["n1", "noise", 0, 0, {"rate": 0.15, "lo": 0.3, "hi": 0.7, "seed": 2.0}], ["p", "param", 1, 0, {"param": "cam_yaw"}],
		["n2", "noise", 0, 1, {"rate": 0.1, "lo": 0.42, "hi": 0.58, "seed": 9.0}], ["p2", "param", 1, 1, {"param": "cam_pitch"}],
		["n3", "noise", 0, 2, {"rate": 0.3, "lo": 0.1, "hi": 0.5, "seed": 4.0}], ["p3", "param", 1, 2, {"param": "spin"}]],
		[["n1", "p"], ["n2", "p2"], ["n3", "p3"]]],
	["Four on the floor strobe", "Rhythm", "A short white hit on every beat.",
		[["b", "bus", 0, 0, {"bus": "beat"}], ["h", "hold", 1, 0, {"ms": 50.0}], ["m", "mul", 2, 0, {"b": 0.8}], ["p", "param", 3, 0, {"param": "flash"}]],
		[["b", "h"], ["h", "m"], ["m", "p"]]],
	["Every 4th beat burst", "Rhythm", "A particle burst on the one of every bar.",
		[["b", "bus", 0, 0, {"bus": "beat"}], ["n", "nth", 1, 0, {"n": 4.0}], ["p", "param", 2, 0, {"param": "burst"}],
		["u", "pulse", 2, 1, {"release": 400.0}], ["p2", "param", 3, 1, {"param": "pulse"}]], [["b", "n"], ["n", "p"], ["n", "u"], ["u", "p2"]]],
	["Half-time pulse", "Rhythm", "Pulses on every other beat — a heavier, half-time feel.",
		[["b", "bus", 0, 0, {"bus": "beat"}], ["n", "nth", 1, 0, {"n": 2.0}], ["u", "pulse", 2, 0, {"release": 500.0}], ["p", "param", 3, 0, {"param": "pulse"}]],
		[["b", "n"], ["n", "u"], ["u", "p"]]],
	["Snare hue steps", "Rhythm", "Each snare steps the hue through 8 colours.",
		[["b", "bus", 0, 0, {"bus": "snare"}], ["c", "counter", 1, 0, {"steps": 8.0}], ["m", "mul", 2, 0, {"b": 0.875}], ["p", "param", 3, 0, {"param": "hue"}]],
		[["b", "c"], ["c", "m"], ["m", "p"]]],
	["Kick / snare toggle", "Rhythm", "Kick and snare flip the camera between two angles.",
		[["k", "bus", 0, 0, {"bus": "kick"}], ["s", "bus", 0, 1, {"bus": "snare"}], ["o", "or", 1, 0, {}], ["t", "toggle", 2, 0, {}],
		["m", "map", 3, 0, {"out_lo": 0.35, "out_hi": 0.65}], ["sl", "slew", 4, 0, {"up": 3.0, "down": 3.0}], ["p", "param", 5, 0, {"param": "cam_yaw"}]],
		[["k", "o"], ["s", "o", 1], ["o", "t"], ["t", "m"], ["m", "sl"], ["sl", "p"]]],
	["Random cuts", "Rhythm", "On about a third of the beats: a hard cut to a new hue with a flash.",
		[["b", "bus", 0, 0, {"bus": "beat"}], ["c", "chance", 1, 0, {"p": 0.33, "seed": 5.0}], ["r", "random", 2, 0, {"seed": 11.0}],
		["p", "param", 3, 0, {"param": "hue"}], ["u", "pulse", 2, 1, {"release": 120.0}], ["p2", "param", 3, 1, {"param": "flash"}]],
		[["b", "c"], ["c", "r"], ["r", "p"], ["c", "u"], ["u", "p2"]]],
	["Onset sparkle", "Rhythm", "Strong onsets (any instrument) fire a burst and a glow sparkle.",
		[["o", "bus", 0, 0, {"bus": "onset"}], ["c", "compare", 1, 0, {"at": 0.6}], ["p", "param", 2, 0, {"param": "burst"}],
		["u", "pulse", 2, 1, {"release": 250.0, "level": 0.7}], ["p2", "param", 3, 1, {"param": "glow"}]], [["o", "c"], ["c", "p"], ["c", "u"], ["u", "p2"]]],
	["Build-up tension", "Song", "During a build the speed and spin climb and a 1/8 strobe creeps in.",
		[["b", "bus", 0, 0, {"bus": "section.build"}], ["sl", "slew", 1, 0, {"up": 0.08, "down": 1.0}], ["p", "param", 2, 0, {"param": "speed"}],
		["p2", "param", 2, 1, {"param": "spin"}], ["l", "lfo", 0, 2, {"wave": "square", "clock": "beat", "beats": 0.5, "width": 0.25}],
		["m", "mul", 1, 2, {}], ["m2", "mul", 2, 2, {"b": 0.6}], ["p3", "param", 3, 2, {"param": "flash"}]],
		[["b", "sl"], ["sl", "p"], ["sl", "p2"], ["l", "m"], ["sl", "m", 1], ["m", "m2"], ["m2", "p3"]]],
	["Drop explosion", "Song", "The drop: a burst, a two-second flash-out and a speed kick.",
		[["d", "bus", 0, 0, {"bus": "drop"}], ["c", "compare", 1, 0, {"at": 0.9}], ["p", "param", 2, 0, {"param": "burst"}],
		["u", "pulse", 2, 1, {"release": 2000.0}], ["p2", "param", 3, 1, {"param": "flash"}], ["s", "shape", 2, 2, {"attack": 0.0, "release": 3000.0}],
		["p3", "param", 3, 2, {"param": "speed"}]], [["d", "c"], ["c", "p"], ["c", "u"], ["u", "p2"], ["d", "s"], ["s", "p3"]]],
	["Peak strobe", "Song", "In the loudest section: a 1/16 strobe; elsewhere nothing.",
		[["l", "lfo", 0, 0, {"wave": "square", "clock": "beat", "beats": 0.25, "width": 0.3}], ["pk", "bus", 0, 1, {"bus": "section.peak"}],
		["g", "gate", 1, 0, {}], ["m", "mul", 2, 0, {"b": 0.7}], ["p", "param", 3, 0, {"param": "flash"}]],
		[["l", "g"], ["pk", "g", 1], ["g", "m"], ["m", "p"]]],
	["Quiet drift", "Song", "In quiet passages the picture slows, dims and drifts on noise.",
		[["q", "bus", 0, 0, {"bus": "section.quiet"}], ["sl", "slew", 1, 0, {"up": 0.3, "down": 0.3}], ["n", "noise", 0, 1, {"rate": 0.08, "lo": 0.05, "hi": 0.25}],
		["e", "bus", 0, 2, {"bus": "energy"}], ["mx", "mix", 2, 1, {}], ["p", "param", 3, 1, {"param": "speed"}], ["i", "invert", 2, 0, {}],
		["m", "mul", 3, 0, {"b": 0.6}], ["p2", "param", 4, 0, {"param": "amount"}]],
		[["q", "sl"], ["e", "mx"], ["n", "mx", 1], ["sl", "mx", 2], ["mx", "p"], ["sl", "i"], ["i", "m"], ["m", "p2"]]],
	["Density spin", "Song", "Busy passages spin faster; the average keeps it from twitching.",
		[["d", "bus", 0, 0, {"bus": "density"}], ["av", "average", 1, 0, {"ms": 1500.0}], ["e", "ease", 2, 0, {"trans": "quad", "ease": "in"}],
		["p", "param", 3, 0, {"param": "spin"}]], [["d", "av"], ["av", "e"], ["e", "p"]]],
	["Loudness peak glow", "Song", "The glow holds the loudest moment, then falls slowly.",
		[["l", "bus", 0, 0, {"bus": "loudness"}], ["pk", "peak", 1, 0, {"hold": 400.0, "release": 1500.0}], ["p", "param", 2, 0, {"param": "glow"}]],
		[["l", "pk"], ["pk", "p"]]],
	["Echo pulse", "Rhythm", "Each kick pulses twice: now and again 180 ms later (a delay echo).",
		[["b", "bus", 0, 0, {"bus": "kick"}], ["dl", "delay", 1, 1, {"ms": 180.0}], ["mx", "max", 2, 0, {"b": 0.0}], ["u", "pulse", 3, 0, {"release": 160.0}],
		["p", "param", 4, 0, {"param": "pulse"}]], [["b", "mx"], ["b", "dl"], ["dl", "mx", 1], ["mx", "u"], ["u", "p"]]],
	["Scene shuffle", "Rhythm", "A counter on the bar picks one of four hues through a switch.",
		[["b", "bus", 0, 0, {"bus": "beat"}], ["n", "nth", 1, 0, {"n": 4.0}], ["c", "counter", 2, 0, {"steps": 4.0}], ["v1", "value", 2, 1, {"value": 0.0}],
		["v2", "value", 2, 2, {"value": 0.25}], ["v3", "value", 2, 3, {"value": 0.5}], ["v4", "value", 2, 4, {"value": 0.75}], ["sw", "switch", 3, 0, {}],
		["p", "param", 4, 0, {"param": "hue"}]],
		[["b", "n"], ["n", "c"], ["c", "sw"], ["v1", "sw", 1], ["v2", "sw", 2], ["v3", "sw", 3], ["v4", "sw", 4], ["sw", "p"]]],
]


## The preset names, grouped: {group: [index…]} in list order.
static func groups() -> Dictionary:
	var out := {}
	for i in LIST.size():
		var g: String = LIST[i][1]
		if not out.has(g):
			out[g] = []
		out[g].append(i)
	return out


static func index_of(name: String) -> int:
	for i in LIST.size():
		if LIST[i][0] == name:
			return i
	return -1


## Preset `i` as a graph; node ids prefixed with `prefix`, positions offset by `at` (Add beside an existing patch).
static func graph(i: int, prefix := "", at := Vector2.ZERO) -> Dictionary:
	if i == 0:
		return starter() if prefix == "" and at == Vector2.ZERO else _moved(starter(), prefix, at)
	var nodes := []
	var bottom := {}  # column → y below its last node (taller nodes push the next one down: no overlap)
	for s in LIST[i][3]:
		var y: float = maxf(20.0 + s[3] * ROW, float(bottom.get(s[2], 0.0)))
		bottom[s[2]] = y + height(s[1]) + 20.0
		nodes.append(N.make(s[1], prefix + s[0], 20.0 + s[2] * COL + at.x, y + at.y, s[4]))
	var links := []
	for l in LIST[i][4]:
		links.append([prefix + l[0], prefix + l[1]] if l.size() == 2 else [prefix + l[0], prefix + l[1], l[2]])
	return {"nodes": nodes, "links": links}


## About how tall a node of `type` draws in the Flow view (title + one row per input / field).
static func height(type: String) -> float:
	var spec: Dictionary = N.TYPES[type]
	var inline := 0
	for inp in spec.ins:
		if inp[1] is String:
			inline += 1
	var lone: bool = spec.ins.size() == 1 and not (spec.ins[0][1] is String) and not spec.props.is_empty()
	return 44.0 + 31.0 * maxi(1, (0 if lone else spec.ins.size()) + spec.props.size() - inline)


## Graph `g` with preset `i` added below it (fresh ids, no clash) — Presets ▸ Add.
static func add_to(g: Dictionary, i: int) -> Dictionary:
	var bottom := 0.0
	var ids := {}
	for n in g.nodes:
		bottom = maxf(bottom, float(n.y) + height(str(n.type)))
		ids[n.id] = true
	var k := 1
	while ids.keys().any(func(id: String) -> bool: return id.begins_with("x%d_" % k)):
		k += 1
	var add := graph(i, "x%d_" % k, Vector2(0, bottom + (40.0 if not g.nodes.is_empty() else 0.0)))
	return {"nodes": g.nodes + add.nodes, "links": g.links + add.links}


## WO-863's starter graph (the default of a new project): kick pumps the rings and bursts (WO-873), energy spins them,
## valence tints, loudness glows, snare flashes.
static func starter() -> Dictionary:
	return {"nodes": [
		N.make("bus", "b1", 20, 20, {"bus": "kick"}), N.make("shape", "s1", 240, 20, {"gain": 1.0, "attack": 5.0, "release": 180.0}),
		N.make("param", "p1", 470, 20, {"param": "pulse"}),
		N.make("bus", "b2", 20, 180, {"bus": "energy"}), N.make("param", "p2", 470, 180, {"param": "spin"}),
		N.make("bus", "b3", 20, 260, {"bus": "valence"}), N.make("shape", "s3", 240, 260, {"gain": 0.4, "attack": 400.0, "release": 1500.0}),
		N.make("param", "p3", 470, 260, {"param": "hue"}),
		N.make("bus", "b4", 20, 400, {"bus": "loudness"}), N.make("param", "p4", 470, 400, {"param": "glow"}),
		N.make("bus", "b5", 20, 500, {"bus": "snare"}), N.make("shape", "s5", 240, 500, {"gain": 0.8, "attack": 0.0, "release": 120.0}),
		N.make("param", "p5", 470, 500, {"param": "flash"}),
		N.make("param", "p6", 470, 100, {"param": "burst"}),
	], "links": [["b1", "s1"], ["s1", "p1"], ["s1", "p6"], ["b2", "p2"], ["b3", "s3"], ["s3", "p3"], ["b4", "p4"], ["b5", "s5"],
		["s5", "p5"]]}


static func _moved(g: Dictionary, prefix: String, at: Vector2) -> Dictionary:
	for n in g.nodes:
		n.id = prefix + n.id
		n.x += at.x
		n.y += at.y
	for l in g.links:
		l[0] = prefix + l[0]
		l[1] = prefix + l[1]
	return g
