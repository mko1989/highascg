extends RefCounted
## WO-605 slice 9b — the GPU column after the layout prefs (web lib/device-view-gpu-port-list.js
## buildGpuSelectablePortEntries + entryToRearPanelGpuItem, -merge.js, -layout-prefs.js, -utils.js
## collectGpuPortNameOptions): order and pairs come from the server topology; this client's saved layout
## (web localStorage `gpu_custom_layout`, here `user://devices.cfg` [gpu] layout) only adds hidden flags and labels.
## The editor rows (layout items) turn into the `gpuPhysicalTopology` the server keeps. Pure apart from the prefs.

const E := preload("res://features/devices/gpu_entries.gd")
const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")

const PREFS := "user://devices.cfg"

## Rear-panel GPU edit mode (web gpuEditMode: the pencil; the GPU page shows the layout editor while it is on).
static var edit := false


## readGpuLayoutPrefs over a saved list: {by_id, order} (rows without a gpu_pN[__tag] id are skipped).
static func prefs_of(list: Variant) -> Dictionary:
	var by_id := {}
	var order := []
	for item in R.a(list):
		var id := E.s(R.d(item).get("id"))
		if id == "" or E.re(E._GPU_P_TAG, id) == null:
			continue
		by_id[id] = item
		order.append(id)
	return {"by_id": by_id, "order": order}


## mergeGpuLayoutEntriesWithPrefs (defaultHideDisconnected is always false in the web's callers).
static func merge(entries: Array, prefs: Dictionary, displays: Array, topo: Array) -> Array:
	var by_id: Dictionary = prefs.get("by_id", {})
	var order := topo.map(func(t: Variant) -> String: return E.s(R.d(t).get("physicalPortId"))) \
		.filter(func(id: String) -> bool: return E.re(E._GPU_P, id) != null)
	var sockets: Variant = topo.size() if not topo.is_empty() else null
	var result := []
	for e in entries:
		var id := E.s(E.or_([e.get("connectorId"), e.get("layoutSlotId"), ""]))
		var saved: Variant = by_id.get(id)
		var m: Dictionary = e.duplicate()
		m.hidden = H.truthy(R.d(saved).get("hidden")) if saved != null else H.truthy(e.get("hidden"))
		m.connected = H.truthy(e.get("connected"))
		m.livePresent = H.truthy(e.get("livePresent"))
		m.monitor = e.get("monitor") if H.truthy(e.get("monitor")) else ""
		if H.truthy(R.d(saved).get("label")):
			m.label = str(saved.label)
		m.topologySlot = (e.get("topologySlot") is bool and e.topologySlot) or E.is_primary(id, sockets)
		result.append(m)
	var have := {}
	for m in result:
		have[E.s(m.connectorId)] = true
	for id in order:
		if have.has(id):
			continue
		var saved := R.d(by_id.get(id))
		var row: Variant = null
		for t in topo:
			if E.s(R.d(t).get("physicalPortId")) == id:
				row = t
				break
		var inferred := E.from_topology_row(row, displays, [], [], float(result.size()), [], null)
		if not R.a(saved.get("pairs")).is_empty():
			inferred.pairs = R.a(saved.pairs).duplicate()
		if H.truthy(saved.get("label")):
			inferred.label = str(saved.label)
		if saved.get("hidden") != null:
			inferred.hidden = H.truthy(saved.hidden)
		result.append(inferred)
		have[id] = true
	if order.is_empty():
		return result
	var dec := []
	for i in result.size():
		var r: int = order.find(result[i].connectorId)
		dec.append([r if r >= 0 else 9000 + i, i, result[i]])
	dec.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	return dec.map(func(x: Array) -> Dictionary: return x[2])


## buildGpuSelectablePortEntries: topology rows, then the raw extras, merged with the client prefs.
static func entries(live: Variant, suggested: Array, graph: Array, saved_topology: Variant, prefs: Dictionary) -> Array:
	var topo := E.topology(live, saved_topology)
	var base := E.from_topology(topo, live, suggested, graph)
	var ids := {}
	for e in base:
		ids[E.s(e.connectorId)] = true
	for e in E.raw_extra(live, suggested, graph):
		if not ids.has(E.s(e.connectorId)):
			base.append(e)
			ids[E.s(e.connectorId)] = true
	return merge(base, prefs, R.a(E.gpu_live(live).get("displays")), topo)


## live.gpu.connectors minus the card / gpu / renderD nodes.
static func inventory(live: Variant) -> Array:
	return R.a(E.gpu_live(live).get("connectors")).filter(func(inv: Variant) -> bool:
		var n := E.s(E.or_([R.d(inv).get("shortName"), R.d(inv).get("name"), ""])).to_lower()
		return n != "" and E.re("^(card|gpu|renderd)\\d+($|[\\s:])", n) == null)


## entryToRearPanelGpuItem.
static func rear_item(e: Dictionary, displays: Array, inv: Array, sockets: Variant) -> Dictionary:
	var pairs := R.a(e.get("pairs"))
	var live_present: bool = H.truthy(e.get("livePresent")) or not E.matching(pairs, displays, inv).is_empty()
	var res: Variant = e.get("resolution")
	var in_graph: bool = e.get("inDeviceGraph") is bool and e.inDeviceGraph
	var it := {"id": e.connectorId, "layoutSlotId": E.or_([e.get("layoutSlotId"), e.connectorId]), "icon": e.get("icon"),
		"label": e.label, "kind": "gpu_out", "index": e.get("index"),
		"connected": H.truthy(e.get("connected")) or (live_present and H.truthy(res) and str(res) != "unknown"),
		"livePresent": live_present, "topologySlot": (e.get("topologySlot") is bool and e.topologySlot) or E.is_primary(e.connectorId, sockets),
		"hidden": e.get("hidden"), "pairs": pairs, "monitor": E.or_([e.get("monitor"), ""]),
		"edidSerial": E.or_([e.get("edidSerial"), ""]), "edidPreferredMode": E.or_([e.get("edidPreferredMode"), ""]),
		"resolution": E.or_([res, ""]), "refreshHz": e.get("refreshHz"), "inDeviceGraph": in_graph, "isVirtual": not in_graph}
	if not e.has("index"):
		it.erase("index")
	return it


## The rear-panel GPU column: rear items + whether each goes in the "Disconnected" folder.
static func rear_items(live: Variant, list: Array) -> Array:
	var sockets: Variant = list.filter(func(e: Dictionary) -> bool: return E.re(E._GPU_P, E.s(e.connectorId)) != null).size()
	sockets = sockets if sockets > 0 else null
	var inv := inventory(live)
	var displays := R.a(E.gpu_live(live).get("displays"))
	return list.map(func(e: Dictionary) -> Dictionary: return rear_item(e, displays, inv, sockets))


## The Devices tab's GPU column from a (settings-merged) device-view payload and this client's saved layout list:
## rear items plus `hdmi` (icon) and `folder` (goes in the "Disconnected" folder). Web: caspar-rear-data.js.
static func column(payload: Dictionary, saved_list: Array) -> Array:
	var items := rear_items(payload.get("live"), column_entries(payload, saved_list))
	for it in items:
		it.hdmi = it.icon == E.ICON_HDMI
		it.folder = in_folder(it)
	return items


## The column's entries (graph + suggested gpu outs, the settings topology, the saved layout) — the rear label drag
## swaps their layout items.
static func column_entries(payload: Dictionary, saved_list: Array) -> Array:
	var gpu_outs := []
	var seen := {}
	for key in ["graph", "suggested"]:
		for c in R.a(R.d(payload.get(key)).get("connectors")):
			if c is Dictionary and c.get("deviceId") == "caspar_host" and c.get("kind") == "gpu_out" and not seen.has(c.get("id")):
				seen[c.get("id")] = true
				gpu_outs.append(c)
	var graph_outs := R.a(R.d(payload.get("graph")).get("connectors")).filter(func(c: Variant) -> bool:
		return c is Dictionary and c.get("kind") in ["gpu_out", "gpu_output"])
	var saved_topo: Variant = E.or_([R.d(payload.get("_settings")).get("gpuPhysicalTopology"), payload.get("gpuPhysicalTopology")])
	return entries(payload.get("live"), gpu_outs, graph_outs, saved_topo, prefs_of(saved_list))


## isDisconnectedGpu: not a topology socket and nothing live on it.
static func in_folder(it: Dictionary) -> bool:
	return not it.topologySlot and not it.livePresent and not it.connected


## layoutItemsFromGpuEntries — the editor / prefs row shape.
static func layout_items(list: Array) -> Array:
	return list.map(func(e: Dictionary) -> Dictionary:
		var pairs := R.a(e.get("pairs")).duplicate()
		if pairs.is_empty() and H.truthy(e.get("monitor")):
			pairs.append(e.monitor)
		var blob := " ".join(pairs.map(func(p: Variant) -> String: return E.s(p) if p != null else "") + [E.s(e.get("monitor"))]).to_upper()
		return {"id": e.connectorId, "label": e.label, "pairs": pairs,
			"type": "hdmi" if blob.contains("HDMI") else ("edp" if blob.contains("EDP") else "dp"), "hidden": H.truthy(e.get("hidden"))})


## buildGpuLayoutItemsFromLive: the editor rows without any saved prefs.
static func items_from_live(live: Variant, suggested: Array, saved_topology: Variant) -> Array:
	return layout_items(entries(live, suggested, [], saved_topology, prefs_of([])))


## gpuLayoutItemsToPhysicalTopology: editor rows → `gpuPhysicalTopology` (rows without a gpu_pN id are dropped).
static func to_topology(items: Array) -> Array:
	var out := []
	for idx in items.size():
		var m := E.re("(?i)^(gpu_p\\d+)", E.s(R.d(items[idx]).get("id")))
		if m == null:
			continue
		var pairs := R.a(items[idx].get("pairs")).filter(func(p: Variant) -> bool: return H.truthy(p))
		out.append({"physicalPortId": m.get_string(1), "slotOrder": idx, "dpA": E.s(pairs[0] if pairs.size() > 0 else ""),
			"dpB": E.s(pairs[1] if pairs.size() > 1 else ""), "connectorNumber": idx, "location": idx})
	return out


## collectGpuPortNameOptions: every RandR / probe name the editor's Port A / B can pick, DP first, then HDMI, eDP, rest.
static func port_options(live: Variant) -> Array:
	var names := []
	var add := func(v: Variant) -> void:
		var t := E.s(v)
		if t != "" and t.to_lower() != "none" and not names.has(t):
			names.append(t)
	var g := E.gpu_live(live)
	for row in R.a(E.pmap(live).get("effectiveTopology")):
		add.call(R.d(row).get("dpA"))
		add.call(R.d(row).get("dpB"))
	for p in R.a(E.pmap(live).get("ports")):
		var pair := R.d(R.d(p).get("pair"))
		if not pair.is_empty():
			for k in ["dpA", "dpB", "name"]:
				add.call(pair.get(k))
		var rt := R.d(R.d(p).get("runtime"))
		for k in ["activePort", "xrandrName", "displayName"]:
			add.call(rt.get(k))
	for c in R.a(g.get("connectors")):
		for k in ["shortName", "name", "xrandrName"]:
			add.call(R.d(c).get(k))
	for d in R.a(g.get("displays")):
		add.call(R.d(d).get("name"))
	if names.is_empty():
		for i in 8:
			add.call("DP-%d" % i)
		for i in 4:
			add.call("HDMI-%d" % i)
		add.call("EDP-1")
		add.call("EDP-1-1")
	var dec := names.map(func(n: String) -> Array: return _rank(n) + [n])
	dec.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and (a[1] < b[1] or (a[1] == b[1] and a[2] < b[2]))))
	return dec.map(func(x: Array) -> String: return x[3])


static func _rank(n: String) -> Array:
	var u := n.to_upper()
	if u.begins_with("DP-"):
		return [0, _parse_int(u.substr(3)), u]
	if u.begins_with("HDMI-"):
		return [1, _parse_int(u.substr(5)), u]
	return [2, 0, u] if u.contains("EDP") else [3, 0, u]


## parseInt(s, 10) || 0.
static func _parse_int(t: String) -> int:
	var m := E.re("^\\s*[+-]?\\d+", t)
	return int(m.get_string()) if m != null else 0


# ---------------------------------------------------------------- this client's saved layout

static func saved() -> Array:
	var cfg := ConfigFile.new()
	return R.a(cfg.get_value("gpu", "layout", [])) if cfg.load(PREFS) == OK else []


static func save(items: Array) -> void:
	var cfg := ConfigFile.new()
	cfg.load(PREFS)
	cfg.set_value("gpu", "layout", items)
	cfg.save(PREFS)


static func clear() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PREFS) == OK and cfg.has_section_key("gpu", "layout"):
		cfg.erase_section_key("gpu", "layout")
		cfg.save(PREFS)
