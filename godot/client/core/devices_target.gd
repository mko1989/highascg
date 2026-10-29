extends Node
## WO-732 P3a — whose devices the Devices tab shows. Owner 24.10: "always the local machine should be at the top".
## WO-802 (owner 29.10: linking is node ↔ node only, a client talks to the node on its own machine): this client is
## always on its home server (core/config.gd), so the Devices tab works on that server through the very same Api /
## Settings / Store as every other tab.
## WO-732 P3b: "Edit" on a linked server's card points the Devices tab at that server (`edit_peer`) — its rear panel,
## cables, destinations and Apply — until "Back". WO-802: those requests go through this client's own server (its
## /api/cluster/peers/:id/relay/…, server cluster-relay.js), never to the other machine. The edit ends by itself when
## this server's snapshot no longer lists that server (unlinked). Box-local features (start-up question, dock,
## Updates, invites) use `box_api` / `box_origin()` and never follow an edit.

signal resolved
signal target_changed  ## WO-732 P3b: the Devices tab now works on a linked server, or is back on this machine

const DTM := preload("res://core/devices_target_model.gd")
const SettingsScript := preload("res://core/settings_state.gd")
const ApiScript := preload("res://core/api.gd")
const Platform := preload("res://core/platform.gd")
const STATE_KEYS := ["channelMap", "configComparison", "hostOperatorFullscreen", "templates"]
const POLL_S := 3.0  # an edited server's WS events do not reach this client: its views are polled instead

var is_resolved := false
var editing := ""  ## WO-732 P3b: origin of the linked server the Devices tab edits, as this server lists it ("" = this machine). For Caspar-side URLs only: never connected to.
var editing_id := ""  ## WO-802: its id in this server's /api/cluster (the relay goes by it)
var editing_name := ""
var ended := ""  ## WO-802: why the last edit ended by itself ("" = it did not)

## Devices requests: the linked server being edited (relayed by this machine's server), else this machine.
var api: ApiScript:
	get:
		return _peer_api if editing != "" else box_api
## This machine's server: the one this client is connected to (WO-802: always its own).
var box_api: ApiScript:
	get:
		return Api
var settings: SettingsScript:
	get:
		return _peer_settings if editing != "" else Settings

var _peer_api: ApiScript
var _peer_settings: SettingsScript
var _peer_state := {}


func _ready() -> void:
	is_resolved = true
	resolved.emit()
	Ws.on("cluster:peers", _on_snap)


func wait() -> void:
	if not is_resolved:
		await resolved


## The origin Caspar-side URLs are built from (host live webpages): the edited server's, else this machine's.
func origin() -> String:
	return editing if editing != "" else box_origin()


func box_origin() -> String:
	return Config.origin


## WO-735: this client runs on a server box and `box_api` reaches that box's own server — the box-local features (the
## start-up question, the dock) work.
func on_box() -> bool:
	return Platform.is_local_origin(box_origin())


## The Devices views of a server whose WS does not reach this client are polled (cluster_panel.gd).
func polled() -> bool:
	return editing != ""


## Store values the Devices tab reads: the connected server's, or the edited server's last /api/state.
func value(key: String, fallback: Variant = null) -> Variant:
	if editing != "":
		return _peer_state.get(key, fallback)
	return Store.get_value(key, fallback)


## Before a Devices load: the edited server's channel map, config comparison and templates, from one /api/state.
func refresh_state() -> void:
	await wait()
	if editing == "":
		return
	var st: Dictionary = await api.get_json("/api/state")
	if st.ok and st.data is Dictionary:
		for k in STATE_KEYS:
			_peer_state[k] = st.data.get(k)


## WO-732 P3b — the Devices tab edits the linked server `peer_id` (as this server lists it) through this server's
## relay; it must answer as HighAsCG there. `peer_origin` only names it for Caspar-side URLs. → "" or why not.
func edit_peer(peer_id: String, peer_name: String, peer_origin := "") -> String:
	var relayed := ApiScript.new()
	relayed.relay_peer = peer_id
	add_child(relayed)
	var r: Dictionary = await relayed.get_json("/api/replication/ping")
	if not (r.ok and r.data is Dictionary and str(r.data.get("appId", "")) == "highascg"):
		relayed.queue_free()
		return "%s does not answer through this server (%s)" % [peer_name, str(r.get("error", "HTTP %d" % int(r.get("status", 0))))]
	stop_editing(false)
	_peer_api = relayed
	_peer_settings = SettingsScript.new()
	_peer_settings.api = relayed
	add_child(_peer_settings)
	_peer_state = {}
	editing = peer_origin if peer_origin != "" else peer_id
	editing_id = peer_id
	editing_name = peer_name
	ended = ""
	print("[devices] editing %s (%s) through this server" % [peer_name, peer_id])
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
	editing_id = ""
	editing_name = ""
	if emit:
		target_changed.emit()


## WO-802: this server's snapshot no longer lists the edited server (unlinked here or there) → back to this machine,
## and say so.
func _on_snap(d: Variant) -> void:
	if editing_id == "" or not d is Dictionary or DTM.still_linked(d, editing_id):
		return
	ended = "%s is no longer linked: back to this machine" % editing_name
	print("[devices] ", ended)
	stop_editing()
