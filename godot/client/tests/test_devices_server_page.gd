extends RefCounted
## WO-605 slice 7 — server_page_model.gd / server_flow.gd / replication_format.gd against the web Caspar server page
## (device-view-inspector-caspar.js + the hot backup section) run under Node on a fake DOM and a scripted server:
## tests/golden/devices_server_page.json. Each case = settings / payload ops + the scripted replication status,
## leaders, network and POST replies; `init` = the page after open, `acts` = edits / presses with the requests
## (POSTs, confirms, dirty, reload, leader scans), the status line + ok, the inspector's own toasts and the page after.
## Factory reset (Danger zone) is not ported (WO-608) and is dropped from the web page before comparing.

const M := preload("res://features/devices/server_page_model.gd")
const FLOW := preload("res://features/devices/server_flow.gd")
const F := preload("res://features/devices/replication_format.gd")
var t
var _g: Dictionary


class FakeIo:
	extends RefCounted
	var srv := {}
	var calls := []
	var toasts := []
	var status_text := ""
	var status_ok := false
	var answer := true

	func _reply(v: Variant) -> Dictionary:
		if v is Dictionary and v.has("__throw"):
			return {"ok": false, "data": null, "error": v.__throw}
		return {"ok": true, "data": v.duplicate(true) if v is Dictionary else v, "error": ""}

	func get_json(path: String) -> Dictionary:
		match path:
			"/api/replication/status":
				return _reply(srv.rep)
			"/api/replication/leaders":
				calls.append(["GET", path])
				return _reply(srv.leaders)
			"/api/system/network":
				return _reply(srv.net)
		return _reply({})

	func post_json(path: String, body: Variant) -> Dictionary:
		calls.append(["POST", path, body.duplicate(true)])
		return _reply(srv.post.get(path, {"ok": true}))

	func confirm(text: String) -> bool:
		calls.append(["CONFIRM", text])
		return answer

	func reload() -> void:
		calls.append(["LOAD"])

	func dirty() -> void:
		calls.append(["DIRTY"])

	func status(text: String, ok: bool) -> void:
		status_text = text
		status_ok = ok

	func toast(text: String, type: String) -> void:
		toasts.append([text, type])

	func changed() -> void:
		pass


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_server_page.json"))
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
			if o.get(k) == null:
				o[k] = {}
			o = o[k]
		if op[2] == "set":
			o[path[-1]] = op[3].duplicate(true) if op[3] is Dictionary or op[3] is Array else op[3]
		else:
			o.erase(path[-1])


## The web's calls as the flow reports them: DIRTY / LOAD without their arguments.
static func _web_calls(calls: Array) -> Array:
	return calls.map(func(c: Array) -> Array: return [c[0]] if c[0] in ["DIRTY", "LOAD"] else c)


static func _web_spec(spec: Array) -> Array:
	return spec.filter(func(it: Dictionary) -> bool:
		return not (it.t == "heading" and it.text == "Danger zone") and not (it.t == "button" and it.text == "Factory reset"))


func _check_spec(got: Array, want: Array, what: String) -> void:
	var w := _web_spec(want)
	t.eq(got.size(), w.size(), what + ": item count")
	for i in mini(got.size(), w.size()):
		t.eq(_norm(got[i]), _norm(w[i]), "%s: item %d" % [what, i])


func _press(flow: Variant, text: String) -> void:
	match text:
		"Save project frame rate":
			await flow.save_fps()
		"Apply network":
			await flow.apply_network()
		"Scan for leaders":
			await flow.scan(false)
		"Become leader":
			await flow.become_leader()
		"Stop offering as leader":
			await flow.stop_leader()
		"Connect to leader":
			await flow.connect_leader()
		"Disconnect (standalone)":
			await flow.disconnect_peer()
		"Refresh connection":
			await flow.refresh_connection()
		"Apply Device View → Caspar":
			await flow.apply_caspar()


func test_pages_replay() -> void:
	var fx: Dictionary = _golden().fixtures
	var now := float(fx.now)
	for c in _golden().cases:
		var env: Dictionary = c.env
		var p: Dictionary = fx.payload.duplicate(true)
		var s: Dictionary = fx.settings.duplicate(true)
		_apply(p, s, env.get("ops", []))
		var io := FakeIo.new()
		io.srv = {"rep": env.get("rep", fx.rep), "leaders": env.get("leaders", {"leaders": []}), "net": env.get("net", fx.net),
			"post": env.get("post", {})}
		var flow = FLOW.new(s, p, io, str(env.get("intent", "")))
		flow.clock = func() -> float: return now
		await flow.start()
		t.eq(_norm(io.calls), _norm(_web_calls(c.init.calls)), c.name + ": init requests")
		_check_spec(M.items(flow.s, now), c.init.spec, c.name + ": init")
		io.calls.clear()
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			io.status_text = ""
			io.status_ok = false
			io.toasts.clear()
			for k in st.get("set", {}):
				io.srv[k] = st.set[k]
			if st.has("confirm"):
				io.answer = st.confirm
			if st.has("select"):
				match str(st.select):
					"mode":
						await flow.on_mode(st.value)
					"fps", "iface", "leader":
						flow.s[st.select] = st.value
			elif st.has("check"):
				await flow.set_cef(st.on)
			elif st.has("radio"):
				flow.s.net_mode = "static" if st.radio == "net_static" else "dhcp"
			elif st.has("input"):
				flow.s[st.input] = st.value
			elif st.has("button"):
				await _press(flow, st.button)
			elif st.get("poll", false):
				await flow.refresh_status()
			t.eq(_norm(io.calls), _norm(_web_calls(a.calls)), what + ": requests")
			t.eq(io.status_text, a.status, what + ": status")
			t.eq(io.status_ok, a.ok, what + ": ok")
			t.eq(io.toasts, a.toasts, what + ": toasts")
			_check_spec(M.items(flow.s, now), a.spec, what)
			io.calls.clear()


func test_formatters() -> void:
	t.eq(F.caspar_fps("30000/1001"), "29.970 fps", "fraction → 3 decimals")
	t.eq(F.caspar_fps("50000/1000"), "50 fps", "whole fraction")
	t.eq(F.caspar_fps("abc"), "abc", "garbage passes through")
	t.eq(F.caspar_fps(null), "—", "missing")
	t.eq(F.age_ms(1999.0), "just now", "under 2 s")
	t.eq(F.age_ms(59400.0), "59s ago", "seconds")
	t.eq(F.age_ms(90000.0), "2m ago", "minutes round half up")
	t.eq(F.drift_ms(-20.0), "-20 ms", "negative drift")
	t.eq(F.drift_ms(null), "—", "no drift")
	t.eq(M.normalize_fps("23.976"), 23.98, "nearest standard rate")
	t.eq(M.normalize_fps("abc"), 50.0, "garbage → 50")
	t.eq(F.paired_title({"role": "x", "self": {"hardwareId": 7}}, "leader"), "Paired with highascg0007", "hardware-id label")


class AutoIo:  # WO-739
	extends RefCounted
	var posts := []
	var cluster: Variant = {"self": {"auto_accept": false}}
	var post_ok := true
	var status_text := ""

	func get_json(path: String) -> Dictionary:
		return {"ok": cluster != null, "data": cluster if path == "/api/cluster" else {}, "error": "" if cluster != null else "HTTP 404"}

	func post_json(path: String, body: Variant) -> Dictionary:
		posts.append([path, body])
		return {"ok": post_ok, "data": {}, "error": "" if post_ok else "HTTP 400: nope"}

	func changed() -> void:
		pass

	func status(text: String, _ok: bool) -> void:
		status_text = text

	func toast(_text: String, _type: String) -> void:
		pass


func _auto_item(flow: Variant) -> Dictionary:
	for it in M.items(flow.s, 0.0, true):
		if it.get("key") == "auto_accept":
			return it
	return {}


func test_auto_accept_master_invites() -> void:  # WO-739
	var io := AutoIo.new()
	var flow: Variant = FLOW.new({}, {}, io, "standalone")
	t.eq(_auto_item(flow).get("disabled"), true, "unknown until /api/cluster answered")
	t.ok(M.items(flow.s, 0.0).all(func(it: Dictionary) -> bool: return it.get("key") != "auto_accept"), "not in the web page replay")
	await flow.refresh_cluster()
	t.eq([_auto_item(flow).text, _auto_item(flow).checked, _auto_item(flow).disabled], ["Auto-accept master invites", false, false], "off by default")
	await flow.set_auto_accept(true)
	t.eq(io.posts, [["/api/cluster/auto-accept", {"on": true}]], "saved on the server")
	t.eq(_auto_item(flow).checked, true, "ticked")
	io.post_ok = false
	await flow.set_auto_accept(false)
	t.eq(_auto_item(flow).checked, true, "a refused save puts the tick back")
	io.cluster = null
	await flow.refresh_cluster()
	t.eq(_auto_item(flow).disabled, true, "an older server (no cluster answer): disabled")
