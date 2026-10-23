extends RefCounted
## WO-605 slice 7 — the Caspar server page (web device-view-inspector-caspar.js + -replication.js / -controls.js):
## page state, the visible item list the web renders (title, host table, project frame rate, CEF GPU, network,
## hot backup) and the hot-backup mode / leader-select sync rules. Pure; server_flow.gd runs the requests.
## State `s` keeps what the web keeps in its DOM: the status line, pair line, connection-panel status and
## wiring note are only rewritten by the paths that rewrite them (Refresh connection's reply skips some).

const F := preload("res://features/devices/replication_format.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const R := preload("res://features/devices/cable_rules.gd")

const STANDARD_FPS := [23.98, 24.0, 25.0, 29.97, 30.0, 50.0, 59.94, 60.0]
const MODES := [["standalone", "Standalone"], ["leader", "Leader (available for followers)"], ["follower", "Follower"]]
const CEF_TEXT := "Enable GPU in CEF templates (WebGL / Shader FX)"
const CEF_HINT := "Needed for shader templates on the CG path. Takes effect on Caspar config apply + restart. Turn off if other channels stutter or tear."
const FPS_HINT := "Output video modes inherit this rate until you change them per connector."
const WIRING_NOTE := "Screen destinations sync from the leader (channel ids must match). Wiring, cables, and Caspar consumers stay local — cable outputs on this box after connect, then Regenerate Caspar from Device View."
const NO_LEADERS := "(no leaders found — scan again or use Become leader on primary box)"
const SCAN_FIRST := "(scan for leaders, then connect)"
const DISCONNECT_CONFIRM := "Disconnect hot backup and return to standalone? Each machine keeps playing locally."
const BUTTONS := ["Scan for leaders", "Become leader", "Stop offering as leader", "Connect to leader", "Disconnect (standalone)",
	"Apply Device View → Caspar"]


## project-fps.js normalizeProjectFps: the nearest standard rate, 50 for garbage.
static func normalize_fps(v: Variant) -> float:
	var n: Variant = F._pf(F.t(v))
	if n == null or n <= 0:
		return 50.0
	var best := 50.0
	var diff := INF
	for f in STANDARD_FPS:
		if absf(f - n) < diff:
			diff = absf(f - n)
			best = f
	return best


static func resolve_project_fps(settings: Variant) -> float:
	var fps: Variant = R.d(R.d(settings).get("machineProfile")).get("defaultProjectFps")
	if fps != null:
		return normalize_fps(fps)
	var list := R.a(R.d(R.d(settings).get("channelMap")).get("programResolutions"))
	var pr := R.d(list[0] if not list.is_empty() else null)
	if F._num(pr, "fps") > 0:
		return normalize_fps(pr.fps)
	return 50.0


static func init_state(settings: Variant, payload: Variant, intent: String) -> Dictionary:
	var fps := resolve_project_fps(settings)
	var sel := O.js(STANDARD_FPS[0])
	for f in STANDARD_FPS:
		if absf(f - fps) < 0.06:
			sel = O.js(f)
			break
	var net := R.d(R.d(settings).get("network"))
	var st := R.d(net.get("static"))
	var dns := R.a(st.get("dns"))
	return {"settings": R.d(settings), "payload": R.d(payload), "fps": sel,
		"cef": O.is_true(R.d(R.d(settings).get("operatorTools")).get("cefEnableGpu")),
		"net_text": "Loading…", "iface_opts": [], "iface": "", "net_mode": "dhcp", "ip": F.t(O.or_([st.get("address"), ""])),
		"prefix": F.t(H.coalesce([st.get("prefixLength"), 24])), "gateway": F.t(O.or_([st.get("gateway"), ""])),
		"dns": F.t(O.or_([dns[0] if not dns.is_empty() else null, ""])),
		"rep": null, "rep_line": "Loading replication status…", "pair": "", "conn": null, "out_warn": "", "wiring": false,
		"mode": intent if intent in ["standalone", "leader", "follower"] else "standalone", "intent": intent,
		"leader_opts": [], "leader": "", "synced": false}


# ---------------------------------------------------------------- network

## refreshNetwork's success path.
static func apply_network(s: Dictionary, net: Dictionary) -> void:
	var cfg := R.d(s.settings.get("network"))
	var opts := []
	var sel := ""
	var ifaces := R.a(net.get("interfaces"))
	if ifaces.is_empty():
		opts.append(["", "(no Ethernet found)"])
	var primary: Variant = O.or_([net.get("primaryInterface"), cfg.get("primaryInterface")])
	for i in ifaces:
		var d := R.d(i)
		opts.append([F.t(d.get("name")), F.t(d.get("name")) + (" — %s" % F.t(d.address) if H.truthy(d.get("address")) else "")])
		if sel == "" and F.t(d.get("name")) == F.t(primary):
			sel = F.t(d.get("name"))
	s.iface_opts = opts
	s.iface = sel if sel != "" else opts[0][0]
	var active := R.d(net.get("active"))
	s.net_text = "Current: %s · %s · %s · config: %s" % [F.t(O.or_([active.get("address"), "no IPv4"])),
		F.t(O.or_([net.get("appliedMode"), "unknown"])), F.t(O.or_([active.get("operstate"), "link?"])),
		F.t(O.or_([net.get("source"), "default"]))] if H.truthy(net.get("active")) else "No active Ethernet interface detected"
	var applied := str(net.get("appliedMode"))
	s.net_mode = applied if applied in ["static", "dhcp"] else ("static" if str(cfg.get("mode")) == "static" else "dhcp")


## Apply network: {error} or the POST body.
static func network_body(s: Dictionary) -> Dictionary:
	if s.iface == "":
		return {"error": "Select an Ethernet interface"}
	var dns: String = s.dns.strip_edges()
	return {"body": {"interface": s.iface, "mode": s.net_mode, "static": {"address": s.ip.strip_edges(),
		"prefixLength": O.int_or(s.prefix, 24), "gateway": s.gateway.strip_edges(), "dns": [dns] if dns != "" else []}}}


# ---------------------------------------------------------------- hot backup state

## refreshStatus's success path (everything the poll rewrites; the line's ages freeze until the next poll).
static func apply_status(s: Dictionary, st: Dictionary, now: float) -> void:
	s.rep = st
	s.rep_line = F.status_line(st, now)
	s.pair = F.pair_line(st)
	s.conn = st
	s.wiring = H.truthy(st.get("enabled"))
	_sync_mode(s, st)
	_sync_leader(s, st)
	s.out_warn = F.output_warnings(st)
	s.synced = true


## Refresh connection's reply status: the web skips the pair line, wiring note and mode sync.
static func apply_reply_status(s: Dictionary, st: Dictionary, now: float) -> void:
	s.rep = st
	s.rep_line = F.status_line(st, now)
	s.conn = st
	_sync_leader(s, st)
	s.out_warn = F.output_warnings(st)
	s.synced = true


static func _sync_mode(s: Dictionary, st: Dictionary) -> void:
	if H.truthy(st.get("enabled")):
		var f: bool = str(st.get("configuredRole")) == "follower" or str(st.get("role")) == "follower"
		s.mode = "follower" if f else "leader"
		s.intent = s.mode
		return
	if s.intent in ["follower", "leader"]:
		s.mode = s.intent
		return
	s.mode = "leader" if H.truthy(st.get("leaderAvailable")) else "standalone"
	if s.mode == "standalone":
		s.intent = "standalone"


static func _sync_leader(s: Dictionary, st: Dictionary) -> void:
	var peer := R.d(st.get("peer"))
	if H.truthy(st.get("enabled")) and (str(st.get("role")) == "follower" or str(st.get("configuredRole")) == "follower") and H.truthy(peer.get("host")):
		var port: int = O.int_or(O.or_([peer.get("port"), 4200]), 4200)
		var value := "%s:%d" % [F.t(peer.host), port]
		s.leader_opts = [[value, "%s (%s) — connected" % [F.t(O.or_([st.get("peerHostname"), st.get("peerSelfId"), peer.host])), value]]]
		s.leader = value
		return
	if s.leader_opts.is_empty():
		s.leader_opts = [["", SCAN_FIRST]]


## The scan's list ({leaders: [...]}).
static func apply_leaders(s: Dictionary, res: Variant) -> int:
	var leaders := R.a(R.d(res).get("leaders"))
	var opts := [] if not leaders.is_empty() else [["", NO_LEADERS]]
	for l in leaders:
		var d := R.d(l)
		opts.append(["%s:%s" % [F.t(d.get("host")), F.t(O.or_([d.get("port"), 4200]))],
			"%s (%s)" % [F.t(O.or_([d.get("hostname"), d.get("host")])), F.t(O.or_([d.get("selfId"), d.get("host")]))]])
	s.leader_opts = opts
	s.leader = opts[0][0]
	return leaders.size()


static func leader_value(s: Dictionary) -> String:
	for o in s.leader_opts:
		if o[0] == s.leader:
			return s.leader
	return s.leader_opts[0][0] if not s.leader_opts.is_empty() else ""


## syncModeUi: which of BUTTONS show (all of them until the first sync, like the freshly built DOM).
static func buttons(s: Dictionary) -> Array:
	if not s.synced:
		return BUTTONS.duplicate()
	var st := R.d(s.rep)
	var enabled := H.truthy(st.get("enabled"))
	var out := ["Scan for leaders"]
	if s.mode == "leader" and not enabled:
		out.append("Become leader")
	if H.truthy(st.get("leaderAvailable")) and not enabled:
		out.append("Stop offering as leader")
	if s.mode == "follower" and not enabled:
		out.append("Connect to leader")
	if enabled:
		out.append("Disconnect (standalone)")
	if str(st.get("role")) == "follower" or (s.mode == "follower" and enabled):
		out.append("Apply Device View → Caspar")
	return out


# ---------------------------------------------------------------- items

## `network_panel`: the client draws the WO-692 Network panel (every NIC + Wi-Fi) in place of the web's one-interface
## block; the golden replay of the web page keeps the default.
static func items(s: Dictionary, now: float, network_panel := false) -> Array:
	var live := R.d(s.payload.get("live"))
	var host := R.d(live.get("host"))
	var caspar := R.d(live.get("caspar"))
	var out := [{"t": "title", "text": "Server"}, {"t": "table", "rows": [
		["Hostname", F.t(O.or_([host.get("hostname"), "-"]))], ["Hardware ID", F.t(O.or_([host.get("hardwareId"), "-"]))],
		["Platform", F.t(O.or_([host.get("platform"), "-"]))], ["AMCP", "connected" if H.truthy(caspar.get("connected")) else "disconnected"],
		["Host", F.t(O.or_([caspar.get("host"), R.d(s.settings.get("caspar")).get("host"), "-"]))]]},
		{"t": "heading", "text": "Project"}, {"t": "caption", "text": "Default project frame rate"},
		{"t": "select", "key": "fps", "value": s.fps, "options": STANDARD_FPS.map(func(f: float) -> Array: return [O.js(f), O.js(f) + " fps"]), "disabled": false},
		{"t": "small", "text": FPS_HINT}, {"t": "button", "text": "Save project frame rate", "disabled": false},
		{"t": "heading", "text": "Templates (CEF)"}, {"t": "check", "key": "cef", "text": CEF_TEXT, "checked": s.cef, "disabled": false},
		{"t": "small", "text": CEF_HINT}]
	if network_panel:
		out.append({"t": "network"})
	else:
		out.append_array([{"t": "heading", "text": "Network"}, {"t": "small", "text": s.net_text},
			{"t": "caption", "text": "Ethernet interface"},
			{"t": "select", "key": "iface", "value": s.iface, "options": s.iface_opts, "disabled": false},
			{"t": "radio", "key": "net_dhcp", "text": "Auto (DHCP)", "checked": s.net_mode == "dhcp", "disabled": false},
			{"t": "radio", "key": "net_static", "text": "Manual (static)", "checked": s.net_mode == "static", "disabled": false}])
		if s.net_mode == "static":
			for f in [["IPv4 address", "ip"], ["Prefix length", "prefix"], ["Gateway", "gateway"], ["DNS", "dns"]]:
				out.append({"t": "caption", "text": f[0]})
				out.append({"t": "input", "key": f[1], "value": s[f[1]]})
		out.append({"t": "button", "text": "Apply network", "disabled": false})
	out.append({"t": "heading", "text": "Hot backup"})
	out.append({"t": "small", "text": s.rep_line})
	if s.pair != "":
		out.append({"t": "small", "text": s.pair})
	out.append_array(connection_items(s.conn, now))
	if s.out_warn != "":
		out.append({"t": "small", "text": s.out_warn})
	if s.wiring:
		out.append({"t": "small", "text": WIRING_NOTE})
	out.append({"t": "caption", "text": "Mode"})
	out.append({"t": "select", "key": "mode", "value": s.mode, "options": MODES, "disabled": false})
	if s.synced and s.mode == "follower":  # the leader picker starts hidden; syncModeUi shows it
		out.append({"t": "caption", "text": "Leader server"})
		out.append({"t": "select", "key": "leader", "value": leader_value(s), "options": s.leader_opts, "disabled": false})
	for b in buttons(s):
		out.append({"t": "button", "text": b, "disabled": false})
	return out


## syncConnectionPanel (shown while paired with a peer host).
static func connection_items(st: Variant, now: float) -> Array:
	var s := R.d(st)
	if not (H.truthy(s.get("enabled")) and H.truthy(R.d(s.get("peer")).get("host"))):
		return []
	var role := F.t(O.or_([s.get("role"), "standalone"]))
	var peer_role := F.t(O.or_([R.d(s.get("peerBox")).get("role"), "follower" if role == "leader" else "leader"]))
	var peer_label := "Leader" if peer_role == "leader" else ("Follower" if peer_role == "follower" else "Peer")
	var cp := R.d(s.get("channelParity"))
	var parity_ok: bool = H.truthy(cp.get("ok")) and not (cp.get("configHashMatch") is bool and not cp.configHashMatch)
	var out := [{"t": "summary", "text": "Connection — %s ↔ %s" % [role, peer_label]},
		{"t": "small", "text": F.channel_parity(cp), "tone": "ok" if parity_ok else "warn"}]
	var caspar: Variant = s.get("casparParity")
	var ctext := F.caspar_parity(caspar, role)
	if ctext != "":
		out.append({"t": "small", "text": ctext, "tone": "ok" if H.truthy(R.d(caspar).get("ok")) else "warn"})
	out.append({"t": "button", "text": "Refresh connection", "disabled": false})
	out.append({"t": "table", "rows": F.local_rows(s.get("local"), s)})
	out.append({"t": "table", "rows": F.peer_rows(O.or_([s.get("peerBox"), s.get("follower")]), s, peer_label, now)})
	out.append({"t": "table", "rows": F.transport_rows(s)})
	var w := _warnings(s, cp, caspar, role)
	if not w.is_empty():
		out.append({"t": "small", "text": " ".join(w)})
	return out


static func _warnings(s: Dictionary, cp: Dictionary, caspar: Variant, role: String) -> Array:
	var w := []
	var c := R.d(caspar)
	if H.truthy(cp.get("peerAvailable")) and not H.truthy(cp.get("ok")):
		w.append(F.channel_parity(cp))
	if H.truthy(caspar) and not H.truthy(c.get("skipped")) and not H.truthy(c.get("ok")):
		w.append(F.caspar_parity(caspar, role))
		if H.truthy(c.get("fixHint")) and role == "follower":
			w.append(F.t(c.fixHint))
	if H.truthy(c.get("regenerateAttempted")) and not H.truthy(c.get("regenerateOk")):
		w.append("Caspar regenerate failed: " + F.t(O.or_([c.get("regenerateError"), "unknown error"])))
	if cp.get("configHashMatch") is bool and not cp.configHashMatch:
		w.append("Replication config hash differs from peer — review pairing and saved settings.")
	var ph := R.d(s.get("playheadSync"))
	var mism := R.a(ph.get("fpsMismatch"))
	if not mism.is_empty():
		w.append("Channel fps mismatch: " + ", ".join(mism.map(func(m: Variant) -> String: return "ch" + F.t(R.d(m).get("channel")))))
	if absf(float(H.coalesce([ph.get("driftMs"), 0]))) >= 500:
		w.append("Playhead drift %s — check Caspar load and video modes." % F.drift_ms(ph.driftMs))
	var fan := R.d(s.get("amcpFanout"))
	if H.truthy(fan.get("active")) and not H.truthy(fan.get("connected")):
		w.append("AMCP fan-out disconnected — backup may not receive live takes.")
	var ws := R.d(R.d(s.get("connection")).get("peerLiveWs"))
	if str(ws.get("direction")) == "outbound" and not H.truthy(ws.get("connected")):
		w.append("Live-state WebSocket disconnected — mirror may be stale after restart.")
	if H.truthy(s.get("peerHttpReachable")) and not H.truthy(s.get("peerLinkReady")):
		w.append("Peer HTTP ok but live-state WebSocket not connected — mirror may be stale.")
	elif not H.truthy(H.coalesce([s.get("peerLinkReady"), s.get("peerReachable")])):
		w.append("Peer link not ready%s — use Refresh connection after restarts." % (" (%s)" % F.t(s.peerPingError) if H.truthy(s.get("peerPingError")) else ""))
	return w
