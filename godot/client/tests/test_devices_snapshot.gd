extends RefCounted
## WO-605 slice 8 — snapshot_model.gd / snapshot_flow.gd against the web Save / Load device snapshot modals
## (device-view-snapshot-modals.js + device-snapshot-capture.js) run under Node on a fake DOM with a scripted server,
## Date pinned: tests/golden/devices_snapshot.json. Save cases replay name edits / Save… presses — the "File:" line,
## the requests, the status lines, and the downloaded file name + its exact JSON text; Load cases replay file picks,
## mode, Preview / Apply (confirms) — the requests, statuses, the preview text and whether Apply is enabled / applied.
## The web's rear-panel capture always fails under Node (no html-to-image), so the fake capture returns null.
## JSON parse error messages differ between JS and Godot: only their "Invalid JSON: " prefix is compared.

const M := preload("res://features/devices/snapshot_model.gd")
const FLOW := preload("res://features/devices/snapshot_flow.gd")
var t
var _g: Dictionary


class FakeIo:
	extends RefCounted
	var srv := {}
	var calls := []
	var statuses := []
	var downloads := []
	var answer := true
	var applied_n := 0

	func get_json(path: String) -> Dictionary:
		calls.append(["GET", path])
		if srv.has("getThrow"):
			return {"ok": false, "data": null, "error": srv.getThrow}
		return {"ok": true, "data": srv.build.duplicate(true), "error": ""}

	func post_json(path: String, body: Dictionary) -> Dictionary:
		calls.append(["POST", path, {"mode": body.mode, "dryRun": body.dryRun, "kind": body.snapshot.get("kind") if body.snapshot is Dictionary else null}])
		var r: Variant = srv.get("dry" if body.dryRun else "apply")
		if r is Dictionary and r.has("__throw"):
			return {"ok": false, "data": null, "error": r.__throw}
		return {"ok": true, "data": r.duplicate(true) if r is Dictionary else r, "error": ""}

	func status(text: String, ok: bool) -> void:
		statuses.append([text, ok])

	func confirm(text: String) -> bool:
		calls.append(["CONFIRM", text])
		return answer

	func capture() -> Variant:
		return null

	func download(name: String, text: String) -> String:
		downloads.append({"name": name, "text": text})
		return name

	func applied() -> void:
		calls.append(["EVENT", "highascg-settings-applied"])
		applied_n += 1


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_snapshot.json"))
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


func test_save_replay() -> void:
	var now := float(_golden().fixtures.now)
	for c in _golden().cases.filter(func(x: Dictionary) -> bool: return x.kind == "save"):
		t.eq(c.init.file, M.file_label(""), c.name + ": initial file line")
		t.eq([c.init.title, c.init.hint, c.init.placeholder, c.init.capture], [M.SAVE_TITLE, M.SAVE_NOTE, M.NAME_HINT, true], c.name + ": texts")
		var io := FakeIo.new()
		io.srv = c.srv.duplicate(true)
		var flow = FLOW.new(io)
		flow.clock = func() -> float: return now
		var name := ""
		var capture := true
		var open := true
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			io.calls.clear()
			io.statuses.clear()
			io.downloads.clear()
			if st.has("name"):
				name = st.name
			if st.has("capture"):
				capture = st.capture
			if st.get("save", false):
				open = not await flow.save(name, capture)
			if st.get("cancel", false):
				open = false
			t.eq(open, a.open, what + ": open")
			if open:
				t.eq(M.file_label(name), a.file, what + ": file line")
			t.eq(_norm(io.calls), _norm(a.calls), what + ": requests")
			t.eq(io.statuses, a.statuses, what + ": statuses")
			t.eq(io.downloads.size(), a.downloads.size(), what + ": downloads")
			for i in mini(io.downloads.size(), a.downloads.size()):
				t.eq(io.downloads[i].name, a.downloads[i].name, what + ": file name")
				t.eq(io.downloads[i].text, a.downloads[i].text, what + ": file text")


func test_load_replay() -> void:
	for c in _golden().cases.filter(func(x: Dictionary) -> bool: return x.kind == "load"):
		t.eq([c.init.title, c.init.intro, c.init.preview], [M.LOAD_TITLE, M.LOAD_INTRO, M.PICK], c.name + ": texts")
		t.eq(c.init.modes, M.MODES, c.name + ": modes")
		var io := FakeIo.new()
		io.srv = c.srv.duplicate(true)
		var flow = FLOW.new(io)
		var mode := "full"
		var open := true
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			io.calls.clear()
			io.statuses.clear()
			io.applied_n = 0
			if st.has("file"):
				flow.on_file(null if st.file == null else (st.file if st.file is String else JSON.stringify(st.file)))
			if st.has("mode"):
				mode = st.mode
			if st.has("confirm"):
				io.answer = st.confirm
			match str(st.get("button", "")):
				"Preview":
					await flow.dry_run(mode)
				"Apply":
					if await flow.apply(mode):
						open = false
				"Cancel":
					open = false
			t.eq(open, a.open, what + ": open")
			t.eq(_norm(io.calls), _norm(a.calls), what + ": requests")
			t.eq(io.statuses, a.statuses, what + ": statuses")
			t.eq(io.applied_n, int(a.applied), what + ": applied")
			if open:
				t.eq(flow.can_apply, a.apply, what + ": Apply enabled")
				if str(a.preview).begins_with("Invalid JSON: "):
					t.eq(flow.preview.begins_with("Invalid JSON: "), true, what + ": preview (parse error)")
				else:
					t.eq(flow.preview, a.preview, what + ": preview")


func test_helpers() -> void:
	for e in _golden().helpers.slugs:
		t.eq(M.slugify(e[0]), e[1], "slug " + str(e[0]))
	for e in _golden().helpers.iso:
		t.eq(M.iso(float(e[0])), e[1], "iso %d" % int(e[0]))
	var built := {"ok": true, "kind": M.KIND, "version": 1, "createdAt": "c", "appVersion": "v", "host": {"hostname": "h"}, "payload": {}}
	var vis := {"mimeType": "image/png", "encoding": "base64", "width": 2, "height": 1, "data": "QQ=="}
	t.eq(M.document(built, "A b", vis, 0).keys(), ["kind", "version", "deviceName", "slug", "createdAt", "appVersion", "host", "visual", "payload"],
		"document key order with a visual (web spread order)")
	t.eq(M.parse_file("{ not json").error.ends_with("(line 1)"), true, "parse error lines count from 1")
	t.eq(M.parse_file("").ok, false, "an empty file is not JSON")


func test_dry_run_details() -> void:
	var f2 = FLOW.new(_Rejecting.new())
	f2.on_file('{"kind":"nope"}')
	await f2.dry_run("full")
	t.eq(f2.preview, "Error: HTTP 400: Invalid device snapshot\n• kind must be \"highascg-device-snapshot\"\n• version must be 1 (got 2)",
		"validation details follow the error (the web drops them)")
	t.eq(f2.can_apply, false, "no Apply after a rejected dry run")


class _Rejecting:
	extends RefCounted

	func post_json(_path: String, _body: Dictionary) -> Dictionary:
		return {"ok": false, "error": "HTTP 400: Invalid device snapshot",
			"data": {"ok": false, "error": "Invalid device snapshot", "details": ['kind must be "highascg-device-snapshot"', "version must be 1 (got 2)"]}}

	func status(_t: String, _ok: bool) -> void:
		pass
