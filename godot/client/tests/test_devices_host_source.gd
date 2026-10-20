extends RefCounted
## WO-605 slice 3c — host_source_model.gd and input_slots_model.gd against the web modules run under Node on a fake
## DOM (inspector-webpage-host / -ndi-host / -browser-display / -decklink-host / -source-label /
## -live-audio-input, extra-live-source-remove, decklink-add-input, live-audio-remove-input, v4l2-remove-input,
## live-audio-inputs, v4l2-inputs): tests/golden/devices_host_source.json. Request plans are compared against the
## web's recorded POST / markCasparRestartDirty sequence (its GETs are the controller's settings re-reads).

const HS := preload("res://features/devices/host_source_model.gd")
const IS := preload("res://features/devices/input_slots_model.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const ORIGIN := "http://127.0.0.1:4200"
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_host_source.json"))
	return _g


static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


## The web's recorded calls without its GETs; a Godot plan without the "soft" markers.
static func _posts(calls: Array) -> Array:
	return calls.filter(func(c: Array) -> bool: return c[0] != "GET")


static func _plan(reqs: Array) -> Array:
	return reqs.map(func(r: Array) -> Array: return r.slice(0, 3))


func _same_plan(reqs: Array, calls: Array, what: String) -> void:
	t.eq(_norm(_plan(reqs)), _norm(_posts(calls)), what)


static func _opts(rows: Array) -> Array:  # the fake DOM's select options → [[value, label]]
	return rows.map(func(o: Dictionary) -> Array: return [str(o.value), str(o.label)])


static func _selected(rows: Array) -> String:
	for o in rows:
		if o.selected:
			return str(o.value)
	return ""


func test_slot_resolvers() -> void:
	var dests := [{"id": "host_decklink_input_3", "hostRole": "decklink_input", "inputSlot": 3},
		{"id": "host_decklink_input_2", "hostRole": "decklink_input"}, {"id": "host_decklink_input_x"},
		{"id": "host_live_audio_input_4"}, {"id": "host_live_audio_input_2", "inputSlot": "5"}, {"id": "host_v4l2_input_1"},
		{"id": "host_v4l2_ch_7", "inputSlot": 0}, {"id": "dst_a", "inputSlot": 2.7}, {}, null]
	var g: Array = _golden().slots
	for i in dests.size():
		t.eq(_norm([HS.decklink_slot(dests[i]), HS.live_audio_slot(dests[i]), HS.v4l2_slot(dests[i])]), _norm(g[i]), "slots %d" % i)


func test_find_live_source() -> void:
	var extras: Array = _golden().extras
	for row in _golden().find:
		var a: Array = row[0]
		var got := HS.find_live_source(a[0], a[1], a[2], extras)
		t.eq(_norm(got if not got.is_empty() else null), _norm(row[1]), "find %s" % str(a))


func test_host_rows_source_id() -> void:
	var payload := {"extraLiveSources": _golden().extras, "live": _golden().dv.live}
	var d := {"id": "host_ndi_1", "hostRole": "ndi_host", "casparChannel": 8, "label": "NDI host"}
	var src := HS.find_live_source(d, "ndi_host", 8, payload.extraLiveSources)
	t.eq(DM.host_rows(d, {}, payload, src), [["Label", "NDI host"], ["Type", "NDI host"], ["Caspar channel", "8"], ["Source ID", "ndi_1"]])
	t.eq(DM.host_rows(d, {}, payload), [["Label", "NDI host"], ["Type", "NDI host"], ["Caspar channel", "8"]], "no source → no Source ID row")


func test_webpage() -> void:
	for c in _golden().webpage:
		var src: Dictionary = c.source.duplicate(true)
		var saved := HS.saved_page(src)
		var init: Dictionary = c.init
		t.eq(saved, init.url, c.name + " url")
		t.eq(HS.is_template_url(saved, ORIGIN), init.useTemplate, c.name + " useTemplate")
		t.eq(HS.template_name(saved, ORIGIN), init.template, c.name + " template")
		var templates := [{"id": "BLACK"}, {"id": "LOWER", "label": "Lower third"}, {"label": "ONLYLABEL"}, {"id": ""}]
		t.eq(HS.template_options(templates), _opts(init.options), c.name + " options")
		var use_tpl: bool = init.useTemplate
		var tpl: String = init.template
		var url: String = init.url if not use_tpl else ""
		for a in c.acts:
			var step: Dictionary = a.step
			if step.has("useTemplate"):
				use_tpl = step.useTemplate
			if step.has("template"):
				tpl = step.template
			if step.has("url"):
				url = step.url
			var r := HS.webpage_request(src, use_tpl, tpl, url, ORIGIN)
			if r.has("error"):
				t.eq(a.calls, [], c.name + " no call on " + r.error)
				t.eq([r.error], a.toasts, c.name + " warn")
			else:
				t.eq(_norm([["POST", "/api/host-live/webpage", r.body]]), _norm(a.calls), c.name + " " + str(step))
				HS.adopt(src, {"source": {"playArg": a.saved, "templateOrUrl": a.saved}}, ["playArg", "templateOrUrl"])
				t.eq(HS.saved_page(src), a.saved, c.name + " adopted")


func test_ndi() -> void:
	var g: Dictionary = _golden().ndi
	var src: Dictionary = g.source.duplicate(true)
	t.eq(str(src.ndiName), g.init.name)
	t.eq(HS.ndi_names({"sources": ["CAM-A (NDI)", "PC (Screen 1)"]}), ["CAM-A (NDI)", "PC (Screen 1)"])
	t.eq(HS.ndi_names({"list": ["X"]}), _opts(g.discoverList.options).map(func(o: Array) -> String: return o[0]), "list fallback")
	t.eq(HS.ndi_names({"sources": []}), [], "empty")
	var r := HS.ndi_request(src, "update", g.picked.name)
	t.eq(_norm([["POST", "/api/host-live/ndi", r.body]]), _norm(g.apply.calls), "apply")
	HS.adopt(src, {"source": g.apply.src}, ["ndiName", "label"])
	t.eq([src.ndiName, src.label], [g.apply.src.ndiName, g.apply.src.label], "adopted")
	t.eq(HS.ndi_message({}, "update"), g.apply.toasts[0])
	t.eq([HS.ndi_request(src, "update", "  ").error], g.applyEmpty.toasts, "empty name")
	t.eq(_norm([["POST", "/api/host-live/ndi", HS.ndi_request(src, "reload", "").body]]), _norm(g.reload.calls), "reload")
	t.eq(HS.ndi_message({}, "reload"), g.reload.toasts[0])
	t.eq(HS.ndi_message({"message": "m"}, "reload"), "m")


func test_browser() -> void:
	var g: Dictionary = _golden().browser
	var src: Dictionary = g.source.duplicate(true)
	t.eq(HS.browser_fields(src), g.init, "fields")
	t.eq(HS.browser_fields({"sourceId": "br_2", "value": "route://11-1"}), g.initDefaults, "defaults")
	var r := HS.browser_request(src, " https://new/ ", "100", "", "99")
	t.eq(_norm([["POST", "/api/host-live/browser", r.body]]), _norm(g.apply.calls), "apply clamps")
	HS.adopt(src, {"source": g.apply.src}, ["url", "width", "height", "fps"])
	t.eq(_norm({"url": src.url, "width": src.width, "height": src.height, "fps": src.fps}), _norm(g.apply.src), "adopted")
	t.eq(HS.browser_message({"ok": true, "message": "Browser source updated"}), g.apply.toasts[0])
	r = HS.browser_request(src, "https://new/", "abc", "2000.9", "0")
	t.eq(_norm([["POST", "/api/host-live/browser", r.body]]), _norm(g.applyGarbage.calls), "garbage → defaults")
	t.eq(HS.browser_message({"ok": true, "hostLivePlay": {"ok": false, "error": "PLAY failed"}}), g.applyPlayFailed.toasts[0])
	t.eq([HS.browser_request(src, "", "1", "1", "1").error], g.applyEmpty.toasts, "empty url")
	t.eq(_norm([["POST", "/api/host-live/browser/interact", HS.interact_body(src)]]), _norm(g.toggleOn.calls), "toggle body")
	var on := HS.interact_outcome({"ok": true, "action": "interact", "message": "Moved"})
	t.eq([on.text, on.message], [g.toggleOn.text, g.toggleOn.toasts[0]], "toggle on")
	var off := HS.interact_outcome({"ok": true, "action": "return"})
	t.eq([off.text, off.message], [g.toggleOff.text, g.toggleOff.toasts[0]], "toggle off")
	var err := HS.interact_outcome({"ok": false, "error": "no window"})
	t.eq([err.ok, err.error], [false, g.toggleErr.toasts[0]], "toggle error")


func test_decklink_controls() -> void:
	var g: Dictionary = _golden().decklink
	var dv: Dictionary = _golden().dv
	var settings: Dictionary = _golden().settings
	var extras: Array = _golden().extras
	var options := func(src: Dictionary, slot: int, payload: Dictionary, st: Variant) -> Array:
		var active := HS.decklink_active_device(src, st, slot)
		return [HS.decklink_options(payload, slot, active).map(func(o: Array) -> Array: return [str(o[0]), o[1]]), str(active)]
	var e3: Dictionary = extras[3].duplicate()
	e3.decklinkDevice = 2  # the golden `extras` row carries the device the apply case adopted afterwards (4)
	for spec in [["slotOnly", {}, 2, dv, settings], ["withSource", e3, 2, dv, settings], ["noConnectors", {}, 2, {}, {}],
			["activeNotListed", {"decklinkDevice": 7}, 1, dv, settings], ["settingsDevice", {}, 2, dv, settings]]:
		var got: Array = options.call(spec[1], spec[2], spec[3], spec[4])
		var rows: Array = g[spec[0]].options
		t.eq(got[0], _opts(rows), spec[0] + " options")
		t.eq(got[1], _selected(rows), spec[0] + " active")
	t.eq(_norm([["POST", "/api/host-live/decklink", HS.decklink_update_body(2, "4", "dlsdi_2", "route://5-2")]]), _norm(g.apply.calls), "apply")
	t.eq(_norm([["POST", "/api/host-live/decklink", HS.decklink_reload_body(2, "dlsdi_2", "route://5-2")]]), _norm(g.reload.calls), "reload")
	t.eq(HS.decklink_update_body(2, "0", "dlsdi_2", "route://5-2"), {}, "device 0 → nothing")
	var rm: Dictionary = _golden().remove
	t.eq(_norm([["POST", "/api/host-live/decklink", HS.decklink_update_body(2, 4, "dlsdi_2", "route://5-2")]]), _norm(rm.changeDevice.calls))
	t.eq(_norm([["POST", "/api/host-live/decklink", HS.decklink_update_body("1", "2", null, null)]]), _norm(rm.changeDeviceBare.calls), "bare")
	t.eq(_norm([["POST", "/api/host-live/decklink", HS.decklink_reload_body(1, "", "")]]), _norm(rm.reloadDevice.calls), "reload bare")
	for row in rm.findConnector:
		var c := HS.find_decklink_connector(dv, int(row[0][0]), int(row[0][1]))
		t.eq(c.get("id"), row[1], "findConnector %s" % str(row[0]))
	t.eq(HS.find_decklink_connector({}, 2, 0), {}, "no connectors")


func test_source_label() -> void:
	var g: Dictionary = _golden().decklink
	var list: Array = _golden().extras.duplicate(true)
	for row in g.labelState:
		t.eq(HS.label_state(list, row[0][0], row[0][1]), row[1], "labelState %s" % str(row[0]))
	var st := HS.label_state(list, "dlsdi_2", "DeckLink 2")
	t.eq([st.custom, st.generated, HS.label_hint(st.custom, st.generated)], [g.labelCustom.value, g.labelCustom.placeholder, g.labelCustom.hint], "custom")
	HS.apply_saved_label(list, "dlsdi_2", "Camera Two")
	t.eq(_norm(list[3]), _norm(g.labelSave.entry), "saved")
	HS.apply_saved_label(list, "dlsdi_2", "")
	t.eq(_norm(list[3]), _norm(g.labelClear.entry), "cleared")
	st = HS.label_state(list, "dlsdi_1", "fb")
	t.eq([st.custom, st.generated, HS.label_hint(st.custom, st.generated)], [g.labelGenerated.value, g.labelGenerated.placeholder, g.labelGenerated.hint], "generated")
	st = HS.label_state(list, "dlsdi_9", "")
	t.eq([st.custom, st.generated, HS.label_hint(st.custom, st.generated)], [g.labelUnknown.value, "", g.labelUnknown.hint], "unknown")
	for row in g.pill:
		t.eq(HS.short_pill(row[0]), row[1], "pill %s" % str(row[0]))


func test_remove_live_sources() -> void:
	var rm: Dictionary = _golden().remove
	var extras: Array = _golden().extras
	_same_plan(HS.remove_live_plan(extras[0], null).requests, rm.webpage.calls, "webpage")
	_same_plan(HS.remove_live_plan(extras[2], {"active": true, "sourceId": "br_1"}).requests, rm.browserFs.calls, "browser fullscreen")
	_same_plan(HS.remove_live_plan(extras[2], {"active": true, "sourceId": "other"}).requests, rm.browserFsOther.calls, "other fullscreen")
	_same_plan(HS.remove_live_plan({"value": "route://12-3", "inputsChannel": 12, "inputsLayer": 3}, null).requests, rm.inputsCh.calls, "inputs channel")
	_same_plan(HS.remove_live_plan({"value": "route://12", "hostChannel": 12}, null).requests, rm.defaultLayer.calls, "default layer")
	_same_plan(HS.remove_live_plan({"value": "route://13-1"}, null).requests, rm.noChannel.calls, "no channel")
	t.eq(HS.remove_live_plan({"sourceId": "x"}, null).error, rm.noValue.error, "no value")


func test_remove_decklink() -> void:
	var rm: Dictionary = _golden().remove
	var dv: Dictionary = _golden().dv
	var cm: Dictionary = dv.live.caspar.channelMap
	var full := func(args: Array, prev: int, next: int) -> Array:
		var p := HS.decklink_remove_plan(dv, args[0], args[1], args[2], args[3], cm)
		return _plan(p.requests) + _plan(HS.decklink_remove_tail(prev, next, p.dest_id))
	t.eq(_norm(full.call([2, "dlsdi_2", "route://5-2", "host_decklink_input_2"], 2, 1)), _norm(_posts(rm.decklink2.calls)), "slot 2, count shrinks")
	t.eq(_norm(full.call([2, "", "", ""], 2, 2)), _norm(_posts(rm.decklink2NoShrink.calls)), "slot 2 resolved from the graph, no shrink")
	t.eq(_norm(full.call([4, "dlsdi_4", "", "host_decklink_input_4"], 2, 2)), _norm(_posts(rm.decklink4.calls)), "slot 4: no live source, no entry")
	t.eq(_norm(full.call([3, "", "", "host_decklink_input_3"], 2, 2)), _norm(_posts(rm.decklink3.calls)), "slot 3 via preferred slot")
	t.eq(HS.decklink_count(_golden().settings), 2)
	t.eq(HS.decklink_count({}), 0)


func test_live_audio_settings() -> void:
	var g: Dictionary = _golden().liveAudio
	for i in g.read.size():
		var ui := IS.read_live_audio(g.read[i][0])
		t.eq(_norm(ui), _norm(g.read[i][1]), "read %d" % i)
		t.eq(_norm(IS.live_audio_body(ui)), _norm(g.body[i]), "body %d" % i)
	for row in g.statusMsg:
		var target: Dictionary = row[0][2] if row[0][2] is Dictionary else {}
		t.eq(IS.status_message(row[0][0], int(row[0][1]), target), row[1], "status %s" % str(row[0]))
	var devices := [{"id": "alsa://hw:1,0", "name": "USB Audio", "type": "alsa"}, {"id": "alsa://hw:2,0", "name": "alsa://hw:2,0", "type": "alsa"},
		{"id": "alsa://hw:1,0", "name": "dup", "type": "alsa"}, {"id": "pulse", "type": "pulse"}, {"id": "", "type": "alsa"}]
	t.eq(IS.alsa_options(devices), g.alsa.map(func(o: Dictionary) -> Array: return [o.value, o.label]), "alsa options")
	t.eq(_opts(g.mount.options), IS.alsa_options(devices), "mount options")
	t.eq(_selected(g.mount.options), "alsa://hw:1,0", "slot 1 device selected")
	t.eq(g.mount.status, IS.status_message({"started": [{"slot": 1}]}, 1, {"channel": 6, "layer": 10}))
	t.eq(IS.status_is_warn(g.mountNoChannel.status), true)
	t.eq(IS.status_is_warn(g.mount.status), false)


func test_live_audio_controls() -> void:
	var g: Dictionary = _golden().liveAudio
	var ui := IS.read_live_audio(_golden().settings.casparServer)
	_same_plan(IS.fft_requests(1, true), g.fftOn.calls, "fft on")
	_same_plan(IS.fft_requests(1, false), g.fftOff.calls, "fft off")
	t.eq([IS.fft_message(1, true), IS.fft_message(1, false)], [g.fftOn.toasts[0], g.fftOff.toasts[0]])
	_same_plan(IS.device_requests(ui, 1, "alsa://hw:2,0"), g.deviceChange.calls, "device change")
	_same_plan(IS._stop(6, 10), g.stop.calls, "stop")
	t.eq(_norm([["POST", "/api/audio/inputs/start", IS.start_body("live_audio", 1)]]), _norm(g.start.calls), "start")
	t.eq(IS.start_error({"ok": true}), "")
	t.eq(IS.start_error({"ok": false, "error": "capture busy"}), g.startFail.toasts[0])
	t.eq(IS.start_error({"ok": false}), "Input failed to start")


func test_remove_input_slots() -> void:
	var rm: Dictionary = _golden().remove
	var cs: Dictionary = _golden().settings.casparServer
	var cm: Dictionary = _golden().dv.live.caspar.channelMap
	var p := IS.live_audio_remove_plan(cs, cm, 1)
	_same_plan(p.requests, rm.liveAudio1.calls.filter(func(c: Array) -> bool: return c[0] != "DIRTY"), "live audio 1")
	t.eq(p.restart, rm.liveAudio1.result.casparRestartNeeded, "slot 1 keeps the count")
	p = IS.live_audio_remove_plan(cs, cm, 2)
	_same_plan(p.requests + [["DIRTY"]], rm.liveAudio2.calls, "live audio 2 (last → count shrinks)")
	t.eq(p.restart, rm.liveAudio2.result.casparRestartNeeded)
	_same_plan(IS.live_audio_remove_plan(cs, {}, 1).requests, rm.liveAudioNoStore.calls, "no channel map → no STOP")
	p = IS.v4l2_remove_plan(cs, cm, 1)
	_same_plan(p.requests + [["DIRTY"]], rm.v4l2_1.calls, "v4l2 1")
	t.eq(p.restart, true)
	p = IS.v4l2_remove_plan(cs, cm, 2)
	_same_plan(p.requests, rm.v4l2_2.calls, "v4l2 2 (empty slot)")
	t.eq(p.restart, false)


func test_v4l2_settings() -> void:
	var g: Dictionary = _golden().v4l2
	for i in g.read.size():
		var ui := IS.read_v4l2(g.read[i][0])
		t.eq(_norm(ui), _norm(g.read[i][1]), "read %d" % i)
		t.eq(_norm(IS.v4l2_body(ui)), _norm(g.body[i]), "body %d" % i)
	var ui := IS.read_v4l2(g.read[0][0])
	ui.merge({"labels": ["Cam", ""], "formats": ["mjpeg"], "widths": [1280], "heights": [720], "fps": [30], "audio": ["hw:1"]})
	t.eq(_norm(IS.v4l2_body(ui)), _norm(g.bodyLabels), "optional per-slot keys")
