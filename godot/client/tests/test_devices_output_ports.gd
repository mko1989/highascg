extends RefCounted
## WO-605 slice 6 — the Stream / Record / Virtual cam / Audio connector pages against the web inspectors
## (device-view-inspector-stream.js / -record.js / -virtual-cam.js / -audio.js, rendered through
## device-view-inspectors.js with device-view-cable-outputs.js's remove handlers) run under Node on a fake DOM and a fake
## server: tests/golden/devices_output_ports.json. Each case = the page for the device-view / settings capture plus
## `ops` (the outputs and their connectors), flattened to the visible items the models emit, then edits and button
## presses with the requests each fired, the status, and the page after. Web gap kept out of the compare: the
## virtual-cam page paints its success statuses with the error style (setStatus without `ok`); Godot shows them as OK.

const O := preload("res://features/devices/output_ports_model.gd")
const SR := preload("res://features/devices/stream_record_model.gd")
const VA := preload("res://features/devices/vcam_audio_model.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_output_ports.json"))
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


static func _apply(p: Dictionary, s: Dictionary, ops: Array) -> void:
	for op in ops:
		var o: Variant = p if op[0] == "p" else s
		var path: Array = op[1]
		for k in path.slice(0, -1):
			var kk: Variant = int(k) if k is float else k
			if o[kk] == null:
				o[kk] = {}
			o = o[kk]
		var last: Variant = int(path[-1]) if path[-1] is float else path[-1]
		match op[2]:
			"set":
				o[last] = op[3].duplicate(true) if op[3] is Dictionary or op[3] is Array else op[3]
			"delete":
				o.erase(last)
			"push":
				o[last].append(op[3].duplicate(true) if op[3] is Dictionary else op[3])


func _env(ops: Array) -> Dictionary:
	var fx: Dictionary = _golden().fixtures
	var p: Dictionary = fx.payload.duplicate(true)
	var s: Dictionary = fx.settings.duplicate(true)
	_apply(p, s, ops)
	return {"p": p, "s": s}


static func _posts(calls: Array) -> Array:
	return calls.filter(func(c: Array) -> bool: return c[0] == "POST").map(func(c: Array) -> Array: return c.slice(0, 3))


static func _dirty(calls: Array) -> bool:
	return calls.any(func(c: Array) -> bool: return c[0] == "DIRTY")


## The page's items for the current values.
static func _items(kind: String, conn: Dictionary, e: Dictionary, ui: Dictionary, live: Variant) -> Array:
	match kind:
		"stream_out":
			return SR.stream_items(conn, e.p, e.s, ui, live)
		"record_out":
			return SR.record_items(conn, e.p, ui, live)
		"v4l2_out":
			return VA.vcam_items(conn, e.p, e.s, ui, live)
	return VA.audio_items(conn, e.p, e.s, ui)


static func _state(kind: String, conn: Dictionary, e: Dictionary) -> Dictionary:
	match kind:
		"stream_out":
			return SR.stream_state(conn, e.s)
		"record_out":
			return SR.record_state(conn, e.s)
		"v4l2_out":
			return VA.vcam_state(conn, e.s)
	return VA.audio_state(conn, e.p, e.s)


func test_pages_replay() -> void:
	for c in _golden().cases:
		var e := _env(c.ops)
		var conn: Dictionary = O.R.connector_by_id(e.p, c.connId)
		var kind: String = conn.kind
		var env: Dictionary = c.env
		var ss: Dictionary = env.get("streamingStatus", {}) if env.get("streamingStatus") is Dictionary else {}
		var live: Variant = env.get("vcam", {"running": false}) if kind == "v4l2_out" else \
			O.R.d(ss.get("rtmp" if kind == "stream_out" else "record")).get("logs")
		var ui := _state(kind, conn, e)
		t.eq(_norm(_items(kind, conn, e, ui, live)), _norm(c.init.spec), "%s: page" % c.name)
		if kind == "audio_out":
			t.eq(VA.REFRESHED if VA.audio_needs_refresh(e.p) else "", c.init.status, "%s: enumeration retry" % c.name)
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			var r := {"requests": [], "status": ""}
			var ok := true
			if st.has("button"):
				r = _press(kind, st.button, conn, e, ui)
				if kind == "stream_out" and st.button == "Save stream settings" and not r.has("error"):
					ui = SR.stream_after_save(ui)
				if kind == "v4l2_out" and st.button == "Start virtual cam":
					live = env.get("vcamStart", {"running": true})
					r.status = VA.vcam_start_status(live)
					ok = O.H.truthy(live.get("running"))
				elif kind == "v4l2_out" and st.button == "Stop virtual cam":
					live = {"running": false}
			else:
				var key: String = st.get("select", st.get("input", st.get("check", "")))
				var v: Variant = st.get("value", st.get("on"))
				if st.has("input") and O.MATH[kind].has(key):
					v = O.math_commit(kind, key, v, ui[key])
				if kind == "audio_out":
					var save_ui := ui
					if key == "type":
						ui = VA.audio_on_type(ui, v, conn, e.p, e.s)
						save_ui = ui
					elif key == "device":
						var d := VA.audio_on_device(ui, v, conn, e.p, e.s)
						save_ui = d.save_ui
						ui = d.ui
					elif key == "monitor":
						ui = VA.audio_on_monitor(ui, v, conn, e.p, e.s)
						save_ui = ui
					else:
						ui[key] = v
						save_ui = ui
					r = VA.audio_save(conn, e.s, save_ui)
				else:
					ui[key] = v
			if r.has("error"):
				t.eq(r.error, a.threw if a.threw != "" else a.status, what + ": error")
				t.eq(_posts(a.calls), [], what + ": nothing posted")
				continue
			t.eq(_norm(_posts(r.requests)), _norm(_posts(a.calls)), what + ": requests")
			t.eq(_dirty(r.requests), _dirty(a.calls), what + ": restart-dirty")
			t.eq(r.status, a.status, what + ": status")
			if r.status != "" and kind != "v4l2_out":
				t.eq(ok, str(a.ok).ends_with("--ok"), what + ": ok")
			t.eq(_norm(_items(kind, conn, e, ui, live)), _norm(a.spec), what + ": page after")


func _press(kind: String, text: String, conn: Dictionary, e: Dictionary, ui: Dictionary) -> Dictionary:
	if text.begins_with("Remove"):
		return O.remove_plan(kind, O.R.s(conn.id), e.p, e.s)
	match text:
		"Save stream settings":
			return SR.stream_save(conn, e.s, ui)
		"Start stream":
			return SR.stream_start(conn, e.s, ui)
		"Stop stream":
			return SR.stream_stop()
		"Save record settings":
			return SR.record_save(conn, e.s, ui)
		"Start record":
			return SR.record_start(conn, ui)
		"Stop record":
			return SR.record_stop(conn)
		"Save settings":
			return {"requests": [["POST", "/api/virtual-camera/config", VA.vcam_body(conn, ui)]], "status": "Virtual camera settings saved."}
		"Start virtual cam":
			return {"requests": [["POST", "/api/virtual-camera/start", VA.vcam_body(conn, ui)]], "status": ""}
		"Stop virtual cam":
			return {"requests": [["POST", "/api/virtual-camera/stop", {"persist": true}]], "status": "Virtual camera stopped."}
	return {"error": "unknown button " + text}


## The rear panel's "+" (device-view-bands-render.js onAdd*Output — not rendered by the golden, pinned here).
func test_add_plans() -> void:
	var s := {"streamOutputs": [{"id": "str_1"}], "recordOutputs": [], "audioOutputs": [{"id": "audio_1"}, {"id": "audio_2"}]}
	var a := O.add_plan("stream_out", s)
	t.eq(a.status, "Added stream output Str2", "stream add status")
	t.eq(a.requests[0][2].streamOutputs[1], {"id": "str_2", "label": "Str2", "enabled": true, "type": "rtmp", "name": "Str2",
		"quality": "medium", "rtmpServerUrl": "", "streamKey": "", "srtUrl": ""}, "stream add row")
	a = O.add_plan("record_out", s)
	t.eq(a.requests, [["POST", "/api/settings", {"recordOutputs": [{"id": "rec_1", "label": "Rec1", "enabled": true, "name": "Rec1",
		"source": "program_1", "crf": 26}]}]], "first record output is Rec1 (WO-473)")
	a = O.add_plan("audio_out", s)
	t.eq(a.status, "Added audio output Audio 3", "audio add status")
	t.eq(a.requests[0][2].audioOutputs[2].channelLayout, "stereo", "audio add layout")
	a = O.add_plan("v4l2_out", null)
	t.eq(a.requests[0][1], "/api/virtual-camera/config", "vcam add path")
	t.eq(a.requests[0][2].showInDeviceView, true, "vcam add shows it")
	t.eq(O.add_plan("stream_out", {}).status, "Added stream output Str1", "no phantom str_1 (WO-474)")


func test_helpers() -> void:
	t.eq(O.js(4500.0), "4500", "whole float")
	t.eq(O.js(true), "true", "bool")
	t.eq(O.int_or("0", 26), 26, "parseInt 0 || fallback")
	t.eq(O.int_or("12abc", 1), 12, "numeric prefix")
	t.eq(O.js_json({"code": 4.0, "ok": false, "a": [1.5]}), "{\"code\":4,\"ok\":false,\"a\":[1.5]}", "JS-shaped JSON")
	t.eq(O.math_commit("record_out", "crf", "abc", "30"), "30", "garbage restores the last good value")
	t.eq(O.math_initial("v4l2_out", "fps", "0"), "1", "fps clamps to 1")
	t.eq(O.remove_confirm("v4l2_out", "vcam_1"), "Remove virtual camera output from Device View?", "vcam confirm")
	t.eq(VA.vcam_patch({}, {"res": "640", "label": "", "device": "", "fps": "", "audio": true, "shader": false}).height, 1080, "no x → height 1080")


## WO-683: Caspar's PortAudio settings are global — one PortAudio output per server.
func test_single_portaudio() -> void:
	t.eq(O.portaudio_output_id([{"id": "a", "type": "system-audio"}, {"id": "b"}, {"id": "c", "type": "portaudio"}]), "b",
		"missing type = PortAudio, first one wins")
	t.eq(O.portaudio_output_id([{"id": "a", "enabled": false}, {"id": "b", "enabled": "false"}]), "", "disabled rows hold nothing")
	var s := {"audioOutputs": [{"id": "audio_1", "label": "HDMI 8ch", "type": "portaudio"}]}
	t.eq(O.add_plan("audio_out", s).requests[0][2].audioOutputs[1].type, "system-audio", "second row starts as System Audio")
	t.eq(O.add_plan("audio_out", {"audioOutputs": []}).requests[0][2].audioOutputs[0].type, "portaudio", "first row is PortAudio")
	s.audioOutputs.append({"id": "audio_2", "label": "Audio 2", "type": "portaudio", "hostApi": "ASIO"})
	var ui := VA.audio_state({"id": "audio_2"}, {}, s)
	t.eq(ui.type, "system-audio", "the second row cannot be PortAudio")
	t.eq(ui.host_api, "auto", "a Windows host API shows as Auto")
	var items := VA.audio_items({"id": "audio_2"}, {}, s, ui)
	var type_sel: Dictionary = items.filter(func(i: Dictionary) -> bool: return i.get("key") == "type")[0]
	t.eq(type_sel.options, [["system-audio", "System Audio (stereo monitor)"]], "PortAudio is not offered")
	t.eq(items.any(func(i: Dictionary) -> bool: return i.get("t") == "warn" and str(i.text).contains("HDMI 8ch")), true,
		"saved-as-PortAudio row warns it is skipped")
	var own := VA.audio_items({"id": "audio_1"}, {}, s, VA.audio_state({"id": "audio_1"}, {}, s))
	t.eq(own.filter(func(i: Dictionary) -> bool: return i.get("key") == "type")[0].options.size(), 2, "the PortAudio output keeps both types")
	var host: Dictionary = own.filter(func(i: Dictionary) -> bool: return i.get("key") == "host_api")[0]
	t.eq(host.options.map(func(o: Array) -> String: return o[0]), ["auto", "ALSA", "JACK"], "Linux host APIs")
