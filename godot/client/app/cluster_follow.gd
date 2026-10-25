extends Node
## WO-670 P3b — this client follows the cluster's master (owner: "clients hold the whole peer list and reconnect to
## the new master by themselves"). Pure rules in core/cluster_follow_model.gd; the origin it follows is ui.cfg
## [cluster] origin (core/config.gd), the switch is a client restart like the A/B one (app/connection_menu.gd).
## - Its server says another server is master (`cluster:peers`, e.g. after a failover or Make master there): a dialog
##   counts down COUNTDOWN_S and reconnects; "Stay here" keeps this server until the next master change.
## - It followed a master away from home and that server leaves the cluster (unlinked, or home no longer linked to
##   it, WO-726): the same dialog counts down and takes it home.
## - Its server is gone for DOWN_MS: every PROBE_S it asks the remembered servers (GET /api/cluster/master) and
##   reconnects to the one that is master, or back home when no master answers (no countdown: nothing is left here).
## Off with Devices → Servers → "This client follows the master".

const F := preload("res://core/cluster_follow_model.gd")
const ConnectionMenu := preload("res://app/connection_menu.gd")

const COUNTDOWN_S := 5
const DOWN_MS := 8000
const PROBE_S := 3.0
const PROBE_TIMEOUT_S := 2.0

var _stay_epoch := -1  # "Stay here" for this epoch
var _down_since := 0
var _probing := false
var _dialog: ConfirmationDialog
var _left := 0
var _target := ""
var _target_name := ""
var _target_home := false  # WO-726: the countdown goes home (the follow is over), not to a master
var _stay_home := false


func _ready() -> void:
	if F.on_box(Config.home_origin()):  # owner 25.10: an on-box client stays on its own server
		if Config.cluster().origin != "":
			Config.save_cluster({"origin": ""})
		return
	_down_since =0 if Ws.is_open else Time.get_ticks_msec()  # a server that never answers counts as gone too
	Ws.on("cluster:peers", _on_snap)
	Ws.connected.connect(func() -> void:
		_down_since = 0
		_fetch())
	Ws.disconnected.connect(func() -> void:
		if _down_since == 0:
			_down_since = Time.get_ticks_msec())
	var t := Timer.new()
	t.wait_time = PROBE_S
	t.timeout.connect(_on_probe_tick)
	add_child(t)
	t.start()
	var cd := Timer.new()
	cd.wait_time = 1.0
	cd.timeout.connect(_on_countdown)
	add_child(cd)
	cd.start()
	_dialog = ConfirmationDialog.new()
	_dialog.title = "Master changed"
	_dialog.ok_button_text = "Reconnect now"
	_dialog.cancel_button_text = "Stay here"
	_dialog.confirmed.connect(func() -> void: _follow(_target))
	_dialog.canceled.connect(func() -> void:
		_stay_home = _stay_home or _target_home
		_target = "")
	add_child(_dialog)
	_fetch()


func _fetch() -> void:
	var r: Dictionary = await Api.get_json("/api/cluster")
	if r.ok and r.data is Dictionary:
		_on_snap(r.data)


func _on_snap(d: Variant) -> void:
	if not d is Dictionary:
		return
	var servers := F.servers(Config.origin, d)
	if servers.size() > 1:
		Config.save_cluster({"servers": servers})
	if not Config.cluster().follow:
		return
	var home := Config.home_origin()
	if Config.cluster().origin != "" and F.follow_over(d, Config.origin, home, IP.get_local_addresses()):
		if not _stay_home and not _dialog.visible:
			_countdown(home, "", true)
		return
	var target := F.master_origin(Config.origin, d)
	var epoch := int(d.get("master", {}).get("epoch", 0)) if d.get("master") is Dictionary else 0
	if target == "" or epoch == _stay_epoch or _dialog.visible:
		return
	_stay_epoch = epoch
	_countdown(target, F.master_name(d), false)


func _countdown(target: String, who: String, home: bool) -> void:
	_target = target
	_target_name = who
	_target_home = home
	_dialog.title = "Back to this server" if home else "Master changed"
	_left = COUNTDOWN_S
	_update_text()
	_dialog.popup_centered()


func _on_countdown() -> void:
	if not _dialog.visible or _target == "":
		return
	_left -= 1
	if _left <= 0:
		_dialog.hide()
		_follow(_target)
	else:
		_update_text()


func _update_text() -> void:
	if _target_home:
		_dialog.dialog_text = "The server this client followed is no longer linked to its own.\nBack to %s in %d s." % [_target, _left]
		return
	_dialog.dialog_text = "%s is now the master.\nThis client reconnects to it in %d s (%s)." % [_target_name, _left, _target]


func _on_probe_tick() -> void:
	if Ws.is_open or _down_since == 0 or _probing or not Config.cluster().follow:
		return
	if Time.get_ticks_msec() - _down_since < DOWN_MS:
		return
	_probing = true
	var home := Config.home_origin()
	var probes := []
	var asked := PackedStringArray()
	for o in Config.cluster().servers + PackedStringArray([home]):
		if o != Config.origin and not asked.has(o):
			asked.append(o)
			probes.append(await _probe(o))
	_probing = false
	var pick := F.pick(probes, home)
	if pick != "" and not Ws.is_open:
		_switch(pick)


func _probe(origin: String) -> Dictionary:
	var r := HTTPRequest.new()
	r.timeout = PROBE_TIMEOUT_S
	add_child(r)
	var out := {"origin": origin, "ok": false, "data": null}
	if r.request(origin + "/api/cluster/master", PackedStringArray(["Accept: application/json"])) == OK:
		var res: Array = await r.request_completed
		if res[0] == HTTPRequest.RESULT_SUCCESS and int(res[1]) == 200:
			out.ok = true
			out.data = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	r.queue_free()
	return out


## Only to a server that says it is master itself (two servers naming each other would bounce the client).
func _follow(origin: String) -> void:
	var p := await _probe(origin)
	if _target_home:
		if p.ok:
			print("[cluster] the follow is over (unlinked): back to ", origin)
			_switch(origin)
		else:
			print("[cluster] not going back to ", origin, ": it does not answer")
		return
	if p.ok and p.data is Dictionary and p.data.get("is_master") == true:
		_switch(origin)
	else:
		print("[cluster] not following ", origin, ": it does not say it is master")


func _switch(to: String) -> void:
	var origin := F.resolve_target(to, Config.home_origin(), IP.get_local_addresses())
	if origin == "" or origin == Config.origin:
		return
	if OS.get_environment("HIGHASCG_SERVER") != "":
		print("[cluster] HIGHASCG_SERVER is set: not following the master to ", origin)
		return
	print("[cluster] following the master: ", Config.origin, " → ", origin)
	Config.save_cluster({"origin": "" if origin == Config.home_origin() else origin})
	ConnectionMenu.restart(self)
