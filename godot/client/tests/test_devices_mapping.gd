extends RefCounted
## WO-605 slice 7c — mapping_graph.gd / mapping_page_model.gd / mapping_flow.gd (+ cable_seed.gd's mapping-output
## feeds) against the web mapping node inspector, column and mapping-node-service.js run under Node on a fake DOM and
## a scripted device-graph server: tests/golden/devices_mapping.json. Each case adds mapping nodes to the live device
## view, opens one node's page, then replays field edits / presses: per step the requests (GET / POST bodies, confirms,
## alerts, dirty, reload), the status line, the server's graph afterwards, and the re-rendered page, column cards and
## mapping-output feed resolutions. "Show Mapping Preview" (pixel-map editor, not ported) is dropped from the web page.

const G := preload("res://features/devices/mapping_graph.gd")
const M := preload("res://features/devices/mapping_page_model.gd")
const FLOW := preload("res://features/devices/mapping_flow.gd")
const S := preload("res://features/devices/cable_seed.gd")
var t
var _g: Dictionary


class FakeIo:
	extends RefCounted
	var srv := {}
	var calls := []
	var status_text := ""
	var fails := []
	var answer := true
	var after: Variant = null  # the golden graph after a server-side add / remove node

	func get_json(path: String) -> Dictionary:
		calls.append(["GET", path.get_slice("?", 0)])
		if srv.fail != "":
			return {"ok": false, "data": null, "error": srv.fail}
		return {"ok": true, "data": {"graph": srv.graph.duplicate(true)}, "error": ""}

	func post_json(path: String, body: Variant) -> Dictionary:
		calls.append(["POST", path, body.duplicate(true)])
		if srv.fail != "":
			return {"ok": false, "data": null, "error": srv.fail}
		if body.has("deviceGraph"):
			srv.graph = body.deviceGraph.duplicate(true)
			return {"ok": true, "data": {"ok": true}, "error": ""}
		srv.graph = after.duplicate(true)
		return {"ok": true, "data": {"ok": true, "graph": after.duplicate(true)}, "error": ""}

	func confirm(text: String) -> bool:
		calls.append(["CONFIRM", text])
		return answer

	func alert(text: String) -> void:
		calls.append(["ALERT", text])

	func dirty() -> void:
		calls.append(["DIRTY", true])

	func reload() -> void:
		calls.append(["LOAD"])

	func status(text: String, _ok: bool) -> void:
		status_text = text

	func fail(text: String) -> void:
		fails.append(text)


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_mapping.json"))
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


func _check_spec(got: Array, want: Array, what: String) -> void:
	var w := want.filter(func(it: Dictionary) -> bool: return it.get("text") != "Show Mapping Preview")
	t.eq(got.size(), w.size(), what + ": item count")
	for i in mini(got.size(), w.size()):
		t.eq(_norm(got[i]), _norm(w[i]), "%s: item %d" % [what, i])


func _check_views(p: Dictionary, node: String, want: Dictionary, what: String) -> void:
	_check_spec(M.items(p, node), want.spec, what)
	t.eq(_norm(M.band(p)), _norm(want.band), what + ": column")
	for id in want.feeds:
		var f := S.feed_source(p, id)
		t.eq(_norm(f if not f.is_empty() else null), _norm(want.feeds[id]), "%s: feed %s" % [what, id])


func _ui(p: Dictionary, node: String) -> Dictionary:
	var n := G.find_node(p.graph, node)
	var ui := {}
	for i in G._outputs(n).size():
		ui[i] = M.field_state(n, G._outputs(n)[i])
	return ui


func _field(flow: Variant, ui: Dictionary, key: String, value: String) -> void:
	if key == "name":
		await flow.rename(value)
		return
	var i := int(key.get_slice(".", 0).trim_prefix("o"))
	var k := key.get_slice(".", 1)
	match k:
		"label":
			await flow.set_label(i, value)
		"mode":
			await flow.on_mode(i, value, ui[i])
		"cw", "ch", "cf":
			ui[i][k] = value
			await flow.save_mode(i, ui[i])
		_:
			ui[i][k] = value
			await flow.save_rect(i, ui[i])


func test_pages_replay() -> void:
	var fx: Dictionary = _golden().fixtures
	var now := float(fx.now)
	for c in _golden().cases:
		var env: Dictionary = c.env
		var p: Dictionary = fx.payload.duplicate(true)
		p.graph.devices.append_array(env.get("devices", []).duplicate(true))
		p.graph.connectors.append_array(env.get("connectors", []).duplicate(true))
		p.graph.edges.append_array(env.get("edges", []).duplicate(true))
		var io := FakeIo.new()
		io.srv = {"graph": p.graph.duplicate(true), "fail": ""}
		var flow = FLOW.new(p, env.node, io)
		flow.clock = func() -> float: return now
		flow.rand36 = func() -> String: return fx.rand36
		_check_views(p, env.node, c.init, c.name + ": init")
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			io.status_text = ""
			io.after = a.graph
			if st.has("fail"):
				io.srv.fail = st.fail
			if st.has("confirm"):
				io.answer = st.confirm
			var ui := _ui(p, env.node)
			if st.has("field"):
				await _field(flow, ui, st.field, st.value)
			for kv in st.get("fields", []):
				await _field(flow, ui, kv[0], kv[1])
			match str(st.get("button", "")):
				"Propose outputs from input":
					await flow.propose()
				"+ Add Output":
					await flow.add_output()
				"Duplicate Node":
					await flow.duplicate()
				"Delete Node":
					await flow.delete_node()
				var b:
					if b.ends_with(".remove"):
						await flow.remove_output(int(b.get_slice(".", 0).trim_prefix("o")))
			if st.has("addNode"):
				await FLOW.add_node(io)
			if st.has("addOutput"):
				await FLOW.add_card_output(io, st.addOutput, now)
			t.eq(_norm(io.calls), _norm(a.calls), what + ": requests")
			t.eq(io.status_text, a.status, what + ": status")
			t.eq(_norm(io.srv.graph), _norm(a.graph), what + ": server graph")
			p.graph = io.srv.graph.duplicate(true)
			flow.payload = p
			_check_views(p, env.node, a, what)
			io.calls.clear()


func test_helpers() -> void:
	var h: Dictionary = _golden().helpers
	for e in h.parse:
		var got := G.parse_custom(e[0])
		t.eq(_norm(got if not got.is_empty() else null), _norm(e[1]), "parse " + str(e[0]))
	for e in h.format:
		t.eq(G.format_custom(e[0][0], e[0][1], e[0][2]), e[1], "format " + str(e[0]))
	for e in h.resolve:
		t.eq(_norm(G.resolve_output(e[0])), _norm(e[1]), "resolve " + JSON.stringify(e[0]))
	for e in h.propose:
		t.eq(_norm(G.propose_layout(e[0][0], e[0][1], e[0][2], e[0][3])), _norm(e[1]), "propose " + str(e[0]))
	t.eq(G.base36(1800000000000), "mywpiww0", "Date.now().toString(36)")
	var n := [0]
	var g := {"devices": [{"id": "m", "role": "pixel_mapping", "settings": {"mappings": [{"id": "a"}, {"id": "b"}]}}], "connectors": []}
	var r := G.duplicate_node(g, "m", "x", func() -> String:
		n[0] += 1
		return str(n[0]))
	t.eq(r.graph.devices[1].settings.mappings.map(func(m: Dictionary) -> String: return m.id), ["map_x_1", "map_x_2"],
		"duplicate draws a fresh tag per slice (web Math.random per mapping)")
