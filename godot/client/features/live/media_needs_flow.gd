extends Node
## WO-1029 plan 07 C10 — the shared media library's live side: reads GET /api/cluster/media-needs from THIS node (never
## from another machine), owns the small "Spread (N)" button at the bottom of the Sources browser, and runs
## plan -> confirm -> POST /api/cluster/media-spread (202) -> `cluster:media` WS progress -> status fallback, the same
## shape as apply_flow.gd. Pure decisions live in media_needs_model.gd. An older node (404) = the feature is absent:
## no markers, no button, no further calls. No linked server = no polling at all (only a cluster change re-reads).

const M := preload("res://features/live/media_needs_model.gd")
const POLL_S := 15.0
const FOLLOW_S := 1.5
const MAX_RUN_S := 3600.0


## Look cards / rows listen here (a static so the deck needs no reference to the Sources panel).
class Bus extends RefCounted:
	signal changed

static var bus := Bus.new()
static var current: Node = null

var needs: Variant = null  # last good answer; null = none / feature absent
var absent := false  # the node answered 404: no such route
var running := false
var line_cb := Callable()  # (text, tip) -> the Sources status line
var button: Button
var _fetching := false
var _states := {}
var _tips := {}
var _confirm: ConfirmationDialog
var _timer: Timer
var _quiet := 0.0
var _done: Dictionary = {}
var _run_id := ""


func _ready() -> void:
	current = self
	button = Button.new()
	button.visible = false
	button.pressed.connect(press)
	_confirm = ConfirmationDialog.new()
	_confirm.title = "Spread media"
	_confirm.ok_button_text = "Copy"
	add_child(_confirm)
	_timer = Timer.new()
	_timer.wait_time = POLL_S
	_timer.timeout.connect(func() -> void: if _host_visible() and M.linked(needs) and not running: refresh())
	add_child(_timer)
	_timer.start()
	var edited := Timer.new()  # a look edit (a layer dragged in from the shared list) changes who needs what
	edited.one_shot = true
	edited.wait_time = 3.0
	edited.timeout.connect(func() -> void: if M.linked(needs) and not running: refresh())
	add_child(edited)
	Store.project_changed.connect(func(_p: Dictionary) -> void: if M.linked(needs): edited.start())
	Ws.on("cluster:peers", func(_d: Variant) -> void: refresh())
	Ws.on("cluster:media", _on_event)
	Ws.connected.connect(refresh)
	var host := get_parent() as Control
	if host != null:
		host.visibility_changed.connect(func() -> void: if host.is_visible_in_tree() and M.linked(needs): refresh())
	refresh.call_deferred()


## The flow lives in the Media tab (its visibility gates the poll); its button goes first in the bottom row.
static func attach(host: Control, row: Container, line: Callable):
	var f := new()
	f.line_cb = line
	host.add_child(f)
	row.add_child(f.button)
	row.move_child(f.button, 0)
	return f


func _exit_tree() -> void:
	if current == self:
		current = null


func _host_visible() -> bool:
	var h := get_parent() as Control
	return h != null and h.is_visible_in_tree()


## Row states / look tips, rebuilt once per answer.
func states() -> Dictionary:
	return _states


func refresh(fresh := false) -> void:
	if _fetching or absent:
		return
	_fetching = true
	var r: Dictionary = await Api.get_json("/api/cluster/media-needs" + ("?refresh=1" if fresh else ""))
	_fetching = false
	if r.get("ok") == true and r.get("data") is Dictionary:
		needs = r.data
	elif int(r.get("status", 0)) == 404:
		absent = true
		needs = null
	else:
		return  # a hiccup keeps what we knew
	_apply()


func _apply() -> void:
	_states = M.states(needs)
	_tips = M.look_tips(needs)
	var b := M.button(needs, running)
	button.visible = b.visible
	button.text = b.text
	button.disabled = b.disabled
	button.tooltip_text = b.tip
	bus.changed.emit()


## The library rows only other servers have (empty without links).
func remote_rows(have: Array) -> Array:
	return M.remote_rows(needs, have)


## {text, amber, tip} for a media id, or {} when the row has nothing to say.
func mark(id: String) -> Dictionary:
	var s: Variant = _states.get(M.key(id))
	if not (s is Dictionary) or ((s as Dictionary).text == "" and (s as Dictionary).tip == ""):
		return {}
	return s


func look_tip(scene: Dictionary) -> String:
	return str(_tips.get(str(scene.get("name", "")), _tips.get(str(scene.get("id", "")), "")))


## A take answer's line: the old missingMedia warning plus, when the server knows, which box lacks which clip.
static func take_line(data: Variant, base: String) -> String:
	var mm := M.take_notice(data, current.needs if current != null else null)
	return " · ".join([base, mm].filter(func(s: String) -> bool: return s != ""))


func press() -> void:
	if running:
		return
	await refresh(true)  # ask every server now: the confirm shows what is true
	var b := M.button(needs)
	if b.disabled:
		return
	_confirm.dialog_text = M.confirm_text(needs)
	if _confirm.confirmed.is_connected(_go):
		_confirm.confirmed.disconnect(_go)
	_confirm.confirmed.connect(_go, CONNECT_ONE_SHOT)
	_confirm.popup_centered()


func _say(text: String, tip := "") -> void:
	if line_cb.is_valid():
		line_cb.call(text, tip)


func _go() -> void:
	var ids: Array = M.plan(needs).map(func(i: Dictionary) -> String: return i.id)
	running = true
	_apply()
	_say("Spreading media…")
	var r: Dictionary = await Api.post_json("/api/cluster/media-spread", {"files": ids})
	var o := M.start_outcome(int(r.get("status", 0)), r.get("data"))
	if o.how == "refused":
		running = false
		_apply()
		_say("✗ Spread refused: %s" % str(r.get("error", o.get("error", ""))))
		return
	if o.how == "attached":
		_say("A spread is already running — following it…")
	await _follow(o.run_id)


## Wait for the `done` event or, after a quiet spell, for the status route to say the run is over.
func _follow(run_id: String) -> void:
	_run_id = run_id
	_done = {}
	_quiet = 0.0
	var waited := 0.0
	while _done.is_empty() and waited < MAX_RUN_S and is_inside_tree():
		await get_tree().create_timer(FOLLOW_S).timeout
		waited += FOLLOW_S
		_quiet += FOLLOW_S
		if _quiet >= FOLLOW_S * 2:
			_quiet = 0.0
			var st: Dictionary = await Api.get_json("/api/cluster/media-spread/status")
			if st.get("ok") == true:
				if M.is_running(st.data):
					_say(M.progress_line(st.data, needs))
				else:
					_done = st.data if st.data is Dictionary else {"run": {}}
	running = false
	if _done.is_empty():
		_apply()
		_say("Spread: no answer from the node — check the servers")
		return
	await _finish()


func _finish() -> void:
	var st: Dictionary = await Api.get_json("/api/cluster/media-spread/status")  # the event carries no file list we rely on
	var answer: Variant = st.data if st.get("ok") == true and M.run_of(st.data).size() > 0 else _done
	var res := M.result(answer, needs)
	_say(res.text, res.tip)
	absent = false
	await refresh(true)


func _on_event(d: Variant) -> void:
	if not running or not d is Dictionary:
		return
	_quiet = 0.0
	if M.finishes(d):
		_done = d
		return
	var line := M.event_line(d, needs)
	if line != "":
		_say(line)
