extends RefCounted
## WO-1039 MVR — mvr_panel.gd end to end on a fake Studio (no switcher, no clicks): reading, drag → autosave body,
## overlap refusal, a rejected save with the device's snapshot + Retry, typed fields, undo, delete / device layout /
## drop requests, Fix aspect ratios. The canvas / inspector are driven through the signals their input handlers emit.

const MvrPanel := preload("res://features/pixelhue/mvr_panel.gd")
const BASE := "/api/pixelhue/studio/"
var t


class FakeStudio:
	extends RefCounted
	var state := {}
	var posts: Array = []
	var gets: Array = []
	var fail_next := ""  # a windows write answers this error (with the device's snapshot)

	func get_json(path: String) -> Dictionary:
		gets.append(path)
		if path == "/api/pixelhue/studio/state":
			return {"ok": true, "status": 200, "data": state.duplicate(true)}
		if path == "/api/pixelhue/studio/mvr-templates":
			return {"ok": true, "status": 200, "data": {"session": "s1", "supported": true, "templates": [{"id": 4.0, "type": 1.0, "windows": 16.0, "label": "Layout 4 · 16 windows"}]}}
		return {"ok": false, "status": 404, "data": {"error": "Not found."}}

	func post_json(path: String, body: Variant, _timeout_s := 0.0) -> Dictionary:
		posts.append([path.trim_prefix("/api/pixelhue/studio/"), JSON.parse_string(JSON.stringify(body))])
		if path.ends_with("/windows"):
			if fail_next != "":
				var why := fail_next
				fail_next = ""
				return {"ok": false, "status": 409, "data": {"error": why, "snapshot": state.duplicate(true)}}
			for c in body.changes:
				for l in state.layers:
					if int(l.id) == int(c.id):
						l.window = c.window.duplicate()
						l.aspectLock = c.aspectLock
						l.aspectMode = c.aspectMode
		var out: Dictionary = state.duplicate(true)
		if path.ends_with("/mvr-layers"):
			out.changedId = 3
		return {"ok": true, "status": 200, "data": out}


func _state() -> Dictionary:
	var l := func(id: int, x: int, y: int, w: int, h: int, sid: int, lock: Variant) -> Dictionary:
		return {"id": float(id), "screenId": 7.0, "name": "Layer%d" % id, "source": "Input %d" % id, "window": {"x": float(x), "y": float(y), "width": float(w), "height": float(h)},
			"sourceId": float(sid), "sourceType": 2.0, "umdHeight": 24.0, "aspectMode": 5.0, "aspectLock": lock}
	return {"screens": [{"id": 7.0, "name": "MVR", "width": 1920.0, "height": 1080.0}],
		"signals": [{"id": 25.0, "connected": true, "width": 1920.0, "height": 1080.0}],
		"layers": [l.call(1, 0, 0, 400, 249, 25, null), l.call(2, 500, 0, 400, 300, 26, null)],
		"sources": [{"type": 2.0, "id": 25.0, "name": "Input 1", "width": 1920.0, "height": 1080.0, "umdHeight": 24.0, "usedBy": 1.0},
			{"type": 2.0, "id": 40.0, "name": "Input 6", "width": 1920.0, "height": 1080.0, "umdHeight": 24.0, "usedBy": null}],
		"session": "s1", "device": {"model": "P20"}, "capabilities": {"mvr": true}}


func _open() -> Array:
	var fake := FakeStudio.new()
	fake.state = _state()
	var p: Node = MvrPanel.new()
	p.api = fake
	var said: Array = []
	p.status.connect(func(text: String) -> void: said.append(text))
	t.root.add_child(p)
	await t.process_frame
	await p.refresh()
	return [p, fake, said]


func _close(p: Node) -> void:
	t.root.remove_child(p)
	p.queue_free()


func test_reads_the_layout_and_templates() -> void:
	var o := await _open()
	var p: Node = o[0]
	t.eq(o[1].gets, [BASE + "state", BASE + "mvr-templates"], "state, then device layouts")
	t.eq(p._screen_id, 7, "output")
	t.eq(p._selected_id, 1, "first window selected")
	t.eq(o[2].back(), "Layout refreshed.", "status")
	t.eq(p._canvas.windows.size(), 2, "canvas has the windows")
	_close(p)


func test_drag_saves_once_with_studio_body() -> void:
	var o := await _open()
	var p: Node = o[0]
	var fake: FakeStudio = o[1]
	p._canvas.drag_started.emit(1, "")
	p._canvas.drag_moved.emit(10.0, 400.0)
	t.ok(p._drag.size() > 0, "dragging")
	t.eq(await p._flush(), false, "nothing is sent while dragging")
	p._canvas.drag_moved.emit(20.0, 500.0)
	p._canvas.drag_ended.emit(false)
	t.ok(fake.posts.is_empty(), "no write before the queue runs")
	await p._flush()
	t.eq(fake.posts, [["windows", {"changes": [{"id": 1.0, "window": {"x": 20.0, "y": 500.0, "width": 400.0, "height": 249.0}, "aspectLock": null, "aspectMode": 5.0}]}]], "PUT /api/windows body")
	t.eq(p._sync.running, false, "done")
	t.eq(p._dirty.text, "Saved · changes send automatically", "saved")
	p._undo_redo(false)
	t.eq(p._selected().window, {"x": 0, "y": 0, "width": 400, "height": 249}, "undo restores the window")
	await p._flush()
	t.eq(fake.posts.size(), 2, "undo saves too")
	_close(p)


func test_drag_into_a_neighbour_is_limited() -> void:
	var o := await _open()
	var p: Node = o[0]
	p._canvas.drag_started.emit(1, "")
	p._canvas.drag_moved.emit(300.0, 0.0)  # would overlap window 2 at x 500
	t.eq(p._selected().window.x, 0, "stays where it was")
	p._canvas.drag_ended.emit(false)
	t.eq(o[2].back(), "Movement or resizing was limited to avoid overlapping another MVR window.", "said why")
	t.eq(p._stack.undo.size(), 0, "nothing to undo")
	_close(p)


func test_rejected_save_shows_the_device_layout_and_retries() -> void:
	var o := await _open()
	var p: Node = o[0]
	var fake: FakeStudio = o[1]
	fake.fail_next = "The device did not retain the requested geometry or aspect locks."
	p._inspector.field_committed.emit("y", "600")
	t.eq(p._selected().window.y, 600, "typed Y applied locally")
	await p._flush()
	t.eq(o[2].back(), "MVR not saved: The device did not retain the requested geometry or aspect locks.", "Studio's sentence")
	t.ok(p._retry.visible, "Retry save shown")
	t.eq(p._dirty.text, "Not saved", "label")
	t.eq(p._selected().window.y, 600, "the local edit is kept over the snapshot")
	t.eq(await p._flush(), false, "the queue stops after a failure")
	p._sync.retry()
	await p._flush()
	t.eq(fake.state.layers[0].window.y, 600, "retry saved it")
	t.eq(o[2].back(), "MVR saved.", "and says so")
	t.ok(not p._retry.visible, "Retry hidden again")
	_close(p)


func test_snapshot_replaces_unedited_windows() -> void:
	var o := await _open()
	var p: Node = o[0]
	var fake: FakeStudio = o[1]
	fake.state.layers[1].window.x = 1000.0  # the device moved window 2 behind our back
	fake.fail_next = "Rejected."
	p._edit({"x": 0, "y": 300, "width": 400, "height": 249})
	await p._flush()
	t.eq(M_layer(p, 2).window.x, 1000, "the snapshot shows the device's actual layout")
	_close(p)


func M_layer(p: Node, id: int) -> Dictionary:
	for l in p._state.layers:
		if int(l.id) == id:
			return l
	return {}


func test_typed_overlap_is_refused() -> void:
	var o := await _open()
	var p: Node = o[0]
	p._inspector.field_committed.emit("x", "300")
	t.eq(p._selected().window.x, 0, "unchanged")
	t.eq(o[2].back(), "MVR windows cannot overlap. Choose a smaller size or a free position.", "Studio's sentence")
	p._inspector.field_committed.emit("width", "abc")
	t.eq(o[2].back(), "Enter a whole number of pixels.", "garbage")
	_close(p)


func test_structure_requests() -> void:
	var o := await _open()
	var p: Node = o[0]
	var fake: FakeStudio = o[1]
	p._on_drop("2:40", -1, Vector2(1500, 800))
	t.eq(fake.posts.back()[0], "mvr-layers", "drop on empty space creates")
	t.eq(fake.posts.back()[1].action, "create", "create")
	t.eq(fake.posts.back()[1].source, {"type": 2.0, "id": 40.0}, "the dropped source")
	t.ok(not fake.posts.back()[1].has("session"), "no session from the client")
	t.eq(o[2].back(), "Input 6 added to the MVR.", "said")
	p._on_drop("2:40", 2, Vector2.ZERO)
	t.eq(fake.posts.back()[1], {"screenId": 7.0, "action": "source", "layerId": 2.0, "source": {"type": 2.0, "id": 40.0}}, "drop on a window replaces its source")
	p._selected_id = 2
	p._on_delete()
	var dlg := _dialog(p)
	t.ok(dlg != null and dlg.dialog_text == "Delete MVR window Input 2?", "delete asks first")
	var before: int = fake.posts.size()
	dlg.confirmed.emit()
	dlg.hide()
	await t.process_frame
	t.eq(fake.posts.size(), before + 1, "confirmed → one request")
	t.eq(fake.posts.back()[1], {"screenId": 7.0, "action": "delete", "layerId": 2.0}, "delete body")
	p._on_template("1:4")
	dlg = _dialog(p)
	t.ok(dlg != null and dlg.dialog_text.begins_with("Apply this device layout?"), "a device layout asks first")
	dlg.confirmed.emit()
	dlg.hide()
	await t.process_frame
	t.eq(fake.posts.back(), ["mvr-templates", {"screenId": 7.0, "templateId": 4.0, "type": 1.0, "confirmReplace": true}], "template body")
	_close(p)


func _dialog(p: Node) -> ConfirmationDialog:
	var found: ConfirmationDialog = null
	for c in p.get_children():
		if c is ConfirmationDialog and not c.has_meta("seen"):
			found = c
	if found != null:
		found.set_meta("seen", true)
	return found


func test_fix_aspect_ratios() -> void:
	var o := await _open()
	var p: Node = o[0]
	var fake: FakeStudio = o[1]
	await p._fix_aspect()
	t.eq(p._selected().window, {"x": 0, "y": 0, "width": 400, "height": 249}, "already 16:9 + 24: unchanged size")
	t.eq(p._selected().aspectLock, 16.0 / 9.0, "and locked")
	t.ok(str(o[2].back()).begins_with("Fixed and locked 1 input/screen windows; 1 other windows unchanged."), "notice")
	await p._flush()
	t.eq(fake.posts.back()[1].changes[0].aspectMode, 5.0, "lock saved with mode 5 (UMD strip)")
	t.eq(p._stack.undo.size(), 1, "one undoable action")
	_close(p)
