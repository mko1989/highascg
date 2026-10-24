extends RefCounted
## WO-605 slice 7 — the Caspar server page's request sequences (web device-view-inspector-caspar.js and
## -replication-controls.js), over an injected `io` so the page controller and the golden replay share them:
##   io.get_json(path) / io.post_json(path, body) → {ok, data, error}   io.confirm(text) → bool
##   io.reload()  (re-read settings + device view)   io.dirty()  (Caspar restart-dirty)
##   io.status(text, ok)   io.toast(text, type)   io.changed()  (state changed → re-render)
## The web's error paths show e.message; a failed request's `error` is the same "HTTP <code>: <detail>" text.
## Not ported: the header badge's own replication poll (replication-ui-state.js, WO-608) and Factory reset (needs
## the default-project builder New Project uses — WO-608).

const M := preload("res://features/devices/server_page_model.gd")
const F := preload("res://features/devices/replication_format.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const R := preload("res://features/devices/cable_rules.gd")

## sessionStorage 'highascg.replication.inspectorMode': the operator's mode pick survives page rebuilds.
static var session_intent := ""

var s: Dictionary
var io: Variant
var clock: Callable = func() -> float: return Time.get_unix_time_from_system() * 1000.0


func _init(settings: Variant, payload: Variant, io_: Variant, intent := session_intent) -> void:
	io = io_
	s = M.init_state(settings, payload, intent)


func _remember() -> void:
	session_intent = s.intent


func _fail(r: Dictionary, toast := true) -> void:
	io.status(str(r.error), false)
	if toast:
		io.toast(str(r.error), "error")


static func _data(r: Dictionary) -> Dictionary:
	return r.data if r.data is Dictionary else {}


## Page open: status (then the quiet leader scan a remembered follower intent asks for) and network.
func start() -> void:
	await refresh_status()
	if s.intent == "follower" and not H.truthy(R.d(s.rep).get("enabled")):
		await scan(true)
	await refresh_network()
	await refresh_cluster()


func refresh_status() -> void:
	var r: Dictionary = await io.get_json("/api/replication/status")
	if not r.ok or not r.data is Dictionary:
		s.rep_line = "Replication unavailable: " + str(r.error)
	else:
		M.apply_status(s, r.data, clock.call())
		_remember()
	io.changed()


func refresh_network() -> void:
	var r: Dictionary = await io.get_json("/api/system/network")
	if r.ok and r.data is Dictionary:
		M.apply_network(s, r.data)
	else:
		s.net_text = "Network status unavailable: " + str(r.error)
	io.changed()


## WO-739: whether this server links a server asking for it at once (GET /api/cluster self.auto_accept).
func refresh_cluster() -> void:
	var r: Dictionary = await io.get_json("/api/cluster")
	var me: Variant = _data(r).get("self")
	s.auto_accept = me.get("auto_accept") == true if r.ok and me is Dictionary else null
	io.changed()


func set_auto_accept(on: bool) -> void:
	s.auto_accept = on
	var r: Dictionary = await io.post_json("/api/cluster/auto-accept", {"on": on})
	if not r.ok:
		s.auto_accept = not on
		_fail(r)
		return
	io.status("Invites from other servers are %s" % ("linked at once" if on else "accepted in Devices → Servers"), true)


func save_fps() -> void:
	var fps: float = F._pf(s.fps) if F._pf(s.fps) != null else NAN
	var r: Dictionary = await io.post_json("/api/settings", {"machineProfile": {"defaultProjectFps": fps}})
	if not r.ok:
		_fail(r, false)
		return
	io.dirty()
	io.status("Project frame rate saved (%s fps)" % O.js(fps), true)
	await io.reload()


func set_cef(on: bool) -> void:
	s.cef = on
	var r: Dictionary = await io.post_json("/api/settings", {"operatorTools": {"cefEnableGpu": on}})
	if not r.ok:
		s.cef = not on
		_fail(r, false)
		io.changed()
		return
	io.dirty()
	io.status("CEF GPU %s — apply Caspar config + restart to take effect" % ("enabled" if on else "disabled"), true)


func apply_network() -> void:
	var plan := M.network_body(s)
	if plan.has("error"):
		io.status(plan.error, false)
		return
	var r: Dictionary = await io.post_json("/api/system/network/apply", plan.body)
	if not r.ok:
		_fail(r, false)
		return
	io.status(F.t(O.or_([_data(r).get("log"), "Network applied"])), true)
	await refresh_network()
	await io.reload()


## Scan for leaders; false on failure (callers carry on, like the web's swallowed rethrow).
func scan(quiet: bool) -> bool:
	var r: Dictionary = await io.get_json("/api/replication/leaders")
	if not r.ok:
		if not quiet:
			_fail(r)
		return false
	var n := M.apply_leaders(s, r.data)
	if not quiet:
		io.status("Found %d leader(s)" % n, true)
		io.toast("Found %d leader(s)" % n if n > 0 else "No leaders on subnet", "success" if n > 0 else "warn")
	io.changed()
	return true


func on_mode(mode: String) -> void:
	s.mode = mode
	s.intent = mode
	s.synced = true
	_remember()
	io.changed()
	if mode != "follower":
		return
	await scan(false)
	var st := R.d(s.rep)
	if H.truthy(st.get("leaderAvailable")) and not H.truthy(st.get("enabled")):
		var r: Dictionary = await io.post_json("/api/replication/stop-leader", {})
		if not r.ok:
			io.toast(str(r.error), "error")
			return
		io.toast("Leader availability stopped — pick a leader and connect", "info")
		await refresh_status()


func become_leader() -> void:
	var r: Dictionary = await io.post_json("/api/replication/become-leader", {})
	if not r.ok:
		_fail(r)
		return
	io.status("This server is now available as leader", true)
	io.toast("Leader available for followers", "success")
	await refresh_status()
	await io.reload()


func stop_leader() -> void:
	var r: Dictionary = await io.post_json("/api/replication/stop-leader", {})
	if not r.ok:
		_fail(r)
		return
	io.status("Leader availability stopped", true)
	io.toast("Leader availability stopped", "info")
	await refresh_status()


func connect_leader() -> void:
	var raw := M.leader_value(s)
	if raw == "":
		io.status("Select a leader first (Scan for leaders)", false)
		io.toast("Select a leader first", "warn")
		return
	var parts := raw.split(":")
	io.toast("Connecting to leader…", "info")
	var r: Dictionary = await io.post_json("/api/replication/connect", {"leaderHost": parts[0],
		"leaderPort": O.int_or(parts[1] if parts.size() > 1 else null, 4200)})
	if not r.ok:
		_fail(r)
		return
	var out := _data(r)
	var ok := H.truthy(out.get("ok"))
	var syncing := H.truthy(out.get("syncing"))
	var err := F.t(O.or_([out.get("error"), "Connect failed"]))
	io.status(("Connected as follower — syncing project from leader…" if syncing else "Connected as follower — project + media syncing") if ok else err, ok)
	io.toast(("Connected — sync in progress" if syncing else "Connected as follower") if ok else err, "success" if ok else "error")
	await refresh_status()
	await io.reload()


func disconnect_peer() -> void:
	if not await io.confirm(M.DISCONNECT_CONFIRM):
		return
	var r: Dictionary = await io.post_json("/api/replication/disconnect", {})
	if not r.ok:
		_fail(r)
		return
	s.intent = "standalone"
	_remember()
	io.status("Standalone — local playout continues", true)
	io.toast("Disconnected — standalone playout", "warn")
	await refresh_status()


func refresh_connection() -> void:
	if not H.truthy(R.d(s.rep).get("enabled")):
		io.toast("Not paired — connect to a leader first", "warn")
		return
	io.toast("Refreshing replication connection…", "info")
	var r: Dictionary = await io.post_json("/api/replication/refresh-connection", {})
	if not r.ok:
		_fail(r)
		return
	var out := _data(r)
	var ok := H.truthy(out.get("ok"))
	if H.truthy(out.get("status")) and out.status is Dictionary:
		M.apply_reply_status(s, out.status, clock.call())
		io.changed()
	else:
		await refresh_status()
	var ping_ok := H.truthy(out.get("pingOk"))
	var msg := ("Connection refreshed" if ping_ok else "Reloaded transports; peer ping failed: " + F.t(O.or_([out.get("pingError"), "unknown"]))) \
		if ok else F.t(O.or_([out.get("error"), "Refresh failed"]))
	io.status(msg, ok and not (out.get("pingOk") is bool and not out.pingOk))
	io.toast(msg, ("success" if ping_ok else "warn") if ok else "error")
	if ok:
		await io.reload()


func apply_caspar() -> void:
	io.toast("Applying Device View setup and regenerating Caspar…", "info")
	var r: Dictionary = await io.post_json("/api/replication/apply-device-view-caspar", {})
	if not r.ok:
		_fail(r)
		return
	var out := _data(r)
	var parity := R.d(out.get("parity"))
	var ok: bool = H.truthy(out.get("ok")) and not (parity.get("ok") is bool and not parity.ok) \
		and not (parity.get("regenerateOk") is bool and not parity.regenerateOk)
	var first := R.d(R.a(parity.get("mismatches")).front() if not R.a(parity.get("mismatches")).is_empty() else null)
	var msg := "Caspar channels now match leader" if H.truthy(parity.get("ok")) else \
		("Still short %s channel(s) — check Device View destinations" % F.t(parity.get("missingCount")) if H.truthy(parity.get("followerNeedsMoreChannels"))
		else F.t(O.or_([parity.get("regenerateError"), first.get("message"), "Regenerate finished — review parity"])))
	io.status(msg, ok)
	io.toast(msg, "success" if ok else "warn")
	await refresh_status()
	await io.reload()
