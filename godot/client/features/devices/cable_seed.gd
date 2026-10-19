extends RefCounted
## WO-605 slice 2b — what a new cable writes besides the edge itself. Pure 1:1 ports of
## device-view-cable-preflight.js (missing gpu_pN / dst_in_* rows written into the saved graph first),
## screen-consumer-defaults.js + device-view-gpu-source-inherit.js + device-view-inspector-gpu-resolve.js (a cable
## onto a GPU socket seeds screen_N consumer flags and inherits the source feed's mode/size/fps; WO-364: a PRV head
## only gets its binding), project-fps.js, the outputLayer note (device-view-cable-outputs.js) and the Caspar
## video-mode dims (CASPAR_VIDEO_MODE_SPECS / videoModeToResolution). Golden-tested (test_devices_cable_seed.gd).
## Not ported: mapping-node output feeds (resolveMappingOutputFeedSource) — Godot draws no mapping nodes yet, so no
## cable can start from one; feed_source() returns {} for them.

const R := preload("res://features/devices/cable_rules.gd")
const PROJECT_FPS := [23.98, 24.0, 25.0, 29.97, 30.0, 50.0, 59.94, 60.0]
const SCREEN_DEFAULTS := {"windowed": true, "borderless": true, "vsync": false}
const MODE_DIMS := {"576": [720, 576], "720": [1280, 720], "1080": [1920, 1080], "1556": [2048, 1556],
	"2160": [3840, 2160], "dci1080": [2048, 1080], "dci2160": [4096, 2160]}
const ALL_RATES := [2398, 2400, 2500, 2997, 3000, 5000, 5994, 6000]
const FILM_RATES := [2398, 2400, 2500]
const HOST_DEVICE := {"id": "caspar_host", "role": "caspar_host", "label": "Caspar / HighAsCG host"}
const DEST_DEVICE := {"id": "destinations", "role": "destinations", "label": "Screen destinations"}


static func normalize_fps(fps: Variant) -> float:
	var n := float(R.s(fps)) if R.s(fps).is_valid_float() else 0.0
	if n <= 0.0:
		return 50.0
	var best := 50.0
	for f in PROJECT_FPS:
		if absf(f - n) < absf(best - n):
			best = f
	return best


static func default_mode_for_fps(fps: Variant) -> String:
	var f := normalize_fps(fps)
	return "1080p%04d" % roundi(f * 100.0)


static func project_fps(settings: Variant) -> float:
	var fps: Variant = R.d(R.d(settings).get("machineProfile")).get("defaultProjectFps")
	if fps != null:
		return normalize_fps(fps)
	var pr: Variant = R.a(R.d(R.d(settings).get("channelMap")).get("programResolutions"))
	var first := R.d(pr[0]) if not pr.is_empty() else {}
	var pfps: Variant = first.get("fps")
	if (pfps is float or pfps is int) and pfps > 0:
		return normalize_fps(pfps)
	return 50.0


static func default_video_mode(settings: Variant) -> String:
	return default_mode_for_fps(project_fps(settings))


## CASPAR_VIDEO_MODE_SPECS[mode] → {width, height, fps}, {} for an id not in the web table.
static func mode_spec(mode: String) -> Dictionary:
	if mode == "PAL":
		return {"width": 720, "height": 576, "fps": 25.0}
	if mode == "NTSC":
		return {"width": 720, "height": 486, "fps": 29.97}
	var m := RegEx.create_from_string("^((?:dci)?\\d{3,4}[pi])(\\d{4})$").search(mode)
	if not m:
		return {}
	var rates: Array = {"576p": [2500], "720p": ALL_RATES, "1080p": ALL_RATES, "2160p": ALL_RATES,
		"1080i": [5000, 5994, 6000], "1556p": FILM_RATES, "dci1080p": FILM_RATES, "dci2160p": FILM_RATES}.get(m.get_string(1), [])
	var rate := int(m.get_string(2))
	if not rate in rates:
		return {}
	var dims: Array = MODE_DIMS[m.get_string(1).left(-1)]
	return {"width": dims[0], "height": dims[1], "fps": rate / 100.0}


## videoModeToResolution: custom "WxHpF", standard 720/1080/2160 ids by their rate, else by prefix, else 1080p50.
static func mode_resolution(mode: String) -> Dictionary:
	var c := RegEx.create_from_string("(?i)^(\\d{2,5})x(\\d{2,5})p([\\d.]+)$").search(mode.strip_edges())
	if c:
		return {"w": maxi(1, int(c.get_string(1))), "h": maxi(1, int(c.get_string(2))),
			"fps": maxf(1.0, float(c.get_string(3))) if float(c.get_string(3)) > 0 else 50.0}
	var m := mode.to_lower()
	var std := RegEx.create_from_string("^(720|1080|2160)[pi](\\d{4})$").search(m)
	var dims := {"720": [1280, 720], "1080": [1920, 1080], "2160": [3840, 2160]}
	if std:
		var d: Array = dims[std.get_string(1)]
		return {"w": d[0], "h": d[1], "fps": int(std.get_string(2)) / 100.0}
	for p in ["1080", "2160", "720"]:
		if m.begins_with(p):
			return {"w": dims[p][0], "h": dims[p][1], "fps": 50.0}
	if m == "pal":
		return {"w": 720, "h": 576, "fps": 25.0}
	if m == "ntsc":
		return {"w": 720, "h": 486, "fps": 29.97}
	return {"w": 1920, "h": 1080, "fps": 50.0}


## JS parseInt(String(v), 10) → int, or null when it is NaN.
static func _int(v: Variant) -> Variant:
	var m := RegEx.create_from_string("^\\s*([+-]?\\d+)").search(R.s(v))
	return int(m.get_string(1)) if m else null


static func _float(v: Variant) -> Variant:
	var m := RegEx.create_from_string("^\\s*([+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?)").search(R.s(v))
	return float(m.get_string(1)) if m else null


static func _first(values: Array) -> Variant:
	for v in values:
		if v != null:
			return v
	return null


## normalizeFeedSource: {id, label, videoMode, width, height, fps}; dims fall back to the mode's.
static func _feed(raw: Dictionary, settings: Variant) -> Dictionary:
	var id := R.s(raw.get("id"))
	if id == "":
		return {}
	var fallback_mode := default_video_mode(settings)
	var mode := R.s(_first([raw.get("videoMode"), fallback_mode]))
	mode = mode if mode != "" else fallback_mode
	var spec := mode_spec(mode)
	var fb := mode_resolution(mode)
	var w: Variant = _int(_first([raw.get("width"), spec.get("width"), fb.w]))
	var h: Variant = _int(_first([raw.get("height"), spec.get("height"), fb.h]))
	var f: Variant = _float(_first([raw.get("fps"), spec.get("fps"), 50]))
	var out := {"id": id, "videoMode": mode, "width": maxi(64, w if w else 1920), "height": maxi(64, h if h else 1080),
		"fps": maxf(1.0, f if f else 50.0)}
	if raw.get("label") != null:
		out.label = R.s(raw.label)
	return out


## resolveCableSourceResolution (destination feeds): graph source row → live destination intent → saved destination.
static func feed_source(payload: Dictionary, source_id: String) -> Dictionary:
	var sid := source_id.strip_edges()
	if not sid.begins_with("dst_in_"):
		return {}
	var settings: Variant = payload.get("_settings")
	for s in R.a(R.d(payload.get("graph")).get("sources")):
		if s is Dictionary and R.s(s.get("id")) == sid:
			return _feed(s, settings)
	var did := sid.trim_prefix("dst_in_").strip_edges()
	if did == "":
		return {}
	var intents := R.a(R.d(R.d(R.d(payload.get("live")).get("caspar")).get("destinationIntent")).get("items"))
	var dests := R.a(R.d(payload.get("screenDestinations")).get("destinations"))
	for list in [intents, dests]:
		for x in list:
			if x is Dictionary and R.s(x.get("id")) == did:
				return _feed({"id": sid, "label": x.get("label"), "videoMode": x.get("videoMode"),
					"width": x.get("width"), "height": x.get("height"), "fps": x.get("fps")}, settings)
	return {}


## gpuOutputBindingFromCableSource: multiview | screen N | (WO-364) screen_prv N for a PRV-half cable.
static func output_binding(payload: Dictionary, source_id: String, half: String) -> Dictionary:
	var sid := source_id.strip_edges()
	if not sid.begins_with("dst_in_"):
		return {}
	var did := sid.trim_prefix("dst_in_").strip_edges()
	var dest := {}
	for x in R.a(R.d(payload.get("screenDestinations")).get("destinations")):
		if x is Dictionary and R.s(x.get("id")) == did and did != "":
			dest = x
			break
	if dest.is_empty():
		return {}
	var mode := R.s(_first([dest.get("mode"), "pgm_prv"])).to_lower()
	mode = mode if mode != "" else "pgm_prv"
	if mode == "multiview":
		return {"type": "multiview"}
	var main: Variant = _int(_first([dest.get("mainScreenIndex"), 0]))
	var n := maxi(1, (main if main else 0) + 1)
	if half == "prv" and mode == "pgm_prv":
		return {"type": "screen_prv", "index": n}
	return {"type": "screen", "index": n}


static func _unset(v: Variant) -> bool:
	return v == null


static func screen_seed_caspar_patch(cs: Dictionary, n: int) -> Dictionary:
	n = maxi(1, n)
	var k := "screen_%d_" % n
	if _unset(cs.get(k + "windowed")) and _unset(cs.get(k + "borderless")) and _unset(cs.get(k + "vsync")):
		return {k + "windowed": SCREEN_DEFAULTS.windowed, k + "borderless": SCREEN_DEFAULTS.borderless,
			k + "vsync": SCREEN_DEFAULTS.vsync}
	var w: Variant = cs.get(k + "windowed")
	var windowed: bool = SCREEN_DEFAULTS.windowed if _unset(w) else not (w is bool and not w) and not (w is String and w == "false")
	var b: Variant = cs.get(k + "borderless")
	if windowed and ((b is bool and not b) or (b is String and b == "false")):
		return {k + "borderless": true}  # legacy bordered window → borderless
	return {}


## screenConsumerSeedSettingsPatch (the web cable path passes no settings, so screen_N_mode is not seeded there).
static func screen_seed_patch(cs: Dictionary, n: int, settings: Variant = null) -> Dictionary:
	var patch := screen_seed_caspar_patch(cs, n)
	var mode_key := "screen_%d_mode" % maxi(1, n)
	if settings != null and R.s(cs.get(mode_key)) == "":
		patch[mode_key] = default_video_mode(settings)
	return {"casparServer": patch}


static func inherited_patch(n: int, source: Dictionary) -> Dictionary:
	n = maxi(1, n)
	var mode := R.s(_first([source.get("videoMode"), "1080p5000"]))
	var w: Variant = _int(_first([source.get("width"), 1920]))
	var h: Variant = _int(_first([source.get("height"), 1080]))
	var f: Variant = _float(_first([source.get("fps"), 50]))
	var k := "screen_%d_" % n
	return {"casparServer": {k + "mode": mode if mode != "" else "1080p5000", k + "custom_width": maxi(64, w if w else 1920),
		k + "custom_height": maxi(64, h if h else 1080), k + "custom_fps": maxf(1.0, f if f else 50.0)}}


static func merge_patches(patches: Array) -> Dictionary:
	var out := {"casparServer": {}}
	for p in patches:
		for k in R.d(p):
			if k == "casparServer":
				out.casparServer.merge(R.d(p[k]), true)
			else:
				out[k] = p[k]
	return out


## resolveGpuScreenNumber: the jack's screen binding, else its cabled destination's main screen, else mainIndex,
## else its position among suggested gpu_out connectors (1–4).
static func screen_number(conn: Dictionary, payload: Dictionary) -> int:
	var ob := R.d(R.d(conn.get("caspar")).get("outputBinding"))
	if R.s(ob.get("type")).to_lower() == "screen":
		var idx: Variant = _int(ob.get("index"))
		if idx != null and idx >= 1:
			return clampi(idx, 1, 4)
	for e in R.a(R.d(payload.get("graph")).get("edges")):
		if e is Dictionary and R.s(e.get("sinkId")) == R.s(conn.get("id")):
			var src := R.s(e.get("sourceId"))
			if src.begins_with("dst_in_"):
				for d in R.a(R.d(payload.get("screenDestinations")).get("destinations")):
					if d is Dictionary and R.s(d.get("id")) == src.trim_prefix("dst_in_"):
						var dm := R.s(_first([d.get("mode"), "pgm_prv"])).to_lower()
						if dm != "multiview" and dm != "stream":
							var ms: Variant = _int(_first([d.get("mainScreenIndex"), 0]))
							return clampi((ms if ms else 0) + 1, 1, 4)
						break
			break
	var mi: Variant = R.d(conn.get("caspar")).get("mainIndex")
	if (mi is float or mi is int) and mi >= 0:
		return clampi(roundi(mi) + 1, 1, 4)
	var gpus := R.a(R.d(payload.get("suggested")).get("connectors")).filter(
		func(x: Variant) -> bool: return x is Dictionary and x.get("kind") == "gpu_out")
	for i in gpus.size():
		if R.s(gpus[i].get("id")) == R.s(conn.get("id")):
			return clampi(i + 1, 1, 4)
	return 1


## resolveGpuPhysicalScreenIndex: gpu_pN → N+1, else the physical port's slot order, else screen_number.
static func physical_screen_index(conn: Dictionary, payload: Dictionary) -> int:
	var id := R.gpu_port_cable_id(R.s(conn.get("id")))
	var m := RegEx.create_from_string("(?i)^gpu_p(\\d+)$").search(id)
	if m:
		return clampi(int(m.get_string(1)) + 1, 1, 4)
	for p in R.gpu_ports(payload):
		if p is Dictionary and R.s(p.get("physicalPortId")) == id:
			var so: Variant = p.get("slotOrder")
			if so is float or so is int:
				return clampi(int(so) + 1, 1, 4)
	var slot: Variant = R.d(conn.get("gpuPhysical")).get("slotOrder")
	if (slot is float or slot is int) and slot >= 0:
		return clampi(roundi(slot) + 1, 1, 4)
	return screen_number(conn, payload)


## tryAddCable's gpu_out block: {settings: patch or {}, connector: updateConnector patch or {}}. `cs` = settings'
## casparServer. Empty for any other sink kind. `payload.graph` must already hold the new edge (web: runs after addEdge
## returned its graph) — screen_number() reads the sink's incoming edge to find the destination's screen.
static func gpu_sink_writes(payload: Dictionary, cs: Dictionary, source_id: String, sink_id: String, half: String) -> Dictionary:
	var sink := R.connector_by_id(payload, sink_id)
	if sink.get("kind") != "gpu_out":
		return {"settings": {}, "connector": {}}
	var screen_n := screen_number(sink, payload)
	var port_n := physical_screen_index(sink, payload)
	var source := feed_source(payload, source_id)
	var binding := output_binding(payload, source_id, half)
	var prv: bool = binding.get("type") == "screen_prv"
	var patches := []
	if not prv and not screen_seed_caspar_patch(cs, port_n).is_empty():
		patches.append(screen_seed_patch(cs, port_n))
	if binding.get("type") == "multiview" and cs.get("multiview_always_on_top") == null:
		patches.append({"casparServer": {"multiview_always_on_top": false}})
	if not source.is_empty() and not prv:
		patches.append(inherited_patch(screen_n, source))
	var connector := {}
	if not source.is_empty():
		connector = {"caspar": {"mode": source.videoMode}}
		if not binding.is_empty():
			connector.caspar.outputBinding = binding
	return {"settings": merge_patches(patches) if not patches.is_empty() else {}, "connector": connector}


## The graph with this edge's note set to {"outputLayer": N} (1 = PGM, 2 = PRV); {} when the edge is missing.
static func with_output_layer(graph: Dictionary, edge_id: String, layer: int) -> Dictionary:
	var g: Dictionary = graph.duplicate(true)
	for e in R.a(g.get("edges")):
		if e is Dictionary and R.s(e.get("id")) == edge_id and edge_id != "":
			e.note = JSON.stringify({"outputLayer": maxi(1, layer)})
			return g
	return {}


## patchGraphWithMissingCableConnectors: the saved graph plus minimal rows for cable ends it does not hold yet
## (a socket that exists only in live hardware, a destination added since the last save) → {graph, added}.
static func preflight(payload: Dictionary, settings: Variant, ids: Array) -> Dictionary:
	var topo := R.topology(payload, settings)
	var base: Variant = payload.get("graph")
	var g: Dictionary = base.duplicate(true) if base is Dictionary else {"version": 1, "devices": [HOST_DEVICE.duplicate()],
		"connectors": [], "edges": []}
	for k in ["devices", "connectors", "edges"]:
		if not g.get(k) is Array:
			g[k] = []
	var has_dev := func(id: String) -> bool: return g.devices.any(func(d: Variant) -> bool: return d is Dictionary and d.get("id") == id)
	if not has_dev.call(R.CASPAR_HOST):
		g.devices.append(HOST_DEVICE.duplicate())
	var have := {}
	for c in g.connectors:
		if c is Dictionary and R.s(c.get("id")) != "":
			have[R.s(c.id)] = true
	var added := []
	for raw in ids:
		var id := R.gpu_port_cable_id(R.s(raw))
		if id == "" or have.has(id):
			continue
		var row := {}
		if RegEx.create_from_string("(?i)^gpu_p\\d+$").search(id):
			row = _minimal_gpu(id, topo, payload)
		elif id.begins_with("dst_in_"):
			row = _minimal_destination(id, payload)
		if row.is_empty():
			continue
		if row.get("deviceId") == "destinations" and not has_dev.call("destinations"):
			g.devices.append(DEST_DEVICE.duplicate())
		g.connectors.append(row)
		have[id] = true
		added.append(id)
	return {"graph": g, "added": added}


static func _listed(payload: Dictionary, key: String, id: String) -> Dictionary:
	for c in R.a(R.d(payload.get(key)).get("connectors")):
		if c is Dictionary and c.get("id") == id:
			return c.duplicate(true)
	return {}


static func _minimal_gpu(id: String, topo: Array, payload: Dictionary) -> Dictionary:
	var sug := _listed(payload, "suggested", id)
	if not sug.is_empty():
		return sug
	var row := {}
	for t in topo:
		if t is Dictionary and R.s(t.get("physicalPortId")) == id:
			row = t
			break
	var phys := {}
	for p in R.gpu_ports(payload):
		if p is Dictionary and R.s(p.get("physicalPortId")) == id:
			phys = p
			break
	var ppair := R.d(phys.get("pair"))
	var src: Array = [row.get("dpA"), row.get("dpB")] if not row.is_empty() else ([ppair.get("dpA"), ppair.get("dpB")] if phys.get("pair") is Dictionary else [])
	var pairs := src.filter(func(x: Variant) -> bool: return R.s(x) != "").map(func(x: Variant) -> String: return R.s(x))
	var active := R.s(_first_truthy([R.d(phys.get("runtime")).get("activePort"), pairs[0] if pairs else null, id]))
	var pair_name := R.s(ppair.get("name"))
	pair_name = pair_name if pair_name != "" else "/".join(pairs)
	var out := {"id": id, "deviceId": R.CASPAR_HOST, "kind": "gpu_out", "label": "P" + id.substr(5), "externalRef": active,
		"caspar": {"bus": "pgm", "mainIndex": 0}}
	if pair_name != "" or not row.is_empty() or phys.get("pair") is Dictionary:
		var rs: Variant = row.get("slotOrder")
		var ps: Variant = phys.get("slotOrder")
		out.gpuPhysical = {"pair": {"dpA": R.s(_first_truthy([row.get("dpA"), ppair.get("dpA"), pairs[0] if pairs.size() > 0 else null, ""])),
			"dpB": R.s(_first_truthy([row.get("dpB"), ppair.get("dpB"), pairs[1] if pairs.size() > 1 else null, ""])), "name": pair_name},
			"slotOrder": rs if (rs is float or rs is int) else (ps if (ps is float or ps is int) else 0)}
	return out


static func _minimal_destination(id: String, payload: Dictionary) -> Dictionary:
	var ext := id.trim_prefix("dst_in_").strip_edges()
	if ext == "":
		return {}
	for key in ["graph", "suggested"]:
		var c := _listed(payload, key, id)
		if not c.is_empty():
			return c
	var label := ext
	for d in R.a(R.d(payload.get("screenDestinations")).get("destinations")):
		if d is Dictionary and R.s(d.get("id")) == ext and R.s(d.get("label")) != "":
			label = R.s(d.label)
			break
	return {"id": id, "deviceId": "destinations", "kind": "destination_in", "externalRef": ext, "label": label}


## JS `a || b || c`.
static func _first_truthy(values: Array) -> Variant:
	for v in values:
		if v != null and not (v is String and v == "") and not ((v is float or v is int) and v == 0) and not (v is bool and not v):
			return v
	return values[-1] if values else null
