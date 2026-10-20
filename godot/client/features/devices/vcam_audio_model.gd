extends RefCounted
## WO-605 slice 6 — the Virtual cam and Audio output connector pages (web device-view-inspector-virtual-cam.js /
## -audio.js). Virtual cam: the read-only cabled source, the live status block (GET /api/virtual-camera/status), and
## the config / start / stop bodies. Audio: auto-saves on every change like the web, and its selects rebuild from
## each other — the change handlers are `audio_on_*`, which return the new values; the device list remembers which
## type it was built for (`dev_type`), because the web's Monitor tick can force System Audio without rebuilding it. Pure.

const O := preload("res://features/devices/output_ports_model.gd")
const R := O.R
const H := O.H

const VCAM_NOTE := "Virtual webcam for Zoom/OBS: Caspar channel → mjpeg stream (loopback UDP) → ffmpeg → v4l2loopback. Audio via ALSA loopback capture device. Cable a destination to this port and Apply to set the source channel."
const VCAM_JPEG_NOTE := "Virtual webcam for Zoom/OBS (LEGACY jpeg mode): Caspar channel → JPEG buffer → v4l2loopback. Audio via ALSA loopback capture device. Cable a destination to this port and Apply to set the source channel."
const AUDIO_TYPES := [["portaudio", "PortAudio (multi-ch)"], ["system-audio", "System Audio (stereo monitor)"]]
const HOST_APIS := [["auto", "Auto Host API"], ["ASIO", "ASIO"], ["ALSA", "ALSA"], ["CoreAudio", "CoreAudio"], ["WASAPI", "WASAPI"]]
const LAYOUTS := [["mono", "Mono (1ch)", 1], ["stereo", "Stereo (2ch)", 2], ["4ch", "4-Channel", 4], ["8ch", "8-Channel", 8],
	["16ch", "16-Channel", 16]]
const STOCK_WARN := "⚠ PortAudio requires the \"Custom Live\" build profile. HighAsCG will attempt to auto-switch this for you when you Apply."
const BUS_NOTE := "Caspar program bus width (mixer pairs) is set on each screen destination — select the destination and use Audio outputs."
const AUDIO_FOOT := "PortAudio supports up to 16 channels. Master layout controls mixer routing pairs (ch1+2 … ch15+16) and Caspar channel-layout on cabled PGM outputs."
const REFRESHED := "Audio device list refreshed. Re-open inspector to see full list."
const REFRESH_REQUESTS := ["/api/audio/portaudio-devices?refresh=1&outputsOnly=false", "/api/audio/devices?refresh=1"]


# ---------------------------------------------------------------- virtual cam

## settings.virtualCamera, else the connector's own fields.
static func vcam_saved(conn: Dictionary, settings: Variant) -> Dictionary:
	var vc: Variant = R.d(settings).get("virtualCamera")
	if vc is Dictionary:
		return vc
	var cas := R.d(conn.get("caspar"))
	return {"label": O.or_([conn.get("label"), "Virtual cam"]), "channel": H.coalesce([cas.get("channel"), 1]),
		"device": O.or_([conn.get("externalRef"), "/dev/video10"]), "fps": H.coalesce([cas.get("fps"), 25]),
		"width": H.coalesce([cas.get("width"), 1920]), "height": H.coalesce([cas.get("height"), 1080]),
		"audioEnabled": O.not_false(cas.get("audioEnabled")), "shaderCamera": O.is_true(cas.get("shaderCamera"))}


static func vcam_state(conn: Dictionary, settings: Variant) -> Dictionary:
	var s := vcam_saved(conn, settings)
	var cas := R.d(conn.get("caspar"))
	return {"label": O.js(O.or_([s.get("label"), conn.get("label"), "Virtual cam"])),
		"device": O.js(O.or_([s.get("device"), conn.get("externalRef"), "/dev/video10"])),
		"fps": O.math_initial("v4l2_out", "fps", O.js(H.coalesce([s.get("fps"), cas.get("fps"), 50]))),
		"res": "%sx%s" % [O.js(H.coalesce([s.get("width"), cas.get("width"), 1920])), O.js(H.coalesce([s.get("height"), cas.get("height"), 1080]))],
		"audio": O.not_false(s.get("audioEnabled")), "shader": O.is_true(s.get("shaderCamera"))}


## The status block under the buttons; `live` = the last /api/virtual-camera status (null = none yet).
static func vcam_status_text(live: Variant) -> String:
	var l := R.d(live)
	var relay := R.d(R.d(l.get("video")).get("relay"))
	var audio := R.d(l.get("audio"))
	var lines := ["Running: %s" % ("yes" if H.truthy(l.get("running")) else "no")]
	if H.truthy(relay.get("mode")):
		lines.append("Pipeline: mjpeg stream → ffmpeg (%s)" % O.js(O.or_([relay.get("source"), "udp"])) if relay.mode == "stream"
			else "Pipeline: LEGACY JPEG buffer loop")
	if H.truthy(relay.get("device")):
		lines.append("Video: %s" % O.js(relay.device))
	if H.truthy(relay.get("pid")):
		lines.append("Relay PID: %s" % O.js(relay.pid))
	if audio.get("attached") != null:
		lines.append("Audio: %s (%s)" % ["attached" if H.truthy(audio.attached) else "off", O.js(O.or_([audio.get("transport"), "alsa_loopback"]))])
	if H.truthy(audio.get("captureDevice")):
		lines.append("Mic device: %s" % O.js(audio.captureDevice))
	var verr: Variant = R.d(R.d(l.get("video")).get("consumer")).get("lastError")
	if H.truthy(verr):
		lines.append("Video error: %s" % O.js(verr))
	if H.truthy(audio.get("lastError")):
		lines.append("Audio error: %s" % O.js(audio.lastError))
	return "\n".join(lines)


static func vcam_items(conn: Dictionary, payload: Dictionary, settings: Variant, ui: Dictionary, live: Variant) -> Array:
	var s := vcam_saved(conn, settings)
	var ch: Variant = H.coalesce([R.d(live).get("channel"), s.get("channel"), R.d(conn.get("caspar")).get("channel")])
	var running := H.truthy(R.d(live).get("running"))
	var items := O.head_items(conn, payload)
	items.append_array([{"t": "note", "text": VCAM_JPEG_NOTE if O.js(O.or_([s.get("mode"), "stream"])) == "jpeg" else VCAM_NOTE},
		{"t": "input", "key": "label", "value": ui.label, "placeholder": "label", "secret": false},
		{"t": "note", "text": "Source: channel %s (from the cable)" % O.js(ch) if H.truthy(ch) else "Source: not cabled — connect it in Device View"},
		{"t": "input", "key": "device", "value": ui.device, "placeholder": "/dev/video10", "secret": false},
		{"t": "input", "key": "fps", "value": ui.fps, "placeholder": "", "secret": false},
		{"t": "input", "key": "res", "value": ui.res, "placeholder": "1920x1080", "secret": false},
		{"t": "check", "key": "audio", "text": "Include audio (ALSA loopback virtual mic)", "checked": ui.audio},
		{"t": "check", "key": "shader", "text": "Send to shaders as camera", "checked": ui.shader},
		{"t": "button", "text": "Save settings", "disabled": false}, {"t": "button", "text": "Start virtual cam", "disabled": running},
		{"t": "button", "text": "Stop virtual cam", "disabled": not running}, {"t": "button", "text": "Remove output", "disabled": false},
		{"t": "log", "text": vcam_status_text(live)}])
	return items


## parsePatch: the config / start body (no channel — the cable is the source of truth).
static func vcam_patch(conn: Dictionary, ui: Dictionary) -> Dictionary:
	var res: PackedStringArray = O.js(O.or_([ui.res, "1920x1080"])).split("x")
	return {"label": O.js(O.or_([ui.label, conn.get("label"), "Virtual cam"])).strip_edges(),
		"device": O.js(O.or_([ui.device, "/dev/video10"])).strip_edges(), "fps": maxi(1, O.int_or(O.or_([ui.fps, "50"]), 50)),
		"width": maxi(320, O.int_or(res[0], 1920)), "height": maxi(240, O.int_or(res[1] if res.size() > 1 else null, 1080)),
		"audioEnabled": O.is_true(ui.audio), "shaderCamera": O.is_true(ui.shader), "showInDeviceView": true}


static func vcam_body(conn: Dictionary, ui: Dictionary) -> Dictionary:
	var b := vcam_patch(conn, ui)
	b.persist = true
	return b


## Start's status from the server's reply.
static func vcam_start_status(reply: Variant) -> String:
	var r := R.d(reply)
	if not H.truthy(r.get("running")):
		return O.js(O.or_([r.get("error"), r.get("reason"), "Start failed — check server logs"]))
	return "Virtual camera running."


# ---------------------------------------------------------------- audio output

static func _existing(conn: Dictionary, settings: Variant) -> Dictionary:
	return O.saved_row(settings, "audioOutputs", O.js(conn.get("id")))


static func _audio_live(payload: Dictionary, key: String) -> Array:
	return R.a(R.d(R.d(payload.get("live")).get("audio")).get(key))


## The device select for `type`: [options, value] — the option matching the saved deviceName (by id or name).
static func audio_devices(payload: Dictionary, type: String, existing: Dictionary) -> Array:
	var opts := [["", "(select audio device)"]]
	var cur := O.js(O.or_([existing.get("deviceName"), ""]))
	var value := ""
	for d in _audio_live(payload, "devices" if type == "system-audio" else "portaudio"):
		var dd := R.d(d)
		var v: String
		var hit: bool
		if type == "system-audio":
			v = O.js(O.or_([dd.get("id"), dd.get("name"), ""]))
			opts.append([v, O.js(O.or_([dd.get("name"), "?"]))])
			hit = cur == v
		else:
			v = O.js(H.coalesce([dd.get("id"), dd.get("name"), ""]))
			var n: Variant = dd.get("maxOutputChannels")
			var ch := " · %sch" % O.js(n) if (n is float or n is int) and n > 0 else ""
			var desc := " — %s" % O.js(dd.description) if H.truthy(dd.get("description")) else ""
			opts.append([v, "%s%s%s" % [O.js(O.or_([dd.get("name"), "?"])), ch, desc]])
			hit = cur == (O.js(dd.id) if dd.get("id") != null else "") or cur == O.js(O.or_([dd.get("name"), ""]))
		if hit:
			value = v  # a later `selected` option wins, as in the DOM
	return [opts, value]


## selectedDeviceMaxChannels: the PortAudio device the select names (0 = none / unknown).
static func audio_max_channels(payload: Dictionary, device: String) -> int:
	if device.strip_edges() == "":
		return 0
	for d in _audio_live(payload, "portaudio"):
		var dd := R.d(d)
		if device.strip_edges() == (O.js(dd.id) if dd.get("id") != null else "") or device.strip_edges() == O.js(O.or_([dd.get("name"), ""])):
			return maxi(0, int(dd.get("maxOutputChannels")) if dd.get("maxOutputChannels") is float or dd.get("maxOutputChannels") is int else 0)
	return 0


## refreshLayoutOptions → {options, value, disabled, hint} for the type / device the layout was last rebuilt for.
static func audio_layout(payload: Dictionary, type: String, device: String, prev: String) -> Dictionary:
	if type == "system-audio":
		return {"options": [["stereo", "Stereo (2ch)"]], "value": "stereo", "disabled": true,
			"hint": "System Audio is stereo-only (headphones / monitor)."}
	var max_ch := audio_max_channels(payload, device)
	var cap := mini(16, max_ch) if max_ch > 0 else 16
	var opts := []
	for o in LAYOUTS:
		if o[2] <= cap:
			opts.append([o[0], o[1]])
	var p := O.js(O.or_([prev, "stereo"]))
	var hint := "Device reports up to %d output channel(s). PortAudio consumer uses the layout below." % max_ch if max_ch > 0 \
		else "Select a device to see its max channel count, or pick up to 16ch manually."
	return {"options": opts, "value": p if O.pick(opts, p) != "" else opts[-1][0], "disabled": false, "hint": hint}


## refreshDevices (device list for the current type, then the layout) into `ui`.
static func _refresh_devices(ui: Dictionary, payload: Dictionary, existing: Dictionary) -> void:
	var dv := audio_devices(payload, ui.type, existing)
	ui.dev_type = ui.type
	ui.device = dv[1]
	_refresh_layout(ui, payload, existing)


static func _refresh_layout(ui: Dictionary, payload: Dictionary, existing: Dictionary) -> void:
	var lay := audio_layout(payload, ui.type, ui.device, O.js(O.or_([existing.get("channelLayout"), ui.layout])))
	ui.layout = lay.value
	ui.lay_type = ui.type


static func audio_state(conn: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	var ex := _existing(conn, settings)
	var ui := {"name": O.js(O.or_([ex.get("label"), conn.get("label"), ""])), "type": O.pick(AUDIO_TYPES, O.js(O.or_([ex.get("type"), "portaudio"]))),
		"layout": "", "monitor": O.js(O.or_([ex.get("role"), ""])) == "monitor", "host_api": O.pick(HOST_APIS, O.js(O.or_([ex.get("hostApi"), "auto"]))),
		"buffer": O.math_initial("audio_out", "buffer", O.js(H.coalesce([ex.get("bufferFrames"), 128]))),
		"latency": O.math_initial("audio_out", "latency", O.js(H.coalesce([ex.get("latencyMs"), 40]))),
		"fifo": O.math_initial("audio_out", "fifo", O.js(H.coalesce([ex.get("fifoMs"), 50])))}
	_refresh_devices(ui, payload, ex)
	ui.manual = "" if ui.device != "" else O.js(O.or_([ex.get("deviceName"), ""]))
	if ui.monitor and ui.type != "system-audio":
		ui.type = "system-audio"  # web: forced without rebuilding the device list
	return ui


static func audio_on_type(ui: Dictionary, v: String, conn: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	var u := ui.duplicate()
	u.type = O.pick(AUDIO_TYPES, v)
	_refresh_devices(u, payload, _existing(conn, settings))
	return u


## Device picked: the layout rebuilds, the save still reads the manual field, then the manual field clears —
## so the returned `save_ui` (what to save) and `ui` (what to show) differ.
static func audio_on_device(ui: Dictionary, v: String, conn: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	var u := ui.duplicate()
	u.device = v
	_refresh_layout(u, payload, _existing(conn, settings))
	var shown := u.duplicate()
	shown.manual = ""
	return {"save_ui": u, "ui": shown}


static func audio_on_monitor(ui: Dictionary, on: bool, conn: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	var u := ui.duplicate()
	u.monitor = on
	if on and u.type != "system-audio":
		u.type = "system-audio"
		_refresh_devices(u, payload, _existing(conn, settings))
	return u


static func audio_items(conn: Dictionary, payload: Dictionary, settings: Variant, ui: Dictionary) -> Array:
	var ex := _existing(conn, settings)
	var dv := audio_devices(payload, ui.dev_type, ex)
	var lay := audio_layout(payload, ui.lay_type, ui.device, ui.layout)
	var items := O.head_items(conn, payload)
	if O.js(O.or_([R.d(R.d(settings).get("casparServer")).get("caspar_build_profile"), "stock"])) == "stock":
		items.append({"t": "warn", "text": STOCK_WARN})
	var inp := func(k: String, ph: String) -> Dictionary: return {"t": "input", "key": k, "value": ui[k], "placeholder": ph, "secret": false}
	var sel := func(k: String, opts: Array, v: String, dis := false) -> Dictionary:
		return {"t": "select", "key": k, "value": v, "options": opts, "disabled": dis}
	items.append_array([inp.call("name", "Output label"), sel.call("type", AUDIO_TYPES, ui.type),
		sel.call("device", dv[0], O.pick(dv[0], ui.device)), inp.call("manual", "or type device name manually"),
		{"t": "check", "key": "monitor", "text": "Monitor / headphone bus (mixer SOLO output)", "checked": ui.monitor},
		{"t": "small", "text": BUS_NOTE}, {"t": "caption", "text": "PortAudio output layout"},
		sel.call("layout", lay.options, ui.layout, lay.disabled), {"t": "small", "text": lay.hint}, sel.call("host_api", HOST_APIS, ui.host_api),
		{"t": "caption", "text": "Buffer frames"}, inp.call("buffer", "Buffer frames (e.g. 128)"), {"t": "caption", "text": "Latency ms"},
		inp.call("latency", "Latency ms (e.g. 40)"), {"t": "caption", "text": "FIFO ms"}, inp.call("fifo", "FIFO ms (e.g. 50)"),
		{"t": "button", "text": "Remove audio output", "disabled": false}, {"t": "note", "text": AUDIO_FOOT}])
	return items


## The enumeration retry the page fires when the snapshot had no PortAudio or no generic devices.
static func audio_needs_refresh(payload: Dictionary) -> bool:
	return _audio_live(payload, "portaudio").is_empty() or _audio_live(payload, "devices").is_empty()


static func audio_save(conn: Dictionary, settings: Variant, ui: Dictionary) -> Dictionary:
	var id := O.js(conn.get("id"))
	var idx := O.row_index(settings, "audioOutputs", id)
	if idx < 0:
		return {"error": "Audio output not found"}
	var fallback := O.js(O.or_([conn.get("label"), conn.get("id")]))
	var label := O.js(O.or_([ui.name, conn.get("label"), conn.get("id")])).strip_edges()
	label = label if label != "" else fallback
	var layout: String = "stereo" if ui.type == "system-audio" else O.js(O.or_([ui.layout, "stereo"]))
	var next: Array = R.a(R.d(settings).audioOutputs).duplicate()
	var row: Dictionary = R.d(next[idx]).duplicate()
	row.merge({"id": id, "label": label, "type": "system-audio" if ui.monitor else ui.type, "role": "monitor" if ui.monitor else "",
		"deviceName": O.js(O.or_([ui.manual, ui.device, ""])).strip_edges(), "channelLayout": layout, "hostApi": ui.host_api,
		"bufferFrames": O.int_or(ui.buffer, 128), "latencyMs": O.int_or(ui.latency, 40), "fifoMs": O.int_or(ui.fifo, 50), "enabled": true}, true)
	next[idx] = row
	return {"requests": [["POST", "/api/settings", {"audioOutputs": next}], ["DIRTY"]],
		"status": "Monitor bus \"%s\" saved — mixer SOLO plays here after Apply + Caspar restart." % label if ui.monitor
			else "Audio output \"%s\" saved (%s PortAudio). Set program bus width on the cabled destination." % [label, layout]}
