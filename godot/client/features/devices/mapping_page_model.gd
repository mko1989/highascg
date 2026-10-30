extends RefCounted
## WO-605 slice 7c — the mapping-node views as data (pure): the Devices tab's "Mapping nodes" column cards (web
## device-view-mappings-render.js) and the node's Inspector page (device-view-inspector-mapping.js
## renderMappingNodeInspector) as an item list, with every field's text as the web shows it (math-input initial
## formatting, the WO-505 standard-mode mirror into the disabled custom fields). Golden-tested in
## test_devices_mapping.gd. Not ported: "Show Mapping Preview" (opens the pixel-map editor, not part of WO-605).

const G := preload("res://features/devices/mapping_graph.gd")
const S := preload("res://features/devices/cable_seed.gd")
const R := preload("res://features/devices/cable_rules.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const MI := preload("res://core/math_input.gd")

const NOT_FOUND := "Mapping node not found."
const NO_NODES := "No mapping nodes. Click + to add."
const NO_INPUT := "Cable a destination to the mapping input first."
const REMOVE_CONFIRM := "Remove this output and its cables?"
const ADDED := "Added pixel mapping node"
const UPDATED := "Mapping updated"


static func nodes(payload: Dictionary) -> Array:
	return R.a(R.d(payload.get("graph")).get("devices")).filter(func(d: Variant) -> bool:
		return d is Dictionary and d.get("role") == "pixel_mapping")


## The column's cards: [{id, label, in, outs: [[connector id, "1"…]]}] (outs by index, stable), or {note}.
static func band(payload: Dictionary) -> Dictionary:
	var list := nodes(payload)
	if list.is_empty():
		return {"note": NO_NODES}
	var conns := R.a(R.d(payload.get("graph")).get("connectors"))
	var cards := []
	for n in list:
		var id := R.s(n.get("id"))
		var card := {"id": id, "label": R.s(O.or_([n.get("label"), n.get("id")])), "in": "", "outs": []}
		for c in conns:
			if c is Dictionary and R.s(c.get("deviceId")) == id and c.get("kind") == "pixel_map_in":
				card.in = R.s(c.get("id"))
				break
		var outs := []
		for c in conns:
			if c is Dictionary and R.s(c.get("deviceId")) == id and c.get("kind") == "pixel_map_out":
				outs.append([_index(c), outs.size(), c])
		outs.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
		card.outs = outs.map(func(e: Array) -> Array: return [R.s(e[2].get("id")), O.js(e[0] + 1)])
		cards.append(card)
	return {"cards": cards}


## Number(c.index) || 0
static func _index(c: Dictionary) -> float:
	var v := G.F._num(c, "index")
	return v if is_finite(v) else 0.0


## resolveMappingInputResolution: the feed cabled into the node's pixel_map_in, else {}.
static func input_resolution(payload: Dictionary, id: String) -> Dictionary:
	var graph := R.d(payload.get("graph"))
	var in_id := ""
	for c in R.a(graph.get("connectors")):
		if c is Dictionary and R.s(c.get("deviceId")) == id and c.get("kind") == "pixel_map_in":
			in_id = R.s(c.get("id"))
			break
	if in_id == "":
		return {}
	for e in R.a(graph.get("edges")):
		if e is Dictionary and R.s(e.get("sinkId")) == in_id:
			return S.feed_source(payload, R.s(e.get("sourceId"))) if H.truthy(e.get("sourceId")) else {}
	return {}


static func input_text(res: Dictionary) -> String:
	if res.is_empty():
		return "Unknown (cable a destination to the mapping input)"
	var t := "%s×%s" % [O.js(res.width), O.js(res.height)]
	if res.get("fps") is float or res.get("fps") is int:
		t += " @ %s Hz" % O.js(res.fps)
	if H.truthy(res.get("label")):
		t += " — " + R.s(res.label)
	return t


static func delete_confirm(node: Dictionary) -> String:
	return 'Delete mapping node "%s" and all its cables?' % R.s(O.or_([node.get("label"), node.get("id")]))


## "Proposed Out 1: 960×1080 @ x=0 · …" (or the fallback when nothing was proposed).
static func proposed_text(proposed: Array) -> String:
	var parts := []
	for i in proposed.size():
		parts.append("Out %d: %s×%s @ x=%s" % [i + 1, O.js(proposed[i].width), O.js(proposed[i].height), O.js(proposed[i].rect.x)])
	return "Proposed " + " · ".join(parts) if not parts.is_empty() else "Outputs updated from input"


## The custom-mode fields as the page opens: {mode, cw, ch, cf} — the stored / resolved size, math-formatted, then
## (standard mode) the mode's own size mirrored in unformatted (WO-505).
static func mode_fields(out: Dictionary) -> Dictionary:
	var res := G.resolve_output(out)
	var custom: bool = res.isCustom or not R.s(out.get("mode")) in DM.STANDARD_VIDEO_MODES or not out.get("mode") is String
	var f := {"mode": "custom" if custom else str(out.mode), "cw": MI.commit(O.js(res.width), 1, INF, 0, null).text,
		"ch": MI.commit(O.js(res.height), 1, INF, 0, null).text, "cf": MI.commit(O.js(res.fps), 1, INF, 2, null).text}
	if not custom:
		mirror_mode(f)
	return f


## syncModeFields for a standard pick: the mode's size into the (disabled) fields.
static func mirror_mode(f: Dictionary) -> void:
	if f.mode == "custom":
		return
	var std := S.mode_resolution(f.mode)
	f.cw = O.js(std.w)
	f.ch = O.js(std.h)
	f.cf = O.js(std.fps)


## The slice rect fields: {x, y, w, h} (missing slice → 0, 0 and the mode's size).
static func rect_fields(node: Dictionary, out: Dictionary) -> Dictionary:
	var slice := {}
	for m in R.a(R.d(node.get("settings")).get("mappings")):
		if R.s(R.d(m).get("outputId")) == R.s(out.get("id")):
			slice = m
			break
	var rect := R.d(slice.get("rect"))
	var sres := S.mode_resolution(R.s(O.or_([out.get("mode"), "1080p5000"])))
	var f := {}
	for k in [["x", 0], ["y", 0], ["w", sres.w], ["h", sres.h]]:
		f[k[0]] = MI.commit(O.js(H.coalesce([rect.get(k[0]), k[1]])), -INF, INF, 0, null).text
	return f


## The node page. `ui` = per output index {mode, cw, ch, cf, x, y, w, h} as the operator left them (none = as opened).
## `slices` (WO-869, the Godot page): no per-output Src fields — slice_page_model.gd's section replaces them. The
## default keeps the web page's item list (the golden replay of the web inspector).
static func items(payload: Dictionary, id: String, ui := {}, slices := false) -> Array:
	var node := G.find_node(payload.get("graph"), id)
	if node.is_empty():
		return [{"t": "note", "text": NOT_FOUND}]
	var out := [{"t": "heading", "text": "Mapping Node"}, {"t": "caption", "text": "Node Label"},
		{"t": "input", "key": "name", "value": R.s(O.or_([node.get("label"), node.get("id")])), "disabled": false},
		{"t": "caption", "text": "Input Resolution"}, {"t": "readout", "text": input_text(input_resolution(payload, id))},
		{"t": "button", "text": "Propose outputs from input", "key": "Propose outputs from input"}, {"t": "heading", "text": "Outputs"}]
	var outputs := G._outputs(node)
	var modes := [["custom", "Custom"]] + DM.STANDARD_VIDEO_MODES.map(func(m: String) -> Array: return [m, m])
	for i in outputs.size():
		var o := R.d(outputs[i])
		var f: Dictionary = ui.get(i, field_state(node, o))
		var k := "o%d." % i
		out.append({"t": "subtitle", "text": "Output %d" % (i + 1)})
		if outputs.size() > 1:
			out.append({"t": "button", "text": "Remove", "key": k + "remove"})
		out.append_array([{"t": "caption", "text": "Label"},
			{"t": "input", "key": k + "label", "value": R.s(O.or_([o.get("label"), "Output %d" % (i + 1)])), "disabled": false},
			{"t": "caption", "text": "Mode"}, {"t": "select", "key": k + "mode", "value": f.mode, "options": modes, "disabled": false}])
		for c in ["cw", "ch", "cf"]:
			out.append({"t": "input", "key": k + c, "value": f[c], "disabled": f.mode != "custom"})
		for c in ([] if slices else [["Src X", "x"], ["Src Y", "y"], ["Width", "w"], ["Height", "h"]]):
			out.append({"t": "caption", "text": c[0]})
			out.append({"t": "input", "key": k + c[1], "value": f[c[1]], "disabled": false})
	out.append_array([{"t": "button", "text": "+ Add Output", "key": "+ Add Output"}, {"t": "heading", "text": "Actions"},
		{"t": "button", "text": "Duplicate Node", "key": "Duplicate Node"}, {"t": "button", "text": "Delete Node", "key": "Delete Node"}])
	return out


## Every field of one output as the page opens (mode_fields + rect_fields).
static func field_state(node: Dictionary, out: Dictionary) -> Dictionary:
	var f := mode_fields(out)
	f.merge(rect_fields(node, out))
	return f
