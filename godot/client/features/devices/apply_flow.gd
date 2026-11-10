extends Node
## WO-1029 — the one "Apply Caspar config (restart)" path. Owner 10.11: the button restarts Caspar on every linked server
## that needs it (never one that does not), and what was on the screens comes back. This client only talks to its OWN
## node (RULES.md "Linked servers"): GET /api/cluster/apply-plan to learn which servers are dirty, POST /api/cluster/apply
## to apply them (the node relays node to node), `cluster:apply` WS events for progress. It does not matter whether the
## Devices tab edits this server or a linked one: the plan and the apply are the same. An older node (404 on the plan)
## keeps today's behaviour: POST /api/caspar-config/apply to whatever server the tab edits (legacy()).
## Attached by devices_follow.gd attach(); the plan feeds the button's dirty colour (polled lightly while the tab is
## visible, re-read after any cable / setting write — cable_gesture.gd emits `changed` / `reload_requested`).

const M := preload("res://features/devices/apply_plan_model.gd")
const ApiScript := preload("res://core/api_timeouts.gd")
const POLL_S := 10.0
const QUIET_S := 4.0  # no WS event for this long: ask GET /api/cluster/apply/status
const MAX_RUN_S := 600.0
const WRITE_DELAY_S := 1.0  # the server records "restart needed" a moment after the write answers

var plan: Variant = null  # last good answer; null = none yet
var legacy_node := false  # the node answered 404: no cluster route
var _g: Node
var _bar: Node
var _set_sticky: Callable
var _confirm: ConfirmationDialog
var _poll: Timer
var _after: Timer
var _fetching := false
var _was_dirty := false
var _running := false
var _run_id := ""
var _done: Dictionary = {}
var _quiet := 0.0


func setup(gesture: Node, bar: Node, set_sticky: Callable) -> void:
	_g = gesture
	_bar = bar
	_set_sticky = set_sticky
	bar.apply_pressed.connect(press)
	_confirm = ConfirmationDialog.new()
	_confirm.title = "Apply Caspar config"
	_confirm.ok_button_text = "Restart"
	add_child(_confirm)
	_poll = Timer.new()
	_poll.wait_time = POLL_S
	_poll.timeout.connect(func() -> void: if _host_visible() and not _running: refresh_plan())
	add_child(_poll)
	_poll.start()
	_after = Timer.new()
	_after.one_shot = true
	_after.wait_time = WRITE_DELAY_S
	_after.timeout.connect(func() -> void: refresh_plan())
	add_child(_after)
	gesture.reload_requested.connect(func() -> void: if not _running: _after.start())
	gesture.changed.connect(_on_gesture_changed)
	var host := get_parent() as Control
	if host != null:
		host.visibility_changed.connect(func() -> void: if host.is_visible_in_tree(): refresh_plan())
	Ws.on("cluster:apply", _on_event)
	DevicesTarget.target_changed.connect(func() -> void: refresh_plan())
	refresh_plan.call_deferred()


func _host_visible() -> bool:
	var h := get_parent() as Control
	return h != null and h.is_visible_in_tree()


func _on_gesture_changed() -> void:
	if _g.restart_dirty and not _was_dirty and not _running:
		_after.start()  # a cable / setting write marked the plan stale
	_was_dirty = _g.restart_dirty


## Re-read the plan from THIS node and repaint the button.
func refresh_plan() -> void:
	if _fetching:
		return
	_fetching = true
	var r: Dictionary = await DevicesTarget.box_api.get_json("/api/cluster/apply-plan")
	_fetching = false
	if r.get("ok") == true:
		legacy_node = false
		plan = r.get("data")
	elif int(r.get("status", 0)) == 404:
		legacy_node = true
		plan = null
	_bar.plan = plan
	_bar.sync(_g)
	if plan is Dictionary and plan.get("running") == true and not _running:  # another client (or a reconnect): follow that run
		_begin()
		_g.status.emit("An apply is running — following it…", true)
		_follow("", plan)


func press() -> void:
	if _g.busy or _running:
		return
	await refresh_plan()
	if _running:  # the plan showed a run already going: we are following it
		return
	if legacy_node or M.servers(plan).is_empty():
		await _g.apply_caspar()  # older node (or no answer): the single-server apply, as before
		return
	var todo := M.ids_to_apply(plan)
	_confirm.dialog_text = M.confirm_text(plan) if not todo.is_empty() else M.anyway_text(plan)
	if _confirm.confirmed.is_connected(_go):
		_confirm.confirmed.disconnect(_go)
	_confirm.confirmed.connect(_go.bind(todo), CONNECT_ONE_SHOT)
	_confirm.popup_centered()


func _go(todo: Array) -> void:
	# Named servers are applied even when clean; nothing dirty = "restart this server anyway" (the node's 'self' alias).
	var body := {"servers": todo if not todo.is_empty() else ["self"], "wait": false}
	_begin()
	var before: Variant = plan
	_g.status.emit("Applying Caspar config — restarting Caspar…", true)
	# wait:false — with two servers a waited answer can pass our 120 s; progress comes over WS, status is the fallback.
	var r: Dictionary = await DevicesTarget.box_api.post_json("/api/cluster/apply", body)
	var f := M.run_to_follow(int(r.get("status", 0)), r.get("data"))
	if f.how == "" and r.get("ok") == true:  # a node that ignored wait:false and answered the finished run
		_finish(r.get("data"), before)
		return
	if f.how == "":
		_end()
		_g.status.emit(str(r.get("error", "")) if str(r.get("error", "")) != "" else "HTTP %d" % int(r.get("status", 0)), false)
		refresh_plan()
		return
	if f.how == "attached":
		_g.status.emit("An apply is already running — following it…", true)
	await _follow(str(f.run_id), before)


## Watch a run until its `done` event or, after a quiet spell, until GET /api/cluster/apply/status says it finished.
func _follow(run_id: String, before: Variant) -> void:
	_run_id = run_id
	_done = {}
	_quiet = 0.0
	var waited := 0.0
	while _done.is_empty() and waited < MAX_RUN_S:
		await get_tree().create_timer(1.0).timeout
		waited += 1.0
		_quiet += 1.0
		if _quiet >= QUIET_S:
			_quiet = 0.0
			var st: Dictionary = await DevicesTarget.box_api.get_json("/api/cluster/apply/status")
			if st.get("ok") == true:
				var run := M.finished_run(st.get("data"), _run_id)
				if not run.is_empty():
					_done = run
	if _done.is_empty():
		_end()
		_g.status.emit("Apply: no answer from the node after %d min — check the servers" % (MAX_RUN_S / 60), false)
		return
	_finish(_done, before)


func _begin() -> void:
	_running = true
	_g.applying = true
	_g.cluster_progress = true
	_g._set_busy(true)


func _end() -> void:
	_running = false
	_g.applying = false
	_g.cluster_progress = false
	_g._set_busy(false)


func _finish(answer: Variant, before: Variant) -> void:
	_end()
	var res := M.result(answer, before)
	_set_sticky.call(true)
	_g.set_dirty(false)
	_bar.set_status(res.summary, res.ok, res.warn, res.detail)
	for row in M.servers(answer):
		_g.applied.emit(row)  # devices_follow.gd turns layoutOk == false amber
	refresh_plan()


func _on_event(d: Variant) -> void:
	if not _running or not d is Dictionary:
		return
	if _run_id != "" and str(d.get("run_id", "")) != _run_id:
		return
	_quiet = 0.0
	if M.finishes(d, _run_id):
		_done = d
		return
	var line := M.progress_line(d, plan)
	if line != "":
		_g.status.emit(line, true)


## The pre-WO-1029 single-server apply (Apply always restarts Caspar — WO-440 force; WO-805: its own long timeout).
## Moved here from cable_gesture.gd (500-line limit); `g` is that node.
static func legacy(g: Node) -> void:
	if g.busy:
		return
	g.applying = true
	g._set_busy(true)
	g.status.emit("Applying Caspar config — restarting Caspar…", true)
	var r: Dictionary = await DevicesTarget.api.post_json("/api/caspar-config/apply", {"force": true}, ApiScript.APPLY_TIMEOUT_S)
	g.applying = false
	g._set_busy(false)
	if not r.ok:
		var e := str(r.get("error", ""))
		g.status.emit(e if e != "" else "HTTP %d" % int(r.get("status", 0)), false)
		return
	g.set_dirty(false)
	var data: Dictionary = r.data if r.get("data") is Dictionary else {}
	var msg := str(data.get("message", ""))
	msg = msg if msg != "" else "Caspar config applied"
	var back := M.restored_or_reason(data.get("restored"), data.get("restored_reason"))  # WO-1029: the single-box answer gained it
	g.status.emit(msg + ("; " + back if back != "" else ""), true)
	g.applied.emit(data)
