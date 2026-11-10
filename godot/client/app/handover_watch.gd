extends Node
## WO-1029 — the remote operator client's handover (RULES.md "Linked servers" 6, contract rules 2-7). Gathers what
## core/handover_model.gd decides on and executes its answer; nothing is decided here.
## It only exists for a client the operator pointed at ANOTHER machine: on loopback (the on-box client, WO-802) it never
## polls, never probes, never moves (_ready returns before the first timer).
##
## MOVE = RESTART, not an in-place reconnect. Every autoload binds to Config.origin at start (Api, Ws, Store,
## ProjectSync, ProjectUndo, Settings, DevicesTarget, VideoSurfaces/feed) and holds the OLD box's show, undo stack and
## autosave revision: swapping the origin under them could write the first box's show onto the second (the WO-918
## class). The client relaunches itself with `--server=<target> --handover-from=<old> --handover-at=<unix>` — the same
## path as before (connection_menu.gd restart: new process first, then quit) — and starts exactly like `--server=`.
## The only sockets besides the origin's own: a GET /api/cluster of the servers the connected box itself reported.

signal changed  ## decision, cue or return offer changed

const Platform := preload("res://core/platform.gd")
const AuthModel := preload("res://core/auth_model.gd")
const NetUtil := preload("res://core/net_util.gd")
const Model := preload("res://core/handover_model.gd")
const ServerAddress := preload("res://core/server_address_model.gd")
const ConnectionMenu := preload("res://app/connection_menu.gd")

const PROBE_TIMEOUT_S := 3.0
const POLL_EVERY_S := 5  ## the connected box's /api/cluster (learning + health) while all is well

var decision := {"action": "stay", "target": {}, "waiting": false, "cue": ""}
var home := {}  ## {origin, name}: the box this client was handed over from
var moved_at := -1.0
var cue_dismissed := false
var _learned := {"box": {"id": "", "host": ""}, "targets": []}
var _answers := {}
var _http_down := -1.0
var _ws_down := -1.0
var _home_up := false
var _ticks := 0
var _moving := false
var _snoozed := false
var _busy_now := false


func _ready() -> void:
	if Config.demo or Platform.is_local_origin(Config.origin):
		set_process_unhandled_key_input(false)
		return
	var from := str(Config.args.get("handover-from", ""))
	if from != "":
		home = {"origin": from, "name": Platform.host_of(from)}
		moved_at = float(str(Config.args.get("handover-at", "-1")))
	var cfg := ConfigFile.new()
	cfg.load(Config.UI_CFG)
	_learned = Model.load_cfg(cfg, Config.origin)  # contract 2: the list of the last session
	if not Ws.is_open:
		_ws_down = _now()
		_http_down = _now()
	Ws.connected.connect(func() -> void: _ws_down = -1.0)
	Ws.disconnected.connect(func() -> void: _ws_down = _now())
	var timer := Timer.new()
	timer.wait_time = 1.0
	timer.autostart = true
	timer.timeout.connect(_tick)
	add_child(timer)


static func _now() -> float:
	return Time.get_unix_time_from_system()


func _tick() -> void:
	_ticks += 1
	var healthy := Ws.is_open and _http_down < 0.0
	if _ticks % POLL_EVERY_S == 1 or (not healthy and _ticks % 2 == 0):
		_probe_box()
	if home.get("origin", "") != "" and _ticks % POLL_EVERY_S == 3:
		_probe_home()
	if not healthy:
		for t in _learned.targets:
			if _ticks % 2 == 0:
				_probe_target(t)
	_decide()


func _decide() -> void:
	_busy_now = _busy()
	var d := Model.decide({"local": false, "now": _now(), "ws_down_since": _ws_down, "http_down_since": _http_down,
		"box": _learned.box, "targets": _learned.targets, "answers": _answers, "busy": _busy_now,
		"last_move": moved_at, "home": home, "home_up": _home_up})
	if d.action != decision.action or d.cue != decision.cue or d.get("target", {}) != decision.get("target", {}):
		if d.action != "offer":
			_snoozed = false
		decision = d
		changed.emit()
	if d.action == "move" and not _moving:
		_go(d.target.origin, true)


## The operator is mid-drag or a modal dialog is open (contract 7): a move waits for that to end.
func _busy() -> bool:
	if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or get_viewport().gui_is_dragging():
		return true
	for w in get_tree().root.get_children():
		if w is Window and (w as Window).visible and (w as Window).exclusive:
			return true
	return false


func _fetch(origin: String) -> Dictionary:
	var r := HTTPRequest.new()
	r.timeout = PROBE_TIMEOUT_S
	add_child(r)
	var res := {"ok": false, "status": 0, "data": null}
	if r.request(origin + "/api/cluster", AuthModel.with_auth(PackedStringArray(["Accept: application/json"]), AuthModel.password)) == OK:
		var done: Array = await r.request_completed
		res = NetUtil.parse_response(done[0], done[1], done[3])
	r.queue_free()
	return res


func _probe_box() -> void:
	var res := await _fetch(Config.origin)
	if int(res.get("status", 0)) > 0:
		_http_down = -1.0
	elif _http_down < 0.0:
		_http_down = _now()
	if bool(res.get("ok", false)):
		_learn(res.data)


## Keep the connected box's linked servers (what IT reports) fresh and in ui.cfg for the next start.
func _learn(cluster: Variant) -> void:
	var learned := {"box": Model.box_of(cluster, Config.origin), "targets": Model.learn_targets(cluster)}
	if learned == _learned:
		return
	_learned = learned
	var cfg := ConfigFile.new()
	cfg.load(Config.UI_CFG)
	Model.store_cfg(cfg, Config.origin, learned.box, learned.targets)
	cfg.save(Config.UI_CFG)


func _probe_target(t: Dictionary) -> void:
	var res := await _fetch(str(t.origin))
	if int(res.get("status", 0)) <= 0:
		_answers[t.origin] = {"ok": false}
	elif bool(res.get("ok", false)):
		_answers[t.origin] = Model.read_answer(res.data)
	else:
		_answers[t.origin] = {"ok": true, "auth": false}  # up, but wants a password: no confirmation


func _probe_home() -> void:
	var res := await _fetch(str(home.origin))
	_home_up = int(res.get("status", 0)) > 0
	_decide()


## One click / Enter on the offer (contract 3), or the automatic move.
func accept_offer() -> void:
	if decision.action == "offer":
		_go(str(decision.target.origin), true)


func snooze_offer() -> void:
	_snoozed = true
	changed.emit()


func offer_visible() -> bool:
	return decision.action == "offer" and not _snoozed


func dismiss_cue() -> void:
	cue_dismissed = true
	changed.emit()


## "‹old› is back — return?" for the eye menu: {origin, name} or {}.
func return_target() -> Dictionary:
	return decision.target if decision.action == "offer_return" else {}


func go_back() -> void:
	var t := return_target()
	if not t.is_empty():
		_go(str(t.origin), false)


## The header cue text, "" when none (or dismissed).
func cue() -> String:
	if home.is_empty() or cue_dismissed:
		return ""
	return Model.cue_text(Platform.host_of(Config.origin), str(home.name), moved_at)


func _go(target: String, forward: bool) -> void:
	if _moving:
		return
	_moving = true
	var user := OS.get_cmdline_user_args()
	var args := ServerAddress.handover_user_args(user, target, Config.origin, _now()) if forward \
		else ServerAddress.return_user_args(user, target)
	print("[client] WO-1029: %s %s (from %s)" % ["handover to" if forward else "returning to", target, Config.origin])
	ConnectionMenu.restart(self, args, true)


func _unhandled_key_input(e: InputEvent) -> void:
	var k := e as InputEventKey
	if k and k.pressed and not k.echo and k.keycode in [KEY_ENTER, KEY_KP_ENTER] and offer_visible():
		accept_offer()
		get_viewport().set_input_as_handled()
