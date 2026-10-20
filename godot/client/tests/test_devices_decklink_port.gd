extends RefCounted
## WO-605 slice 5 — decklink_port_model.gd / decklink_input_model.gd against the web DeckLink connector page
## (device-view-inspector-decklink*.js + lib/decklink-add-input.js) run under Node on a fake DOM and a fake server:
## tests/golden/devices_decklink_port.json. `cases` = the page rendered for the live device-view / settings capture
## plus data mutations (`ops`), flattened into the spec the model emits, then edits / button presses with the requests
## each fired; `onUpdate` = what the fake server changed when it got the updateConnector write. `adds` = direct
## addDecklinkInputSlot runs. The host-channel device switcher (slice 3c) is compared by its options only.

const DP := preload("res://features/devices/decklink_port_model.gd")
const DI := preload("res://features/devices/decklink_input_model.gd")
const HS := preload("res://features/devices/host_source_model.gd")
const MI := preload("res://core/math_input.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_decklink_port.json"))
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


## generator applyOps (root p | s; conn ops are not used here).
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
				o[last].append(op[3].duplicate(true))


func _env(ops: Array) -> Dictionary:
	var fx: Dictionary = _golden().fixtures
	var p: Dictionary = fx.payload.duplicate(true)
	var s: Dictionary = fx.settings.duplicate(true)
	_apply(p, s, ops)
	p._settings = s
	return {"p": p, "s": s}


static func _conn(p: Dictionary, id: String) -> Dictionary:
	for c in R_a(p.get("graph", {}).get("connectors")) + R_a(p.suggested.connectors):
		if c.id == id:
			return c
	return {}


static func R_a(v: Variant) -> Array:
	return v if v is Array else []


## The model's spec with the host switcher reduced to the web's options (value is the shim's blind spot).
static func _spec(conn: Dictionary, p: Dictionary, s: Dictionary) -> Array:
	return DP.page_spec(conn, p, s).map(func(it: Dictionary) -> Dictionary:
		if it.t != "host":
			return it
		var active := HS.decklink_active_device(it.source, s, it.slot)
		return {"t": "host", "options": HS.decklink_options(p, it.slot, active).map(func(o: Array) -> Array: return [str(o[0]), o[1]])})


static func _web_spec(spec: Array) -> Array:
	return spec.map(func(it: Dictionary) -> Dictionary:
		if it.t != "host":
			return it
		return {"t": "host", "options": it.options})


static func _posts(calls: Array) -> Array:
	return calls.filter(func(c: Array) -> bool: return c[0] == "POST").map(func(c: Array) -> Array: return c.slice(0, 3))


static func _dirty(calls: Array) -> bool:
	return calls.any(func(c: Array) -> bool: return c[0] == "DIRTY")


static func _count(s: Dictionary) -> int:
	return HS.decklink_count(s)


func test_page_spec() -> void:
	for c in _golden().cases:
		var e := _env(c.ops)
		var got: Array = _norm(_spec(_conn(e.p, c.connId), e.p, e.s))
		var want: Array = _norm(_web_spec(c.init.spec))
		t.eq(got.size(), want.size(), "%s: item count" % c.name)
		for i in mini(got.size(), want.size()):
			t.eq(got[i], want[i], "%s: item %d" % [c.name, i])


## Start an input from the page: prepare on the server's device view, the server's updateConnector side effects,
## finish on the re-read settings / device view. → [posts, dirty, status, ok]
func _start(conn: Dictionary, e: Dictionary, on_update: Array) -> Array:
	var v := DI.view(conn, e.p, e.s)
	var dv: Dictionary = e.p.duplicate(true)
	var prep := DI.add_prepare(dv, maxi(1, v.dev if v.dev != 0 else v.slot), v.slot)
	if prep.has("error"):
		return [[], false, "Failed: " + prep.error, false]
	var prev := _count(e.s)
	var s2: Dictionary = e.s.duplicate(true)
	var dv2 := dv.duplicate(true)
	_apply(dv2, s2, on_update)
	var fin := DI.add_finish(prep, prev, _count(s2), dv2, s2)
	var reqs: Array = prep.requests + fin.requests
	return [_posts(reqs), _dirty(reqs) or fin.restart or fin.pending, DI.add_status(v.dev, fin), true]


## Stop input: removeDecklinkInputSlot on the server's device view, then the count re-read and tail.
func _stop(conn: Dictionary, e: Dictionary, on_update: Array) -> Array:
	var v := DI.view(conn, e.p, e.s)
	var a := DI.stop_args(conn, v)
	var dv: Dictionary = e.p.duplicate(true)
	var cm: Dictionary = dv.get("live", {}).get("caspar", {}).get("channelMap") if dv.get("live", {}).get("caspar", {}).get("channelMap") is Dictionary else {}
	var plan := HS.decklink_remove_plan(dv, a[0], a[1], a[2], "", cm)
	var s2: Dictionary = e.s.duplicate(true)
	_apply(dv, s2, on_update)
	var reqs: Array = plan.requests + HS.decklink_remove_tail(_count(e.s), _count(s2), plan.dest_id)
	return [_posts(reqs), _dirty(reqs), DI.stop_status(v), true]


func test_edits_replay() -> void:
	for c in _golden().cases:
		var e := _env(c.ops)
		var conn := _conn(e.p, c.connId)
		var ui := DP.consumer_state(conn, DP.output_status(e.p, c.connId))
		var kf_items := DP.keyfill_items(conn, e.p)
		var kf := {"on": kf_items[0].checked, "key": kf_items[1].value}
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			var got: Array  # [posts, dirty, status, ok]
			if st.has("button"):
				got = _start(conn, e, c.onUpdate) if st.button == "Start an input" else _stop(conn, e, c.onUpdate)
			elif (st.has("check") and st.check == "kf") or (st.has("select") and st.select == "key"):
				if st.has("check"):
					kf.on = st.on
					kf.key = DP.key_after_toggle(st.on, kf.key, e.p, conn)
				else:
					kf.key = st.value
				var r := DP.keyfill_patch(conn, e.p, kf.on, kf.key)
				got = [[], false, r.error, false] if r.has("error") else \
					[[["POST", "/api/device-view", {"updateConnector": {"id": c.connId, "patch": {"caspar": r.patch}}}]], true, r.status, true]
				t.eq(DP.keyfill_items(conn, e.p)[1].options.size() > 0, true, what + ": key options")
			else:
				var key: String = st.get("select", st.get("check", st.get("input", "")))
				ui[key] = st.get("value", st.get("on"))
				var r := DP.consumer_patch(conn, ui)
				if key == "depth":
					ui.depth = MI.commit(str(ui.depth), 1, 3, 0, null).text
				got = [[], false, r.error, false] if r.has("error") else \
					[[["POST", "/api/device-view", {"updateConnector": {"id": c.connId, "patch": {"caspar": r.patch}}}]], true, "SDI settings saved.", true]
			t.eq(_norm(got[0]), _norm(_posts(a.calls)), what + ": requests")
			t.eq(got[1], _dirty(a.calls), what + ": dirty")
			t.eq(got[2], a.status, what + ": status")
			t.eq(got[3], str(a.ok).ends_with("--ok"), what + ": ok")
			if a.spec is Array:  # the live-synced parts: pixel hint and the key select's enabled state
				for it in a.spec:
					if it.t == "hint":
						t.eq(DP.yuv_warning(ui), it.text, what + ": yuv hint")
					elif it.t == "select" and it.key == "key":
						t.eq(not kf.on, it.disabled, what + ": key select disabled")
						t.eq(str(kf.key), it.value, what + ": key value")


func test_add_slot() -> void:
	for c in _golden().adds:
		var fx: Dictionary = _golden().fixtures
		var p: Dictionary = fx.payload.duplicate(true)
		var s: Dictionary = fx.settings.duplicate(true)
		_apply(p, s, c.ops)
		var prep := DI.add_prepare(p, int(c.args.device), int(c.args.slot))
		if c.error != "":
			t.eq(prep.get("error", ""), c.error, c.name + ": error")
			continue
		var prev := _count(s)
		_apply(p, s, c.onUpdate)
		var fin := DI.add_finish(prep, prev, _count(s), p, s)
		var reqs: Array = prep.requests + fin.requests
		t.eq(_norm(_posts(reqs)), _norm(_posts(c.calls)), c.name + ": requests")
		t.eq(_dirty(reqs), _dirty(c.calls), c.name + ": restart-dirty event")
		t.eq(_norm(fin.host_channel), _norm(c.res.hostChannel), c.name + ": host channel")
		t.eq(fin.restart, c.res.casparRestartNeeded, c.name + ": restart needed")
		t.eq(fin.pending, c.res.pendingApply, c.name + ": pending apply")
		t.eq(prep.slot, int(c.res.slot), c.name + ": slot")
		t.eq(prep.connector_id, c.res.connectorId, c.name + ": connector")


func test_helpers() -> void:
	t.eq(DP.needs_yuv("DCI2160p2400"), true, "dci 2160p needs yuv")
	t.eq(DP.needs_yuv(" 4320p5000 "), true, "4320p needs yuv")
	t.eq(DP.needs_yuv("1080p5000"), false, "1080p is fine")
	t.eq(DP.inherited_mode_text(null), "—", "no inherited feed")
	t.eq(DP.inherited_mode_text({"width": 1920, "height": 1080, "fps": 59.94}), "1920×1080 @ 59.94 Hz", "dims only")
	t.eq(DP.output_note("unassigned", 1), "Cabled (1 connection) — becomes a program output on Apply. Fill+key below.", "one cable")
	t.eq(DP.keyfill_patch({"externalRef": "2"}, {}, true, "0").error, "Choose key port.", "no key chosen")
	t.eq(DP.consumer_patch({}, {"mode": "1080p5000", "depth": "0", "audio": true, "layout": "", "latency": "", "color": "", "pixel": "", "low_latency": false}).patch.decklinkBufferDepth, 3, "depth 0 → 3 (parseInt || 3)")
	t.eq(DI.add_status(3, {"host_channel": null, "restart": false}), "Port 3 is input on ch null.", "web prints a missing channel as null")
