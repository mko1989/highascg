extends RefCounted
## WO-1011 — the Visuals Flow node library: every node type, its category, inputs and properties, and the graph
## normalisation the store and the view share. The op set and port semantics follow cables.gl's ops (Ops.Anim, Ops.Math,
## Ops.Trigger, Ops.Boolean, Ops.Number — https://github.com/cables-gl/cables, MIT, Copyright (c) 2019-present undefined
## development; see THIRD_PARTY_NOTICES), re-implemented for our float control graph: values are floats, a "trigger" is
## a rising edge through 0.5 (re-armed below 0.3, as visuals_stage.gd's burst). The per-frame logic is in flow_eval.gd.
##
## Spec: TYPES[type] = {t: title, cat, ins: [[label, fallback]], props: [[key, label, kind, default, …]], out: bool}.
## An input's fallback (used while nothing is linked) is a constant or the key of one of the node's properties.
## Property kinds: "f" [lo, hi, step] · "opt" [options] · "bus" · "param".

const CATS := ["Sources", "Math", "Animate", "Triggers & logic", "Output"]
const WAVES := ["sine", "triangle", "ramp up", "ramp down", "square", "random", "smooth random"]
const TRANS := ["linear", "sine", "quad", "cubic", "quart", "quint", "expo", "circ", "back", "elastic", "bounce", "spring"]
const EASES := ["in", "out", "in-out", "out-in"]
const IN := [["In", 0.0]]
const TRIG := [["Trigger", 0.0]]

const TYPES := {
	# Sources
	"bus": {"t": "Audio bus", "cat": "Sources", "ins": [], "props": [["bus", "", "bus", "loudness"]]},
	"lfo": {"t": "LFO", "cat": "Sources", "ins": [["Reset", 0.0]], "props": [["wave", "", "opt", "sine", WAVES],
		["clock", "Clock", "opt", "free", ["free", "beat"]], ["rate", "Hz (free)", "f", 0.5, 0.0, 30.0, 0.01],
		["beats", "Beats/cycle", "f", 4.0, 0.25, 64.0, 0.25], ["phase", "Phase", "f", 0.0, 0.0, 1.0, 0.01],
		["width", "Pulse width", "f", 0.5, 0.0, 1.0, 0.01], ["lo", "Min", "f", 0.0, -4.0, 4.0, 0.01],
		["hi", "Max", "f", 1.0, -4.0, 4.0, 0.01], ["seed", "Seed", "f", 0.0, 0.0, 999.0, 1.0]]},
	"value": {"t": "Value", "cat": "Sources", "ins": [], "props": [["value", "Value", "f", 0.5, -4.0, 4.0, 0.01]]},
	"noise": {"t": "Noise", "cat": "Sources", "ins": [], "props": [["rate", "Speed Hz", "f", 0.2, 0.0, 20.0, 0.01],
		["lo", "Min", "f", 0.0, -4.0, 4.0, 0.01], ["hi", "Max", "f", 1.0, -4.0, 4.0, 0.01], ["seed", "Seed", "f", 1.0, 0.0, 999.0, 1.0]]},
	"random": {"t": "Random on trigger", "cat": "Sources", "ins": TRIG, "props": [["lo", "Min", "f", 0.0, -4.0, 4.0, 0.01],
		["hi", "Max", "f", 1.0, -4.0, 4.0, 0.01], ["seed", "Seed", "f", 1.0, 0.0, 999.0, 1.0]]},
	# Math
	"add": {"t": "Add", "cat": "Math", "ins": [["A", 0.0], ["B", "b"]], "props": [["b", "+ B", "f", 0.0, -4.0, 4.0, 0.01]]},
	"sub": {"t": "Subtract", "cat": "Math", "ins": [["A", 0.0], ["B", "b"]], "props": [["b", "− B", "f", 0.0, -4.0, 4.0, 0.01]]},
	"mul": {"t": "Multiply", "cat": "Math", "ins": [["A", 0.0], ["B", "b"]], "props": [["b", "× B", "f", 1.0, -8.0, 8.0, 0.01]]},
	"min": {"t": "Min", "cat": "Math", "ins": [["A", 0.0], ["B", "b"]], "props": [["b", "B", "f", 1.0, -4.0, 4.0, 0.01]]},
	"max": {"t": "Max", "cat": "Math", "ins": [["A", 0.0], ["B", "b"]], "props": [["b", "B", "f", 0.0, -4.0, 4.0, 0.01]]},
	"mix": {"t": "Mix (crossfade)", "cat": "Math", "ins": [["A", 0.0], ["B", "b"], ["Mix", "t"]],
		"props": [["b", "B", "f", 1.0, -4.0, 4.0, 0.01], ["t", "Mix", "f", 0.5, 0.0, 1.0, 0.01]]},
	"map": {"t": "Map range", "cat": "Math", "ins": IN, "props": [["in_lo", "In min", "f", 0.0, -4.0, 4.0, 0.01],
		["in_hi", "In max", "f", 1.0, -4.0, 4.0, 0.01], ["out_lo", "Out min", "f", 0.0, -4.0, 4.0, 0.01],
		["out_hi", "Out max", "f", 1.0, -4.0, 4.0, 0.01], ["ease", "Easing", "opt", "linear", ["linear", "smoothstep", "smootherstep"]],
		["clamp", "Clamp", "opt", "on", ["on", "off"]]]},
	"clamp": {"t": "Clamp", "cat": "Math", "ins": IN, "props": [["lo", "Min", "f", 0.0, -4.0, 4.0, 0.01], ["hi", "Max", "f", 1.0, -4.0, 4.0, 0.01]]},
	"invert": {"t": "One minus", "cat": "Math", "ins": IN, "props": []},
	"abs": {"t": "Absolute", "cat": "Math", "ins": IN, "props": []},
	"pow": {"t": "Power", "cat": "Math", "ins": IN, "props": [["exp", "Exponent", "f", 2.0, 0.05, 8.0, 0.05]]},
	"steps": {"t": "Quantize", "cat": "Math", "ins": IN, "props": [["steps", "Steps", "f", 4.0, 1.0, 64.0, 1.0]]},
	"wrap": {"t": "Wrap (modulo)", "cat": "Math", "ins": IN, "props": [["mod", "Modulo", "f", 1.0, 0.01, 16.0, 0.01]]},
	"curve": {"t": "Curve (gain)", "cat": "Math", "ins": IN, "props": [["gain", "Gain", "f", 0.25, 0.01, 0.99, 0.01]]},
	"ease": {"t": "Ease", "cat": "Math", "ins": IN, "props": [["trans", "Curve", "opt", "cubic", TRANS], ["ease", "", "opt", "in-out", EASES]]},
	"compare": {"t": "Threshold", "cat": "Math", "ins": IN, "props": [["at", "Threshold", "f", 0.5, -4.0, 4.0, 0.01],
		["dir", "When", "opt", "above", ["above", "below"]]]},
	# Animate
	"shape": {"t": "Shape", "cat": "Animate", "ins": IN, "props": [["gain", "Gain", "f", 1.0, -4.0, 4.0, 0.05],
		["attack", "Attack ms", "f", 10.0, 0.0, 5000.0, 5.0], ["release", "Release ms", "f", 200.0, 0.0, 10000.0, 10.0]]},
	"smooth": {"t": "Smooth", "cat": "Animate", "ins": IN, "props": [["up", "Rise factor", "f", 4.0, 1.0, 200.0, 0.5],
		["down", "Fall factor", "f", 4.0, 1.0, 200.0, 0.5]]},
	"spring": {"t": "Spring", "cat": "Animate", "ins": IN, "props": [["damping", "Damping", "f", 0.2, 0.0, 1.0, 0.01],
		["stiffness", "Stiffness", "f", 0.7, 0.0, 1.0, 0.01]]},
	"slew": {"t": "Slew limit", "cat": "Animate", "ins": IN, "props": [["up", "Rise /s", "f", 2.0, 0.01, 100.0, 0.05],
		["down", "Fall /s", "f", 2.0, 0.01, 100.0, 0.05]]},
	"delay": {"t": "Delay", "cat": "Animate", "ins": IN, "props": [["ms", "Delay ms", "f", 250.0, 0.0, 4000.0, 10.0]]},
	"average": {"t": "Average", "cat": "Animate", "ins": IN, "props": [["ms", "Window ms", "f", 500.0, 20.0, 10000.0, 10.0]]},
	"speed": {"t": "Speed (change)", "cat": "Animate", "ins": IN, "props": [["scale", "Scale", "f", 0.25, 0.01, 10.0, 0.01]]},
	"peak": {"t": "Peak hold", "cat": "Animate", "ins": [["In", 0.0], ["Reset", 0.0]], "props": [["hold", "Hold ms", "f", 500.0, 0.0, 10000.0, 10.0],
		["release", "Fall ms", "f", 1000.0, 0.0, 20000.0, 10.0]]},
	# Triggers & logic
	"pulse": {"t": "Pulse (decay)", "cat": "Triggers & logic", "ins": TRIG, "props": [["release", "Decay ms", "f", 300.0, 1.0, 10000.0, 10.0],
		["level", "Level", "f", 1.0, 0.0, 4.0, 0.01]]},
	"hold": {"t": "Hold (monoflop)", "cat": "Triggers & logic", "ins": TRIG, "props": [["ms", "Hold ms", "f", 100.0, 1.0, 20000.0, 10.0]]},
	"counter": {"t": "Counter", "cat": "Triggers & logic", "ins": [["Trigger", 0.0], ["Reset", 0.0]],
		"props": [["steps", "Steps", "f", 4.0, 2.0, 64.0, 1.0]]},
	"toggle": {"t": "Toggle", "cat": "Triggers & logic", "ins": [["Trigger", 0.0], ["Reset", 0.0]], "props": []},
	"nth": {"t": "Every Nth", "cat": "Triggers & logic", "ins": [["Trigger", 0.0], ["Reset", 0.0]],
		"props": [["n", "N", "f", 4.0, 1.0, 64.0, 1.0]]},
	"chance": {"t": "Chance", "cat": "Triggers & logic", "ins": TRIG, "props": [["p", "Probability", "f", 0.5, 0.0, 1.0, 0.01],
		["seed", "Seed", "f", 1.0, 0.0, 999.0, 1.0]]},
	"sample": {"t": "Sample & hold", "cat": "Triggers & logic", "ins": [["In", 0.0], ["Trigger", 0.0]], "props": []},
	"gate": {"t": "Gate", "cat": "Triggers & logic", "ins": [["In", 0.0], ["Open", 0.0]], "props": []},
	"switch": {"t": "Switch (4)", "cat": "Triggers & logic", "ins": [["Select", 0.0], ["1", 0.0], ["2", 0.0], ["3", 0.0], ["4", 0.0]], "props": []},
	"and": {"t": "And", "cat": "Triggers & logic", "ins": [["A", 0.0], ["B", 0.0]], "props": []},
	"or": {"t": "Or", "cat": "Triggers & logic", "ins": [["A", 0.0], ["B", 0.0]], "props": []},
	# Output
	"param": {"t": "Parameter", "cat": "Output", "ins": IN, "props": [["param", "", "param", "pulse"]], "out": false},
}

const COLORS := {"Sources": Color("#4fc3f7"), "Math": Color("#81c784"), "Animate": Color("#ffd54f"),
	"Triggers & logic": Color("#ba68c8"), "Output": Color("#ef5350")}


static func has_out(type: String) -> bool:
	return TYPES[type].get("out", true)


static func ins(type: String) -> Array:
	return TYPES[type].ins


static func color(type: String) -> Color:
	return COLORS[TYPES[type].cat]


## The types of category `cat`, in library order.
static func of_cat(cat: String) -> Array:
	return TYPES.keys().filter(func(k: String) -> bool: return TYPES[k].cat == cat)


## A new node of `type` with every property at its default.
static func make(type: String, id: String, x: float, y: float, props := {}) -> Dictionary:
	var n := {"id": id, "type": type, "x": x, "y": y}
	for p in TYPES[type].props:
		n[p[0]] = p[3]
	n.merge(props, true)
	return n


## `n` (any Dictionary) made safe for `type`: known properties only, floats clamped, options from their list.
static func clean(n: Dictionary, buses: Array, params: Array) -> Dictionary:
	var t := str(n.type)
	var c := {"id": str(n.id), "type": t, "x": _num(n.get("x")), "y": _num(n.get("y"))}
	for p in TYPES[t].props:
		var v: Variant = n.get(p[0], p[3])
		match p[2]:
			"f":
				c[p[0]] = clampf(_num(v) if v != null else float(p[3]), p[4], p[5])
			"opt":
				c[p[0]] = str(v) if str(v) in p[4] else p[3]
			"bus":
				c[p[0]] = str(v) if str(v) in buses else p[3]
			"param":
				c[p[0]] = str(v) if str(v) in params else p[3]
	return c


## A stored or hand-edited graph made safe: known types only, unique ids, links from a node with an output to an existing
## input port (`[a, b]` = port 0, `[a, b, port]` otherwise), one link per (source, target, port). null when not a graph.
static func normalize(g: Variant, buses: Array, params: Array) -> Variant:
	if not g is Dictionary or not g.get("nodes") is Array:
		return null
	var nodes := []
	var types := {}
	for n in g.nodes:
		if not n is Dictionary or str(n.get("id", "")) == "" or types.has(str(n.id)) or not TYPES.has(str(n.get("type", ""))):
			continue
		var c := clean(n, buses, params)
		types[c.id] = c.type
		nodes.append(c)
	var links := []
	var seen := {}
	for l in (g.get("links") if g.get("links") is Array else []):
		if not l is Array or l.size() < 2 or l.size() > 3:
			continue
		var a := str(l[0])
		var b := str(l[1])
		var port := int(_num(l[2])) if l.size() == 3 else 0
		if not types.has(a) or not types.has(b) or not has_out(types[a]) or port < 0 or port >= ins(types[b]).size():
			continue
		var key := "%s>%s>%d" % [a, b, port]
		if seen.has(key):
			continue
		seen[key] = true
		links.append([a, b] if port == 0 else [a, b, port])
	return {"nodes": nodes, "links": links}


static func port_of(l: Array) -> int:
	return int(l[2]) if l.size() > 2 else 0


static func _num(v: Variant) -> float:
	if v is float or v is int:
		return float(v)
	if v is String and (v as String).is_valid_float():
		return (v as String).to_float()
	return 0.0
