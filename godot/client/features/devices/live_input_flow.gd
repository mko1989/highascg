extends RefCounted
## WO-605 slice 11 — the "Add live input" dialog's state and request sequences (web live-input-modal.js event
## wiring, -submit.js, decklink-add-input.js via decklink_input_model.gd, live-audio-add-input.js, v4l2-add-input.js)
## over an injected `io`, so the dialog and the golden replay share them:
##   io.get_json(path) / io.post_json(path, body) → {ok, data, error}   io.load_settings() → the re-read settings
##   io.dirty()  (Caspar restart-dirty)   io.added()  (web onAdded: the tab reloads, the dialog closes)   io.changed()
## `s` holds the fields under their web element ids (minus "live-input-") plus the computed texts / option lists.

const M := preload("res://features/devices/live_input_model.gd")
const DI := preload("res://features/devices/decklink_input_model.gd")
const IS := preload("res://features/devices/input_slots_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const R := preload("res://features/devices/cable_rules.gd")

var s := {
	"kind": "decklink", "decklink-slot": "1", "ports": [], "port_status": "", "ch_fixed": "—", "ch_note": "", "hint": "",
	"status": "", "error": false, "busy": false,
	"ndi": [], "ndi-select": "", "ndi-manual": "", "ndi_status": "",
	"browser-display-url": "", "browser-display-width": "1152", "browser-display-height": "648", "browser-display-fps": "25",
	"browser-use-template": false, "browser-url": "", "browser-template": "", "templates": [["", "— Select a template —"]],
	"browser-as-cg": false,
	"audio": [], "audio-select": "", "audio-manual": "", "audio_status": "", "audio_hint": "",
	"v4l2": [], "v4l2-select": "", "v4l2-manual": "", "v4l2-label": "", "v4l2-format": "auto", "v4l2-fps": "0",
	"v4l2-audio": [], "v4l2-audio-select": "", "v4l2-audio-manual": "", "v4l2_status": "", "v4l2_hint": "",
}
var settings: Dictionary
var state: Dictionary  # the WS store's channelMap / configComparison / templates
var io: Variant
var _open_cm: Dictionary  # the modal's channelMap, fixed at open (the slot hints read it)


func _init(settings_: Variant, state_: Dictionary, io_: Variant) -> void:
	settings = R.d(settings_)
	state = state_
	io = io_
	_open_cm = M.channel_map(settings, state)


func start(kind := "decklink") -> void:
	await set_kind(kind)


func set_kind(k: String) -> void:
	s.kind = k
	_hint()
	match k:
		"decklink":
			_sync_decklink()
			io.changed()
			await refresh_ports()
		"live_audio":
			s.audio_hint = M.slot_hint(k, settings, _device("audio"), _open_cm)
			io.changed()
			await refresh_audio()
		"usb_video":
			s.v4l2_hint = M.slot_hint(k, settings, _device("v4l2"), _open_cm)
			io.changed()
			await refresh_v4l2()
		"browser":
			_sync_template()
			io.changed()
		_:
			io.changed()


## A field edit (web change / input listeners), by element id.
func set_field(id: String, v: Variant) -> void:
	s[id] = v
	match id:
		"decklink-slot":
			_sync_decklink()
		"browser-as-cg":
			_hint()
		"browser-use-template":
			_sync_template()
		"audio-select", "audio-manual":
			s.audio_hint = M.slot_hint("live_audio", settings, _device("audio"), _open_cm)
		"v4l2-select", "v4l2-manual":
			s.v4l2_hint = M.slot_hint("usb_video", settings, _device("v4l2"), _open_cm)
	io.changed()


func _device(pre: String) -> String:
	var manual := str(s[pre + "-manual"]).strip_edges()
	return manual if manual != "" else str(s[pre + "-select"]).strip_edges()


func _slot() -> int:
	var n: Variant = H.js_int(s["decklink-slot"] if str(s["decklink-slot"]) != "" else "1")
	return n if n != null and n >= 1 else 1


func _entry() -> Dictionary:
	return H.decklink_entry(M.channel_map(settings, state), _slot())


func _hint() -> void:
	s.hint = M.hint(s.kind, _slot(), _entry() if s.kind == "decklink" else {}, s["browser-as-cg"])


func _sync_decklink() -> void:
	var row := M.decklink_channel(_entry(), state.get("configComparison"))
	s.ch_fixed = row[0]
	s.ch_note = row[1]
	_hint()


func _sync_template() -> void:
	if s["browser-use-template"] and s.templates.size() <= 1:
		s.templates = M.HS.template_options(state.get("templates"))


static func _first(options: Array) -> String:
	return str(options[0][0]) if not options.is_empty() else ""


func refresh_ports() -> void:
	s.port_status = "Loading ports…"
	var r: Dictionary = await io.get_json("/api/device-view")
	if not r.ok:
		s.port_status = str(r.error)
		io.changed()
		return
	var p := M.decklink_ports(R.d(r.data))
	var prev := str(s["decklink-slot"])
	s.ports = p.ports
	s.port_status = p.status
	s["decklink-slot"] = prev if s.ports.any(func(o: Array) -> bool: return o[0] == prev) else _first(s.ports)
	_sync_decklink()
	io.changed()


func discover_ndi() -> void:
	s.ndi_status = "Scanning…"
	io.changed()
	var r: Dictionary = await io.get_json("/api/ndi/list")
	if not r.ok:
		s.ndi_status = str(r.error)
	else:
		var l := M.ndi_list(r.data)
		s.ndi = l.options
		s["ndi-select"] = _first(s.ndi)
		s.ndi_status = l.status
	io.changed()


func refresh_audio() -> void:
	s.audio_status = "Scanning…"
	var r: Dictionary = await io.get_json("/api/audio/devices?refresh=1")
	if not r.ok:
		s.audio_status = str(r.error)
	else:
		var devices := R.a(R.d(r.data).get("devices"))
		s.audio = IS.alsa_options(devices)
		s["audio-select"] = _first(s.audio)
		s.audio_status = "%d device(s)" % devices.size() if not devices.is_empty() else "No ALSA capture devices found"
		s.audio_hint = M.slot_hint("live_audio", settings, _device("audio"), _open_cm)
	io.changed()


func refresh_v4l2() -> void:
	s.v4l2_status = "Scanning…"
	var rv: Dictionary = await io.get_json("/api/system/v4l2-devices?refresh=1")
	var ra: Dictionary = await io.get_json("/api/audio/devices?refresh=1")
	if not rv.ok or not ra.ok:
		s.v4l2_status = str(rv.error if not rv.ok else ra.error)
	else:
		var devices := R.a(R.d(rv.data).get("devices"))
		var alsa := R.a(R.d(ra.data).get("devices"))
		s.v4l2 = M.v4l2_options(devices)
		s["v4l2-select"] = _first(s.v4l2)
		s["v4l2-audio"] = M.v4l2_alsa_options(alsa)
		s["v4l2-audio-select"] = _first(s["v4l2-audio"])
		s.v4l2_status = "%d video, %d audio device(s)" % [devices.size(), alsa.size()] if not devices.is_empty() else "No V4L2 capture devices found"
		s.v4l2_hint = M.slot_hint("usb_video", settings, _device("v4l2"), _open_cm)
	io.changed()


# ---------------------------------------------------------------- submit

func _status(text: String, err: bool) -> void:
	s.status = text
	s.error = err
	io.changed()


## api-client: a failed request, or a 200 reply carrying {ok:false}, is an error with the server's text.
static func _reply_error(r: Dictionary) -> String:
	if not r.ok:
		return str(r.error)
	var d: Variant = r.get("data")
	if d is Dictionary and d.get("ok") is bool and not d.ok:
		return str(d.get("error", d.get("reason", "Request failed")))
	return ""


func _run(requests: Array) -> String:
	for req in requests:
		if req[0] == "DIRTY":
			io.dirty()
			continue
		var err := _reply_error(await io.post_json(req[1], req[2]))
		if err != "" and req.size() < 4:
			return err
	return ""


func _finish(text: String) -> void:
	_status(text, false)
	io.added()


func submit() -> void:
	if s.busy:
		return
	_status("", false)
	s.busy = true
	match str(s.kind):
		"decklink":
			await _add_decklink()
		"ndi":
			var p := M.ndi_item(s["ndi-manual"], s["ndi-select"])
			await _add_extra(p, false)
		"browser_display":
			await _add_extra(M.browser_display_item(s["browser-display-url"], s["browser-display-width"],
				s["browser-display-height"], s["browser-display-fps"]), false)
		"browser":
			await _add_extra(M.browser_item(s["browser-use-template"], s["browser-template"], s["browser-url"],
				s["browser-as-cg"]), s["browser-as-cg"])
		"live_audio", "usb_video":
			await _add_slot(s.kind)
	s.busy = false
	io.changed()


func _device_view() -> Dictionary:
	var r: Dictionary = await io.get_json("/api/device-view")
	return {"error": _reply_error(r), "dv": R.d(r.get("data"))}


func _add_decklink() -> void:
	var slot := _slot()
	_status("Registering DeckLink SDI port %d..." % slot, false)
	settings = R.d(await io.load_settings())
	var prev := DI.HS.decklink_count(settings)
	var g := await _device_view()
	var prep := DI.add_prepare(g.dv, 0, slot) if g.error == "" else {"error": g.error}
	var err: String = prep.get("error", "")
	if err == "":
		err = await _run(prep.requests)
	if err == "":
		settings = R.d(await io.load_settings())
		g = await _device_view()
		err = g.error
	if err != "":
		_status(err, true)
		return
	var fin := DI.add_finish(prep, prev, DI.HS.decklink_count(settings), g.dv, settings)
	err = await _run(fin.requests)
	if err != "":
		_status(err, true)
		return
	if fin.restart or fin.pending:
		io.dirty()
	_finish(M.decklink_message(prep.slot, fin))


## NDI / browser: one addExtraLiveSource.
func _add_extra(p: Dictionary, as_cg: bool) -> void:
	if p.has("error"):
		_status(p.error, true)
		return
	var r: Dictionary = await io.post_json("/api/device-view", {"addExtraLiveSource": p.item})
	var err := _reply_error(r)
	if err != "":
		_status(err, true)
		return
	var m := M.added_message(r.data, as_cg)
	if m[1]:
		io.dirty()
	_finish(m[0])


## addLiveAudioInputSlot / addV4l2InputSlot, then the modal's own restart-dirty + status.
func _add_slot(k: String) -> void:
	var audio := k == "live_audio"
	var device := _device("audio" if audio else "v4l2")
	if device == "":
		_status("Pick a capture device or enter an ALSA URI" if audio else "Pick a capture device or enter a device path", true)
		return
	settings = R.d(await io.load_settings())
	var prev := M.read_ui(k, settings)
	var p := M.pick_slot(k, prev, device)
	if p.has("error"):
		_status(p.error, true)
		return
	var next := prev.duplicate(true)
	next.count = p.count
	next.slots = p.slots
	next.slots[p.slot - 1] = device
	if not audio:
		_v4l2_extras(next, p.slot - 1)
	var base := "/api/audio/live-inputs" if audio else "/api/v4l2-inputs"
	var err := _reply_error(await io.post_json(base + "/config", IS.live_audio_body(next) if audio else IS.v4l2_body(next)))
	if err != "":
		_status(err, true)
		return
	settings = R.d(await io.load_settings())
	var restart: bool = p.count > prev.count
	if restart:
		io.dirty()
	var lr: Dictionary = await io.get_json(base)
	var lp := R.d(lr.data) if lr.ok else {}
	var cm := R.d(state.get("channelMap")).duplicate()
	for key in (["liveAudioCount", "liveAudioInputChannels"] if audio else ["v4l2InputCount", "v4l2InputChannels"]):
		cm[key] = lp.get(key)
	var entry := H.live_audio_entry(cm, p.slot) if audio else H.v4l2_entry(cm, p.slot)
	var play: Variant = null
	if H.truthy(entry.get("route")) and not restart:
		var r: Dictionary = await io.post_json(base + "/apply", {})
		err = _reply_error(r)
		play = {"ok": false, "error": err} if err != "" else (null if audio else r.data)
	if restart:
		io.dirty()
	_finish(M.slot_message(k, {"slot": p.slot, "host_channel": entry.get("channel"), "restart": restart, "play": play}))


## The modal's optional label / format / fps / audio for the new USB video slot (defaults per slot otherwise).
func _v4l2_extras(ui: Dictionary, i: int) -> void:
	var n := IS.MAX_SLOTS
	ui.labels = []
	ui.labels.resize(n)
	ui.labels.fill("")
	ui.formats = []
	ui.formats.resize(n)
	ui.formats.fill("auto")
	ui.fps = []
	ui.fps.resize(n)
	ui.fps.fill(0)
	ui.audio = []
	ui.audio.resize(n)
	ui.audio.fill("none")
	var label := str(s["v4l2-label"]).strip_edges()
	if label != "":
		ui.labels[i] = label
	var format := str(s["v4l2-format"]).strip_edges()
	if format != "" and format != "auto":
		ui.formats[i] = format
	var fps: Variant = H.js_int(s["v4l2-fps"] if str(s["v4l2-fps"]) != "" else "0")
	if fps != null and fps > 0:
		ui.fps[i] = fps
	var a := str(s["v4l2-audio-manual"]).strip_edges()
	if a == "" and s["v4l2-audio-select"] != "none":
		a = str(s["v4l2-audio-select"]).strip_edges()
	if a != "" and a != "none":
		ui.audio[i] = a
