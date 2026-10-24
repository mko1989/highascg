extends Node
## WO-732 P3a — whose devices the Devices tab shows. Owner 24.10: "always the local machine should be at the top".
## A client running on a server box that follows another server (the master, WO-670 P3b) still shows and edits THIS
## machine's rear panel, cables and settings: its requests go straight to the box's own server (the home origin),
## and the linked servers, the master among them, are listed under it. Every other client (the box's own kiosk when
## it is home, a laptop) works on the connected server through the very same Api / Settings / Store as before.
## WO-732 P3b: "Edit" on a linked server's card points the Devices tab at that server (`edit_peer`) — its rear panel,
## cables, destinations and Apply — until "Back". Box-local features (start-up question, dock, Updates, invites) use
## `box_api` / `box_origin()` and never follow it.

signal resolved
signal target_changed  ## WO-732 P3b: the Devices tab now works on a linked server, or is back on this machine

const DTM := preload("res://core/devices_target_model.gd")
const SettingsScript := preload("res://core/settings_state.gd")
const ApiScript := preload("res://core/api.gd")
const Platform := preload("res://core/platform.gd")
const STATE_KEYS := ["channelMap", "configComparison", "hostOperatorFullscreen", "templates"]
const POLL_S := 3.0  # the home server's WS events do not reach this client: its views are polled instead
const BOOT_WAIT_S := 90.0  # WO-735: at boot this client can start before the box's server listens (WO-696)

var remote := false  # true = the Devices tab works on this machine, not on the connected server
var is_resolved := false
var home := ""
var editing := ""  ## WO-732 P3b: origin of the linked server the Devices tab edits ("" = this machine)
var editing_name := ""

## Devices requests: the linked server being edited, else this machine (`box_api`).
var api: ApiScript:
	get:
		return _peer_api if editing != "" else box_api
## This machine's server. Held until the target is decided, so an early request never lands on the wrong server.
var box_api: ApiScript:
	get:
		return Api if is_resolved and not remote else _api
var settings: SettingsScript:
	get:
		return _peer_settings if editing != "" else _settings if remote else Settings

var _api: ApiScript
var _settings: SettingsScript
var _state := {}
var _peer_api: ApiScript
var _peer_settings: SettingsScript
var _peer_state := {}


func _ready() -> void:
	_api = ApiScript.new()
	_api.held = true
	add_child(_api)
	_resolve()


func _resolve() -> void:
	var h := Config.home_origin()
	var answers := false
	if DTM.pick(Config.origin, h, true) != "":
		var probe := ApiScript.new()
		probe.origin_override = h
		add_child(probe)
		var r: Dictionary = await probe.get_json("/api/replication/ping")
		var waited := 0.0
		while int(r.get("status", 0)) == 0 and waited < BOOT_WAIT_S:
			await get_tree().create_timer(2.0).timeout
			waited += 2.0
			r = await probe.get_json("/api/replication/ping")
		probe.queue_free()
		answers = r.ok and r.data is Dictionary and str(r.data.get("appId", "")) == "highascg"
	home = DTM.pick(Config.origin, h, answers)
	remote = home != ""
	if remote:
		_api.origin_override = home
		_settings = SettingsScript.new()
		_settings.api = _api
		add_child(_settings)
		print("[devices] this client follows %s: the Devices tab works on this machine (%s)" % [Config.origin, home])
	is_resolved = true
	_api.open()
	resolved.emit()


func wait() -> void:
	if not is_resolved:
		await resolved


## The origin Caspar-side URLs are built from (host live webpages): the edited server's, else this machine's.
func origin() -> String:
	return editing if editing != "" else box_origin()


func box_origin() -> String:
	return home if remote else Config.origin


## WO-735: this client runs on a server box and `box_api` reaches that box's own server — the box-local features (the
## start-up question, the dock) work, also while the client follows another server.
func on_box() -> bool:
	return Platform.is_local_origin(box_origin())


## The Devices views of a server whose WS does not reach this client are polled (cluster_panel.gd).
func polled() -> bool:
	return remote or editing != ""


## Store values the Devices tab reads: the connected server's, or the target's last /api/state.
func value(key: String, fallback: Variant = null) -> Variant:
	if editing != "":
		return _peer_state.get(key, fallback)
	if not remote:
		return Store.get_value(key, fallback)
	return _state.get(key, fallback)


## Before a Devices load: the target's channel map, config comparison and templates, from one /api/state.
func refresh_state() -> void:
	await wait()
	if editing == "" and not remote:
		return
	var st: Dictionary = await api.get_json("/api/state")
	if st.ok and st.data is Dictionary:
		for k in STATE_KEYS:
			(_peer_state if editing != "" else _state)[k] = st.data.get(k)


## WO-732 P3b — the Devices tab edits the linked server at `peer_origin` (it must answer as HighAsCG from this client).
## → "" or why not.
func edit_peer(peer_origin: String, peer_name: String) -> String:
	var probe := ApiScript.new()
	probe.origin_override = peer_origin
	add_child(probe)
	var r: Dictionary = await probe.get_json("/api/replication/ping")
	if not (r.ok and r.data is Dictionary and str(r.data.get("appId", "")) == "highascg"):
		probe.queue_free()
		return "%s does not answer at %s from this client" % [peer_name, peer_origin]
	stop_editing(false)
	_peer_api = probe
	_peer_settings = SettingsScript.new()
	_peer_settings.api = probe
	add_child(_peer_settings)
	_peer_state = {}
	editing = peer_origin
	editing_name = peer_name
	print("[devices] editing %s (%s)" % [peer_name, peer_origin])
	target_changed.emit()
	return ""


## Back to this machine.
func stop_editing(emit := true) -> void:
	if editing == "":
		return
	for n in [_peer_api, _peer_settings]:
		if is_instance_valid(n):
			n.queue_free()
	_peer_api = null
	_peer_settings = null
	editing = ""
	editing_name = ""
	if emit:
		target_changed.emit()
