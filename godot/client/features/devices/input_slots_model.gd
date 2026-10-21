extends RefCounted
## WO-605 slice 3c — the pure half of the live-audio / USB-video slot controls on a host-channel page
## (web live-audio-inputs.js, v4l2-inputs.js, inspector-live-audio-input.js, live-audio-remove-input.js,
## v4l2-remove-input.js, live-input-start.js). Reads the casparServer settings slice, builds the config bodies and
## plans the request sequences; the controller posts them. Golden-tested in tests/test_devices_host_source.gd.

const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")
const MAX_SLOTS := 8  # LIVE_AUDIO_MAX_SLOTS == V4L2_MAX_SLOTS


static func _int(v: Variant, def: int) -> int:  # parseInt(String(v ?? def), 10) || def
	var n: Variant = H.js_int(H.coalesce([v, str(def)]))
	return n if n != null and n != 0 else def


static func _str(v: Variant) -> String:
	return "" if v == null else (R.s(v) if (v is int or v is float) else str(v))


static func _flag(v: Variant) -> bool:  # === true || === 'true'
	return (v is bool and v) or (v is String and v == "true")


static func _not_false(v: Variant) -> bool:  # !== false && !== 'false'
	return not ((v is bool and not v) or (v is String and v == "false"))


static func clamp_slot(slot: Variant) -> int:
	return clampi(_int(slot, 1), 1, MAX_SLOTS)


# ---------------------------------------------------------------- live audio

## readLiveAudioCasparSettings
static func read_live_audio(cs: Variant) -> Dictionary:
	var c := R.d(cs)
	var count := clampi(_int(c.get("live_audio_input_count"), 0), 0, MAX_SLOTS)
	var slots := []
	var pgm_layer := _int(c.get("live_audio_pgm_layer"), 2)
	var targets := []
	for i in range(1, MAX_SLOTS + 1):
		slots.append(_str(c.get("live_audio_input_%d_device" % i)).strip_edges())
		var raw: Variant = c.get("live_audio_input_%d_pgm_channels" % i)
		if raw == null:
			targets.append(null)
			continue
		var layer := maxi(1, pgm_layer) + i - 1
		var chans := []
		for part in RegEx.create_from_string("[,;\\s]+").sub(_str(raw), " ", true).split(" ", false):
			var n: Variant = H.js_int(part)
			if n != null and n >= 1:
				chans.append({"channel": n, "layer": layer})
		targets.append(chans)
	var ap := R.d(R.d(c.get("audioRouting")).get("audioPreview"))
	return {
		"count": count, "slots": slots, "routeTargets": targets,
		"pgmAlwaysOn": _not_false(c.get("live_audio_pgm_always_on")),
		"pgmScreen": _int(c.get("live_audio_pgm_screen"), 1), "pgmLayer": pgm_layer,
		"pgmAudioOnly": _not_false(c.get("live_audio_pgm_audio_only")),
		"hostChannelEnabled": _flag(c.get("live_audio_inputs_host_channel_enabled")),
		"inputsChannelMode": _or(c.get("live_audio_inputs_channel_mode"), "1080p5000"),
		"audioPreviewEnabled": _flag(ap.get("enabled")) or _flag(c.get("audio_preview_enabled")),
		"audioPreviewBus": _or(ap.get("bus"), _or(c.get("audio_preview_bus"), "preview_1")),
		"audioPreviewScreen": _int(H.coalesce([ap.get("screenIndex"), c.get("audio_preview_screen")]), 1),
		"audioPreviewDevice": _or(ap.get("deviceName"), _or(c.get("audio_preview_device_name"), "")).strip_edges(),
		"audioPreviewDefaultSource": _or(ap.get("defaultSource"), _or(c.get("audio_preview_default_source"), "preview_1")),
	}


static func _or(v: Variant, def: String) -> String:  # String(v || def)
	return _str(v) if H.truthy(v) else def


## buildLiveAudioConfigBody
static func live_audio_body(ui: Dictionary) -> Dictionary:
	var body := {
		"live_audio_input_count": ui.count, "live_audio_pgm_always_on": ui.pgmAlwaysOn,
		"live_audio_pgm_screen": ui.pgmScreen, "live_audio_pgm_layer": ui.pgmLayer,
		"live_audio_pgm_audio_only": ui.pgmAudioOnly, "live_audio_inputs_host_channel_enabled": ui.hostChannelEnabled,
		"live_audio_inputs_channel_mode": ui.inputsChannelMode, "live_audio_input_channel_mode": ui.inputsChannelMode,
		"audio_preview_enabled": ui.audioPreviewEnabled, "audio_preview_bus": ui.audioPreviewBus,
		"audio_preview_screen": ui.audioPreviewScreen, "audio_preview_device_name": ui.audioPreviewDevice,
		"audio_preview_default_source": ui.audioPreviewDefaultSource,
	}
	var targets := R.a(ui.get("routeTargets"))
	for i in range(1, MAX_SLOTS + 1):
		body["live_audio_input_%d_device" % i] = _or(ui.slots[i - 1], "")
		if i - 1 < targets.size() and targets[i - 1] is Array:
			body["live_audio_input_%d_pgm_channels" % i] = ",".join(targets[i - 1].map(func(t: Dictionary) -> String: return R.s(t.channel)))
	return body


## alsaCaptureDeviceOptions → [[value, label]…]
static func alsa_options(devices: Variant) -> Array:
	var out := [["", "— none —"]]
	var seen := {}
	for d in R.a(devices):
		if not (d is Dictionary) or d.get("type") != "alsa":
			continue
		var id := _str(d.get("id")).strip_edges()
		if id == "" or seen.has(id):
			continue
		seen[id] = true
		var name := _or(d.get("name"), id).strip_edges()
		out.append([id, id if name == id else "%s (%s)" % [name, id]])
	return out


## liveAudioSlotStatusMessage; `target` = {channel, layer} or {}.
static func status_message(status: Variant, slot: int, target: Dictionary) -> String:
	if not (status is Dictionary):
		return ""
	if status.get("enabled") is bool and not status.enabled and str(status.get("reason")) == "amcp_disconnected":
		return "AMCP offline — live audio not started"
	var ch: Variant = target.get("channel")
	var layer: Variant = target.get("layer")
	var match := func(x: Variant) -> bool:
		return x is Dictionary and (H._num_eq(x.get("slot"), slot) and x.get("slot") != null \
			or (ch != null and layer != null and H._num_eq(x.get("channel"), ch) and H._num_eq(x.get("layer"), layer) \
				and x.get("channel") != null and x.get("layer") != null))
	for f in R.a(status.get("failed")):
		if match.call(f):
			return _str(f.message) if H.truthy(f.get("message")) else "PLAY failed on this slot"
	for s in R.a(status.get("started")):
		if match.call(s):
			return "Running on %s-%s" % [R.s(ch), R.s(layer)] if ch != null and layer != null else "Running"
	return ""


static func status_is_warn(msg: String) -> bool:
	return msg.contains("PLAY failed") or msg.contains("offline")


## The shader-FFT checkbox: config + apply (then the controller reloads settings).
static func fft_requests(slot: int, on: bool) -> Array:
	return [["POST", "/api/audio/live-inputs/config", {"audio_fft_source_slot": slot if on else 0}],
		["POST", "/api/audio/live-inputs/apply", {}]]


static func fft_message(slot: int, on: bool) -> String:
	return "Shaders now react to slot %d audio." % slot if on else "Shader FFT source cleared."


## The capture-device select: count + pgm_always_on + the 8 device keys with this slot swapped, then apply.
static func device_requests(ui: Dictionary, slot: int, device: String) -> Array:
	var body := {"live_audio_input_count": ui.count, "live_audio_pgm_always_on": ui.pgmAlwaysOn}
	for i in range(1, MAX_SLOTS + 1):
		body["live_audio_input_%d_device" % i] = device.strip_edges() if i == slot else _or(ui.slots[i - 1], "")
	return [["POST", "/api/audio/live-inputs/config", body], ["POST", "/api/audio/live-inputs/apply", {}]]


static func start_body(kind: String, slot: int) -> Dictionary:
	return {"kind": kind, "slot": slot}


## runInputStart's failure text ("" = started).
static func start_error(r: Variant) -> String:
	var d := R.d(r)
	if d.get("ok") == false:
		return _str(H.coalesce([d.get("error"), d.get("reason")])) if H.truthy(H.coalesce([d.get("error"), d.get("reason")])) else "Input failed to start"
	return ""


## removeLiveAudioInputSlot between the two settings loads: {requests, restart}. `cm` = state channelMap.
## (The web also clears this slot's browser-stored PGM play targets; Godot keeps none, so there is nothing to clear.)
## The config POST makes the server STOP this slot's PGM routes (WO-604) — no client STOPs them.
static func live_audio_remove_plan(cs: Variant, cm: Dictionary, slot: Variant) -> Dictionary:
	var s := clamp_slot(slot)
	var prev := read_live_audio(cs)
	var entry := H.live_audio_entry(cm, s)
	var reqs := []
	if entry.get("channel") != null:
		reqs.append_array(_stop(entry.channel, H.coalesce([entry.get("layer"), s])))
	var next := _shrunk(prev, s)
	next.hostChannelEnabled = true if next.count > 0 else prev.hostChannelEnabled
	reqs.append(["POST", "/api/audio/live-inputs/config", live_audio_body(next)])
	return {"requests": reqs, "restart": next.count < prev.count}


static func _shrunk(prev: Dictionary, s: int) -> Dictionary:
	var next := prev.duplicate()
	var slots: Array = prev.slots.duplicate()
	slots[s - 1] = ""
	var count := clampi(prev.count, 0, MAX_SLOTS)
	while count > 0 and _str(slots[count - 1]).strip_edges() == "":
		count -= 1
	next.slots = slots
	next.count = count
	return next


## WO-623 D: STOP + MIXER CLEAR composed on the server (POST /api/host-live/layer).
static func _stop(ch: Variant, layer: Variant) -> Array:
	return [["POST", "/api/host-live/layer", {"action": "stop", "channel": ch, "layer": layer}, "soft"]]


# ---------------------------------------------------------------- USB video (V4L2)

## readV4l2CasparSettings
static func read_v4l2(cs: Variant) -> Dictionary:
	var c := R.d(cs)
	var slots := []
	for i in range(1, MAX_SLOTS + 1):
		slots.append(_str(c.get("v4l2_input_%d_device" % i)).strip_edges())
	return {"count": clampi(_int(c.get("v4l2_input_count"), 0), 0, MAX_SLOTS), "slots": slots,
		"captureBridge": _flag(c.get("v4l2_capture_bridge")),
		"inputsChannelMode": _str(H.coalesce([c.get("v4l2_input_channel_mode"), c.get("inputs_channel_mode"), ""])).strip_edges()}


## buildV4l2ConfigBody (the optional per-slot label/format/width/height/fps/audio arrays included when truthy).
static func v4l2_body(ui: Dictionary) -> Dictionary:
	var body := {"v4l2_input_count": ui.count, "v4l2_capture_bridge": ui.get("captureBridge") == true}
	if H.truthy(ui.get("inputsChannelMode")):
		body.v4l2_input_channel_mode = ui.inputsChannelMode
	for i in range(1, MAX_SLOTS + 1):
		body["v4l2_input_%d_device" % i] = _or(ui.slots[i - 1], "")
		for spec in [["labels", "label"], ["formats", "format"], ["widths", "width"], ["heights", "height"], ["fps", "fps"], ["audio", "audio"]]:
			var arr := R.a(ui.get(spec[0]))
			if i - 1 < arr.size() and H.truthy(arr[i - 1]):
				body["v4l2_input_%d_%s" % [i, spec[1]]] = arr[i - 1]
	return body


## removeV4l2InputSlot between the two settings loads: {requests, restart}.
static func v4l2_remove_plan(cs: Variant, cm: Dictionary, slot: Variant) -> Dictionary:
	var s := clamp_slot(slot)
	var prev := read_v4l2(cs)
	var entry := H.v4l2_entry(cm, s)
	var reqs := []
	if entry.get("channel") != null:
		reqs.append_array(_stop(entry.channel, H.coalesce([entry.get("layer"), s])))
	var next := _shrunk(prev, s)
	reqs.append(["POST", "/api/v4l2-inputs/config", v4l2_body(next)])
	return {"requests": reqs, "restart": next.count < prev.count}
