extends RefCounted
## WO-605 slice 7 — hot backup formatters and inspector table rows (web device-view-inspector-replication-shared.js
## + lib/hot-backup-project.js). Pure; `now` = Date.now() in ms (the tests pin it). Statuses are the server's
## GET /api/replication/status JSON, so every number arrives as a float and absent keys must stay distinct from null
## where the web compares `undefined` (see _num).

const O := preload("res://features/devices/output_ports_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const R := preload("res://features/devices/cable_rules.gd")


## JS numeric coercion of d[k] for comparisons: absent → NaN (undefined), null → 0, numbers as is.
static func _num(d: Variant, k: String) -> float:
	if not d is Dictionary or not d.has(k):
		return NAN
	var v: Variant = d[k]
	if v == null:
		return 0.0
	if v is bool:
		return 1.0 if v else 0.0
	if v is int or v is float:
		return float(v)
	var s := str(v).strip_edges()
	return 0.0 if s == "" else (s.to_float() if s.is_valid_float() else NAN)


## Number.isFinite(v) — numbers only, no coercion.
static func _finite(v: Variant) -> bool:
	return (v is int or v is float) and is_finite(float(v))


## JS parseFloat / parseInt prefix (null for NaN).
static func _pf(s: String) -> Variant:
	var m := RegEx.create_from_string("^\\s*[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?").search(s)
	return m.get_string(0).strip_edges().to_float() if m else null


## `${v}` for a value the web prints straight into a template (null → "null", whole floats without ".0").
static func t(v: Variant) -> String:
	return "null" if v == null else O.js(v)


## `a ?? b ?? '—'` printed.
static func _qq(values: Array) -> String:
	return t(H.coalesce(values + ["—"]))


## `a || b || '—'` printed.
static func _or(values: Array) -> String:
	return t(O.or_(values + ["—"]))


static func _round(x: float) -> int:
	return int(floor(x + 0.5))


static func caspar_fps(fr: Variant) -> String:
	if not H.truthy(fr):
		return "—"
	var s := str(t(fr)).strip_edges()
	var slash := s.find("/")
	if slash > 0:
		var num: Variant = H.js_int(s.substr(0, slash))
		var den: Variant = H.js_int(s.substr(slash + 1))
		if num != null and den != null and den > 0:
			var fps := float(num) / float(den)
			return "%s fps" % (O.js(fps) if fps == floorf(fps) else "%.3f" % fps)
	var n: Variant = _pf(s)
	return "%s fps" % O.js(n) if n != null else s


static func age_ms(ms: Variant) -> String:
	if not _finite(ms):
		return "—"
	var f := float(ms)
	if f < 2000:
		return "just now"
	if f < 60000:
		return "%ds ago" % _round(f / 1000.0)
	return "%dm ago" % _round(f / 60000.0)


static func drift_ms(ms: Variant) -> String:
	if not _finite(ms):
		return "—"
	return "%s%s ms" % ["+" if float(ms) > 0 else "", O.js(ms)]


static func channel_parity(cp: Variant) -> String:
	var c := R.d(cp)
	if not H.truthy(c.get("peerAvailable")):
		return "Channel plan: peer not reached yet"
	if H.truthy(c.get("ok")):
		return "Channel plan matches"
	var parts := R.a(c.get("mismatches")).map(func(m: Variant) -> String:
		var d := R.d(m)
		return "%s: %s ≠ %s" % [t(d.get("label")), t(d.get("local")), t(d.get("peer"))])
	return "Channel plan mismatch — " + "; ".join(parts)


static func caspar_parity(cp: Variant, role: String) -> String:
	var c := R.d(cp)
	if cp == null or H.truthy(c.get("skipped")):
		return ""
	if H.truthy(c.get("ok")):
		return "Running Caspar: %s channels match (leader ↔ %s)" % [t(c.get("leaderChannelCount")), "backup" if role == "leader" else "this box"]
	if H.truthy(c.get("followerNeedsMoreChannels")):
		return "Running Caspar: backup needs %s more channel(s) (%s on backup vs %s on leader) — load Device View setup and regenerate" % [
			t(c.get("missingCount")), t(c.get("followerChannelCount")), t(c.get("leaderChannelCount"))]
	var msgs := R.a(c.get("mismatches")).map(func(m: Variant) -> Variant: return R.d(m).get("message")).filter(func(m: Variant) -> bool: return H.truthy(m))
	return "Running Caspar: " + "; ".join(msgs.map(func(m: Variant) -> String: return t(m))) if not msgs.is_empty() else "Running Caspar: mismatch vs leader"


## formatStatus — the one-line summary under "Hot backup".
static func status_line(st: Variant, now: float) -> String:
	if st == null:
		return "Replication unavailable"
	var s: Dictionary = st
	var parts := ["Role: %s" % t(O.or_([s.get("role"), "standalone"]))]
	if H.truthy(s.get("leaderAvailable")) and not H.truthy(s.get("enabled")):
		parts.append("accepting followers")
	if H.truthy(s.get("enabled")):
		var peer := R.d(s.get("peer"))
		parts.append("paired → %s" % t(O.or_([s.get("peerSelfId"), s.get("peerHostname"), peer.get("host"), "?"])))
		var link_ok: Variant = H.coalesce([s.get("peerLinkReady"), s.get("peerReachable")])
		var http_down: bool = s.get("peerHttpReachable") is bool and not s.peerHttpReachable
		parts.append("peer linked" if H.truthy(link_ok) else ("peer offline" if http_down else "peer connecting…"))
		if not H.truthy(link_ok) and H.truthy(s.get("peerPingError")):
			parts.append(t(s.peerPingError))
	elif not H.truthy(s.get("leaderAvailable")):
		parts.append("not paired")
	var media := R.d(s.get("mediaSync"))
	if media.get("percent") != null:
		parts.append("media %s%% (%s)" % [t(media.percent), "syncthing" if str(media.get("transport")) == "syncthing" else "rsync"])
	var out := R.d(s.get("casparOutput"))
	if out.get("ok") is bool and not out.ok and not R.a(out.get("warnings")).is_empty():
		parts.append("Caspar output needs wiring")
	if s.get("scheduledApply") is bool and not s.scheduledApply:
		parts.append("mirror immediate")
	elif s.get("scheduledApplyLeadMs") != null:
		parts.append("mirror lead %sms" % t(s.scheduledApplyLeadMs))
	var show := R.d(s.get("showSync"))
	if str(s.get("role")) == "follower" and H.truthy(show.get("revisionLag")):
		parts.append("show behind leader")
	elif H.truthy(show.get("receivedAtMs")):
		parts.append("show synced %s" % age_ms(now - float(show.receivedAtMs)))
	var peer_seq := _num(s, "peerLiveStateSeq")
	if peer_seq > 0 and _num(s, "lastAppliedSeq") < peer_seq:
		parts.append("behind seq %s" % O.js(peer_seq - _num(s, "lastAppliedSeq")))
	var fan := R.d(s.get("amcpFanout"))
	if str(s.get("role")) == "leader" and H.truthy(fan.get("active")):
		parts.append("fan-out connected" if H.truthy(fan.get("connected")) else "fan-out disconnected")
		var ph := R.d(s.get("playheadSync"))
		if H.truthy(ph.get("lastSampleAt")) and _finite(ph.get("driftMs")):
			parts.append("drift " + drift_ms(ph.driftMs))
	var cp := R.d(s.get("casparParity"))
	if s.get("casparParity") != null and not H.truthy(cp.get("skipped")) and not H.truthy(cp.get("ok")):
		parts.append("backup +%s ch needed" % t(cp.get("missingCount")) if H.truthy(cp.get("followerNeedsMoreChannels")) else "Caspar mismatch")
	return " · ".join(parts)


static func peer_rows(peer: Variant, st: Dictionary, role_label: String, now: float) -> Array:
	if not H.truthy(peer):
		return []
	var p: Dictionary = peer
	var fan := R.d(st.get("amcpFanout"))
	var ph := R.d(st.get("playheadSync"))
	var ep := R.d(fan.get("endpoint"))
	var endpoint := "%s:%s" % [t(ep.host), t(O.or_([ep.get("port"), 5250]))] if H.truthy(ep.get("host")) else \
		("%s:%s" % [t(p.casparHost), t(O.or_([p.get("casparPort"), 5250]))] if H.truthy(p.get("casparHost")) else "—")
	var rows := [[role_label, _or([p.get("hostname"), p.get("selfId"), p.get("host")])],
		["Hardware ID", _or([p.get("hardwareId"), st.get("peerHardwareId")])],
		["Address", "%s:%s" % [t(p.get("host")) if p.has("host") else "undefined", t(O.or_([p.get("port"), 4200]))]],
		["Peer status", "online · ping %s" % age_ms(p.get("pingAgeMs")) if H.truthy(p.get("reachable")) else "offline"],
		["Role", _or([p.get("role")])], ["App version", _or([p.get("appVersion")])]]
	var role := str(st.get("role"))
	if role == "leader":
		var fan_text := "inactive"
		if H.truthy(fan.get("active")):
			fan_text = "connected → " + endpoint if H.truthy(fan.get("connected")) else \
				"disconnected" + (" (%s)" % t(fan.lastError) if H.truthy(fan.get("lastError")) else "")
		rows.append(["AMCP fan-out", fan_text])
		if H.truthy(fan.get("active")):
			rows.append(["Commands sent", _qq([fan.get("commandsSent"), 0])])
			rows.append(["Queue depth", _qq([fan.get("queueDepth"), 0])])
			if float(H.coalesce([fan.get("skippedNotConnected"), 0])) > 0:
				rows.append(["Skipped (offline)", t(fan.skippedNotConnected)])
	if p.get("lastAppliedSeq") != null or p.get("liveStateSeq") != null:
		rows.append(["Mirror seq", "follower %s · leader %s" % [_qq([p.get("lastAppliedSeq")]), _qq([p.get("liveStateSeq"), st.get("liveStateSeq")])]
			if role == "leader" else "local %s · leader %s" % [_qq([st.get("lastAppliedSeq")]), _qq([p.get("liveStateSeq")])]])
	if _num(p, "mirrorLag") > 0:
		rows.append(["Mirror lag", "%s events" % t(p.mirrorLag)])
	var show := R.d(st.get("showSync"))
	if role == "follower":
		rows.append(["Leader show rev", _or([show.get("leaderRevision"), p.get("activeShowRevision")])])
		rows.append(["Applied show rev", _or([show.get("appliedRevision")])])
		rows.append(["Show received", age_ms(now - float(show.receivedAtMs)) if H.truthy(show.get("receivedAtMs")) else _or([show.get("receivedAt")])])
		if H.truthy(show.get("revisionLag")):
			rows.append(["Show sync", "behind leader (pull pending)"])
	elif role == "leader" and H.truthy(show.get("leaderRevision")):
		rows.append(["Active show rev", t(show.leaderRevision)])
		if H.truthy(show.get("leaderSavedAt")):
			rows.append(["Show saved at", t(show.leaderSavedAt)])
	if H.truthy(ph.get("lastSampleAt")) and role == "leader":
		rows.append(["Playhead drift", drift_ms(ph.get("driftMs"))])
		rows.append(["Drift sampled", age_ms(now - float(ph.lastSampleAt))])
	var lf := R.d(ph.get("leaderFramerates"))
	var ff := R.d(ph.get("followerFramerates"))
	var pf := R.d(p.get("programFramerates"))
	var keys := []
	for d in [ff, lf, pf]:
		for k in d:
			if not keys.has(str(k)):
				keys.append(str(k))
	keys.sort_custom(func(a: String, b: String) -> bool: return int(_pf(a) if _pf(a) != null else 0) < int(_pf(b) if _pf(b) != null else 0))
	for ch in keys:
		var leader_fr: Variant = lf.get(ch)
		var follower_fr: Variant = O.or_([ff.get(ch), pf.get(ch)])
		if not H.truthy(leader_fr) and not H.truthy(follower_fr):
			continue
		rows.append(["PGM ch %s fps" % ch, "%s / %s" % [caspar_fps(leader_fr), caspar_fps(follower_fr)]])
	return rows


static func local_rows(local: Variant, st: Dictionary) -> Array:
	if not H.truthy(local):
		return []
	var l: Dictionary = local
	var map := R.d(l.get("channelMap"))
	var pgm := ", ".join(R.a(map.get("programChannels")).map(func(ch: Variant) -> String: return "ch" + t(ch)))
	var prv_list := R.a(map.get("previewChannels"))
	var prv_parts := []
	for i in prv_list.size():
		prv_parts.append("screen%d:off" % (i + 1) if prv_list[i] == null else "screen%d:ch%s" % [i + 1, t(prv_list[i])])
	var prv := ", ".join(prv_parts)
	return [["This server", _or([l.get("hostname"), l.get("selfId")])], ["Hardware ID", _or([l.get("hardwareId")])],
		["Role", _or([l.get("role"), st.get("role")])], ["PGM channels", pgm if pgm != "" else "—"],
		["PRV channels", prv if prv != "" else "—"], ["Multiview", "off" if map.get("multiviewCh") == null else "ch %s" % t(map.multiviewCh)]]


static func transport_rows(st: Dictionary) -> Array:
	var conn: Variant = st.get("connection")
	if not H.truthy(conn):
		return []
	var c: Dictionary = conn
	var http := R.d(c.get("peerHttp"))
	var cp: Variant = st.get("casparParity")
	var rows := [["Peer HTTP", "online · " + age_ms(http.get("pingAgeMs")) if H.truthy(http.get("reachable")) else
			("stale · " + age_ms(http.get("pingAgeMs")) if H.truthy(http.get("rawReachable")) else "offline")],
		["Peer link", "ready" if H.truthy(st.get("peerLinkReady")) else
			("HTTP only (WS pending)" if H.truthy(st.get("peerHttpReachable")) else _or([st.get("peerPingError"), "offline"]))]]
	if H.truthy(cp) and not H.truthy(cp.get("skipped")):
		rows.append(["Caspar channels", "%s match" % t(cp.get("leaderChannelCount")) if H.truthy(cp.get("ok")) else
			"%s/%s (backup/leader)" % [t(H.coalesce([cp.get("followerChannelCount"), "?"])), t(H.coalesce([cp.get("leaderChannelCount"), "?"]))]])
	if H.truthy(c.get("peerLiveWs")):
		var ws: Dictionary = c.peerLiveWs
		if str(ws.get("direction")) == "outbound":
			rows.append(["Live-state WS", "connected (outbound)" if H.truthy(ws.get("connected")) else "disconnected"])
		else:
			rows.append(["Live-state WS", "%s follower client(s)" % t(ws.clientCount) if _num(ws, "clientCount") > 0 else "no follower WS clients"])
	var pc := R.d(c.get("peerCaspar"))
	if H.truthy(pc.get("active")):
		var ep := R.d(pc.get("endpoint"))
		var ep_str := "%s:%s" % [t(ep.host), t(O.or_([ep.get("port"), 5250]))] if H.truthy(ep.get("host")) else "—"
		rows.append(["Peer Caspar AMCP", "connected → " + ep_str if H.truthy(pc.get("connected")) else "disconnected"])
	return rows


## hot-backup-project.js hotBackupPeerBoxForViewer.
static func peer_box_for_viewer(hb: Variant, viewer_role: String) -> Variant:
	if not hb is Dictionary:
		return null
	var role := R.s(hb.get("role")) if H.truthy(hb.get("role")) else ""
	if role != "" and viewer_role != "" and role == viewer_role:
		return hb.get("peer") if H.truthy(hb.get("peer")) else null
	return O.or_([hb.get("self"), hb.get("peer"), null])


static func _pad4(v: Variant) -> String:
	return t(v).lpad(4, "0")


## hotBackupPairedTitle (via hotBackupPeerLabel).
static func paired_title(hb: Variant, viewer_role: String) -> String:
	var role := viewer_role if viewer_role != "" else (R.s(R.d(hb).get("role")) if H.truthy(R.d(hb).get("role")) else "")
	var peer: Variant = peer_box_for_viewer(hb, role)
	if not H.truthy(peer):
		return ""
	var label := R.s(peer.get("hostname")).strip_edges() if H.truthy(peer.get("hostname")) else ""
	if label == "" and H.truthy(peer.get("hardwareId")):
		label = "highascg" + _pad4(peer.hardwareId)
	if label == "" and H.truthy(peer.get("host")):
		label = R.s(peer.host).strip_edges()
	return "Paired with " + label if label != "" else ""


## syncProjectPairLineWithHelpers → the line's text ("" = hidden).
static func pair_line(st: Variant) -> String:
	var s := R.d(st)
	var hb: Variant = s.get("projectHotBackup")
	if not H.truthy(hb) or not H.truthy(s.get("enabled")):
		return ""
	var role := R.s(s.get("role")) if H.truthy(s.get("role")) else ""
	var title := paired_title(hb, role)
	if title == "" and H.truthy(hb.get("peerLabel")):
		title = "Paired with " + t(hb.peerLabel)
	var peer := R.d(peer_box_for_viewer(hb, role))
	var details := []
	if H.truthy(peer.get("hostname")):
		details.append(t(peer.hostname))
	if H.truthy(peer.get("hardwareId")):
		details.append("ID " + _pad4(peer.hardwareId))
	if H.truthy(peer.get("host")):
		details.append(t(peer.host))
	return " — ".join([title, " · ".join(details)].filter(func(x: String) -> bool: return x != ""))


## syncOutputWarnings → the line's text ("" = hidden).
static func output_warnings(st: Variant) -> String:
	var w := R.a(R.d(R.d(st).get("casparOutput")).get("warnings"))
	return " ".join(w.map(func(x: Variant) -> String: return t(R.d(x).get("message")) if R.d(x).has("message") else "undefined"))
