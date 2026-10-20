extends RefCounted
## WO-605 slice 9b-2 — gpu_layout_flow.gd against the web GPU layout editor (device-view-inspector-gpu-layout-editor.js)
## run under Node on a fake DOM with a scripted server: tests/golden/devices_gpu_editor.json. Each case = a payload,
## the saved layout (web localStorage) and steps (Port A/B / Hide edits, row drops, bulk buttons, Save, Export, Load,
## Reset layout, Assign); per step the web's localStorage writes (LS / LS_CLEAR), POSTs, confirms, reloads, download
## and status. Mapped on purpose: the web's alerts are this client's status line; where the web leaves its rows stale
## (bulk buttons, Load) the rows are compared with what it saved; a failed topology POST is reported, not "saved".

const FLOW := preload("res://features/devices/gpu_layout_flow.gd")
var t
var _g: Dictionary


class FakeIo:
	extends RefCounted
	var post := {}
	var calls := []
	var status_text := ""
	var status_ok := false
	var answer := true

	func post_json(path: String, body: Variant) -> Dictionary:
		calls.append(["POST", path, body.duplicate(true)])
		var v: Variant = post.get(path, {"ok": true})
		if v is Dictionary and v.has("__throw"):
			return {"ok": false, "data": null, "error": v.__throw}
		return {"ok": true, "data": v.duplicate(true), "error": ""}

	func confirm(text: String) -> bool:
		calls.append(["CONFIRM", text])
		return answer

	func reload() -> void:
		calls.append(["LOAD"])

	func status(text: String, ok: bool) -> void:
		status_text = text
		status_ok = ok

	func prefs_save(items: Array) -> void:
		calls.append(["LS", items])

	func prefs_clear() -> void:
		calls.append(["LS_CLEAR"])


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_gpu_editor.json"))
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


static func _rows_of(items: Array) -> Array:
	var out := []
	for i in items.size():
		var p: Array = items[i].get("pairs", [])
		out.append({"head": "Socket %d (%s)" % [i + 1, items[i].label], "a": p[0] if p.size() > 0 else "",
			"b": p[1] if p.size() > 1 else "", "hidden": bool(items[i].get("hidden", false))})
	return out


## A <select> shows only its options: a pair name the options lack reads as None ("").
static func _selectable(rows: Array, options: Array) -> Array:
	return rows.map(func(r: Dictionary) -> Dictionary:
		return {"head": r.head, "a": r.a if r.a in options else "", "b": r.b if r.b in options else "", "hidden": r.hidden})


func test_editor_replay() -> void:
	for c in _golden().cases:
		var io := FakeIo.new()
		var flow = FLOW.new(c.payload, c.prefs if c.prefs is Array else [], io)
		t.ok(not flow.stale, c.name + ": fresh rows")
		t.eq(_norm(flow.rows()), _norm(c.init.rows), c.name + ": init rows")
		t.eq(flow.unmapped(), c.init.unmapped, c.name + ": init unmapped")
		t.eq([""] + flow.options, c.init.options, c.name + ": port options")
		var shown: Array = c.init.rows
		var stale := false
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			io.status_text = ""
			io.status_ok = false
			if st.has("set"):
				io.post = st.set.post
			if st.has("confirm"):
				io.answer = st.confirm
			var want: Array = a.calls.filter(func(x: Array) -> bool: return x[0] != "ALERT")
			var alerts: Array = a.calls.filter(func(x: Array) -> bool: return x[0] == "ALERT")
			var w_status: String = alerts[0][1] if not alerts.is_empty() else a.status
			var w_ok: bool = a.ok if alerts.is_empty() else w_status == "GPU layout loaded from file."
			var rows := flow.rows()
			if st.has("port"):
				var i := int(st.port[0])
				var v: String = st.port[2] if st.port[2] in flow.options else ""  # a <select> keeps only its options
				await flow.edit(i, v if st.port[1] == "a" else rows[i].a, v if st.port[1] == "b" else rows[i].b, rows[i].hidden)
			elif st.has("hide"):
				var i := int(st.hide)
				await flow.edit(i, rows[i].a, rows[i].b, not rows[i].hidden)
			elif st.has("drop"):
				await flow.move(int(st.drop[0]), int(st.drop[1]), float(st.drop[2]) > 20.0)
			elif st.has("assign"):
				await flow.assign(flow.unmapped()[int(st.assign[0])].name, st.assign[1])
			elif st.has("load"):
				await flow.load_text(st.load)
			elif st.get("button") == "Save":
				await flow.save()
			elif st.get("button") == "Reset layout":
				await flow.reset()
			elif st.get("button") == "Export":
				io.calls.append(["DOWNLOAD", flow.export_name(), flow.export_text()])
			else:
				await flow.bulk(st.button)
			if w_status == "GPU layout saved (topology persisted)" and want.any(func(x: Array) -> bool:
					return x[0] == "POST" and io.post.has(x[1]) and io.post[x[1]] is Dictionary and io.post[x[1]].has("__throw")):
				w_status = "GPU layout saved on this client; topology not saved: " + str(io.post["/api/settings"].__throw)
				w_ok = false
			t.eq(_norm(io.calls), _norm(want), what + ": requests")
			if want.any(func(x: Array) -> bool: return x[0] == "LS_CLEAR"):
				t.ok(flow.stale, what + ": a reset makes the page re-read its rows")
			if w_status.begins_with("Invalid GPU layout file: "):
				t.ok(io.status_text.begins_with("Invalid GPU layout file: "), what + ": status " + io.status_text)
			else:
				t.eq(io.status_text, w_status, what + ": status")
			t.eq(io.status_ok, w_ok, what + ": ok")
			var ls: Array = want.filter(func(x: Array) -> bool: return x[0] == "LS")
			# the web re-renders its rows on edits, drops, Assign and Reset; after bulk buttons and Load they show the
			# rows from before until the next re-render, so those compare with what it saved
			var renders: bool = (st.has("port") or st.has("hide") or st.has("drop") or st.has("assign")) and not ls.is_empty() \
				or (st.get("button") == "Reset layout" and want.any(func(x: Array) -> bool: return x[0] == "LS_CLEAR"))
			if not ls.is_empty():
				shown = _rows_of(ls[-1][1])
			elif renders or not stale:
				shown = a.after.rows
			stale = not renders and (stale or not ls.is_empty())
			t.eq(_norm(_selectable(flow.rows(), flow.options)), _norm(_selectable(shown, flow.options)), what + ": rows")
			t.eq(flow.unmapped(), a.after.unmapped, what + ": unmapped")
			io.calls.clear()


func test_rear_show_all() -> void:
	var c: Dictionary = _golden().cases[0]
	var outs: Array = c.payload.suggested.connectors
	t.eq(_norm(FLOW.show_all(c.payload.live, outs)), _norm(_golden().showAll), "Show all rows = the web's")


func test_merge_loaded() -> void:
	var cur := [{"id": "gpu_p0", "label": "A", "pairs": []}, {"id": "gpu_p1", "label": "B", "pairs": []}]
	var got := FLOW.merge_loaded(cur, [{"id": " gpu_p1 ", "label": "x"}, {"id": "gpu_p1", "hidden": true}, [1], {"id": ""}])
	t.eq(got.map(func(x: Dictionary) -> String: return x.id), ["gpu_p1", "gpu_p0"], "file rows first, ids trimmed for matching")
	t.eq([got[0].label, got[0].hidden, got[0].pairs], ["x", true, []], "later rows merge over earlier ones")
	t.eq(FLOW.layout_rows([{"id": "gpu_p0", "pairs": ["", "DP-1"]}, {"id": "gpu_p1"}]), "  gpu_p0: DP-1\n  gpu_p1: (empty)", "diff rows")
