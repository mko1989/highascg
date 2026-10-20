extends RefCounted
## WO-622 — the web Sources "Live" tab as data (sources-panel-live-render.js renderLiveTab with buildLiveSources,
## migrateLegacyInputRoute, reconcileExtraLiveSourceChannel, the per-kind slot status messages and
## getLiveThumbnailChannelForSource). Rows = saved extras (state.extraLiveSources) the base list doesn't already hold,
## then the base list: System Timers template, PGM / PRV routes, DeckLink / live audio / USB inputs, audio zones.
## Each row drags the web payload {type, value, label, resolution, fps, routeType, …} onto the look editor.

const H := preload("res://features/devices/host_channels.gd")
const R := preload("res://features/devices/cable_rules.gd")
const TIMERS := "/templates/playback_timers.html"
const HOST_KINDS := ["webpage_host", "ndi_host", "browser_display"]
const HINTS := [
	["decklink", "DeckLink tiles match Settings. Use Stop to clear layer."],
	["live_audio", "Live audio: configure in Settings → live audio, then drag onto looks."],
	["v4l2", "USB video: click a tile to inspect or remove; drag route:// onto PGM or multiview."],
	["layer", "Layer routes: Looks row ↗ (default = PGM; Shift+↗ = edit bus, Ctrl+↗ = PRV). Drag onto another layer."],
	["webpage_host", "Webpage hosts: click a tile to edit the page URL in the Inspector; ⛶ routes video to the operator monitor."],
	["ndi_host", "NDI hosts: click a tile to inspect and remove in the Inspector panel."],
	["browser_display", "Browser sources: click a tile to edit URL/dimensions and toggle operator screen in the Inspector."],
]
const PAYLOAD_KEYS := ["resolution", "fps", "routeType", "screenIdx"]


## JS String(v) for the values these rows carry: integral floats print without ".0", null → "".
static func _js(v: Variant) -> String:
	if v == null:
		return ""
	if v is float and is_equal_approx(v, roundf(v)) and absf(v) < 1e15:
		return str(int(v))
	return str(v)


static func _num(v: Variant) -> Variant:
	if v is int or v is float:
		return v
	if v is String and v.strip_edges().is_valid_float():
		return float(v)
	return null


static func _at(arr: Variant, i: int) -> Variant:
	var a := R.a(arr)
	return a[i] if i < a.size() else null


## effectiveChannelMap: the planned (Settings) map while host channels wait for Apply, else the live one.
static func effective_cm(planned: Variant, live: Variant) -> Variant:
	var p: Variant = planned if planned is Dictionary else null
	var l: Variant = live if live is Dictionary else null
	if H.pending_apply(p, l):
		return p if p != null else l
	return l if l != null else p


## formatFps: two decimals at most, whole rates without them; missing / ≤ 0 → "".
static func format_fps(v: Variant) -> String:
	var f: Variant = _num(v)
	if f == null or is_nan(float(f)) or f <= 0:
		return ""
	var n := roundf(float(f) * 100.0) / 100.0
	return str(int(n)) if n == floorf(n) else "%.2f" % n


static func _res(res: Variant) -> String:
	if res is Dictionary and H.truthy(res.get("w")) and H.truthy(res.get("h")):
		return "%s×%s" % [_js(res.w), _js(res.h)]
	return ""


static func _rate(res: Variant) -> String:
	return format_fps(res.fps) if res is Dictionary and res.get("fps") != null else ""


static func _cfg_slot(cfg: Variant, i: int) -> Dictionary:
	for s in R.a(R.d(R.d(cfg).get("configured")).get("slots")):
		if s is Dictionary and _num(s.get("slot")) != null and float(_num(s.slot)) == i:
			return s
	return {}


## buildLiveSources.
static func build(cm: Variant, connectors: Array, audio_cfg: Variant, v4l2_cfg: Variant) -> Array:
	var out := [{"type": "browser", "routeType": "browser", "value": TIMERS, "label": "System Timers Template",
		"resolution": "1920×1080", "fps": "50", "browserAsCg": false}]
	if not cm is Dictionary:
		return out
	var names := R.a(cm.get("virtualMainChannels"))
	var pgm := R.a(cm.get("programChannels"))
	for i in pgm.size():
		var res: Variant = _at(cm.get("programResolutions"), i)
		var nm: Variant = R.d(_at(names, i)).get("name")
		out.append({"type": "route", "routeType": "pgm", "value": "route://" + _js(pgm[i]),
			"label": "PGM: " + _js(nm) if H.truthy(nm) else "Program %d" % (i + 1), "resolution": _res(res), "fps": _rate(res)})
	var prv := R.a(cm.get("previewChannels"))
	for i in prv.size():
		if _at(cm.get("previewEnabledByMain"), i) == false or prv[i] == null:
			continue
		var res: Variant = _at(cm.get("programResolutions"), i)
		var nm: Variant = R.d(_at(names, i)).get("name")
		out.append({"type": "route", "routeType": "prv", "value": "route://" + _js(prv[i]),
			"label": "PRV: " + _js(nm) if H.truthy(nm) else "Preview %d" % (i + 1), "resolution": _res(res), "fps": _rate(res)})
	for e in H.input_channels(cm):
		if e.get("kind") == "decklink":
			out.append(_decklink_row(e, connectors))
	for i in range(1, H._count(cm, "liveAudioCount") + 1):
		var e := H.live_audio_entry(cm, i)
		if e.is_empty():
			continue
		var cfg := _cfg_slot(audio_cfg, i)
		var res: Variant = e.get("resolution") if H.truthy(e.get("resolution")) else cfg.get("resolution")
		out.append(_slot_row("live_audio", e, H.coalesce([e.get("route") if H.truthy(e.get("route")) else null, cfg.get("route")]),
			e.get("label") if H.truthy(e.get("label")) else cfg.get("label") if H.truthy(cfg.get("label")) else "Live audio %d" % i,
			_res(res), _rate(res), {"liveAudioSlot": i}))
	for i in range(1, H._count(cm, "v4l2InputCount") + 1):
		var e := H.v4l2_entry(cm, i)
		if e.is_empty():
			continue
		var cfg := _cfg_slot(v4l2_cfg, i)
		var res: Variant = e.get("resolution") if H.truthy(e.get("resolution")) else cfg.get("resolution")
		var size := _res(res) if _res(res) != "" else _res({"w": cfg.get("width"), "h": cfg.get("height")})
		var rate := _rate(res) if res is Dictionary and res.get("fps") != null else format_fps(cfg.fps) if H.truthy(cfg.get("fps")) else ""
		var extra := {"v4l2Slot": i}
		if cfg.get("device") != null:
			extra.devicePath = cfg.device
		out.append(_slot_row("v4l2", e, H.coalesce([e.get("route") if H.truthy(e.get("route")) else null, cfg.get("route")]),
			cfg.get("label") if H.truthy(cfg.get("label")) else e.get("label") if H.truthy(e.get("label")) else "USB video %d" % i,
			size, rate, extra))
	var zones := R.a(cm.get("audioOnlyChannels"))
	for i in zones.size():
		var res: Variant = _at(cm.get("audioOnlyResolutions"), i)
		out.append({"type": "route", "routeType": "audio_zone", "value": "route://" + _js(zones[i]),
			"label": "Audio zone %d" % (i + 1), "resolution": _res(res), "fps": _rate(res)})
	return out


static func _decklink_row(e: Dictionary, connectors: Array) -> Dictionary:
	var i: Variant = e.get("slot")
	var conn := {}
	for c in connectors:
		if c is Dictionary and str(c.get("kind")) in ["decklink_io", "decklink"] and R.d(c.get("caspar")).get("ioDirection") == "in" \
				and ((i is int or i is float) and (H._num_eq(c.get("index"), i - 1) or H._connector_slot(c) == i)):
			conn = c
			break
	var label: Variant = e.get("label") if H.truthy(e.get("label")) else conn.get("label") if H.truthy(conn.get("label")) \
		else "DeckLink %s" % _js(i)
	var row := _slot_row("decklink", e, e.get("route"), label, _res(e.get("resolution")), _rate(e.get("resolution")),
		{"decklinkSlot": i})
	if conn.get("id") != null:
		row.connectorId = conn.id
	row.decklinkDevice = H.js_int(conn.externalRef) if conn.get("externalRef") != null else i
	return row


static func _slot_row(kind: String, e: Dictionary, value: Variant, label: Variant, res: String, fps: String, extra: Dictionary) -> Dictionary:
	var row := {"type": "route", "routeType": kind, "value": value, "label": label, "resolution": res, "fps": fps}
	row.merge(extra)
	for k in [["inputsChannel", "channel"], ["inputsLayer", "layer"]]:
		if e.get(k[1]) != null:
			row[k[0]] = e[k[1]]
	return row


## migrateLegacyInputRoute: route://<old shared inputs ch>-<1..8> → the slot's own DeckLink / live-audio route.
static func migrate_route(cm: Variant, value: Variant) -> String:
	var val := _js(value).strip_edges()
	var m := RegEx.create_from_string("(?i)^route://(\\d+)(?:-(\\d+))?$").search(val)
	if m == null or not cm is Dictionary or not H._num_eq(int(m.get_string(1)), cm.get("inputsCh")):
		return val
	if m.get_string(2) != "":
		var layer := int(m.get_string(2))
		if layer >= 1 and layer <= 8:
			for route in [H.decklink_entry(cm, layer).get("route"), H.live_audio_entry(cm, layer).get("route")]:
				if H.truthy(route):
					return str(route)
	return val


## reconcileExtraLiveSourceChannel: a saved extra follows its slot / host channel in the current map.
static func reconcile_extra(src: Dictionary, cm: Variant) -> Dictionary:
	if not cm is Dictionary:
		return src
	var rt := _js(src.get("routeType")).to_lower()
	var e := {}
	if rt == "decklink" and src.get("decklinkSlot") != null:
		e = H.decklink_entry(cm, _num(src.decklinkSlot))
	elif rt == "live_audio" and src.get("liveAudioSlot") != null:
		e = H.live_audio_entry(cm, _num(src.liveAudioSlot))
	elif rt == "v4l2" and src.get("v4l2Slot") != null:
		e = H.v4l2_entry(cm, _num(src.v4l2Slot))
	elif rt in HOST_KINDS:
		var sid: Variant = src.get("sourceId") if H.truthy(src.get("sourceId")) else src.get("hostSourceId")
		var want := _js(sid if H.truthy(sid) else "").strip_edges()
		for x in H._entries(cm):
			if _js(x.get("kind")) == rt and (want == "" or _js(x.get("sourceId")) == want):
				e = x
				break
	if e.get("channel") == null:
		return src
	var out := src.duplicate()
	out.inputsChannel = e.channel
	out.hostChannel = e.channel
	var lyr: Variant = H.coalesce([e.get("layer"), src.get("inputsLayer")])
	if lyr != null:
		out.inputsLayer = lyr
	out.value = e.route if H.truthy(e.get("route")) else src.get("value")
	return out


## The tab's rows: extras the base list doesn't already hold (migrated + reconciled), then the base list.
static func sources(cm: Variant, connectors: Array, audio_cfg: Variant, v4l2_cfg: Variant, extras: Variant) -> Array:
	var base := build(cm, connectors, audio_cfg, v4l2_cfg)
	var have := {}
	for s in base:
		have[_js(s.get("value"))] = true
	var out := []
	for s in R.a(extras):
		if s is Dictionary and H.truthy(s.get("value")) and not have.has(_js(s.value)):
			var m: Dictionary = s.duplicate(true)
			m.value = migrate_route(cm, s.value)
			out.append(reconcile_extra(m, cm))
	return out + base


static func hint(rows: Array) -> String:
	var parts := []
	for h in HINTS:
		if rows.any(func(s: Dictionary) -> bool: return s.get("routeType") == h[0]):
			parts.append(h[1])
	return " ".join(parts)


## Line 2: device path, resolution, rate, host channel, page size, route, Direct / CG flags.
static func meta(s: Dictionary) -> String:
	var items := [_js(s.get("resolution")), _js(s.fps) + " fps" if H.truthy(s.get("fps")) else ""]
	var rt: Variant = s.get("routeType")
	if rt == "v4l2" and H.truthy(s.get("devicePath")):
		items.push_front(_js(s.devicePath))
	if rt in HOST_KINDS:
		if s.get("hostChannel") != null:
			items.append("host ch " + _js(s.hostChannel))
		if rt == "browser_display" and s.get("width") != null and s.get("height") != null:
			items.append("%sx%s" % [_js(s.width), _js(s.height)])
		items.append(_js(s.get("value")))
	if s.get("type") == "ndi" and rt != "ndi_host" and H.truthy(s.get("useDirect")):
		items.append("Direct (legacy)")
	if s.get("type") == "browser" and H.truthy(s.get("browserAsCg")):
		items.append("CG template")
	return " · ".join(items.filter(func(x: String) -> bool: return x != ""))


static func _find(list: Variant, pred: Callable) -> Dictionary:
	for x in R.a(list):
		if x is Dictionary and pred.call(x):
			return x
	return {}


static func _offline(st: Variant) -> bool:
	return st.get("enabled") == false and st.get("reason") == "amcp_disconnected"


## Line 3 (warning colour): decklinkSlotStatusMessage / liveAudioSlotStatusMessage / v4l2SlotStatusMessage.
## status = {decklink, audio, v4l2} — state.decklinkInputsStatus / liveAudioInputsStatus / v4l2InputsStatus.
static func slot_message(s: Dictionary, status: Dictionary) -> String:
	var rt: Variant = s.get("routeType")
	if rt == "decklink" and s.get("decklinkSlot") != null:
		var st: Variant = status.get("decklink")
		var slot: Variant = s.decklinkSlot
		if not st is Dictionary:
			return ""
		if _offline(st):
			return "AMCP offline — inputs not started"
		var f := _find(st.get("failed"), func(x: Dictionary) -> bool: return H._num_eq(x.get("layer"), slot))
		if not f.is_empty():
			return _js(f.message) if H.truthy(f.get("message")) else "PLAY failed on this layer"
		if not _find(st.get("skippedConflicts"), func(x: Dictionary) -> bool: return H._num_eq(x.get("input"), slot)).is_empty():
			return "Skipped: device used as DeckLink output elsewhere"
		if not _find(st.get("skippedDuplicates"), func(x: Dictionary) -> bool: return H._num_eq(x.get("input"), slot)).is_empty():
			return "Skipped: duplicate device index (see Settings → Screens)"
	elif rt == "live_audio" and s.get("liveAudioSlot") != null:
		var st: Variant = status.get("audio")
		var slot: Variant = s.liveAudioSlot
		if not st is Dictionary:
			return ""
		if _offline(st):
			return "AMCP offline — live audio not started"
		var f := _find(st.get("failed"), func(x: Dictionary) -> bool: return H._num_eq(x.get("slot"), slot))
		if not f.is_empty():
			return _js(f.message) if H.truthy(f.get("message")) else "PLAY failed on this slot"
		if not _find(st.get("started"), func(x: Dictionary) -> bool: return H._num_eq(x.get("slot"), slot)).is_empty():
			return "Running"
	elif rt == "v4l2" and s.get("v4l2Slot") != null:
		var st: Variant = status.get("v4l2")
		var slot: Variant = s.v4l2Slot
		if not st is Dictionary:
			return ""
		if _offline(st):
			return "AMCP offline — USB input not started"
		var f := _find(st.get("failed"), func(x: Dictionary) -> bool: return H._num_eq(_num(x.get("slot")), slot))
		if not f.is_empty():
			return _js(f.message) if H.truthy(f.get("message")) else "PLAY failed for this slot"
	return ""


## getLiveThumbnailChannelForSource: the route's channel, else the saved thumbnail channel; direct NDI has none.
static func thumb_channel(s: Dictionary) -> Variant:
	var v: Variant = s.get("value")
	if s.get("useDirect") == true and v is String and v.strip_edges().to_lower().begins_with("ndi://"):
		return null
	if v is String:
		var m := RegEx.create_from_string("(?i)^route://(\\d+)").search(v)
		if m != null and int(m.get_string(1)) > 0:
			return int(m.get_string(1))
	var n: Variant = H.js_int(H.coalesce([s.get("thumbnailChannel"), s.get("liveThumbChannel"), s.get("producerChannel")]))
	return n if n != null and n > 0 else null


## The drag payload (makeDraggable + the Live tab's extras).
static func drag_payload(s: Dictionary) -> Dictionary:
	var out := {"type": s.get("type"), "value": s.get("value"),
		"label": s.label if H.truthy(s.get("label")) else s.get("value")}
	for k in PAYLOAD_KEYS:
		if s.has(k):
			out[k] = s[k]
	var tc: Variant = _num(s.get("thumbnailChannel"))
	if not (s.get("type") == "ndi" and s.get("useDirect") == true and s.get("routeType") != "ndi_host") \
			and tc != null and is_finite(float(tc)) and tc > 0:
		out.thumbnailChannel = tc
	if s.get("useDirect") != null:
		out.useDirect = s.useDirect
	if s.get("browserAsCg") == true:
		out.browserAsCg = true
	return out
