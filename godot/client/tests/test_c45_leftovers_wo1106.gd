extends RefCounted
## WO-1106 C45 leftovers against the shared fake HTTP client (tests/test_pixelhue_panels_wo1106.gd `Fake`; nothing
## reaches a server): a refused "Looks drive the switcher" puts the tick back and says why, and a fresh media-needs read
## (Spread / Send confirm) waits for a poll in flight instead of being dropped. (The remote-file folder drop:
## tests/test_media_ops.gd.) The scripts name autoloads, so they are loaded after the runner's first frame.

const P := preload("res://tests/test_pixelhue_panels_wo1106.gd")
var t
var _mounted: Array[Node] = []


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for n in _mounted:
			if is_instance_valid(n) and not n.is_queued_for_deletion():
				n.free()


func test_refused_drive_switch_puts_the_tick_back() -> void:
	await t.process_frame
	var api := P.Fake.new()
	api.answers["/api/pixelhue/config"] = {"host": "10.0.0.9", "drive": false}
	var panel: VBoxContainer = load("res://features/devices/pixelhue_panel.gd").new()
	panel.target_api = func() -> Object: return api
	_mounted.append(panel)
	t.root.add_child(panel)
	await t.process_frame
	await t.process_frame
	var boxes := panel.find_children("*", "CheckBox", true, false)
	t.eq(boxes.size(), 1, "the drive switch")
	if boxes.size() != 1:
		return
	var drive: CheckBox = boxes[0]
	t.eq(drive.button_pressed, false, "off, as the server keeps it")
	api.fail["/api/pixelhue/config"] = "pixelhue.json is read-only"
	drive.button_pressed = true  # the operator ticks it
	await t.process_frame
	t.eq(api.posts.size(), 1, "asked the server once")
	t.eq([drive.button_pressed, panel._drive], [false, false], "refused: the tick goes back")
	t.ok(panel._status.text.contains("refused it: pixelhue.json is read-only") and panel._status.text.contains("still only reads"),
		"and says why: " + panel._status.text)
	api.fail.clear()
	api.post_answers["/api/pixelhue/config"] = {"host": "10.0.0.9", "drive": true}
	drive.button_pressed = true
	await t.process_frame
	t.eq([drive.button_pressed, panel._drive], [true, true], "accepted: ticked")
	panel.free()


func test_fresh_needs_read_waits_for_the_poll_in_flight() -> void:
	await t.process_frame
	var api := P.Fake.new()
	api.answers["/api/cluster/media-needs"] = {"rev": "old"}
	api.answers["/api/cluster/media-needs?refresh=1"] = {"rev": "fresh"}
	var flow: Node = load("res://features/live/media_needs_flow.gd").new()  # not in the tree: no poll timer, no WS
	flow.api = api
	flow.button = Button.new()
	api.hold = true
	flow.refresh()  # the 15 s poll, in flight
	var done := [false]
	var confirm := func() -> void:
		await flow.refresh(true)  # what press() / send() do before the confirm
		done[0] = true
	confirm.call()
	t.eq([api.gets.size(), done[0]], [1, false], "the fresh read waits for the one in flight")
	api.hold = false
	api.released.emit()
	await t.process_frame
	t.eq(api.gets, ["/api/cluster/media-needs", "/api/cluster/media-needs?refresh=1"], "then asks every server again")
	t.eq([done[0], flow.needs.get("rev")], [true, "fresh"], "the confirm sees the fresh answer, not the poll's")
	flow.refresh()
	flow.refresh()
	t.eq(api.gets.size(), 4, "polls one after another still read")
	flow.button.free()
	flow.free()
