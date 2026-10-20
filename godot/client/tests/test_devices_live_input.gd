extends RefCounted
## WO-605 slice 11 — live_input_model.gd / live_input_flow.gd against the web "Add live input" modal
## (live-input-modal.js + -submit.js + the add-slot helpers) run under Node on a fake DOM and a scripted server:
## tests/golden/devices_live_input.json. Each case = the server's settings / device view / device lists / POST
## replies and the store state; `init` = the dialog after open, `acts` = field edits / clicks with the POSTs, the
## restart-dirty and onAdded counts, and the dialog after (shown section, hint HTML, status, pickers, slot hints).

const FLOW := preload("res://features/devices/live_input_flow.gd")
const M := preload("res://features/devices/live_input_model.gd")
const R := preload("res://features/devices/cable_rules.gd")
var t


class FakeIo:
	extends RefCounted
	var srv := {}
	var posts := []
	var n_dirty := 0
	var n_added := 0
	const GETS := {"/api/settings": "s", "/api/device-view": "dv", "/api/audio/devices": "audioDevices",
		"/api/system/v4l2-devices": "v4l2Devices", "/api/ndi/list": "ndi", "/api/audio/live-inputs": "liveAudio",
		"/api/v4l2-inputs": "v4l2Cfg"}

	func _reply(v: Variant) -> Dictionary:
		if v is Dictionary and v.has("__throw"):
			return {"ok": false, "data": null, "error": v.__throw}
		return {"ok": true, "data": v.duplicate(true) if v is Dictionary else v, "error": ""}

	func get_json(path: String) -> Dictionary:
		var k: String = GETS.get(path.split("?")[0], "")
		return _reply(srv.get(k, {})) if k != "" else _reply({})

	func post_json(path: String, body: Variant) -> Dictionary:
		posts.append([path, body.duplicate(true) if body is Dictionary else body])
		var b := body as Dictionary
		var key := path + ("#update" if b.has("updateConnector") else ("#add" if b.has("addExtraLiveSource") else ""))
		apply_ops(R.a(R.d(srv.get("after")).get(key)))
		if path in ["/api/audio/live-inputs/config", "/api/v4l2-inputs/config"]:
			srv.s.casparServer.merge(b.duplicate(true), true)
		var post := R.d(srv.get("post"))
		if post.has(key):
			return _reply(post[key])
		if post.has(path):
			return _reply(post[path])
		return _reply({"ok": true})

	func load_settings() -> Dictionary:
		return srv.s.duplicate(true)

	func dirty() -> void:
		n_dirty += 1

	func added() -> void:
		n_added += 1

	func changed() -> void:
		pass

	## [where, path, value]: where "s" / "dv" / "srv"; a null value deletes.
	func apply_ops(ops: Array) -> void:
		for op in ops:
			var o: Variant = srv.s if op[0] == "s" else (srv.dv if op[0] == "dv" else srv)
			var path: Array = op[1]
			for k in path.slice(0, -1):
				var key: Variant = int(k) if o is Array else k
				if o is Dictionary and o.get(key) == null:
					o[key] = {}
				o = o[key]
			var last: Variant = int(path[-1]) if o is Array else path[-1]
			if op.size() < 3 or op[2] == null:
				o.erase(last)
			else:
				o[last] = op[2].duplicate(true) if op[2] is Dictionary or op[2] is Array else op[2]



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


## The golden's view shape from the flow state.
static func _view(f: Variant) -> Dictionary:
	var s: Dictionary = f.s
	var v := {"kind": s.kind, "shown": [M.WRAP[s.kind]], "hint": s.hint, "status": s.status, "error": s.error,
		"play_disabled": s.busy}
	match str(s.kind):
		"decklink":
			v.merge({"ch_fixed": s.ch_fixed, "ch_note": s.ch_note, "ports": s.ports, "port": s["decklink-slot"],
				"port_status": s.port_status})
		"ndi":
			v.merge({"ndi": s.ndi, "ndi_status": s.ndi_status})
		"live_audio":
			v.merge({"audio": s.audio, "audio_status": s.audio_status, "audio_hint": s.audio_hint})
		"usb_video":
			v.merge({"v4l2": s.v4l2, "v4l2_audio": s["v4l2-audio"], "v4l2_status": s.v4l2_status, "v4l2_hint": s.v4l2_hint})
		"browser":
			v.merge({"template_mode": s["browser-use-template"], "templates": s.templates})
	return v


func test_dialog_replay() -> void:
	var g: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_live_input.json"))
	for c in g.cases:
		var io := FakeIo.new()
		io.srv = c.srv.duplicate(true)
		for k in ["dv", "s"]:  # "@name" = a shared fixture
			if io.srv[k] is String:
				io.srv[k] = g.fixtures[io.srv[k].substr(1)].duplicate(true)
		var flow = FLOW.new(io.srv.s.duplicate(true), c.state.duplicate(true), io)
		await flow.start()
		t.eq(_norm(_view(flow)), _norm(c.init), c.name + ": init")
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			io.posts.clear()
			io.n_dirty = 0
			io.n_added = 0
			if st.has("kind"):
				await flow.set_kind(st.kind)
			for id in st.get("set", {}):
				flow.set_field(id, st.set[id])
			for k in st.get("state", {}):
				flow.state[k] = st.state[k]
			io.apply_ops(st.get("ops", []))
			match str(st.get("click", "")):
				"play":
					await flow.submit()
				"ndi-discover":
					await flow.discover_ndi()
			t.eq(_norm(io.posts), _norm(a.posts), what + ": posts")
			t.eq(io.n_dirty, int(a.dirty), what + ": dirty")
			t.eq(io.n_added, int(a.added), what + ": added")
			t.eq(_norm(_view(flow)), _norm(a.view), what + ": view")


func test_helpers() -> void:
	t.eq(M.ndi_label("ndi://HOST/\"Cam 1\""), "HOST Cam 1", "ndi:// host + quoted name")
	t.eq(M.ndi_label("Plain"), "Plain", "plain name")
	t.eq(M.bbcode("a <strong>b</strong> <code>[x]</code> &amp; &lt;"), "a [b]b[/b] [code][lb]x][/code] & <", "hint → bbcode")
	t.eq(M.browser_item(true, "lt.html", "", false).item.value, "http://127.0.0.1:4200/template/lt.html", ".html not doubled")
	t.eq(M.escape_html("<a & 'b'>"), "&lt;a &amp; &#39;b&#39;&gt;", "escapeHtml")


## tests/golden/devices_live_band.json: collectUnlistedLiveSourceRows + the host count that picks the empty note.
func test_band_rows() -> void:
	var g: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_live_band.json"))
	for c in g.cases:
		t.eq(M.H.host_destinations(c.payload).size(), int(c.hosts), c.name + ": host count")
		var rows := M.band_rows(c.payload).map(func(r: Dictionary) -> Dictionary:
			var o := r.duplicate()
			o.connectorId = r.connectorId if r.connectorId != "" else null
			return o)
		t.eq(_norm(rows), _norm(c.rows), c.name + ": rows")
