extends RefCounted
## WO-608 header slice 2 — pure mapping from server state to the header's badges, chips and menus (web
## header-bar-streaming.js, header-bar-replication.js, app-pgm-header-timer.js, header-bar-audio.js,
## header-bar-config-strip.js). Testable without autoloads.

## Badge colours (web 01a2-header-bar.css): {bg, border, text}.
const TONES := {
	"idle": [Color("#484f58"), Color("#5a626d"), Color("#aeb5bd")],
	"live": [Color("#9b1c1c"), Color("#c53030"), Color.WHITE],
	"active": [Color("#15803d"), Color("#22c55e"), Color.WHITE],
	"available": [Color("#3f6212"), Color("#84cc16"), Color("#ecfccb")],
	"pending": [Color("#854d0e"), Color("#f59e0b"), Color.WHITE],
}


## streaming-channel-state.js parseActiveFlag.
static func active_flag(v: Variant) -> bool:
	if v is bool:
		return v
	if v is int or v is float:
		return v == 1
	return str(v).strip_edges().to_lower() in ["true", "1", "yes", "on", "running", "live"]


## isStreamOutputLive / isRecordOutputLive: `slice` is status.rtmp or status.record.
static func output_live(slice: Variant, id: String) -> bool:
	if not (slice is Dictionary) or id == "" or not active_flag((slice as Dictionary).get("active")):
		return false
	var outs: Array = (slice as Dictionary).get("activeOutputs", []) if (slice as Dictionary).get("activeOutputs") is Array else []
	if not outs.is_empty():
		return outs.map(func(o: Variant) -> String: return str(o)).has(id)
	return str((slice as Dictionary).get("outputId", "")).strip_edges() == id


## Settings streamOutputs / recordOutputs → [{id, label, tone, tip}] (enabled rows with an id; S1 / R1 or the
## name's first letter + the id's number, like the web).
static func stream_badges(stream_outputs: Variant, record_outputs: Variant, status: Variant) -> Array:
	var st: Dictionary = status if status is Dictionary else {}
	var out: Array = []
	for pair in [[stream_outputs, "rtmp", "Str", ["str", "stream"], "S", "streaming"], [record_outputs, "record", "Rec", ["rec", "record"], "R", "recording"]]:
		if not (pair[0] is Array):
			continue
		for r in pair[0]:
			if not (r is Dictionary) or (r as Dictionary).get("enabled") == false:
				continue
			var id := str(r.get("id", "")).strip_edges()
			if id == "":
				continue
			var m := RegEx.create_from_string("(\\d+)").search(id)
			var idx := m.get_string(1) if m else ""
			var name := str(r.get("name", r.get("label", ""))).strip_edges()
			if name == "":
				name = pair[2] + idx
			var low := name.to_lower()
			var label: String = (pair[4] + (idx if idx != "" else "1")) if (low.begins_with(pair[3][0]) or low.begins_with(pair[3][1])) else name.substr(0, 1).to_upper() + idx
			var on := output_live(st.get(pair[1]), id)
			var tip := ("%s is %s" % [name, pair[5]]) if on else ("%s (idle)" % name)
			if on and pair[1] == "record" and st.get("record") is Dictionary and str(st.record.get("path", "")) not in ["", "<null>"]:
				tip += " (%s)" % str(st.record.path)
			out.append({"id": id, "label": label, "tone": "live" if on else "idle", "tip": tip})
	return out


## header-bar-replication.js render(): {} when standalone with no leader on offer.
static func replication_badge(status: Variant) -> Dictionary:
	if not (status is Dictionary):
		return {}
	var s: Dictionary = status
	var role := str(s.get("role", "standalone"))
	var enabled: bool = s.get("enabled") == true
	var peer_ok: bool = (s.get("peerLinkReady") if s.get("peerLinkReady") != null else s.get("peerReachable")) == true
	var host := str((s.get("peer", {}) as Dictionary).get("host", "")) if s.get("peer") is Dictionary else ""
	if enabled and role == "follower":
		return {"label": "F", "tone": "active" if peer_ok else "pending",
			"tip": ("Follower — linked to %s" if peer_ok else "Follower — connecting to %s…") % (host if host != "" else "leader")}
	if enabled and role == "leader":
		var peer := host if host != "" else (str(s.get("peerSelfId")) if s.get("peerSelfId") != null else "follower")
		return {"label": "L", "tone": "active" if peer_ok else "pending",
			"tip": ("Leader — follower %s online" if peer_ok else "Leader — waiting for follower (%s)…") % peer}
	if s.get("leaderAvailable") == true:
		return {"label": "L", "tone": "available", "tip": "Leader available — waiting for follower to connect"}
	return {}


## Screen chips for the PGM timer: one per playback / program channel, 3-letter screen label (WO-506).
static func timer_chips(cm: Dictionary) -> Array:
	var list: Array = cm.get("playbackChannels") if cm.get("playbackChannels") is Array and not (cm.playbackChannels as Array).is_empty() else (cm.get("programChannels", [1]) if cm.get("programChannels") is Array else [1])
	var labels: Array = cm.get("screenLabels", []) if cm.get("screenLabels") is Array else []
	var out: Array = []
	for i in list.size():
		var full := str(labels[i]) if i < labels.size() and str(labels[i]) != "" else "S%d" % (i + 1)
		var short := full.strip_edges().substr(0, 3)
		out.append({"main": i, "channel": int(list[i]), "label": short if short != "" else "P%d" % (i + 1), "tip": "Show playback timer for %s (channel %d)" % [full, int(list[i])]})
	return out


## Server hardware-monitor sources (POST /api/audio/monitor-source {source}); [] = no monitor bus, no menu.
static func monitor_options(cm: Dictionary) -> Dictionary:
	var ap: Dictionary = cm.get("audioPreview", {}) if cm.get("audioPreview") is Dictionary else {}
	var preview_on := active_flag(ap.get("enabled")) and cm.get("audioPreviewCh") != null
	if not preview_on and cm.get("monitorCh") == null:
		return {"title": "", "note": "", "options": []}
	var pgm: Array = cm.get("programChannels", [1]) if cm.get("programChannels") is Array else [1]
	var prv: Array = cm.get("previewChannels", [2]) if cm.get("previewChannels") is Array else [2]
	var opts := [{"id": "pgm_1", "label": "PGM · ch %d" % int(pgm[0] if not pgm.is_empty() else 1)},
		{"id": "prv_1", "label": "PRV · ch %d" % int(prv[0] if not prv.is_empty() else 2)}]
	if cm.get("multiviewCh") != null:
		opts.append({"id": "multiview", "label": "Multiview · ch %d" % int(cm.multiviewCh)})
	if preview_on:
		return {"title": "Headphones (preview bus)", "options": opts,
			"note": "Solo routes to ch %d (%s). Clear solo restores %s." % [int(cm.audioPreviewCh), str(ap.get("bus", "preview")), str(ap.get("defaultSource", "preview_1"))]}
	return {"title": "Server hardware monitor", "note": "", "options": opts}


## header-bar-config-strip.js renderConfigComparison → {ok, summary, rows: [[#, module, server]], issues, hint}.
static func config_strip(c: Variant) -> Dictionary:
	if not (c is Dictionary):
		return {"ok": false, "summary": "Connect to CasparCG or wait for INFO CONFIG to compare channel layout.", "rows": [], "issues": [], "hint": ""}
	var d: Dictionary = c
	var phys: Array = d.get("serverPhysicalScreens", []) if d.get("serverPhysicalScreens") is Array else []
	var phys_line := ""
	if not phys.is_empty():
		phys_line = " Caspar screen outputs: %d (ch %s). App screens: %s." % [phys.size(), ", ".join(phys.map(func(s: Variant) -> String: return str(int(s.get("index", 0))) if s is Dictionary else "?")), _n(d.get("moduleScreenCount"))]
	var summary := ""
	var ok := false
	if d.get("aligned") == true:
		ok = true
		summary = "Server config matches module settings (%s channels).%s" % [_n(d.get("serverChannelCount")), phys_line]
	elif not d.get("serverChannelCount"):
		summary = "Connect to CasparCG or wait for INFO CONFIG to compare channel layout."
	else:
		summary = "Mismatch: server has %s channel(s), module expects %s.%s%s" % [_n(d.get("serverChannelCount")), _n(d.get("moduleChannelCount")), phys_line,
			" Screen count differs from app — check multiview or extra screen consumers." if d.get("screensCountMismatch") == true else ""]
	var sv: Array = d.get("serverChannels", []) if d.get("serverChannels") is Array else []
	var mv: Array = d.get("moduleChannels", []) if d.get("moduleChannels") is Array else []
	var rows: Array = []
	for i in maxi(sv.size(), mv.size()):
		var s: Dictionary = sv[i] if i < sv.size() and sv[i] is Dictionary else {}
		var m: Dictionary = mv[i] if i < mv.size() and mv[i] is Dictionary else {}
		var num: Variant = s.get("index", m.get("index", i + 1))
		rows.append([str(int(num)), ("%s: %s" % [str(m.get("role", "")), str(m.get("videoMode", "—"))]) if not m.is_empty() else "—",
			(str(s.get("videoMode", "—")) + (" (screen)" if s.get("hasScreen") == true else "")) if not s.is_empty() else "—"])
	var issues: Array = (d.get("issues", []) as Array).map(func(x: Variant) -> String: return str(x)) if d.get("issues") is Array else []
	return {"ok": ok, "summary": summary, "rows": rows, "issues": issues, "hint": str(d.get("hint", "")) if d.get("hint") != null else ""}


static func _n(v: Variant) -> String:
	if v == null:
		return "—"
	return str(int(v)) if (v is float or v is int) else str(v)
