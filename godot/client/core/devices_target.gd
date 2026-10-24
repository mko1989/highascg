extends Node
## WO-732 P3a — whose devices the Devices tab shows. Owner 24.10: "always the local machine should be at the top".
## A client running on a server box that follows another server (the master, WO-670 P3b) still shows and edits THIS
## machine's rear panel, cables and settings: its requests go straight to the box's own server (the home origin),
## and the linked servers, the master among them, are listed under it. Every other client (the box's own kiosk when
## it is home, a laptop) works on the connected server through the very same Api / Settings / Store as before.

signal resolved

const DTM := preload("res://core/devices_target_model.gd")
const SettingsScript := preload("res://core/settings_state.gd")
const ApiScript := preload("res://core/api.gd")
const STATE_KEYS := ["channelMap", "configComparison", "hostOperatorFullscreen", "templates"]
const POLL_S := 3.0  # the home server's WS events do not reach this client: its views are polled instead

var remote := false  # true = the Devices tab works on this machine, not on the connected server
var is_resolved := false
var home := ""

## Held until the target is decided, so an early request never lands on the wrong server.
var api: ApiScript:
	get:
		return Api if is_resolved and not remote else _api
var settings: SettingsScript:
	get:
		return _settings if remote else Settings

var _api: ApiScript
var _settings: SettingsScript
var _state := {}


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


## The origin Caspar-side URLs are built from (host live webpages).
func origin() -> String:
	return home if remote else Config.origin


## Store values the Devices tab reads: the connected server's, or this machine's last /api/state.
func value(key: String, fallback: Variant = null) -> Variant:
	if not remote:
		return Store.get_value(key, fallback)
	return _state.get(key, fallback)


## Before a Devices load: this machine's channel map, config comparison and templates, from one /api/state.
func refresh_state() -> void:
	await wait()
	if not remote:
		return
	var st: Dictionary = await _api.get_json("/api/state")
	if st.ok and st.data is Dictionary:
		for k in STATE_KEYS:
			_state[k] = st.data.get(k)
