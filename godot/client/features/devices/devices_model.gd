extends RefCounted
## WO-605 slice 1 — GET /api/device-view → what the read-only Devices tab draws: destination cards, rear-panel
## columns (GPU, DeckLink, stream / virtual cam / record / audio), and cables as anchor-key pairs. Ports of
## device-view-output-layer.js (PGM/PRV halves), destinationRectLabel (ui-utils) and the caspar-rear-data.js kind
## filters; the GPU column is gpu_layout.gd (slice 9b). Pure (tests preload it).

const DO := preload("res://features/devices/decklink_order.gd")
const GL := preload("res://features/devices/gpu_layout.gd")
const H := preload("res://features/devices/host_channels.gd")
const CASPAR_HOST := "caspar_host"
const MODE_TAG := {"pgm_only": "PGM", "multiview": "MVR", "stream": "STREAM", "pixelmap": "PXM",
	"operator_gui": "OPG"}
## Rear-panel slots after GPU / DeckLink, in the web's order: [title, connector kinds].
const EXTRA_SLOTS := [["Stream", ["stream_out"]], ["Virtual cam", ["v4l2_out"]], ["Record", ["record_out"]]]


## The `{outputLayer}` note WO-364 puts on destination edges: 1 = PGM, 2 = PRV (edgeOutputLayer).
static func output_layer(edge: Dictionary) -> int:
	var raw: Variant = edge.get("note")
	if raw == null:
		return 1
	if raw is int or raw is float:
		return maxi(1, roundi(float(raw)))
	var s := str(raw).strip_edges()
	if s == "":
		return 1
	var j: Variant = JSON.parse_string(s) if s.begins_with("{") else null  # parse_string logs on non-JSON
	if j is Dictionary:
		var n: Variant = j.get("outputLayer")
		return maxi(1, roundi(float(n))) if (n is int or n is float) else 1
	var re := RegEx.create_from_string("(?i)outputLayer\\s*[:=]\\s*(\\d+)")
	var m := re.search(s)
	return maxi(1, int(m.get_string(1))) if m else 1


static func is_destination_connector(id: String) -> bool:
	return id.begins_with("dst_in_")


## Anchor identity: a pgm_prv destination is ONE connector with two halves, so its dots are `id#pgm` / `id#prv`.
static func anchor_key(id: String, half := "") -> String:
	return "%s#%s" % [id, half] if half == "pgm" or half == "prv" else id


## Where a cable leaves: destination sources carry their half (PRV edges leave the PRV dot), others the plain id.
static func source_anchor(edge: Dictionary) -> String:
	var id := str(edge.get("sourceId", ""))
	if not is_destination_connector(id):
		return id
	return anchor_key(id, "prv" if output_layer(edge) >= 2 else "pgm")


## "OPG · 1920x1080@50" / "NDI host · ch 4" (destinationRectLabel).
static func dest_sub(d: Dictionary) -> String:
	var mode := str(d.get("mode", "pgm_prv"))
	if mode == "host_channel":
		var role := H.role_label(str(d.hostRole)) if H.truthy(d.get("hostRole")) else "Host"
		return "%s · ch %s" % [role, H.R.s(d.casparChannel)] if d.get("casparChannel") != null else role
	var tag: String = MODE_TAG.get(mode, "PGM/PRV")
	if mode == "stream":
		var st: Variant = d.get("stream")
		return "%s · %s" % [tag, str(st.get("type", "rtmp") if st is Dictionary else "rtmp").to_upper()]
	var w := maxi(64, int(d.get("width", 1920)) if d.get("width") != null else 1920)
	var h := maxi(64, int(d.get("height", 1080)) if d.get("height") != null else 1080)
	var fps := maxf(1.0, float(d.get("fps", 50)) if d.get("fps") != null else 50.0)
	return "%s · %dx%d@%s" % [tag, w, h, _num(fps)]


static func _num(v: float) -> String:
	return str(int(v)) if is_equal_approx(v, roundf(v)) else str(v)


## graph + suggested connectors, first occurrence of each id wins.
static func connectors(payload: Dictionary) -> Dictionary:
	var out := {}
	for key in ["graph", "suggested"]:
		var src: Variant = payload.get(key)
		if not src is Dictionary:
			continue
		for c in src.get("connectors", []):
			if c is Dictionary and str(c.get("id", "")) != "" and not out.has(str(c.id)):
				out[str(c.id)] = c
	return out


static func _of_kinds(conns: Dictionary, kinds: Array) -> Array:
	var out := []
	for c in conns.values():
		if c.get("deviceId") == CASPAR_HOST and kinds.has(str(c.get("kind", ""))):
			out.append({"id": str(c.id), "label": str(c.get("label", c.id)), "kind": str(c.kind),
				"index": int(c.get("index", 0)) if c.get("index") != null else 0})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.index < b.index)
	return out


## Everything the tab draws. Destinations: screen destinations, then pinned and auto-detected host channels
## (host_channels.gd); `live_cm` is the WS state channelMap, `cc` the state configComparison (the "(planned)" badge).
## `deck_saved` = the client's saved DeckLink rear order (decklink_order.gd; [] = the web's default order);
## `gpu_saved` = its saved GPU layout rows (gpu_layout.gd: hidden flags + labels over the server topology).
static func build(payload: Dictionary, live_cm: Variant = null, cc: Variant = null, deck_saved: Array = [],
		gpu_saved: Array = []) -> Dictionary:
	var conns := connectors(payload)
	var labels := {}
	var gpu := GL.column(payload, gpu_saved)
	var deck := DO.current(_of_kinds(conns, ["decklink_io", "decklink_out"]), deck_saved)
	var slots := [{"title": "GPU", "kind": "gpu", "items": gpu}, {"title": "DeckLink", "kind": "decklink", "items": deck}]
	for s in EXTRA_SLOTS:
		slots.append({"title": s[0], "kind": s[1][0], "items": _of_kinds(conns, s[1])})
	var audio := []
	for a in payload.get("audioOutputs", []):
		if a is Dictionary and str(a.get("id", "")) != "":
			audio.append({"id": str(a.id), "label": str(a.get("label", a.get("name", a.id))).left(80)})
	slots.append({"title": "Audio", "kind": "audio_out", "items": audio})
	for s in slots:
		for it in s.items:
			labels[it.id] = it.label
	var edges := []
	var graph: Dictionary = payload.get("graph", {}) if payload.get("graph") is Dictionary else {}
	var nodes := {}
	for d in H.R.a(graph.get("devices")):
		if d is Dictionary and d.get("role") == "pixel_mapping":
			nodes[H.R.s(d.get("id"))] = H.R.s(d.label) if H.truthy(d.get("label")) else H.R.s(d.get("id"))
	for c in conns.values():  # mapping connectors: "<node> in" / "<node> out N" (the web shows the raw id)
		if c.get("kind") in ["pixel_map_in", "pixel_map_out"]:
			var node: String = nodes.get(H.R.s(c.get("deviceId")), H.R.s(c.get("deviceId")))
			labels[c.id] = node + (" in" if c.kind == "pixel_map_in" else " out %d" % (int(H.R.d(c).get("index", 0)) + 1))
	for e in graph.get("edges", []):
		if e is Dictionary and str(e.get("sourceId", "")) != "" and str(e.get("sinkId", "")) != "":
			edges.append(e)
	var caspar := H.R.d(H.R.d(payload.get("live")).get("caspar"))
	var intents := {}
	for it in H.R.a(H.R.d(caspar.get("destinationIntent")).get("items")):
		if it is Dictionary and not intents.has(H.R.s(it.get("id"))):
			intents[H.R.s(it.get("id"))] = it
	var switcher_bus := H.R.s(H.R.d(caspar.get("channelMap")).get("transitionModel")) == "switcher_bus"
	var dests := []
	var counts := {"screen": 0, "host": 0}
	for d in H.all_destinations(payload, live_cm):
		var did := H.R.s(d.get("id")).strip_edges()
		if did == "" or dests.any(func(x: Dictionary) -> bool: return x.id == did):
			continue
		var host := H.is_host(d)
		counts["host" if host else "screen"] += 1
		var conn := _dest_connector(conns, did)
		var mode := str(d.get("mode", "pgm_prv"))
		var name := H.R.s(d.label) if H.truthy(d.get("label")) else did
		labels[conn] = name
		var intent: Variant = intents.get(did)
		var sub := dest_sub(d)
		if host:
			var ch: Variant = H.coalesce([d.get("casparChannel"), H.R.d(intent).get("pgmChannel")])
			sub = "HOST · ch %s%s" % [H.R.s(ch) if ch != null else "?", " (planned)" if H.channel_planned(ch, cc) else ""]
		var links := []
		for e in edges.filter(func(x: Dictionary) -> bool: return str(x.sourceId) == conn):
			var prefix := ("PGM: " if output_layer(e) == 1 else "PRV: ") if mode == "pgm_prv" else ""
			links.append([output_layer(e), prefix + str(labels.get(str(e.sinkId), e.sinkId))])
		links.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
		dests.append({"id": did, "label": name, "sub": sub, "mode": mode, "host": host, "connector": conn,
			"halves": ["pgm", "prv"] if mode == "pgm_prv" else [], "prv_dot": not switcher_bus, "dest": d,
			"intent": intent, "links": links.map(func(l: Array) -> String: return l[1])})
	var cables := []
	for e in edges:
		cables.append({"id": str(e.get("id", "")), "from": source_anchor(e), "to": str(e.sinkId),
			"label": "%s → %s" % [labels.get(str(e.sourceId), e.sourceId), labels.get(str(e.sinkId), e.sinkId)]})
	return {"destinations": dests, "slots": slots, "cables": cables, "screen_count": counts.screen,
		"host_count": counts.host}


## resolveDestinationSinkConnectorId: the destination_in connector whose externalRef is the destination id.
static func _dest_connector(conns: Dictionary, did: String) -> String:
	for c in conns.values():
		if c.get("kind") == "destination_in" and str(c.get("externalRef", "")) == did:
			return str(c.id)
	return "dst_in_" + did
