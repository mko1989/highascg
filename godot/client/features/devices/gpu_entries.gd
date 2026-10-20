extends RefCounted
## WO-605 slice 9b — the GPU rear-panel column as the web builds it (lib/device-view-gpu-port-entries.js, -utils.js,
## -topology.js, -list.js buildGpuSelectablePortEntries): one entry per topology row (effectiveTopology, else the saved
## gpuPhysicalTopology, else suggestedTopology), then the raw live entries whose id is not gpu_pN. Pure.
## The raw pass is ported only as far as it can change that result: with a DRM physical map it adds nothing, and its
## gpu_pN entries are dropped anyway — they still matter as the "already bound" set later suggested / display rows are
## checked against. The inferred gpu_pN jacks it pads at the end (and the localStorage port-count override behind
## them) can never reach the output, so they are not ported. Entries carry the web's fields (`connected` may be the
## web's "" on a topology row with an active port but no resolution); merge / prefs live in gpu_layout.gd.

const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")

const ICON_HDMI := "/assets/hdmi-port-icon.svg"
const ICON_DP := "/assets/display-port-icon.svg"
const SOCKETS_RTX := 4  # RTX_20_30_SOCKET_COUNT
const _GPU_P := "(?i)^gpu_p\\d+$"
const _GPU_P_ANY := "(?i)^gpu_p\\d+(__.*)?$"
const _GPU_P_TAG := "(?i)^gpu_p\\d+(__[A-Za-z0-9_]+)?$"


static func re(pattern: String, text: String) -> RegExMatch:
	return RegEx.create_from_string(pattern).search(text)


## JS `String(v || '').trim()`.
static func s(v: Variant) -> String:
	return R.s(v) if H.truthy(v) else ""


## `a || b || …` — the first truthy value, else the last.
static func or_(values: Array) -> Variant:
	for v in values:
		if H.truthy(v):
			return v
	return values[-1]


static func norm(v: Variant) -> String:
	return R.norm_randr(v if H.truthy(v) else "")


## `Number.isFinite(Number(v)) ? Number(v) : null` on dict[key] (a missing key is undefined → null; null → 0).
static func num(dict: Variant, key: String) -> Variant:
	if not dict is Dictionary or not dict.has(key):
		return null
	var v: Variant = dict[key]
	if v == null:
		return 0.0
	if v is bool:
		return 1.0 if v else 0.0
	if v is int or v is float:
		return float(v) if is_finite(float(v)) else null
	var t := str(v).strip_edges()
	if t == "":
		return 0.0
	return float(t) if t.is_valid_float() else null


static func gpu_live(live: Variant) -> Dictionary:
	return R.d(R.d(live).get("gpu"))


static func pmap(live: Variant) -> Dictionary:
	return R.d(gpu_live(live).get("physicalMap"))


## Stable sort by Number(slotOrder) || 0.
static func by_slot(rows: Array) -> Array:
	var dec := []
	for i in rows.size():
		var so: Variant = num(rows[i], "slotOrder")
		dec.append([so if so != null else 0.0, i, rows[i]])
	dec.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	return dec.map(func(x: Array) -> Variant: return x[2])


static func icon(parts: Array) -> String:
	var blob := " ".join(parts.filter(func(p: Variant) -> bool: return H.truthy(p)).map(func(p: Variant) -> String: return R.s(p))).to_upper()
	return ICON_HDMI if blob.contains("HDMI") else ICON_DP


static func edid_label(mon: Variant) -> String:
	return s(mon.get("monitorName")) if mon is Dictionary else ""


static func monitor_label(rt: Variant, display: Variant) -> String:
	var r := R.d(rt)
	var dsp := R.d(display)
	var a := edid_label(r.get("monitor"))
	if a != "":
		return a
	var b := edid_label(or_([dsp.get("monitor"), R.d(dsp.get("edid")).get("parsed")]))
	if b != "":
		return b
	return s(or_([r.get("xrandrName"), r.get("displayName"), r.get("activePort"), dsp.get("name"), ""]))


static func is_primary(id: Variant, socket_count: Variant) -> bool:
	var m := re("(?i)^gpu_p(\\d+)$", s(id))
	if m == null:
		return false
	var limit: int = int(socket_count) if socket_count != null and float(socket_count) > 0 else SOCKETS_RTX
	return int(m.get_string(1)) < limit


static func has_server_map(live: Variant) -> bool:
	return R.a(pmap(live).get("ports")).any(func(p: Variant) -> bool: return re(_GPU_P, s(R.d(p).get("physicalPortId"))) != null)


## displaysMatchingPairs: live displays (then probe connectors) on one of `pairs`, unless explicitly disconnected.
static func matching(pairs: Array, displays: Array, conns: Array) -> Array:
	var want := {}
	for p in pairs:
		if norm(p) != "":
			want[norm(p)] = true
	var hits := []
	if want.is_empty():
		return hits
	for d in displays:
		var n := norm(R.d(d).get("name"))
		if n != "" and want.has(n) and not (R.d(d).get("connected") is bool and not d.connected):
			hits.append({"name": n, "ref": d})
	for c in conns:
		var cd := R.d(c)
		var n := norm(cd.get("shortName") if H.truthy(cd.get("shortName")) else cd.get("name"))
		if n != "" and want.has(n) and not (cd.get("connected") is bool and not cd.connected) \
				and not hits.any(func(h: Dictionary) -> bool: return h.name == n):
			hits.append({"name": n, "ref": c})
	return hits


## labelForTopologyPairs: "DP 0/1", "HDMI 0", eDP pairs joined.
static func pair_label(pairs: Array) -> String:
	var list: Array = pairs.filter(func(p: Variant) -> bool: return H.truthy(p)).map(func(p: Variant) -> String: return R.s(p))
	if list.is_empty():
		return ""
	var blob := " ".join(list).to_upper()
	if blob.contains("HDMI"):
		return "HDMI " + "/".join(list.map(func(p: String) -> String: return "-".join(p.split("-").slice(1))))
	if blob.contains("EDP"):
		return " · ".join(list)
	return "DP " + "/".join(list.map(func(p: String) -> String: return RegEx.create_from_string("(?i)^DP-").sub(p, "")))


static func _row_pairs(row: Variant) -> Array:
	return [R.d(row).get("dpA"), R.d(row).get("dpB")].filter(func(p: Variant) -> bool: return H.truthy(p)).map(func(p: Variant) -> String: return R.s(p))


static func _has_id(list: Array, id: String) -> bool:
	return list.any(func(c: Variant) -> bool: return s(R.d(c).get("id")) == id)


## entryFromTopologyRow.
static func from_topology_row(row: Variant, displays: Array, conns: Array, suggested: Array, index: Variant, graph: Array,
		socket_count: Variant) -> Dictionary:
	var id := s(R.d(row).get("physicalPortId"))
	var pairs := _row_pairs(row)
	var hits := matching(pairs, displays, conns)
	var connected := not hits.is_empty()
	var active: String = hits[0].name if connected else ""
	var disp: Variant = null
	if connected and hits[0].ref is Dictionary and hits[0].ref.has("resolution"):
		disp = hits[0].ref
	else:
		for d in displays:
			if norm(R.d(d).get("name")) == norm(active):
				disp = d
				break
	var res := s(R.d(disp).get("resolution"))
	var has_mode: Variant = false if not connected else ("" if res == "" else res != "unknown")
	var label := pair_label(pairs)
	label = label if label != "" else id
	if connected and active != "":
		label = "%s · %s" % [label, active] if has_mode is bool and has_mode else "%s · %s (no mode)" % [label, active]
	var dd := R.d(disp)
	var in_dev: bool = _has_id(suggested, id) or _has_id(graph, id) or connected
	var e := {"connectorId": id, "layoutSlotId": id, "label": label, "kind": "gpu_out", "index": index,
		"connected": has_mode, "livePresent": connected, "topologySlot": is_primary(id, socket_count), "hidden": false,
		"pairs": pairs, "monitor": monitor_label({"monitor": or_([dd.get("monitor"), R.d(dd.get("edid")).get("parsed")])} if disp != null else null, disp) if active != "" else "",
		"resolution": res, "refreshHz": num(disp, "refreshHz"), "icon": icon(pairs), "isVirtual": not in_dev, "inDeviceGraph": in_dev}
	if index == null:
		e.erase("index")
	return e


## resolveTopologyForDeviceView: the server-reconciled map, else the saved settings rows, else the suggested rows.
static func topology(live: Variant, saved: Variant) -> Array:
	var pm := pmap(live)
	for t in [pm.get("effectiveTopology"), saved, pm.get("suggestedTopology")]:
		if t is Array and not t.is_empty():
			return t
	return []


static func from_topology(topo: Array, live: Variant, suggested: Array, graph: Array) -> Array:
	var g := gpu_live(live)
	var sorted := by_slot(topo)
	var out := []
	for i in sorted.size():
		out.append(from_topology_row(sorted[i], R.a(g.get("displays")), R.a(g.get("connectors")), suggested, float(i), graph, sorted.size()))
	return out


# ---------------------------------------------------------------- raw live entries (buildRawGpuPortEntriesFromLive)

static func _from_physical(p: Dictionary, index: int) -> Dictionary:
	var id := s(p.get("physicalPortId"))
	var rt := R.d(p.get("runtime"))
	var pair := R.d(p.get("pair"))
	var mon := R.d(rt.get("monitor"))
	var pair_name := s(pair.get("name"))
	var label := pair_name if pair_name != "" else id
	if H.truthy(rt.get("connected")):  # labelForPhysicalPort
		var parts := [label]
		for v in [s(or_([rt.get("xrandrName"), rt.get("displayName"), rt.get("activePort"), ""])), edid_label(rt.get("monitor"))]:
			if v != "":
				parts.append(v)
		var res := s(rt.get("resolution"))
		if res != "" and res != "unknown":
			parts.append(res)
		label = " · ".join(parts)
	return {"connectorId": id, "layoutSlotId": id, "label": label, "kind": "gpu_out", "index": float(index),
		"connected": H.truthy(rt.get("connected")), "hidden": false, "pairs": _row_pairs(pair), "monitor": monitor_label(rt, null),
		"edidSerial": s(mon.get("serial")), "edidPreferredMode": s(mon.get("preferredMode")), "resolution": s(rt.get("resolution")),
		"refreshHz": num(rt, "refreshHz"), "icon": icon([pair.get("dpA"), pair.get("dpB"), pair.get("name"), rt.get("activePort")]),
		"isVirtual": not H.truthy(rt.get("connected")), "physicalPort": p}


static func _from_suggested(c: Dictionary, displays: Array, index: int, physical: Variant) -> Dictionary:
	var id := s(c.get("id"))
	var ref := s(or_([c.get("externalRef"), c.get("label"), id]))
	var disp := {}
	for d in displays:
		if norm(R.d(d).get("name")) == norm(ref):
			disp = R.d(d)
			break
	var dc := H.truthy(disp.get("connected"))
	if physical != null:
		var m := _from_physical(physical, index)
		m.connectorId = id if id != "" else m.connectorId
		m.layoutSlotId = id if id != "" else m.layoutSlotId
		m.label = str(or_([c.get("label"), m.label, ref, id]))
		m.monitor = str(or_([disp.get("name"), m.monitor, ref]))
		m.connected = m.connected or dc
		m.isVirtual = not m.connected
		return m
	return {"connectorId": id, "layoutSlotId": id, "label": str(or_([c.get("label"), ref, id])), "kind": "gpu_out", "index": float(index), "connected": dc,
		"hidden": false, "pairs": [ref] if ref != "" else [], "monitor": str(or_([disp.get("name"), ref])),
		"resolution": s(disp.get("resolution")), "refreshHz": num(disp, "refreshHz"),
		"icon": icon([ref, c.get("label")]), "isVirtual": not dc}


static func _from_display(d: Dictionary, suggested: Array, index: int) -> Dictionary:
	var name := s(d.get("name"))
	var hit := {}
	for c in suggested:
		var cd := R.d(c)
		if cd.get("kind") == "gpu_out" and norm(or_([cd.get("externalRef"), cd.get("label")])) == norm(name):
			hit = cd
			break
	var id := s(hit.get("id"))
	if id == "":
		id = "gpu_" + RegEx.create_from_string("[^A-Z0-9]+").sub(norm(name), "_", true)
	return {"connectorId": id, "layoutSlotId": id, "label": str(hit.label) if H.truthy(hit.get("label")) else name,
		"kind": "gpu_out", "index": float(index), "connected": H.truthy(d.get("connected")), "hidden": false, "pairs": [name],
		"monitor": name, "resolution": s(d.get("resolution")), "refreshHz": num(d, "refreshHz"), "icon": icon([name]),
		"isVirtual": not H.truthy(d.get("connected"))}


## entryActivelyBoundToDisplay: the RandR output already sits on this jack.
static func _bound(e: Dictionary, name: Variant) -> bool:
	var n := norm(name)
	if n == "":
		return false
	if norm(e.get("monitor")) == n or R.a(e.get("pairs")).any(func(p: Variant) -> bool: return norm(p) == n):
		return true
	var rt := R.d(R.d(e.get("physicalPort")).get("runtime"))
	if rt.is_empty():
		return false
	return norm(or_([rt.get("xrandrName"), rt.get("displayName"), rt.get("activePort"), ""])) == n


## The raw entries with non-gpu_pN ids (in raw order, tagged inDeviceGraph) — all buildGpuSelectablePortEntries keeps.
static func raw_extra(live: Variant, suggested: Array, graph: Array) -> Array:
	var g := gpu_live(live)
	var ports := R.a(pmap(live).get("ports"))
	var displays := R.a(g.get("displays"))
	var entries := []
	var seen := {}
	var push := func(e: Dictionary) -> void:
		var id := s(e.connectorId)
		if id != "" and not seen.has(id):
			seen[id] = true
			e.index = float(entries.size())
			entries.append(e)
	var physical := {}
	for p in by_slot(ports):
		if s(R.d(p).get("physicalPortId")) != "":
			physical[s(p.physicalPortId)] = p
	for c in suggested:
		var cd := R.d(c)
		var id := s(cd.get("id"))
		if cd.get("kind") != "gpu_out" or id == "" or seen.has(id):
			continue
		var ref := s(or_([cd.get("externalRef"), cd.get("label"), ""]))
		if ref != "" and entries.any(func(e: Dictionary) -> bool: return _bound(e, ref)):
			continue
		var p: Variant = physical.get(id)
		physical.erase(id)
		push.call(_from_suggested(cd, displays, entries.size(), p))
	for p in physical.values():
		push.call(_from_physical(p, entries.size()))
	var drm := has_server_map(live)
	if not (drm and not displays.is_empty()):
		for d in displays:
			var name := s(R.d(d).get("name"))
			if name != "" and not entries.any(func(e: Dictionary) -> bool: return _bound(e, name)):
				push.call(_from_display(d, suggested, entries.size()))
	var graph_ids := {}
	for c in suggested + graph:
		if R.d(c).get("kind") in ["gpu_out", "gpu_output"] and s(c.get("id")) != "":
			graph_ids[s(c.id)] = true
	var phys_ids := {}
	for p in ports:
		if s(R.d(p).get("physicalPortId")) != "":
			phys_ids[s(p.physicalPortId)] = true
	var out := []
	for e in entries:
		var id := s(e.connectorId)
		if drm or re(_GPU_P_ANY, id) != null:
			continue  # DRM rear panels keep gpu_pN only; gpu_pN rows come from the topology instead
		e.inDeviceGraph = graph_ids.has(id) or phys_ids.has(id)
		out.append(e)
	return out
