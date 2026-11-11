extends RefCounted
## WO-1039 — programming_panel.gd end to end against a fake HTTP client (nothing reaches a switcher): refresh loads
## and draws both bands, live geometry is coalesced (one request in flight, newest window only), Take waits for
## pending geometry, a failed geometry write stops the queue until Retry and blocks other commands, a locked PGM
## is not editable, a dropped source creates a layer and selects it, Delete asks first.

const ProgPanel := preload("res://features/pixelhue/programming_panel.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
const T := preload("res://tests/test_pixelhue_programming.gd")
var t


class FakeApi:
	extends RefCounted
	signal released
	var hold := false
	var fail_geometry := ""
	var posts: Array = []  # [path, body]
	var gets: Array = []
	var state: Dictionary = T.state()

	func get_json(path: String) -> Dictionary:
		gets.append(path)
		if path.ends_with("programming/sources"):
			return {"ok": true, "status": 200, "data": {"sources": state.sources.filter(func(s: Dictionary) -> bool: return s.type == 2)}}
		if path.ends_with("gallery"):
			return {"ok": true, "status": 200, "data": {"support": {}, "pictures": []}}
		return {"ok": true, "status": 200, "data": state.duplicate(true)}

	func post_json(path: String, body: Variant, _timeout := 0.0) -> Dictionary:
		posts.append([path, body.duplicate(true)])
		if path.ends_with("programming/geometry"):
			if hold:
				await released
			if fail_geometry != "":
				return {"ok": false, "status": 409, "data": {"error": fail_geometry}}
			var layers: Array = []
			for c in body.changes:
				layers.append({"id": c.id, "screenId": c.screenId, "window": c.window})
			return {"ok": true, "status": 200, "data": {"layers": layers}}
		var next := state.duplicate(true)
		if str(body.get("action")) == "create":
			next.layers.append({"id": 777, "screenId": body.screenId, "scene": body.scene, "type": 2, "name": "Layer 9", "window": body.window, "zorder": 9})
		return {"ok": true, "status": 200, "data": next}

	func get_bytes(_path: String) -> Dictionary:
		return {"ok": false, "bytes": PackedByteArray()}


func _setup() -> Array:
	var api := FakeApi.new()
	var p := ProgPanel.new()
	p.api = api
	var notes: Array = []
	p.status.connect(func(text: String) -> void: notes.append(text))
	t.root.add_child(p)
	await t.process_frame
	await p.refresh()
	return [p, api, notes]


func _geometry_posts(api: FakeApi) -> Array:
	return api.posts.filter(func(x: Array) -> bool: return str(x[0]).ends_with("geometry"))


func _wait(s := 0.12) -> void:
	await t.create_timer(s).timeout


func test_refresh_draws_bands() -> void:
	var a: Array = await _setup()
	var p: ProgPanel = a[0]
	t.ok(not p.state.is_empty(), "programming loaded")
	t.eq(p.shown, [3, 1], "enabled screens with outputs shown")
	t.eq(p._bands.stages.size(), 4, "PGM + PVW for each shown screen")
	t.ok(p._bands.stages[3].locked == false and p._bands.stages[1].locked == true, "Screen 1 PGM locked, PVW not")
	t.ok(a[1].gets.has("/api/pixelhue/studio/programming"), "read through the studio bridge")
	p.queue_free()


func test_live_geometry_coalesces() -> void:
	var a: Array = await _setup()
	var p: ProgPanel = a[0]
	var api: FakeApi = a[1]
	api.hold = true
	var l := M.layer_by_id(p.state, 54657024)
	p.select(54657024)
	p.live_geometry(M.window_change(p.state, l, G.win(10, 0, 1920, 1080)))
	p.live_geometry(M.window_change(p.state, l, G.win(20, 0, 1920, 1080)))
	p.live_geometry(M.window_change(p.state, l, G.win(30, 0, 1920, 1080)))
	t.eq(_geometry_posts(api).size(), 1, "first position sent at once, the rest wait (one in flight)")
	t.eq(_geometry_posts(api)[0][1], {"changes": [{"action": "window", "screenId": 3, "id": 54657024, "window": G.win(10, 0, 1920, 1080)}]}, "lean geometry body")
	t.eq(p._save_label.text, "Sending…", "status")
	api.hold = false
	api.released.emit()
	await _wait()
	var sent := _geometry_posts(api)
	t.eq(sent.size(), 2, "the two intermediate positions collapsed into one")
	t.eq(int(sent[1][1].changes[0].window.x), 30, "only the newest position")
	t.eq(p._save_label.text, "Live · saved", "saved")
	t.eq(int(M.layer_by_id(p.state, 54657024).window.x), 30, "local window kept")
	p.queue_free()


func test_take_waits_for_geometry() -> void:
	var a: Array = await _setup()
	var p: ProgPanel = a[0]
	var api: FakeApi = a[1]
	api.hold = true
	var l := M.layer_by_id(p.state, 54657024)
	p.live_geometry(M.window_change(p.state, l, G.win(5, 5, 1920, 1080)))
	p.command(M.take_body(p.shown, 500, true), "Take sent.")
	t.eq(api.posts.size(), 1, "Take is not sent while geometry is in flight")
	api.hold = false
	api.released.emit()
	await _wait()
	t.eq(api.posts.size(), 2, "then Take")
	t.eq(api.posts[1][1], {"action": "take", "screenIds": [3, 1], "time": 500, "swap": true}, "Take body for every shown screen")
	t.ok(a[2].has("Take sent."), "success line")
	p.queue_free()


func test_failed_write_stops_until_retry() -> void:
	var a: Array = await _setup()
	var p: ProgPanel = a[0]
	var api: FakeApi = a[1]
	api.fail_geometry = "Layer X must be an integer from -500000 to 500000."
	var l := M.layer_by_id(p.state, 54657024)
	p.live_geometry(M.window_change(p.state, l, G.win(7, 0, 1920, 1080)))
	await _wait()
	t.ok(p._retry.visible, "Retry save offered")
	t.eq(p._save_label.text, "Not saved", "status")
	t.ok(a[2].has("Layer position not saved: Layer X must be an integer from -500000 to 500000."), "Studio's words")
	p.live_geometry(M.window_change(p.state, l, G.win(8, 0, 1920, 1080)))
	await _wait()
	t.eq(_geometry_posts(api).size(), 1, "queue stopped")
	await p.command(M.zorder_body(l, 3), "x")
	t.ok(a[2].has("Retry the unsaved layer positions before this action."), "other commands wait for Retry")
	api.fail_geometry = ""
	p._queue.retry()
	await _wait()
	t.eq(_geometry_posts(api).size(), 2, "retry sends")
	t.eq(int(_geometry_posts(api)[1][1].changes[0].window.x), 8, "the newest position")
	t.ok(not p._retry.visible, "Retry hidden again")
	p.queue_free()


func test_locked_pgm_is_not_editable() -> void:
	var a: Array = await _setup()
	var p: ProgPanel = a[0]
	var l := M.layer_by_id(p.state, 100)
	p.live_geometry(M.window_change(p.state, l, G.win(1, 1, 500, 500)))
	await _wait()
	t.eq(a[1].posts.size(), 0, "nothing sent for a locked PGM layer")
	p.clear_layer(l)
	t.eq(p.get_children().filter(func(c: Node) -> bool: return c is ConfirmationDialog).size(), 0, "no clear dialog either")
	p.queue_free()


func test_drop_creates_and_selects() -> void:
	var a: Array = await _setup()
	var p: ProgPanel = a[0]
	var api: FakeApi = a[1]
	await p.drop("2:25", M.screen_by_id(p.state, 3), M.PVW, {"x": 960, "y": 540}, {})
	t.eq(api.posts[0][0], "/api/pixelhue/studio/programming", "command path")
	t.eq(api.posts[0][1].action, "create", "create")
	t.eq(p.selected_id, 777, "the new layer is selected")
	t.ok(a[2].has("Layer created."), "message")
	p.queue_free()


func test_clear_asks_first() -> void:
	var a: Array = await _setup()
	var p: ProgPanel = a[0]
	p.clear_layer(M.layer_by_id(p.state, 101))
	var dialogs: Array = p.get_children().filter(func(c: Node) -> bool: return c is ConfirmationDialog)
	t.eq(dialogs.size(), 1, "confirmation shown")
	t.ok(str(dialogs[0].dialog_text).contains("both layers"), "a group clear names both layers")
	t.eq(a[1].posts.size(), 0, "nothing sent before OK")
	(dialogs[0] as ConfirmationDialog).confirmed.emit()
	await _wait()
	t.eq(a[1].posts[0][1], {"action": "group-delete", "screenId": 1, "id": 101}, "sent after OK")
	p.queue_free()
