extends RefCounted
## WO-1106 (4.4) — PixelHue panels against a fake HTTP client (nothing reaches a switcher): the tab's status poll keeps
## one read in flight and backs off (C31), Outputs keeps staged edits on a tab change and re-reads only on Discard
## (C34), a read in flight no longer overwrites what was typed (C37), writes pressed while a tab reads wait instead of
## being dropped and a refused backup write puts its control back (C38), a timing row without polarity still builds
## its body (C43), and the 95 s capacity write cannot be queued twice (C45). `Fake` is shared with the other
## *_wo1106 suites.

const Tab := preload("res://features/pixelhue/pixelhue_tab.gd")
const Outputs := preload("res://features/pixelhue/outputs_panel.gd")
const Inputs := preload("res://features/pixelhue/inputs_panel.gd")
const Device := preload("res://features/pixelhue/device_panel.gd")
const Screens := preload("res://features/pixelhue/screens_panel.gd")
const DM := preload("res://features/pixelhue/device_model.gd")
const SM := preload("res://features/pixelhue/screens_model.gd")
const A := preload("res://features/pixelhue/inputs_adv_model.gd")
const TO := preload("res://tests/test_pixelhue_outputs.gd")
const TI := preload("res://tests/test_pixelhue_inputs.gd")
const BASE := "/api/pixelhue/studio/"
var t


## A fake Api: GET answers by path (`answers`, data of a 200), POST answers (`post_answers`, default {}), `fail` =
## path → error (a 500 with Studio's {error}), `bytes` for get_bytes. hold / hold_posts / hold_bytes park the calls
## until `released` is emitted (one in flight, as the real pool would show it).
class Fake:
	extends RefCounted
	signal released
	var hold := false
	var hold_posts := false
	var hold_bytes := false
	var answers := {}
	var post_answers := {}
	var fail := {}
	var bytes := {}
	var gets: Array = []
	var posts: Array = []  # [path, body]
	var byte_gets: Array = []

	func _answer(table: Dictionary, path: String, fallback: Variant) -> Dictionary:
		if fail.has(path):
			return {"ok": false, "status": 500, "data": {"error": str(fail[path])}, "error": str(fail[path])}
		var d: Variant = table.get(path, fallback)
		if d == null:
			return {"ok": false, "status": 0, "data": null, "error": "no answer"}
		if d is Dictionary:
			d = (d as Dictionary).duplicate(true)
		return {"ok": true, "status": 200, "data": d}

	func get_json(path: String) -> Dictionary:
		gets.append(path)
		if hold:
			await released
		return _answer(answers, path, null)

	func post_json(path: String, body: Variant, _timeout := 0.0) -> Dictionary:
		posts.append([path, body])
		if hold_posts:
			await released
		return _answer(post_answers, path, {})

	func get_bytes(path: String) -> Dictionary:
		byte_gets.append(path)
		if hold_bytes:
			await released
		return {"ok": bytes.has(path), "status": 200 if bytes.has(path) else 0, "bytes": bytes.get(path, PackedByteArray())}


## Everything a test mounted under t.root: freed when this suite is released, also after a test that died early (a
## leftover panel would keep polling through the rest of the run).
var _mounted: Array[Node] = []


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for n in _mounted:
			if is_instance_valid(n) and not n.is_queued_for_deletion():
				n.free()


func _mount(panel: Node, api: Fake) -> void:
	panel.set("api", api)
	_mounted.append(panel)
	t.root.add_child(panel)
	await t.process_frame


# ---- C31 ----

func test_status_poll_keeps_one_read_in_flight_and_backs_off() -> void:
	var api := Fake.new()
	api.hold = true
	var tab: Tab = Tab.new()  # not in the tree: no timer, no panels; the poll itself is under test
	tab.api = api
	tab._device = Label.new()
	tab._tabs = TabContainer.new()
	tab._poll()
	tab._poll()
	t.eq(api.gets.size(), 1, "a second tick while the first read waits sends nothing")
	api.hold = false
	api.released.emit()
	t.ok(not tab._polling, "the answer clears the guard")
	await tab._poll()
	t.eq(api.gets.size(), 2, "after one failure the next tick still reads")
	await tab._poll()
	t.eq(api.gets.size(), 2, "after two failures in a row one tick is skipped")
	await tab._poll()
	t.eq(api.gets.size(), 3, "then it reads again")
	await tab._poll()
	await tab._poll()
	t.eq(api.gets.size(), 3, "three failures: two ticks skipped")
	api.answers[BASE + "status"] = {"connected": false}
	await tab._poll()
	t.eq(api.gets.size(), 4, "reads again")
	t.eq(tab._device.text, "PixelHue: not connected", "header line")
	tab._device.free()
	tab._tabs.free()
	tab.free()


# ---- C34 ----

func test_outputs_refresh_keeps_staged_edits_until_discard() -> void:
	var api := Fake.new()
	api.answers[BASE + "outputs"] = TO.new()._state()
	var p: Outputs = Outputs.new()
	await _mount(p, api)
	await p.refresh()
	t.eq(p._pending().size(), 0, "loaded, nothing staged")
	p._drafts[5]["name"] = "Left"
	await p.refresh()
	t.eq(str(p._drafts[5].name), "Left", "a tab change / Refresh keeps the staged name")
	t.eq(api.gets.size(), 1, "and does not re-read the outputs")
	await p.refresh(true)
	t.eq(str(p._drafts[5].name), "OUT 1", "Discard re-reads and drops the edit")
	t.eq(api.gets.size(), 2, "one more read")
	p.queue_free()


# ---- C45 (capacity) ----

func test_capacity_write_cannot_be_queued_twice() -> void:
	var api := Fake.new()
	api.answers[BASE + "outputs"] = TO.new()._state()
	api.post_answers[BASE + "output-capacity"] = TO.new()._state()
	var p: Outputs = Outputs.new()
	var notes: Array = []
	p.status.connect(func(text: String) -> void: notes.append(text))
	await _mount(p, api)
	await p.refresh()
	api.hold_posts = true
	var g := {"slotId": 2.0, "capacity": 1.0}
	p._write_capacity(g, 2)
	p._write_capacity(g, 2)  # a second confirm that was open at the same time
	t.eq(api.posts.size(), 1, "one capacity write")
	t.ok(notes.has(Outputs.CAPACITY_BUSY), "the second one says why nothing happened")
	api.hold_posts = false
	api.released.emit()
	t.ok(not p._capacity_busy, "guard cleared after the answer")
	p.queue_free()


# ---- C37 ----

func test_inputs_read_in_flight_keeps_what_was_typed() -> void:
	var api := Fake.new()
	api.answers[BASE + "inputs"] = {"inputs": [TI.new()._row()]}
	var p: Inputs = Inputs.new()
	await _mount(p, api)
	await p.refresh()
	t.eq(p._pending().size(), 0, "loaded")
	api.hold = true
	p.refresh()
	var d: Dictionary = p._drafts["100:0"]
	d.name = "Cam"
	d.nameTouched = true
	api.hold = false
	api.released.emit()
	t.eq(str(p._drafts["100:0"].name), "Cam", "the name typed while the read ran is still staged")
	t.eq(p._pending().size(), 1, "and still pending")
	p.queue_free()


func _device_state() -> Dictionary:
	return {"node": {"name": "P20"}, "options": {"power": ["restart"]}, "device": {"model": "P20", "serial": "1"}}


func test_device_read_in_flight_keeps_what_was_typed() -> void:
	var api := Fake.new()
	api.answers[BASE + "device"] = _device_state()
	var p: Device = Device.new()
	await _mount(p, api)
	await p.refresh()
	var field := p._name
	t.eq(field.text, "P20", "loaded")
	api.hold = true
	p.refresh()
	field.text = "Stage"
	api.hold = false
	api.released.emit()
	t.ok(p._name == field and field.text == "Stage", "the typed name survives the read (no re-render)")
	await p.refresh()
	t.ok(p._name != field, "an untouched read re-renders as before")
	p.queue_free()


# ---- C38 ----

func test_device_write_during_a_read_waits_instead_of_dropping() -> void:
	var api := Fake.new()
	api.answers[BASE + "device"] = _device_state()
	api.post_answers[BASE + "device-action"] = _device_state()
	var p: Device = Device.new()
	var notes: Array = []
	p.status.connect(func(text: String) -> void: notes.append(text))
	await _mount(p, api)
	api.hold = true
	p.refresh()  # the tab was just opened
	p._send("device-action", DM.restart_action(), "Restarting.")
	t.eq(api.posts.size(), 0, "Restart waits for the read")
	api.hold = false
	api.released.emit()  # the device read answers; self-test and source backup answer at once
	t.eq(api.posts.size(), 1, "then goes out instead of being dropped")
	t.eq(api.posts[0][1], DM.restart_action(), "restart body")
	api.hold_posts = true
	p._send("device-action", DM.restart_action(), "")
	p._send("device-action", DM.restart_action(), "")
	t.eq(api.posts.size(), 2, "a second press while one is sent is not queued blindly")
	t.ok(notes.any(func(n: String) -> bool: return n.begins_with("The previous change is still being sent")), "and says so")
	api.hold_posts = false
	api.released.emit()
	p.queue_free()


func test_refused_backup_write_puts_the_control_back() -> void:
	var api := Fake.new()
	api.fail[BASE + "source-backup"] = "Backup not allowed now."
	var p: Device = Device.new()
	await _mount(p, api)
	p._backup.show_state({"supported": true, "enable": 0})
	var en := _first_option(p._backup)
	en.select(1)  # the operator's pick, before the write answers
	await p._send("source-backup", DM.backup_enable(1), "Source backup on.")
	t.eq(_first_option(p._backup).selected, 0, "back to what the switcher reported")
	p.queue_free()


func _first_option(n: Node) -> OptionButton:
	for c in n.get_children():
		if c.is_queued_for_deletion():
			continue
		if c is OptionButton:
			return c as OptionButton
		var deeper := _first_option(c)
		if deeper != null:
			return deeper
	return null


func test_screens_blackout_during_a_read_waits_instead_of_dropping() -> void:
	var api := Fake.new()
	api.answers[BASE + "screens"] = {"screens": []}
	api.post_answers[BASE + "screens"] = {"screens": []}
	var p: Screens = Screens.new()
	await _mount(p, api)
	api.hold = true
	p.refresh()
	p._command(SM.toggle_body("ftb", 3, 0))
	t.eq(api.posts.size(), 0, "Blackout waits for the read")
	api.hold = false
	api.released.emit()
	t.eq(api.posts.size(), 1, "then goes out")
	t.eq(api.posts[0][1], {"action": "ftb", "id": 3, "enable": 1}, "blackout body")
	t.ok(not p._writing and not p._reading, "flags cleared")
	p.queue_free()


# ---- C43 ----

func test_timing_body_without_polarity() -> void:
	var tm := {"refresh": 50.0, "horizontal": {"active": 1920, "front": 88, "sync": 44, "total": 2640},
		"vertical": {"active": 1080, "front": 4, "sync": 5, "total": 1125}}
	t.eq(A.validate_timing(tm), "", "a valid timing")
	var body := A.timing_body(25, tm)
	t.eq(int(body.timing.horizontal.polarity), 1, "missing polarity = Positive, no error")
	t.eq(int(body.timing.vertical.polarity), 1, "both axes")
