extends RefCounted
## WO-605 slice 12 — decklink_drop_flow.gd against the web drops (device-view-cable-outputs.js
## setDecklinkAsDestinationOutput, sources-panel-decklink-drop.js parseDecklinkDrop + mapDecklinkToLiveInput →
## decklink-add-input.js) run under Node on a scripted server: tests/golden/devices_decklink_drop.json. Each live case =
## the box's device view + settings with `ops` applied, `onUpdate` ops the server applies on the next updateConnector,
## and a failing request; the web's requests, status / restart-dirty / tab calls, status and corner hint must match.
## The web's APPLY calls (window.__highascgApplyExtraLiveSources, its client-state push) have no Godot counterpart.

const FLOW := preload("res://features/devices/decklink_drop_flow.gd")
var t
var _g: Dictionary


class FakeIo:
	extends RefCounted
	var p := {}
	var s := {}
	var on_update := []
	var fail := Callable()
	var calls := []
	var hints := []
	var status_text := ""
	var status_kind := ""

	func get_json(path: String) -> Dictionary:
		return {"ok": true, "data": p.duplicate(true) if path == "/api/device-view" else {}, "error": ""}

	func post_json(path: String, body: Variant) -> Dictionary:
		calls.append(["POST", path, body.duplicate(true)])
		if fail.is_valid() and fail.call(body):
			return {"ok": false, "data": null, "error": "HTTP 500: boom"}
		if path == "/api/device-view" and body.has("updateConnector"):
			_apply(p, s, on_update)
			on_update = []
		return {"ok": true, "data": {"ok": true}, "error": ""}

	func load_settings() -> Dictionary:
		return s.duplicate(true)

	func status(text: String, kind: String) -> void:
		status_text = text
		status_kind = kind
		calls.append(["STATUS", text, kind])

	func dirty() -> void:
		calls.append(["DIRTY"])

	func reload() -> void:
		calls.append(["LOAD"])

	func hint(text: String) -> void:
		hints.append(text)

	func tab(name: String) -> void:
		calls.append(["TAB", name])

	static func _apply(p: Dictionary, s: Dictionary, ops: Array) -> void:
		for op in ops:
			var o: Variant = p if op[0] == "p" else s
			var path: Array = op[1].map(func(k: Variant) -> Variant: return int(k) if k is float else k)
			for k in path.slice(0, -1):
				if (o[k] if o is Array else o.get(k)) == null:
					o[k] = {}
				o = o[k]
			if op[2] == "set":
				o[path[-1]] = op[3].duplicate(true) if op[3] is Dictionary or op[3] is Array else op[3]
			else:
				o.erase(path[-1])


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_decklink_drop.json"))
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


func test_destination_drops() -> void:
	var fx: Dictionary = _golden().fixtures
	for c in _golden().dest:
		var io := FakeIo.new()
		io.p = fx.payload.duplicate(true)
		io.s = fx.settings.duplicate(true)
		if c.fail:
			io.fail = func(_b: Variant) -> bool: return true
		await FLOW.new(io).to_destination(c.cid, c.destination, c.intent)
		var calls := io.calls.filter(func(x: Array) -> bool: return x[0] != "STATUS")
		t.eq(_norm(calls), _norm(c.calls), c.name + ": requests")
		t.eq(io.status_text, c.status, c.name + ": status")
		t.eq(io.status_kind == "ok", c.ok, c.name + ": ok")


func test_live_input_drops() -> void:
	var fx: Dictionary = _golden().fixtures
	var fails := {"update fails": "updateConnector", "add live fails": "addExtraLiveSource"}
	for c in _golden().live:
		var io := FakeIo.new()
		io.p = fx.payload.duplicate(true)
		io.s = fx.settings.duplicate(true)
		FakeIo._apply(io.p, io.s, c.ops)
		io.on_update = c.onUpdate.duplicate(true)
		if fails.has(c.name):
			var key: String = fails[c.name]
			io.fail = func(b: Variant) -> bool: return b is Dictionary and b.has(key)
		var cid := FLOW.parse({FLOW.MIME: c.raw})
		t.eq(cid != "", c.accepted, c.name + ": accepted")
		if cid != "":
			await FLOW.new(io).to_live_input(cid)
		var want: Array = c.calls.filter(func(x: Array) -> bool: return x[0] != "APPLY")
		t.eq(_norm(io.calls), _norm(want), c.name + ": requests")
		t.eq([io.status_text, io.status_kind], c.status, c.name + ": status")
		t.eq(io.hints, c.hint, c.name + ": hint")


func test_parse_and_accepts() -> void:
	t.eq(FLOW.parse(FLOW.payload("dlsdi_2")), "dlsdi_2", "the rear panel's payload round-trips")
	t.eq(FLOW.parse({}), "", "no connector payload")
	t.eq(FLOW.parse({"type": "media", "value": "CLIP"}), "", "a media drag is not a connector")
	t.eq(FLOW.parse(null), "", "not a dictionary")
	t.ok(FLOW.accepts({"mode": "pgm_prv"}), "screen destination")
	t.ok(FLOW.accepts({"mode": "host_channel"}), "host channel")
	t.ok(not FLOW.accepts({"mode": "stream"}), "stream destination refuses")
