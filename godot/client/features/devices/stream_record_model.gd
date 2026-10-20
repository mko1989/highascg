extends RefCounted
## WO-605 slice 6 — the Stream and Record connector pages (web device-view-inspector-stream.js / -record.js): the
## field values a page opens with (`*_state`), the visible items for the current values (`*_items` — NDI hides
## the URL / encoder fields and Start / Stop, the key fields are RTMP-only, the SRT fields SRT-only) and the request
## plans behind Save / Start / Stop. Plans return {error} (shown as a failed status) or {requests, status} (status ""
## = the web sets none). Pure.

const O := preload("res://features/devices/output_ports_model.gd")
const R := O.R
const H := O.H

const STREAM_NOTE := "Saved settings apply on next Start stream. Cable from a destination to set the source channel."
const RECORD_NOTE := "Saved settings apply on next Start record. Cable from a destination to set the source channel."
const RECORD_FOOT := "Use cable from destination to choose which channel this record output captures."
const NDI_NOTE := "NDI output is always on — it is written into the Caspar config as an NDI consumer on the cabled destination’s channel (like an SDI out). Set the name, Save, then Apply Caspar config. No Start needed."
const NDI_ATTRIBUTION := "Uses NDI® (ndi.video). NDI® is a registered trademark of Vizrt NDI AB."
const TYPES := [["ndi", "NDI"], ["rtmp", "RTMP"], ["srt", "SRT"], ["udp", "UDP"]]
const QUALITY := [["low", "low"], ["medium", "medium"], ["high", "high"]]
const VCODEC := [["h264", "h264"], ["hevc", "hevc"]]
const PRESET := [["ultrafast", "ultrafast"], ["veryfast", "veryfast"], ["fast", "fast"], ["medium", "medium"], ["slow", "slow"]]
const ACODEC := [["aac", "aac"], ["copy", "copy"], ["none", "none"]]
const SRT_MODE := [["caller", "srt: caller"], ["listener", "srt: listener"]]
const PAIR := [["all", "audio pair: all"], ["1+2", "audio pair: 1+2"], ["3+4", "audio pair: 3+4"], ["5+6", "audio pair: 5+6"],
	["7+8", "audio pair: 7+8"]]


static func _sel(key: String, options: Array, value: String) -> Dictionary:
	return {"t": "select", "key": key, "value": value, "options": options, "disabled": false}


static func _in(key: String, value: String, placeholder: String, secret := false) -> Dictionary:
	return {"t": "input", "key": key, "value": value, "placeholder": placeholder, "secret": secret}


static func _btn(text: String, disabled := false) -> Dictionary:
	return {"t": "button", "text": text, "disabled": disabled}


static func _lower(v: Variant) -> String:
	return O.js(v).to_lower()


# ---------------------------------------------------------------- stream

static func _cred(conn: Dictionary, settings: Variant) -> Dictionary:
	return R.d(R.d(R.d(settings).get("streamCredentials")).get(O.js(conn.get("id"))))


static func stream_state(conn: Dictionary, settings: Variant) -> Dictionary:
	var saved := O.saved_row(settings, "streamOutputs", O.js(conn.get("id")))
	var cas := R.d(conn.get("caspar"))
	var cred := _cred(conn, settings)
	var g := func(k: String, d: Variant) -> Variant: return O.or_([saved.get(k), cas.get(k), d])
	var pair := O.pick(PAIR, O.js(g.call("audioSourcePair", "all")))
	return {
		"type": O.pick(TYPES, _lower(g.call("type", "rtmp"))),
		"name": O.js(O.or_([saved.get("name"), cas.get("name"), conn.get("label"), ""])),
		"url": O.js(O.or_([cred.get("rtmpServerUrl"), saved.get("rtmpServerUrl"), saved.get("srtUrl"), cas.get("rtmpServerUrl"), cas.get("srtUrl"), ""])),
		"key": "", "clear_key": false,
		"srt_latency": O.js(H.coalesce([saved.get("srtLatencyMs"), cas.get("srtLatencyMs"), 120])),
		"srt_stream_id": O.js(g.call("srtStreamId", "")),
		"srt_mode": "listener" if _lower(g.call("srtMode", "caller")) == "listener" else "caller",
		"srt_pass": "", "clear_pass": false,
		"quality": O.pick(QUALITY, O.js(g.call("quality", "medium"))),
		"vcodec": O.pick(VCODEC, _lower(g.call("videoCodec", "h264"))),
		"vbitrate": O.math_initial("stream_out", "vbitrate", O.js(H.coalesce([saved.get("videoBitrateKbps"), cas.get("videoBitrateKbps"), 4500]))),
		"preset": O.pick(PRESET, _lower(g.call("encoderPreset", "veryfast"))),
		"acodec": O.pick(ACODEC, _lower(g.call("audioCodec", "aac"))),
		"abitrate": O.math_initial("stream_out", "abitrate", O.js(H.coalesce([saved.get("audioBitrateKbps"), cas.get("audioBitrateKbps"), 128]))),
		"pair": pair if pair != "" else "all",
	}


static func stream_items(conn: Dictionary, payload: Dictionary, settings: Variant, ui: Dictionary, logs: Variant) -> Array:
	var saved := O.saved_row(settings, "streamOutputs", O.js(conn.get("id")))
	var cred := _cred(conn, settings)
	var t: String = O.or_([ui.type, "rtmp"])
	var items := O.head_items(conn, payload)
	items.append({"t": "note", "text": STREAM_NOTE})
	items.append(_sel("type", TYPES, ui.type))
	items.append(_in("name", ui.name, "name / label"))
	if t != "ndi":
		items.append(_in("url", ui.url, "srt://host:port" if t == "srt" else ("udp://host:port" if t == "udp" else "rtmp://server/app")))
	if t == "rtmp":
		var has_key: bool = O.is_true(cred.get("hasStreamKey")) or O.is_true(saved.get("hasStreamKey"))
		items.append(_in("key", ui.key, "saved in project — leave blank to keep" if has_key else "stream key (saved in project)"))
		items.append({"t": "check", "key": "clear_key", "text": "clear saved key", "checked": ui.clear_key})
	if t == "srt":
		var has_pass: bool = O.is_true(cred.get("hasSrtPassphrase")) or O.is_true(saved.get("hasSrtPassphrase"))
		items.append(_in("srt_latency", ui.srt_latency, "SRT latency ms"))
		items.append(_in("srt_stream_id", ui.srt_stream_id, "SRT streamid (optional)"))
		items.append(_sel("srt_mode", SRT_MODE, ui.srt_mode))
		items.append(_in("srt_pass", ui.srt_pass, "saved in project — leave blank to keep" if has_pass
			else "SRT passphrase (10-79 chars, saved in project)", true))
		items.append({"t": "check", "key": "clear_pass", "text": "clear saved passphrase", "checked": ui.clear_pass})
	if t != "ndi":
		items.append_array([_sel("quality", QUALITY, ui.quality), _sel("vcodec", VCODEC, ui.vcodec), _in("vbitrate", ui.vbitrate, "video kbps"),
			_sel("preset", PRESET, ui.preset), _sel("acodec", ACODEC, ui.acodec), _in("abitrate", ui.abitrate, "audio kbps"),
			_sel("pair", PAIR, ui.pair)])
	items.append(_btn("Save stream settings"))
	if t != "ndi":
		items.append_array([_btn("Start stream"), _btn("Stop stream")])
	items.append(_btn("Remove stream output"))
	if t == "ndi":
		items.append_array([{"t": "note", "text": NDI_NOTE}, {"t": "note", "text": NDI_ATTRIBUTION}])
	items.append_array([{"t": "note", "text": "Stream log"}, {"t": "log", "text": O.log_text(logs, "No stream logs yet.")}])
	return items


static func _clamp_int(v: Variant, fallback: int, lo: int, hi: int) -> int:
	return clampi(O.int_or(v, fallback), lo, hi)


## Save stream settings: the settings row, then the project credentials (RTMP url / key, SRT passphrase).
static func stream_save(conn: Dictionary, settings: Variant, ui: Dictionary) -> Dictionary:
	var id := O.js(conn.get("id"))
	var idx := O.row_index(settings, "streamOutputs", id)
	if idx < 0:
		return {"error": "Stream output not found"}
	var t := _lower(O.or_([ui.type, "rtmp"]))
	var fallback := O.js(O.or_([conn.get("label"), conn.get("id")]))
	var name := O.js(O.or_([ui.name, conn.get("label"), conn.get("id")])).strip_edges()
	name = name if name != "" else fallback
	var next: Array = R.a(R.d(settings).streamOutputs).duplicate()
	var row: Dictionary = R.d(next[idx]).duplicate()
	row.merge({"id": id, "type": t, "name": name, "label": name if t == "ndi" else O.js(O.or_([row.get("label"), name])),
		"quality": O.or_([ui.quality, "medium"]), "srtUrl": ui.url.strip_edges() if t == "srt" else "",
		"videoCodec": _lower(O.or_([ui.vcodec, "h264"])), "videoBitrateKbps": maxi(200, O.int_or(O.or_([ui.vbitrate, "4500"]), 4500)),
		"encoderPreset": _lower(O.or_([ui.preset, "veryfast"])), "audioCodec": _lower(O.or_([ui.acodec, "aac"])),
		"audioBitrateKbps": maxi(32, O.int_or(O.or_([ui.abitrate, "128"]), 128)), "audioSourcePair": O.or_([ui.pair, "all"]),
		"srtLatencyMs": _clamp_int(O.or_([ui.srt_latency, "120"]), 120, 20, 8000), "srtStreamId": ui.srt_stream_id.strip_edges(),
		"srtMode": O.or_([ui.srt_mode, "caller"])}, true)
	next[idx] = row
	var reqs := [["POST", "/api/settings", {"streamOutputs": next}]]
	var status := ""
	match t:
		"ndi":
			reqs.append(["DIRTY"])
			status = "NDI output saved — Apply Caspar config to put it on air."
		"rtmp":
			reqs.append(["POST", "/api/project/streaming-credentials", {"outputId": id, "rtmpServerUrl": ui.url.strip_edges(),
				"streamKey": ui.key.strip_edges(), "clearKey": O.is_true(ui.clear_key), "clearPassphrase": false}])
		"srt":
			reqs.append(["POST", "/api/project/streaming-credentials", {"outputId": id, "clearKey": false,
				"srtPassphrase": ui.srt_pass.strip_edges(), "clearPassphrase": O.is_true(ui.clear_pass)}])
	return {"requests": reqs, "status": status}


## Start stream. The web's startStreamingChannelRtmp forwards only the RTMP-shaped fields (type / SRT / pair are
## dropped on the way out — WO-605 slice 6 web gap); the body here is what it actually posts.
static func stream_start(conn: Dictionary, settings: Variant, ui: Dictionary) -> Dictionary:
	var t := _lower(O.or_([ui.type, "rtmp"]))
	if t == "ndi":
		return {"error": "NDI is always on via the Caspar config — Apply Caspar config instead of Start."}
	if t != "rtmp" and t != "srt":
		return {"error": "Start for %s is not wired yet. Save settings first." % t.to_upper()}
	var saved := O.saved_row(settings, "streamOutputs", O.js(conn.get("id")))
	var cas := R.d(conn.get("caspar"))
	var g := func(k: String, field: String, d: Variant) -> Variant: return O.or_([ui[k], saved.get(field), cas.get(field), d])
	var url := O.js(O.or_([ui.url, _cred(conn, settings).get("rtmpServerUrl"), saved.get("rtmpServerUrl"), ""])).strip_edges()
	if t == "srt" and O.js(O.or_([ui.url, saved.get("srtUrl"), cas.get("srtUrl"), ""])).strip_edges() == "":
		return {"error": "SRT URL is empty (srt://host:port). Fill it in the stream inspector first."}
	if t == "rtmp" and url == "":
		return {"error": "RTMP server URL is empty. Fill it in stream inspector first."}
	var reqs := []
	var sc := R.d(R.d(settings).get("streamingChannel"))
	if not O.flag(sc.get("enabled")):
		var on := sc.duplicate()
		on.enabled = true
		reqs.append_array([["POST", "/api/settings", {"streamingChannel": on}], ["DIRTY"]])
	reqs.append(["POST", "/api/streaming-channel/rtmp", {"action": "start", "rtmpServerUrl": url,
		"quality": O.js(g.call("quality", "quality", "medium")), "outputId": O.js(conn.get("id")),
		"videoCodec": _lower(g.call("vcodec", "videoCodec", "h264")),
		"videoBitrateKbps": maxi(200, O.int_or(g.call("vbitrate", "videoBitrateKbps", "4500"), 4500)),
		"encoderPreset": _lower(g.call("preset", "encoderPreset", "veryfast")), "audioCodec": _lower(g.call("acodec", "audioCodec", "aac")),
		"audioBitrateKbps": maxi(32, O.int_or(g.call("abitrate", "audioBitrateKbps", "128"), 128))}])
	return {"requests": reqs, "status": "Streaming started"}


## What Save leaves behind in the form: the clear ticks off, the typed passphrase gone.
static func stream_after_save(ui: Dictionary) -> Dictionary:
	var u := ui.duplicate()
	var t := _lower(O.or_([ui.type, "rtmp"]))
	if t == "rtmp":
		u.clear_key = false
	if t == "srt":
		u.clear_pass = false
		u.srt_pass = ""
	return u


static func stream_stop() -> Dictionary:
	return {"requests": [["POST", "/api/streaming-channel/rtmp", {"action": "stop"}]], "status": "Streaming stopped"}


# ---------------------------------------------------------------- record

static func record_state(conn: Dictionary, settings: Variant) -> Dictionary:
	var saved := O.saved_row(settings, "recordOutputs", O.js(conn.get("id")))
	var cas := R.d(conn.get("caspar"))
	var g := func(k: String, d: Variant) -> Variant: return O.or_([saved.get(k), cas.get(k), d])
	var n := func(k: String, d: Variant) -> String: return O.js(H.coalesce([saved.get(k), cas.get(k), d]))
	return {
		"name": O.js(O.or_([saved.get("name"), cas.get("name"), conn.get("label"), ""])),
		"crf": O.math_initial("record_out", "crf", n.call("crf", 26)),
		"vcodec": O.pick(VCODEC, _lower(g.call("videoCodec", "h264"))),
		"vbitrate": O.math_initial("record_out", "vbitrate", n.call("videoBitrateKbps", 4500)),
		"preset": O.pick(PRESET, _lower(g.call("encoderPreset", "veryfast"))),
		"acodec": O.pick(ACODEC, _lower(g.call("audioCodec", "aac"))),
		"abitrate": O.math_initial("record_out", "abitrate", n.call("audioBitrateKbps", 128)),
	}


static func record_items(conn: Dictionary, payload: Dictionary, ui: Dictionary, logs: Variant) -> Array:
	var items := O.head_items(conn, payload)
	items.append_array([{"t": "note", "text": RECORD_NOTE}, _in("name", ui.name, "record output name"), _in("crf", ui.crf, ""),
		_sel("vcodec", VCODEC, ui.vcodec), _in("vbitrate", ui.vbitrate, "video kbps (0=CRF mode)"), _sel("preset", PRESET, ui.preset),
		_sel("acodec", ACODEC, ui.acodec), _in("abitrate", ui.abitrate, "audio kbps"), _btn("Save record settings"),
		_btn("Start record"), _btn("Stop record"), _btn("Remove record output"), {"t": "note", "text": "Record log"},
		{"t": "log", "text": O.log_text(logs, "No record logs yet.")}, {"t": "note", "text": RECORD_FOOT}])
	return items


## The encoder fields Save and Start share.
static func _record_fields(ui: Dictionary) -> Dictionary:
	return {"crf": _clamp_int(O.or_([ui.crf, "26"]), 26, 18, 51), "videoCodec": _lower(O.or_([ui.vcodec, "h264"])),
		"videoBitrateKbps": maxi(0, O.int_or(O.or_([ui.vbitrate, "0"]), 0)), "encoderPreset": _lower(O.or_([ui.preset, "veryfast"])),
		"audioCodec": _lower(O.or_([ui.acodec, "aac"])), "audioBitrateKbps": maxi(32, O.int_or(O.or_([ui.abitrate, "128"]), 128))}


static func record_save(conn: Dictionary, settings: Variant, ui: Dictionary) -> Dictionary:
	var id := O.js(conn.get("id"))
	var idx := O.row_index(settings, "recordOutputs", id)
	if idx < 0:
		return {"error": "Record output not found"}
	var fallback := O.js(O.or_([conn.get("label"), conn.get("id")]))
	var name := O.js(O.or_([ui.name, conn.get("label"), conn.get("id")])).strip_edges()
	name = name if name != "" else fallback
	var next: Array = R.a(R.d(settings).recordOutputs).duplicate()
	var row: Dictionary = R.d(next[idx]).duplicate()
	row.merge({"id": id, "name": name, "label": O.js(O.or_([row.get("label"), name]))}, true)
	row.merge(_record_fields(ui), true)
	next[idx] = row
	return {"requests": [["POST", "/api/settings", {"recordOutputs": next}]], "status": ""}


static func record_start(conn: Dictionary, ui: Dictionary) -> Dictionary:
	var id := O.js(conn.get("id"))
	var body := {"action": "start", "outputId": id}
	body.merge(_record_fields(ui))
	return {"requests": [["POST", "/api/streaming-channel/record", body]], "status": "Recording started (%s)" % id}


static func record_stop(conn: Dictionary) -> Dictionary:
	var id := O.js(conn.get("id"))
	return {"requests": [["POST", "/api/streaming-channel/record", {"action": "stop", "outputId": id}]],
		"status": "Recording stopped (%s)" % id}
