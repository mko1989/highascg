extends RefCounted
## WO-605 slice 6 — what the Stream / Record / Virtual cam / Audio connector pages share (web device-view-inspectors.js
## + device-view-inspector-render.js readableConnectorRows, the inspectors' log boxes, device-view-cable-outputs.js's
## remove handlers and device-view-bands-render.js's "+" add handlers): the summary table, the JS string / number
## coercions the pages' save code relies on, the math-input commits, and the add / remove request plans. Pure.
## A request is [method, path, body] (a 4th element = failure ignored) or ["DIRTY"] (host_controls_base.gd `_run`).

const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")
const MI := preload("res://core/math_input.gd")

const CASPAR_HOST := "caspar_host"
## Math-input fields per kind: key → [min, max] (decimals 0).
const MATH := {
	"stream_out": {"vbitrate": [200.0, INF], "abitrate": [32.0, INF]},
	"record_out": {"crf": [18.0, 51.0], "vbitrate": [0.0, INF], "abitrate": [32.0, INF]},
	"v4l2_out": {"fps": [1.0, 60.0]},
	"audio_out": {"buffer": [1.0, INF], "latency": [1.0, INF], "fifo": [1.0, INF]},
}
const SETTINGS_KEY := {"stream_out": "streamOutputs", "record_out": "recordOutputs", "audio_out": "audioOutputs"}
const REMOVED := {"stream_out": "Stream output removed", "record_out": "Record output removed",
	"audio_out": "Audio output removed", "v4l2_out": "Virtual camera output removed"}


# ---------------------------------------------------------------- JS coercions

## JS String(v): null → "" here (callers only reach it through `|| ''`), whole floats without ".0", no trimming.
static func js(v: Variant) -> String:
	if v == null:
		return ""
	if v is float and is_equal_approx(v, roundf(v)) and absf(v) < 1e15:
		return str(int(v))
	if v is bool:
		return "true" if v else "false"
	return str(v)


## `v === true` / `v !== false` (Godot's == errors across bool / String).
static func is_true(v: Variant) -> bool:
	return v is bool and v


static func not_false(v: Variant) -> bool:
	return not (v is bool and not v)


## v === true || v === 'true' (settings flags that went through a form).
static func flag(v: Variant) -> bool:
	return is_true(v) or (v is String and v == "true")


## `a || b || …` — the first truthy value, else the last.
static func or_(values: Array) -> Variant:
	for v in values:
		if H.truthy(v):
			return v
	return values[-1]


## parseInt(String(v), 10) || fallback.
static func int_or(v: Variant, fallback: int) -> int:
	var n: Variant = H.js_int(js(v))
	return n if n != null and n != 0 else fallback


## select.value = v: the value when it is one of the options, else "" (nothing selected).
static func pick(options: Array, v: String) -> String:
	for o in options:
		if o[0] == v:
			return v
	return ""


## JSON.stringify with JS number formatting (Godot writes 4.0) and insertion-ordered keys.
static func js_json(v: Variant) -> String:
	return JSON.stringify(_ints(v), "", false)


static func _ints(v: Variant) -> Variant:
	if v is float and is_equal_approx(v, roundf(v)) and absf(v) < 1e15:
		return int(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _ints(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _ints(x))
	return v


## attachMathInput's first commit (no last-good value yet).
static func math_initial(kind: String, key: String, raw: String) -> String:
	var b: Array = MATH[kind][key]
	return MI.commit(raw, b[0], b[1], 0, null).text


## A later commit: the field's current text is the last good value (the web resyncs it on focus).
static func math_commit(kind: String, key: String, raw: String, current: String) -> String:
	var b: Array = MATH[kind][key]
	var lg: Variant = null
	var p := MI.parse(current)
	if not is_nan(p):
		lg = clampf(p, b[0], b[1])
	return MI.commit(raw, b[0], b[1], 0, lg).text


# ---------------------------------------------------------------- page parts

## The title + summary table every one of these pages opens with.
static func head_items(conn: Dictionary, payload: Dictionary) -> Array:
	var id := R.s(conn.get("id"))
	var rows := [["Name", js(or_([conn.get("label"), conn.get("id")]))],
		["Device", "Caspar / HighAsCG host" if conn.get("deviceId") == CASPAR_HOST else js(or_([conn.get("deviceId"), "Unknown"]))]]
	if conn.get("kind") == "record_out":
		var cas := R.d(conn.get("caspar"))
		rows.append_array([["Type", "Record output (FILE consumer)"], ["Output ID", js(or_([conn.get("id"), "-"]))],
			["Source", js(or_([cas.get("source"), "program_1"]))], ["CRF", js(H.coalesce([cas.get("crf"), 26]))]])
	else:
		rows.append(["Type", js(or_([conn.get("kind"), "unknown"]))])
	var outs := 0
	var ins := 0
	for e in R.a(R.d(payload.get("graph")).get("edges")):
		if e is Dictionary:
			outs += 1 if js(e.get("sourceId")) == id else 0
			ins += 1 if js(e.get("sinkId")) == id else 0
	rows.append_array([["Out cables", str(outs)], ["In cables", str(ins)]])
	return [{"t": "title", "text": js(or_([conn.get("label"), conn.get("id")]))}, {"t": "table", "rows": rows}]


## The stream / record log box: the last 20 entries as `[ts] [LEVEL] message {extra}`.
static func log_text(list: Variant, empty: String) -> String:
	var rows := R.a(list)
	if rows.is_empty():
		return empty
	var lines := []
	for x in rows.slice(-20):
		var e := R.d(x)
		var ts := js(or_([e.get("ts"), ""])).replace("T", " ").replace("Z", "")
		var extra := " " + js_json(e.extra) if e.get("extra") is Dictionary or e.get("extra") is Array else ""
		lines.append("[%s] [%s] %s%s" % [ts, js(or_([e.get("level"), "info"])).to_upper(), js(or_([e.get("message"), ""])), extra])
	return "\n".join(lines)


## The settings row for `conn` ({} = none).
static func saved_row(settings: Variant, key: String, id: String) -> Dictionary:
	for x in R.a(R.d(settings).get(key)):
		if x is Dictionary and js(or_([x.get("id"), ""])) == id:
			return x
	return {}


## WO-683 (mirror of src/config/portaudio-output.js): Caspar's PortAudio settings are global, so a server drives one
## PortAudio device — the first enabled PortAudio row (a missing type reads as PortAudio). '' when there is none.
static func portaudio_output_id(outputs: Variant) -> String:
	for o in R.a(outputs):
		if not (o is Dictionary) or (o.get("enabled") is bool and not o.enabled) or str(o.get("enabled")) == "false":
			continue
		if js(or_([o.get("type"), "portaudio"])).to_lower() == "system-audio":
			continue
		var id := js(or_([o.get("id"), ""])).strip_edges()
		if id != "":
			return id
	return ""


static func row_index(settings: Variant, key: String, id: String) -> int:
	var rows := R.a(R.d(settings).get(key))
	for i in rows.size():
		if rows[i] is Dictionary and js(or_([rows[i].get("id"), ""])) == id:
			return i
	return -1


# ---------------------------------------------------------------- remove / add

static func remove_confirm(kind: String, id: String) -> String:
	match kind:
		"stream_out":
			return "Remove stream output %s?" % id
		"record_out":
			return "Remove record output %s?" % id
		"audio_out":
			return "Remove audio output %s?" % id
	return "Remove virtual camera output from Device View?"


## ctx.remove*OutputConnector: drop the settings row (or hide the virtual cam), then prune the connector and its
## cables from the saved graph. {requests, status}.
static func remove_plan(kind: String, id: String, payload: Dictionary, settings: Variant) -> Dictionary:
	var cid := id.strip_edges()
	var reqs := []
	if kind == "v4l2_out":
		cid = cid if cid != "" else "vcam_1"
		reqs.append(["POST", "/api/virtual-camera/stop", {"persist": false}, true])
		reqs.append(["POST", "/api/virtual-camera/config", {"showInDeviceView": false, "enabled": false, "persist": true}])
	else:
		var key: String = SETTINGS_KEY[kind]
		var keep := R.a(R.d(settings).get(key)).filter(func(x: Variant) -> bool: return js(R.d(x).get("id")) != cid)
		reqs.append(["POST", "/api/settings", {key: keep}])
	var g: Variant = payload.get("graph")
	if H.truthy(g) and g is Dictionary:
		var graph: Dictionary = g.duplicate(true)
		graph.edges = R.a(graph.get("edges")).filter(func(e: Variant) -> bool:
			return js(R.d(e).get("sourceId")) != cid and js(R.d(e).get("sinkId")) != cid)
		graph.connectors = R.a(graph.get("connectors")).filter(func(c: Variant) -> bool: return js(R.d(c).get("id")) != cid)
		reqs.append(["POST", "/api/device-view", {"deviceGraph": graph}])
	var sc := R.d(R.d(settings).get("streamingChannel"))
	if kind == "audio_out" or (kind == "stream_out" and flag(sc.get("dedicatedOutputChannel"))):
		reqs.append(["DIRTY"])
	return {"requests": reqs, "status": REMOVED[kind]}


## The rear panel's "+" (bands-render onAdd*Output): the next numbered row, or the virtual cam shown again.
static func add_plan(kind: String, settings: Variant) -> Dictionary:
	if kind == "v4l2_out":
		return {"requests": [["POST", "/api/virtual-camera/config", {"showInDeviceView": true, "label": "Virtual cam", "channel": 1,
			"device": "/dev/video10", "width": 1920, "height": 1080, "fps": 50, "audioEnabled": true, "persist": true}]],
			"status": "Virtual camera output added"}
	var key: String = SETTINGS_KEY[kind]
	var cur := R.a(R.d(settings).get(key))
	var prefix: String = {"stream_out": "str", "record_out": "rec"}.get(kind, "audio")
	var i := cur.size() + 1
	while cur.any(func(r: Variant) -> bool: return js(R.d(r).get("id")) == "%s_%d" % [prefix, i]):
		i += 1  # WO-843: after a middle row was removed size + 1 is taken (str_1, str_3 → the new row was a second str_3)
	var row: Dictionary
	var label: String
	match kind:
		"stream_out":
			label = "Str%d" % i
			row = {"id": "str_%d" % i, "label": label, "enabled": true, "type": "rtmp", "name": label, "quality": "medium",
				"rtmpServerUrl": "", "streamKey": "", "srtUrl": ""}
		"record_out":
			label = "Rec%d" % i
			row = {"id": "rec_%d" % i, "label": label, "enabled": true, "name": label, "source": "program_1", "crf": 26}
		_:
			label = "Audio %d" % i
			# WO-683: one PortAudio output per server — later ones start as System Audio (OAL).
			var type := "system-audio" if portaudio_output_id(cur) != "" else "portaudio"
			row = {"id": "audio_%d" % i, "label": label, "enabled": true, "type": type, "deviceName": "", "channelLayout": "stereo"}
	var next := cur.duplicate()
	next.append(row)
	var what: String = {"stream_out": "stream", "record_out": "record", "audio_out": "audio"}[kind]
	return {"requests": [["POST", "/api/settings", {key: next}]], "status": "Added %s output %s" % [what, label]}
