extends RefCounted
## WO-605 slice 10 — the Devices tab's Matrix view, pure: payload → crosspoint rows / columns (web
## device-view-matrix-ports.js extractMatrixPorts) and a crosspoint click → the new device graph (the cell handler
## in device-view-matrix.js). Rows are sources (destinations split into PGM / PRV halves, host channels, pixel-map
## outs, live inputs), columns are sinks (outputs, pixel-map ins). Tests preload it.

const H := preload("res://features/devices/host_channels.gd")
const M := preload("res://features/devices/devices_model.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const R := preload("res://features/devices/cable_rules.gd")
## Caspar outputs take ONE feed (isCasparOutputConnector / isSingleInputSinkId): a crosspoint replaces, like a router.
const SINGLE_INPUT := ["gpu_out", "decklink_out", "decklink_io", "caspar_mv_out", "stream_out", "record_out", "audio_out",
	"v4l2_out"]
const SOURCE_KINDS := ["audio_in", "v4l2_in"]


static func single_input_sink(payload: Dictionary, sink_id: String) -> bool:
	return R.s(R.connector_by_id(payload, sink_id).get("kind")) in SINGLE_INPUT


## `a || b` as text (a JS template of the first truthy value).
static func _or(a: Variant, b: Variant) -> String:
	return O.js(a if H.truthy(a) else b)


static func _group(kind: String) -> String:
	var g := "Outputs"
	if kind.contains("decklink"):
		g = "DeckLink"
	if kind.contains("gpu"):
		g = "GPU"
	if kind == "v4l2_in":
		g = "USB video"
	if kind.contains("stream") or kind.contains("record"):
		g = "Streams/Records"
	return g


## {sources: [{id, label, group, half}], sinks: [...]}; `half` is "pgm" / "prv" for a split destination, else null.
static func ports(payload: Dictionary, live_cm: Variant = null) -> Dictionary:
	var out := {"sources": [], "sinks": []}
	var added := {}
	var consumed := {}  # bare ids already on screen (WO-365: a half-split row must not come back as "Other Sources")
	var add := func(id: String, label: String, is_source: bool, group: String, half: Variant) -> void:
		var key := "%s#%s" % [id, half] if half != null else id
		if id == "" or added.has(key):
			return
		added[key] = true
		consumed[id] = true
		out["sources" if is_source else "sinks"].append({"id": id, "label": label, "group": group, "half": half})
	var seen := {}
	for d in H.all_destinations(payload, live_cm):
		var host: bool = str(d.get("mode", "")) == "host_channel" or d.get("virtual") is bool and d.virtual
		var group := "Host channels" if host else "Destinations"
		seen[R.s(d.get("id"))] = true
		var id := "dst_in_" + O.js(d.get("id"))
		var label := _or(d.get("label"), d.get("id"))
		if _or(d.get("mode"), "pgm_prv") == "pgm_prv" and not host:  # WO-364: PRV is a routable bus of its own
			add.call(id, label + " — PGM", true, group, "pgm")
			add.call(id, label + " — PRV", true, group, "prv")
		else:
			add.call(id, label, true, group, null)
	for h in H.host_destinations(payload, live_cm):
		if H.truthy(h.get("id")) and not seen.has(R.s(h.id)):
			add.call("dst_in_" + O.js(h.id), _or(h.get("label"), h.id), true, "Host channels", null)
	var graph := R.d(payload.get("graph"))
	var conns := R.a(graph.get("connectors"))
	for node in R.a(graph.get("devices")):
		if not (node is Dictionary and _is(node.get("role"), "pixel_mapping")):
			continue
		var label := _or(node.get("label"), node.get("id"))
		for c in conns:
			if c is Dictionary and O.js(c.get("deviceId")) == O.js(node.get("id")) and _is(c.get("kind"), "pixel_map_in"):
				add.call(O.js(c.get("id")), label + " In", false, "Pixel Maps", null)
				break
		var outs := []  # decorated: sort_custom is not stable, the web's sort is
		for c in conns:
			if c is Dictionary and O.js(c.get("deviceId")) == O.js(node.get("id")) and _is(c.get("kind"), "pixel_map_out"):
				outs.append([_num(c.get("index")), outs.size(), c])
		outs.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0] or (x[0] == y[0] and x[1] < y[1]))
		for o in outs:
			add.call(O.js(o[2].get("id")), "%s Out %s" % [label, O.js(o[0] + 1)], true, "Pixel Maps", null)
	for c in R.a(R.d(payload.get("suggested")).get("connectors")):
		if not (c is Dictionary and H.truthy(c.get("id"))):
			continue
		var kind := O.js(c.get("kind"))
		var label := _or(c.get("label"), c.get("externalRef") if H.truthy(c.get("externalRef")) else c.id)
		if kind in SINGLE_INPUT:
			add.call(O.js(c.id), label, false, _group(kind), null)
		if kind in SOURCE_KINDS:
			add.call(O.js(c.id), label, true, _group(kind), null)
	for e in R.a(graph.get("edges")):
		if not e is Dictionary:
			continue
		for end in [["sourceId", true, "Other Sources"], ["sinkId", false, "Other Outputs"]]:
			var id: Variant = e.get(end[0])
			if H.truthy(id) and not consumed.has(O.js(id)):
				add.call(O.js(id), _or(R.connector_by_id(payload, O.js(id)).get("label"), id), end[1], end[2], null)
	return out


## `v === s` for a string s (Godot's == errors across some type pairs).
static func _is(v: Variant, s: String) -> bool:
	return (v is String or v is StringName) and str(v) == s


## Number(v) || 0 for the pixel-map out order.
static func _num(v: Variant) -> float:
	if v is int or v is float:
		return float(v)
	var t := O.js(v).strip_edges()
	return float(t) if t.is_valid_float() else 0.0


## The edge a crosspoint shows: same source and sink, and on a half row the same output layer (WO-364).
static func is_edge(e: Variant, src: Dictionary, sink: Dictionary) -> bool:
	return e is Dictionary and _is(e.get("sourceId"), src.id) and _is(e.get("sinkId"), sink.id) \
		and (src.half == null or M.output_layer(e) == (2 if src.half == "prv" else 1))


static func active(payload: Dictionary, src: Dictionary, sink: Dictionary) -> bool:
	return R.a(R.d(payload.get("graph")).get("edges")).any(func(e: Variant) -> bool: return is_edge(e, src, sink))


## A crosspoint click → the whole new graph: an active one disconnects (that half only); an empty one connects,
## first dropping a single-input sink's other feeds (WO-373), a PRV row noting {"outputLayer": 2}.
static func toggle(payload: Dictionary, src: Dictionary, sink: Dictionary, new_id: String) -> Dictionary:
	var g: Dictionary = (payload.graph if H.truthy(payload.get("graph")) else {"edges": [], "connectors": []}).duplicate(true)
	var edges := R.a(g.get("edges"))
	if active(payload, src, sink):
		g.edges = edges.filter(func(e: Variant) -> bool: return not is_edge(e, src, sink))
		return g
	if single_input_sink(payload, sink.id):
		edges = edges.filter(func(e: Variant) -> bool: return O.js(R.d(e).get("sinkId")) != sink.id)
	var edge := {"id": new_id, "sourceId": src.id, "sinkId": sink.id}
	if src.half == "prv":
		edge.note = JSON.stringify({"outputLayer": 2})
	edges.append(edge)
	g.edges = edges
	return g


## `edge_<ms>_<0..999>` (the web's Date.now + Math.random id).
static func new_edge_id() -> String:
	return "edge_%d_%d" % [int(Time.get_unix_time_from_system() * 1000.0), randi() % 1000]


## A row / column header click: ["dest", <destination id>] opens that destination, else ["conn", <id>] its connector.
static func header_target(id: String) -> Array:
	return ["dest", id.trim_prefix("dst_in_")] if id.begins_with("dst_in_") else ["conn", id]
