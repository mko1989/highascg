extends RefCounted
## WO-1106 (4.4) — client plumbing against fakes: the operator's server-address pick drops the handover args (C32), the
## cabled-channels switch writes to the server whose state it shows and re-reads when the edited server changes (C33),
## the Live tab's PixelHue layer list keeps one read in flight and slows down when the switcher is gone (C35), a failed
## "Apply edited config" (or showing the pane again) keeps the hand-edited text (C36), handover probes keep one request
## in flight per origin (C44).

const SA := preload("res://core/server_address_model.gd")
const Flow := preload("res://features/devices/channels_cabled_flow.gd")
const CM := preload("res://features/devices/channels_cabled_model.gd")
const Layers := preload("res://features/live/pixelhue_layers_list.gd")
const Pane := preload("res://app/config_pane.gd")
const Watch := preload("res://app/handover_watch.gd")
const P := preload("res://tests/test_pixelhue_panels_wo1106.gd")
var t
## Everything a test mounted under t.root: freed when this suite is released, also after a test that died early.
var _mounted: Array[Node] = []


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for n in _mounted:
			if is_instance_valid(n) and not n.is_queued_for_deletion():
				n.free()


func _mount(n: Node) -> void:
	_mounted.append(n)
	t.root.add_child(n)


# ---- C32 ----

func test_address_pick_drops_the_handover_args() -> void:
	var args := PackedStringArray(["--fullscreen", "--server=http://10.0.0.7:4200", "--handover-from=http://10.0.0.5:4200",
		"--handover-at=1700000000", "--tab=2"])
	t.eq(SA.address_user_args(args), PackedStringArray(["--fullscreen", "--tab=2"]), "the saved address wins")
	t.eq(SA.restart_user_args(args), args, "a plain restart of a handed-over client still keeps them (unchanged)")


# ---- C33 ----

func test_cabled_switch_reads_and_writes_the_same_server() -> void:
	var here := P.Fake.new()
	here.answers[CM.endpoint()] = {"on": false}
	var peer := P.Fake.new()
	peer.answers[CM.endpoint()] = {"on": true}
	var target: Array = [here]
	var f: Flow = Flow.new()
	f.target_api = func() -> Object: return target[0]
	_mount(f)
	await t.process_frame
	t.ok(not f._box.button_pressed and not f._box.disabled, "shows this server's state")
	target[0] = peer  # Devices "Edit" of a linked server (DevicesTarget.target_changed → _load)
	await f._load()
	t.ok(f._box.button_pressed, "re-read: shows the edited server's state")
	await f._toggled(false)
	t.eq(peer.posts.size(), 1, "the dry run goes to the server shown")
	t.eq(here.posts.size(), 0, "never to the other one")
	await f._apply(here, true, false)  # a confirm opened before the switch to the peer
	t.eq(here.posts.size(), 0, "a stale confirm writes nothing")
	t.ok(f._status.text.begins_with("Not switched"), "and says so")
	f.queue_free()


# ---- C35 ----

func test_layers_list_one_read_in_flight_and_slow_after_failures() -> void:
	var api := P.Fake.new()
	api.hold = true
	var parent := VBoxContainer.new()
	_mount(parent)
	var l: Layers = Layers.new()
	l.api = api
	parent.add_child(l)
	l.reload()
	await t.process_frame  # the deferred first reload finds one in flight
	l.reload()
	t.eq(api.gets.size(), 1, "one read in flight")
	api.hold = false
	api.released.emit()
	await l.reload()
	await l.reload()
	t.eq(api.gets.size(), 3, "three failures in a row")
	for _i in Layers.SLOW_EVERY - 1:
		await l.reload()
	t.eq(api.gets.size(), 3, "then the 3 s ticks skip")
	await l.reload()
	t.eq(api.gets.size(), 4, "every SLOW_EVERY-th tick still reads (the list comes back with the switcher)")
	t.ok(not l.visible, "no list while it does not answer")
	parent.queue_free()


# ---- C36 ----

func _config_api() -> P.Fake:
	var api := P.Fake.new()
	api.answers["/api/caspar-config/current"] = {"exists": true, "xml": "<configuration/>", "path": "/x/casparcg.config"}
	api.bytes["/api/caspar-config/generate"] = "<configuration/>".to_utf8_buffer()
	api.answers["/api/caspar-config/dirty"] = {"dirty": false}
	api.answers["/api/caspar-config/override"] = {"override": ""}
	api.answers["/api/cluster/apply-plan"] = {"servers": [{"self": true, "name": "box"}]}
	return api


func test_failed_apply_keeps_the_edited_config() -> void:
	var api := _config_api()
	api.fail["/api/caspar-config/apply"] = "Caspar refused the file"
	var p: Pane = Pane.new()
	p.api = api
	await p.load_all()
	p._edit.button_pressed = true
	p._text.text = "<configuration><paths/></configuration>"
	t.ok(p.has_unsaved(), "hand edit")
	await p._send()
	t.ok(p._result.text.begins_with("FAILED"), "the failure is shown")
	t.eq(p._text.text, "<configuration><paths/></configuration>", "the text is kept to fix and resend")
	t.ok(p._edit.button_pressed and p.has_unsaved(), "still in edit mode")
	await p.load_all()  # the pane toggled off and on again
	t.eq(p._text.text, "<configuration><paths/></configuration>", "showing the pane again keeps it too")
	api.fail.erase("/api/caspar-config/apply")
	api.post_answers["/api/caspar-config/apply"] = {"ok": true, "restartSent": true}
	api.answers["/api/caspar-config/current"] = {"exists": true, "xml": "<configuration><paths/></configuration>", "path": "/x/casparcg.config"}
	await p._send()
	t.ok(not p._edit.button_pressed, "after a successful Apply the editor shows the file again")
	t.eq(p._text.text, "<configuration><paths/></configuration>", "the file now on disk")
	p.free()


# ---- C44 ----

class Fetcher:
	extends RefCounted
	signal released
	var hold := true
	var calls: Array = []

	func fetch_cluster(origin: String) -> Dictionary:
		calls.append(origin)
		if hold:
			await released
		return {"ok": false, "status": 0, "data": null}


func test_handover_probe_one_in_flight_per_origin() -> void:
	var f := Fetcher.new()
	var w: Watch = Watch.new()  # not in the tree: no timer; the probes themselves are under test
	w.fetcher = f
	w._probe_target({"origin": "http://a:4200"})
	w._probe_target({"origin": "http://a:4200"})  # the next 2 s tick while the first still waits
	w._probe_target({"origin": "http://b:4200"})
	t.eq(f.calls, ["http://a:4200", "http://b:4200"], "one probe per origin in flight")
	f.hold = false
	f.released.emit()
	t.eq(w._answers.get("http://a:4200"), {"ok": false}, "the answer is recorded")
	t.ok(w._inflight.is_empty(), "nothing left in flight")
	await w._probe_target({"origin": "http://a:4200"})
	t.eq(f.calls.size(), 3, "the next tick probes again")
	w.free()
