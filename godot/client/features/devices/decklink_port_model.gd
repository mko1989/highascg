extends RefCounted
## WO-605 slice 5 — the DeckLink connector page's output side (web device-view-inspector-decklink.js,
## -decklink-output.js, -decklink-shared.js, lib/device-view-decklink-keyfill.js): the page spec, the SDI consumer
## and fill + key patches. The spec is the flat item list the web page renders ({t: heading | note | small | warn |
## hr | caption | select | input | hint | check | button | label | host}); decklink_port_controls.gd builds widgets
## from it and the golden test compares it item by item with the web DOM. The input side (Start / Stop input, the
## host-channel device switcher) is decklink_input_model.gd. Pure: no autoloads.

const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")
const GM := preload("res://features/devices/gpu_modeline_model.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const DI := preload("res://features/devices/decklink_input_model.gd")

const LATENCY := ["normal", "low", "default"]
const COLOR_SPACE := ["bt709", "bt601", "bt2020"]
const PIXEL_FORMAT := [["", "Auto (Caspar decides)"], ["yuv", "YUV — required for 2160p"], ["rgba", "RGBA"]]
const CHANNEL_LAYOUT := [["stereo", "Stereo"], ["mono", "Mono"], ["8ch", "8ch (discrete)"]]
const RASTER_NOTE := "SDI format is the physical raster (e.g. 1080p50, 2160p50). Upstream canvas is passed through at 1:1 — no scaling. Larger canvas overflows; smaller canvas does not fill the SDI frame."
const YUV_WARNING := "This is a 2160p output — set Pixel format to YUV, or the SDI shows nothing and the whole channel stops rendering on every consumer."
const MODE_PLACEHOLDER := "Select SDI format…"
const DECKLINK_KINDS := ["decklink_io", "decklink_out"]


## parseInt(String(v ?? '0'), 10) || 0
static func _pi(v: Variant) -> int:
	var n: Variant = H.js_int(v if v != null else "0")
	return n if n != null else 0


## A JS template-literal rendering of a number / string.
static func _t(v: Variant) -> String:
	if v == null:
		return "null"
	return str(v) if v is String else GM.js_num_str(v)


static func _str(v: Variant) -> String:
	return "" if not H.truthy(v) else R.s(v)


# ---------------------------------------------------------------- page spec

## The whole page under the title (the web skips the rear-order editor outside its edit mode).
static func page_spec(conn: Dictionary, payload: Dictionary, settings: Variant) -> Array:
	if str(conn.get("kind")) == "decklink_out":
		return output_items(conn, payload)
	var io := H._io_direction(conn.get("caspar"))
	var items := DI.input_items(conn, payload, settings)
	items.append({"t": "hr"})
	items.append({"t": "heading", "text": "Output"})
	if io == "in":
		items.append({"t": "note", "text": "This port is in input mode. Stop input above to use it as a program / fill+key output."})
		return items
	items.append({"t": "note", "text": output_note(io, cable_count(payload, str(conn.get("id", ""))))})
	items.append_array(output_items(conn, payload))
	return items


static func output_note(io: String, cables: int) -> String:
	if io != "unassigned":
		return "Program output, fill+key pairs, and destination mapping."
	if cables > 0:
		return "Cabled (%d connection%s) — becomes a program output on Apply. Fill+key below." % [cables, "" if cables == 1 else "s"]
	return "Unassigned SDI port. Cable a screen destination here to use as program output, or configure fill+key below."


## connectorCableCount: graph edges with this connector at either end.
static func cable_count(payload: Dictionary, id: String) -> int:
	if id == "":
		return 0
	var n := 0
	for e in R.a(R.d(payload.get("graph")).get("edges")):
		if e is Dictionary and (_str(e.get("sinkId")) == id or _str(e.get("sourceId")) == id):
			n += 1
	return n


static func output_items(conn: Dictionary, payload: Dictionary) -> Array:
	var status := output_status(payload, str(conn.get("id", "")))
	return inherit_items(status) + consumer_items(conn, status) + keyfill_items(conn, payload)


## decklinkOutputStatusForConnector: live.decklink.outputs row for this connector, {} when none.
static func output_status(payload: Dictionary, id: String) -> Dictionary:
	for o in R.a(R.d(R.d(payload.get("live")).get("decklink")).get("outputs")):
		if o is Dictionary and _str(o.get("connectorId")) == id:
			return o
	return {}


## formatInheritedDecklinkMode.
static func inherited_mode_text(inh: Variant) -> String:
	if not inh is Dictionary:
		return "—"
	var mode := _str(inh.get("standardModeId")) if H.truthy(inh.get("standardModeId")) else _str(inh.get("videoMode"))
	var w: Variant = inh.get("width")
	var h: Variant = inh.get("height")
	var fps: Variant = inh.get("fps")
	var dims := H.truthy(w) and H.truthy(h) and H.truthy(fps)
	if mode != "" and dims:
		return "%s (%s×%s @ %s Hz)" % [mode, _t(w), _t(h), _t(fps)]
	if mode != "":
		return mode
	if dims:
		return "%s×%s @ %s Hz" % [_t(w), _t(h), _t(fps)]
	return "—"


static func inherit_items(status: Dictionary) -> Array:
	var inh: Variant = status.get("inherited")
	var i := R.d(inh)
	var source := str(i.sourceLabel) if H.truthy(i.get("sourceLabel")) else "Upstream feed"
	var sdi := _str(status.get("decklinkVideoMode")) if H.truthy(status.get("decklinkVideoMode")) else _str(i.get("operatorOutputMode"))
	var items := [{"t": "heading", "text": "SDI output"}, {"t": "note", "text": RASTER_NOTE},
		{"t": "note", "text": "Upstream: %s — %s" % [source, inherited_mode_text(inh if inh is Dictionary else null)]}]
	if H.truthy(i.get("width")) and H.truthy(i.get("height")) and sdi != "":
		items.append({"t": "small", "text": "1:1 passthrough %s×%s → SDI %s" % [_t(i.width), _t(i.height), sdi]})
	elif sdi != "":
		items.append({"t": "small", "text": "SDI format: " + sdi})
	if not status.is_empty() and not H.truthy(status.get("ok")):
		items.append({"t": "warn", "text": str(status.reason) if H.truthy(status.get("reason")) else "Wire a destination feed to this SDI port."})
	elif H.truthy(status.get("reason")):
		items.append({"t": "small", "text": str(status.reason)})
	elif str(i.get("outputModeSource")) == "override":
		items.append({"t": "small", "text": "Channel pixels map 1:1 onto the SDI raster (crop or letterbox, never scaled)."})
	return items


# ---------------------------------------------------------------- SDI consumer

## readDecklinkConsumerCaspar (+ the select fallbacks). Web gap: lowLatency is never read back, so the box always
## opens unchecked (and every save writes false) — ported as-is, logged in WO-605 slice 5.
static func consumer_state(conn: Dictionary, status: Dictionary) -> Dictionary:
	var c := R.d(conn.get("caspar"))
	var saved := _str(c.get("decklinkOutputVideoMode"))
	var inherited := _str(status.get("decklinkVideoMode"))
	var layout := (_str(c.get("decklinkChannelLayout")) if H.truthy(c.get("decklinkChannelLayout")) else "stereo").to_lower()
	var latency := (_str(c.get("decklinkLatency")) if H.truthy(c.get("decklinkLatency")) else "normal").to_lower()
	var color := (_str(c.get("decklinkColorSpace")) if H.truthy(c.get("decklinkColorSpace")) else "bt709").to_lower()
	var pixel := _str(c.get("decklinkPixelFormat")).to_lower()
	var depth: Variant = H.js_int(c.get("decklinkBufferDepth") if c.get("decklinkBufferDepth") != null else 3)
	var ea: Variant = c.get("decklinkEmbeddedAudio")
	return {
		"saved_mode": saved,
		"mode": saved if saved in DM.STANDARD_VIDEO_MODES else (inherited if inherited in DM.STANDARD_VIDEO_MODES else ""),
		"layout": layout if CHANNEL_LAYOUT.any(func(o: Array) -> bool: return o[0] == layout) else "stereo",
		"latency": latency if latency in LATENCY else "normal",
		"depth": str(clampi(depth if depth != null and depth != 0 else 3, 1, 3)),
		"color": color if color in COLOR_SPACE else "bt709",
		"pixel": pixel if PIXEL_FORMAT.any(func(o: Array) -> bool: return o[0] == pixel) else "",
		"audio": not (ea is bool and ea == false) and not (ea is String and ea == "false"),
		"low_latency": false,
	}


## decklinkModeNeedsYuv.
static func needs_yuv(mode: String) -> bool:
	return RegEx.create_from_string("^(dci)?(2160|4320)p").search(mode.strip_edges().to_lower()) != null


## The pixel-format hint under the select: `mode` = the select's value, else the saved mode.
static func yuv_warning(ui: Dictionary) -> String:
	var mode: String = ui.mode if ui.mode != "" else ui.saved_mode
	return YUV_WARNING if needs_yuv(mode) and ui.pixel != "yuv" else ""


static func mode_options() -> Array:
	var out := [["", MODE_PLACEHOLDER]]
	for m in DM.STANDARD_VIDEO_MODES:
		out.append([m, m])
	return out


static func consumer_items(conn: Dictionary, status: Dictionary) -> Array:
	var ui := consumer_state(conn, status)
	var plain := func(list: Array) -> Array: return list.map(func(v: String) -> Array: return [v, v])
	var sel := func(key: String, caption: String, options: Array) -> Array:
		return [{"t": "caption", "text": caption}, {"t": "select", "key": key, "value": ui[key], "options": options, "disabled": false}]
	var items := [{"t": "heading", "text": "SDI consumer"}]
	items.append_array(sel.call("mode", "SDI format", mode_options()))
	items.append_array(sel.call("layout", "Channel layout", CHANNEL_LAYOUT))
	items.append_array(sel.call("latency", "Latency", plain.call(LATENCY)))
	items.append_array([{"t": "caption", "text": "Buffer depth"}, {"t": "input", "key": "depth", "value": ui.depth}])
	items.append_array(sel.call("color", "Color space", plain.call(COLOR_SPACE)))
	items.append_array(sel.call("pixel", "Pixel format", PIXEL_FORMAT))
	items.append({"t": "hint", "text": yuv_warning(ui)})
	items.append({"t": "check", "key": "audio", "text": "Embedded audio on SDI", "checked": ui.audio})
	items.append({"t": "check", "key": "low_latency", "text": "Low-latency mode", "checked": ui.low_latency})
	return items


## persist(): {error} or {patch} — the full SDI consumer set plus the binding / key fields the connector carries.
## `depth` is the raw field text (the web reads it before the math commit rewrites it).
static func consumer_patch(conn: Dictionary, ui: Dictionary) -> Dictionary:
	var mode: String = str(ui.mode).strip_edges()
	if mode == "" or not mode in DM.STANDARD_VIDEO_MODES:
		return {"error": "Select an SDI format."}
	var depth: Variant = H.js_int(ui.depth if str(ui.depth) != "" else "3")
	var p := {
		"ioDirection": "out", "decklinkOutputVideoMode": mode, "decklinkEmbeddedAudio": ui.audio,
		"decklinkChannelLayout": ui.layout if ui.layout != "" else "stereo",
		"decklinkLatency": ui.latency if ui.latency != "" else "normal",
		"decklinkBufferDepth": clampi(depth if depth != null and depth != 0 else 3, 1, 3),
		"decklinkColorSpace": ui.color if ui.color != "" else "bt709",
		"decklinkPixelFormat": ui.pixel, "decklinkLowLatency": ui.low_latency,
	}
	var c := R.d(conn.get("caspar"))
	if H.truthy(c.get("outputBinding")):
		p.outputBinding = c.outputBinding
	for k in ["decklinkKeyFill", "decklinkKeyDevice", "decklinkKeyer"]:
		if c.get(k) != null:
			p[k] = c[k]
	return {"patch": p}


# ---------------------------------------------------------------- fill + key

static func _binding(conn: Dictionary) -> Dictionary:
	var ob: Variant = R.d(conn.get("caspar")).get("outputBinding")
	if not ob is Dictionary:
		return {}
	var t := R.s(ob.get("type")).to_lower()
	if t == "multiview":
		return {"type": "multiview"}
	if t == "screen":
		var idx: Variant = H.js_int(ob.get("index") if ob.get("index") != null else "")
		if idx != null and idx >= 1:
			return {"type": "screen", "screen": idx}
	return {}


static func _screen_row(dl: Dictionary, screen: int) -> Dictionary:
	for o in R.a(dl.get("screenOutputs")):
		if o is Dictionary and GM.js_num(o.get("screen")) == float(screen):
			return o
	return {}


## resolveDecklinkKeyFillState → {fill, enabled, key}.
static func keyfill_state(conn: Dictionary, payload: Dictionary) -> Dictionary:
	var c := R.d(conn.get("caspar"))
	var fill := _pi(conn.get("externalRef"))
	var graph_key := _pi(c.get("decklinkKeyDevice"))
	var kf: Variant = c.get("decklinkKeyFill")
	var off: bool = (kf is bool and kf == false) or (kf is String and kf == "false")
	var on: bool = (kf is bool and kf == true) or (kf is String and kf == "true") or (not off and graph_key > 0)
	var b := _binding(conn)
	var dl := R.d(R.d(payload.get("live")).get("decklink"))
	var live_kf: Variant = null
	var live_fill := 0
	if b.get("type") == "multiview":
		var mv: Variant = dl.get("multiviewKeyFill")
		live_kf = H.coalesce([R.d(mv).get("keyFill"), mv])
		live_fill = _pi(dl.get("multiviewDevice"))
	elif b.get("type") == "screen":
		var row := _screen_row(dl, b.screen)
		live_kf = row.get("keyFill")
		live_fill = _pi(row.get("device"))
	var lk := R.d(live_kf)
	var live_key := _pi(lk.get("keyDevice"))
	var live_on: bool = lk.get("enabled") is bool and lk.enabled == true
	var this_fill := fill > 0 and live_fill > 0 and fill == live_fill
	var this_key := fill > 0 and live_on and live_key == fill and not this_fill
	if off:
		return {"fill": fill, "enabled": false, "key": 0}
	var enabled: bool = not this_key and (on or (live_on and this_fill))
	var key := (graph_key if graph_key > 0 else live_key) if enabled else 0
	return {"fill": fill, "enabled": enabled, "key": key}


## collectDecklinkDeviceIndices: every SDI device index the box knows of, `exclude` left out, ascending.
static func device_indices(payload: Dictionary, exclude: int) -> Array:
	var seen := {}
	var add := func(v: Variant) -> void:
		var n: Variant = H.js_int(v)
		if n != null and n > 0 and n != exclude:
			seen[n] = true
	var dl := R.d(R.d(payload.get("live")).get("decklink"))
	for c in R.a(R.d(dl.get("hardware")).get("connectors")):
		var cd := R.d(c)
		add.call(H.coalesce([cd.get("device"), cd.get("index"), cd.get("externalRef")]))
	for c in R.a(R.d(payload.get("suggested")).get("connectors")):
		if c is Dictionary and str(c.get("kind", "")) in DECKLINK_KINDS:
			add.call(c.get("externalRef"))
	for o in R.a(dl.get("screenOutputs")):
		add.call(R.d(o).get("device"))
		add.call(R.d(R.d(o).get("keyFill")).get("keyDevice"))
	add.call(dl.get("multiviewDevice"))
	var out := seen.keys()
	out.sort()
	return out


static func keyfill_items(conn: Dictionary, payload: Dictionary) -> Array:
	var st := keyfill_state(conn, payload)
	var idx := device_indices(payload, st.fill)
	var options := [["0", "Key port…"]]
	for i in idx:
		options.append([str(i), str(i)])
	if st.key > 0 and not st.key in idx:
		options.append([str(st.key), str(st.key)])
	var value := str(st.key) if st.key > 0 else (str(idx[0]) if not idx.is_empty() else "0")
	return [{"t": "check", "key": "kf", "text": "Fill + key", "checked": st.enabled},
		{"t": "select", "key": "key", "value": value, "options": options, "disabled": not st.enabled}]


## The key select value after ticking Fill + key: the first index when none is chosen.
static func key_after_toggle(on: bool, key: String, payload: Dictionary, conn: Dictionary) -> String:
	var idx := device_indices(payload, keyfill_state(conn, payload).fill)
	if on and _pi(key) <= 0 and not idx.is_empty():
		return str(idx[0])
	return key


## persist(): {error} or {patch, status}.
static func keyfill_patch(conn: Dictionary, payload: Dictionary, on: bool, key: String) -> Dictionary:
	var fill: int = keyfill_state(conn, payload).fill
	var kd := _pi(key if key != "" else "0") if on else 0
	if on and fill > 0 and kd > 0 and kd == fill:
		return {"error": "Key port must differ from fill."}
	if on and kd <= 0:
		return {"error": "Choose key port."}
	var p := {"ioDirection": "out", "decklinkKeyFill": on, "decklinkKeyDevice": kd if on else 0, "decklinkKeyer": "internal"}
	var ob: Variant = R.d(conn.get("caspar")).get("outputBinding")
	if H.truthy(ob):
		p.outputBinding = ob
	return {"patch": p, "status": "Key on port %d." % kd if on else "Fill only."}
