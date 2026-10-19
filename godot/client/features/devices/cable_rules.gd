extends RefCounted
## WO-605 slice 2 — what a cable gesture may do, before anything is written. Pure 1:1 ports of
## device-view-helpers.js (connectorById, connectorRole, orderEdgeForDeviceView, friendlyConnectorLabel),
## decklink-io-direction.js, device-view-cable-resolve.js, device-view-cable-regrab.js (WO-278),
## device-view-cable-messages.js and the cable half of caspar-restart-dirty-policy.js. Golden-tested against the
## web modules (tests/test_devices_cable_rules.gd).
## Not ported: the per-browser GPU layout prefs that canonicalCableConnectorId consults first (localStorage — the
## Godot client has no layout editor yet), and auto host-channel destinations in labels (destinations slice).

const CASPAR_HOST := "caspar_host"
const OUT_KINDS := ["gpu_out", "decklink_out", "caspar_mv_out", "stream_out", "record_out", "audio_out", "v4l2_out"]
const REJECTIONS := {
	"sink_already_connected": "That output already has a cable. Remove the existing cable first, then connect from the mapping output again.",
	"duplicate": "This cable is already in the graph.",
	"self_loop": "Cannot connect a connector to itself.",
	"missing_ids": "Missing connector id — refresh Device View and try again.",
	"unknown_source": "Unknown source connector — refresh Device View or sync from hardware.",
	"unknown_sink": "Unknown sink connector — refresh Device View or sync from hardware.",
}
const RESTORE_TEXT := {
	"cancelled": "Cable re-grab cancelled — connection left as it was.",
	"unchanged": "Cable dropped back on the same port — nothing changed.",
	"self": "A cable cannot connect a port to itself — connection restored.",
	"sink-occupied": "That input already has a cable. Remove it first — connection restored.",
	"direction": "That target would reverse the cable direction — connection restored.",
	"invalid-target": "These connectors cannot be cabled together (wrong roles or direction) — connection restored.",
}


## JS `String(v || '').trim()`; JSON numbers arrive as floats, so 2.0 → "2".
static func s(v: Variant) -> String:
	if v == null:
		return ""
	if v is float and is_equal_approx(v, roundf(v)) and absf(v) < 1e15:
		return str(int(v))
	return str(v).strip_edges()


static func d(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


static func a(v: Variant) -> Array:
	return v if v is Array else []


static func norm_randr(v: Variant) -> String:
	var re := RegEx.create_from_string("(?i)^CARD\\d+-")
	return re.sub(s(v).to_upper(), "")


static func gpu_ports(payload: Dictionary) -> Array:
	return a(d(d(d(payload.get("live")).get("gpu")).get("physicalMap")).get("ports"))


## resolveTopologyForDeviceView: live effective → saved (payload, then settings) → live suggested.
static func topology(payload: Dictionary, settings: Variant = null) -> Array:
	var pm := d(d(d(payload.get("live")).get("gpu")).get("physicalMap"))
	for t in [pm.get("effectiveTopology"), payload.get("gpuPhysicalTopology"), d(settings).get("gpuPhysicalTopology"),
			pm.get("suggestedTopology")]:
		if t is Array and not t.is_empty():
			return t
	return []


static func _find_by(list: Array, key: String, value: String) -> Dictionary:
	for x in list:
		if x is Dictionary and s(x.get(key)) == value:
			return x
	return {}


static func connector_by_id(payload: Dictionary, id: String) -> Dictionary:
	for key in ["graph", "suggested"]:
		for c in a(d(payload.get(key)).get("connectors")):
			if c is Dictionary and str(c.get("id")) == id:
				return c
	var sid := id.strip_edges()
	var ports := gpu_ports(payload)
	var split := RegEx.create_from_string("(?i)^(gpu_p\\d+)__([A-Za-z0-9_]+)$").search(sid)
	if split:
		var parent := split.get_string(1)
		var tag := split.get_string(2).replace("_", "-")
		var p := _find_by(ports, "physicalPortId", parent)
		var probe := {}
		for c in [d(p.get("probe")).get("connectorA"), d(p.get("probe")).get("connectorB")]:
			if c is Dictionary and norm_randr(c.get("shortName")) == norm_randr(tag):
				probe = c
				break
		var short := s(probe.get("shortName")) if s(probe.get("shortName")) != "" else tag
		var out := {"id": sid, "deviceId": CASPAR_HOST, "kind": "gpu_out", "label": short,
			"externalRef": s(probe.get("name")) if s(probe.get("name")) != "" else short, "parentPortId": parent,
			"isSynthetic": true}
		if p.get("pair") is Dictionary and not p.pair.is_empty():
			out.gpuPhysical = {"pair": p.pair, "slotOrder": p.get("slotOrder")}
		return out
	if RegEx.create_from_string("(?i)^gpu_p\\d+$").search(sid):
		var p := _find_by(ports, "physicalPortId", sid)
		var row := _find_by(topology(payload, payload.get("_settings")), "physicalPortId", sid)
		var pair_name := s(d(p.get("pair")).get("name"))
		var active := s(d(p.get("runtime")).get("activePort"))
		var pairs := [] if row.is_empty() else [row.get("dpA"), row.get("dpB")].filter(func(x: Variant) -> bool: return s(x) != "")
		var topo_label := "/".join(pairs.map(func(x: Variant) -> String: return s(x)))
		var out := {"id": sid, "deviceId": CASPAR_HOST, "kind": "gpu_out", "isSynthetic": true,
			"label": pair_name if pair_name != "" else (topo_label if topo_label != "" else sid),
			"externalRef": active if active != "" else (pair_name if pair_name != "" else (s(pairs[0]) if pairs else sid))}
		if p.get("pair") is Dictionary and not p.pair.is_empty():
			out.gpuPhysical = {"pair": p.pair, "slotOrder": p.get("slotOrder")}
		elif not row.is_empty():
			out.gpuPhysical = {"pair": {"name": topo_label, "dpA": row.get("dpA"), "dpB": row.get("dpB")},
				"slotOrder": row.get("slotOrder")}
		return out
	if RegEx.create_from_string("(?i)^(DP|HDMI)-\\d+$").search(sid):
		return {"id": sid, "deviceId": CASPAR_HOST, "kind": "gpu_out", "label": sid, "isSynthetic": true}
	if not sid.begins_with("dst_in_"):
		return {}
	var ext := sid.trim_prefix("dst_in_").strip_edges()
	if ext == "":
		return {}
	var dest := _find_by(a(d(payload.get("screenDestinations")).get("destinations")), "id", ext)
	return {"id": sid, "deviceId": "destinations", "kind": "destination_in", "externalRef": ext,
		"label": s(dest.get("label")) if s(dest.get("label")) != "" else ext}


## "out" | "in" | "unassigned" (normalizeDecklinkIoDirection).
static func decklink_direction(c: Dictionary) -> String:
	var dir := s(d(c.get("caspar")).get("ioDirection")).to_lower()
	return dir if dir == "out" or dir == "in" else "unassigned"


static func role(c: Dictionary) -> String:
	if c.is_empty():
		return "other"
	var kind := s(c.get("kind"))
	if c.get("deviceId") == CASPAR_HOST and kind in OUT_KINDS:
		return "caspar_out"
	if c.get("deviceId") == CASPAR_HOST and kind == "decklink_io":
		return "caspar_in" if decklink_direction(c) == "in" else "caspar_out"  # unassigned DeckLinks are output sinks
	if c.get("deviceId") == "destinations" and kind == "destination_in":
		return "destination_out"
	if kind == "pixel_map_in":
		return "pixel_mapping_in"
	if kind == "pixel_map_out":
		return "pixel_mapping_out"
	return "other"


## Signal flows destination → output, destination → mapping input, mapping output → output; either click order.
## {sourceId, sinkId} or {} when the pair cannot be cabled.
static func order_edge(payload: Dictionary, first: String, second: String) -> Dictionary:
	var ca := connector_by_id(payload, first)
	var cb := connector_by_id(payload, second)
	if ca.is_empty() or cb.is_empty():
		return {}
	var ra := role(ca)
	var rb := role(cb)
	for pair in [["destination_out", "caspar_out"], ["destination_out", "pixel_mapping_in"], ["pixel_mapping_out", "caspar_out"]]:
		if ra == pair[0] and rb == pair[1]:
			return {"sourceId": first, "sinkId": second}
		if rb == pair[0] and ra == pair[1]:
			return {"sourceId": second, "sinkId": first}
	return {}


## A cable may START here (beginOrCompleteCable).
static func can_start(payload: Dictionary, id: String) -> bool:
	return role(connector_by_id(payload, id)) in ["destination_out", "caspar_out", "pixel_mapping_out"]


## gpu_p0__DP_1 → gpu_p0 (one cable per physical socket).
static func gpu_port_cable_id(id: String) -> String:
	var m := RegEx.create_from_string("(?i)^(gpu_p\\d+)").search(id.strip_edges())
	return m.get_string(1) if m else id.strip_edges()


## UI id → the persisted graph id (canonicalCableConnectorId, minus the layout prefs).
static func canonical_id(payload: Dictionary, id: String) -> String:
	id = id.strip_edges()
	if id == "":
		return id
	if RegEx.create_from_string("(?i)^gpu_p\\d+").search(id):
		return gpu_port_cable_id(id)
	if not RegEx.create_from_string("(?i)^(DP|HDMI|EDP)-\\d+$").search(id):
		return id
	var want := norm_randr(id)
	for p in gpu_ports(payload):
		if not p is Dictionary:
			continue
		var parent := s(p.get("physicalPortId"))
		if parent == "":
			continue
		var pair := d(p.get("pair"))
		var rt := d(p.get("runtime"))
		for v in [pair.get("dpA"), pair.get("dpB"), rt.get("activePort"), rt.get("xrandrName"), rt.get("displayName")]:
			if norm_randr(v) == want and want != "":
				return parent
		for key in ["connectorA", "connectorB"]:
			var sn: Variant = d(d(p.get("probe")).get(key)).get("shortName")
			if s(sn) != "" and norm_randr(sn) == want:
				return parent
	for key in ["graph", "suggested"]:
		for c in a(d(payload.get(key)).get("connectors")):
			if c is Dictionary and c.get("kind") == "gpu_out":
				var ref: Variant = c.get("externalRef") if s(c.get("externalRef")) != "" else c.get("label")
				if norm_randr(ref) == want:
					return gpu_port_cable_id(s(c.get("id")))
	return id


## The edge already on this sink's physical socket, or {}.
static func sink_conflict(payload: Dictionary, sink_id: String) -> Dictionary:
	var sid := gpu_port_cable_id(sink_id)
	if sid == "":
		return {}
	for e in a(d(payload.get("graph")).get("edges")):
		if e is Dictionary and gpu_port_cable_id(s(e.get("sinkId"))) == sid:
			return e
	return {}


static func describe_rejection(raw: Variant) -> String:
	var r := s(raw)
	if r == "":
		return "Cable could not be saved."
	if REJECTIONS.has(r):
		return REJECTIONS[r]
	if r.contains("sink_already_connected"):
		return REJECTIONS.sink_already_connected
	if r.contains("allowed:") or r.contains("destination_to_output"):
		return "This pairing is not allowed — try the other direction (signal flows destination feed → mapping input, mapping output → GPU/DeckLink output)."
	if r.contains("validate") or r.contains("Invalid"):
		return "Graph validation failed: " + r
	return r


static func is_unknown_connector_error(raw: Variant) -> bool:
	var r := s(raw).to_lower()
	return r.contains("unknown_sink") or r.contains("unknown_source")


## Re-grab (WO-278): the ends of `edges` that terminate at this connector; a self-loop counts as its sink end.
static func endpoints_at(edges: Array, connector_id: String) -> Array:
	var cid := connector_id.strip_edges()
	var hits := []
	if cid == "":
		return hits
	for e in edges:
		if not e is Dictionary or s(e.get("id")) == "":
			continue
		var src := s(e.get("sourceId"))
		var snk := s(e.get("sinkId"))
		if snk == cid:
			hits.append({"edgeId": s(e.id), "end": "sink", "anchorId": src, "movingId": snk})
		elif src == cid:
			hits.append({"edgeId": s(e.id), "end": "source", "anchorId": snk, "movingId": src})
	return hits


## Only the ALREADY selected cable can be grabbed — a click on a cabled output otherwise starts a new cable.
static func pick_regrab(edges: Array, connector_id: String, selected_edge_id: String) -> Dictionary:
	if selected_edge_id.strip_edges() == "":
		return {}
	for h in endpoints_at(edges, connector_id):
		if h.edgeId == selected_edge_id.strip_edges():
			return h
	return {}


## planCableRegrab: {action: retarget|restore|none, reason?, removeEdgeId?, sourceId?, sinkId?, conflictEdgeId?}.
## Never persists — anything short of a valid new target is a restore, which is free (the edge was never removed).
static func plan_regrab(payload: Dictionary, grab: Dictionary, target_id: String) -> Dictionary:
	if s(grab.get("edgeId")) == "":
		return {"action": "none"}
	if target_id.strip_edges() == "":
		return {"action": "restore", "reason": "cancelled"}
	var anchor := canonical_id(payload, s(grab.get("anchorId")))
	var moving := canonical_id(payload, s(grab.get("movingId")))
	var dropped := canonical_id(payload, target_id.strip_edges())
	if anchor == "":
		return {"action": "restore", "reason": "anchor-missing"}
	if dropped == moving:
		return {"action": "restore", "reason": "unchanged"}
	if dropped == anchor:
		return {"action": "restore", "reason": "self"}
	var o := order_edge(payload, anchor, dropped)
	if o.is_empty():
		return {"action": "restore", "reason": "invalid-target"}
	var src := canonical_id(payload, o.sourceId)
	var snk := canonical_id(payload, o.sinkId)
	if not ((grab.end == "sink" and src == anchor) or (grab.end == "source" and snk == anchor)):
		return {"action": "restore", "reason": "direction"}
	var conflict := sink_conflict(payload, snk)
	if not conflict.is_empty() and s(conflict.get("id")) != s(grab.edgeId):
		return {"action": "restore", "reason": "sink-occupied", "conflictEdgeId": s(conflict.get("id"))}
	return {"action": "retarget", "removeEdgeId": s(grab.edgeId), "sourceId": src, "sinkId": snk}


## The original edge, re-added when the server rejects the new one after the old was removed.
static func regrab_rollback(grab: Dictionary) -> Dictionary:
	if s(grab.get("anchorId")) == "" or s(grab.get("movingId")) == "":
		return {}
	if grab.get("end") == "sink":
		return {"sourceId": s(grab.anchorId), "sinkId": s(grab.movingId)}
	if grab.get("end") == "source":
		return {"sourceId": s(grab.movingId), "sinkId": s(grab.anchorId)}
	return {}


static func describe_restore(plan: Dictionary) -> String:
	return RESTORE_TEXT.get(s(plan.get("reason")), "Connection restored.")


static func dedicated_streaming(settings: Variant) -> bool:
	var v: Variant = d(d(settings).get("streamingChannel")).get("dedicatedOutputChannel")
	return (v is bool and v) or (v is String and v == "true")


## Cabling this sink needs a Caspar restart (WO-172 T172.3 matrix): stream only in dedicated-channel mode,
## record / virtual cam never, everything else always.
static func sink_needs_restart(sink: Dictionary, dedicated: bool) -> bool:
	match s(sink.get("kind")):
		"stream_out":
			return dedicated
		"record_out", "v4l2_out":
			return false
	return true


## friendlyConnectorLabel (status lines).
static func friendly_label(payload: Dictionary, connector_id: String) -> String:
	var id := connector_id.strip_edges()
	if id == "":
		return "unknown"
	var conn := connector_by_id(payload, id)
	var kind := s(conn.get("kind"))
	var num := RegEx.create_from_string("(\\d+)").search(id)
	match kind:
		"destination_in":
			var did := s(conn.get("externalRef"))
			if did.begins_with("host_"):
				var hd := _find_by(a(d(payload.get("screenDestinations")).get("destinations")), "id", did)
				if s(hd.get("label")) != "":
					return s(hd.label)
				if hd.get("casparChannel") != null:
					return "host_ch" + s(hd.casparChannel)
			var intent := _find_by(a(d(d(d(payload.get("live")).get("caspar")).get("destinationIntent")).get("items")), "id", did)
			var msi: Variant = intent.get("mainScreenIndex")
			var n := int(msi) + 1 if (msi is float or msi is int) else -1
			if intent.get("mode") == "multiview":
				return "dst_mv%d" % (n if n > 0 else 1)
			if n > 0:
				return "dst_ch%d" % n
			if did == "multiview":
				return "dst_mv1"
			var clean := did.trim_prefix("dst_")
			return "dst_out_" + clean if clean != "" else "dst_out"
		"stream_out":
			return "str" + num.get_string(1) if num else s(conn.get("label")) if s(conn.get("label")) != "" else id
		"v4l2_out":
			return s(conn.get("label")) if s(conn.get("label")) != "" else "Virtual cam"
		"record_out":
			return "rec" + num.get_string(1) if num else s(conn.get("label")) if s(conn.get("label")) != "" else id
		"gpu_out":
			var pid := s(conn.get("id"))
			if RegEx.create_from_string("(?i)^gpu_p\\d+__").search(pid):
				return s(conn.get("label")) if s(conn.get("label")) != "" else "__".join(pid.split("__").slice(1)).replace("_", "-")
			if RegEx.create_from_string("(?i)^gpu_p\\d+$").search(pid):
				var pair := s(d(d(conn.get("gpuPhysical")).get("pair")).get("name"))
				return "%s (%s)" % [pid, pair] if pair != "" else pid
			var name := s(conn.get("label")) if s(conn.get("label")) != "" else s(conn.get("externalRef"))
			return "gpu_" + name if name != "" else id
		"decklink_io", "decklink_out":
			var ext := s(conn.get("externalRef"))
			if ext.is_valid_int() and int(ext) > 0:
				return "decklink_%d" % int(ext)
			var tail := RegEx.create_from_string("(?:^|_)(\\d+)$").search(id)
			if tail:
				return "decklink_" + tail.get_string(1)
			var idx := s(conn.get("index"))
			if idx.is_valid_int() and int(idx) >= 0:
				return "decklink_%d" % (int(idx) + 1)
			return "decklink"
	return s(conn.get("label")) if s(conn.get("label")) != "" else id
