extends RefCounted
## WO-1105 — pure helpers of Settings ▸ Games (GET /api/games/hosting, WS games:hosting; tests/test_games_settings_wo1105.gd).
## The server names every game (ids, titles, the main number's label, bot levels); nothing here knows a game.

const PATH := "/api/games/hosting"
const PHASES := {"off": "module off", "closed": "session closed", "lobby": "lobby", "countdown": "starting",
	"race": "racing", "match": "match on", "round": "round on", "results": "results", "paused": "paused"}
const AFFECT := [["on", "Others can affect it"], ["soft", "Soft (no knock-backs)"], ["off", "Nobody affects it"]]
const QR_QUIET := 4


## The status line of one game row: "lobby · 2 players · 3 bots" / "module off".
static func status_text(g: Dictionary) -> String:
	var phase := str(g.get("phase", "off"))
	var s: String = PHASES.get(phase, phase)
	if g.get("open") != true:
		return s
	var parts := [s]
	var n := int(g.get("players", 0))
	parts.append("%d player%s" % [n, "" if n == 1 else "s"])
	var b: Variant = g.get("bots")
	if b is Dictionary and int((b as Dictionary).get("n", 0)) > 0:
		parts.append("%d bot%s" % [int(b.n), "" if int(b.n) == 1 else "s"])
	var sp := int(g.get("spectators", 0))
	if sp > 0:
		parts.append("%d watching" % sp)
	return " · ".join(parts)


## What a row may press now: {module, session, start, stop, bots, main, qr}.
static func enabled(g: Dictionary) -> Dictionary:
	var mod_on: bool = g.get("moduleOn") == true
	var open: bool = g.get("open") == true
	var running: bool = g.get("running") == true
	return {
		"module": g.get("error") == null or mod_on,
		"session": mod_on,
		"start": open and not running and g.get("safe") != true,
		"stop": open and running,
		"bots": open and g.get("bots") is Dictionary,
		"main": open and g.get("main") is Dictionary and not running,
		"qr": g.get("joinUrl") is String and str(g.joinUrl) != "",
	}


## The summary under the global switches: "2 sessions open, 1 running" / "No game session is open."
static func global_text(st: Variant) -> String:
	if not (st is Dictionary) or not ((st as Dictionary).get("games") is Array):
		return "Game hosting state unavailable."
	if (st.games as Array).is_empty():
		return "No game module is installed on this box."
	var gl: Dictionary = st.get("global", {}) if st.get("global") is Dictionary else {}
	var open := int(gl.get("open", 0))
	if open == 0:
		return "No game session is open."
	var run := int(gl.get("running", 0))
	return "%d session%s open, %d running%s." % [open, "" if open == 1 else "s", run, " — everything is PAUSED" if gl.get("safe") == true else ""]


## The join line + warning: {url, text, warn}. World first when its module is on (the one address for every game).
static func join_info(st: Variant) -> Dictionary:
	if not (st is Dictionary):
		return {"url": "", "text": "", "warn": ""}
	var j: Dictionary = st.get("join", {}) if st.get("join") is Dictionary else {}
	var url := ""
	var w: Variant = st.get("world")
	if w is Dictionary and (w as Dictionary).get("joinUrl") is String and str(w.joinUrl) != "":
		url = str(w.joinUrl)
	elif st.get("games") is Array:
		for g in st.games:
			if g is Dictionary and g.get("open") == true and g.get("joinUrl") is String:
				url = str(g.joinUrl)
				break
	var addr := "%s (%s)" % [str(j.get("ip", "")), str(j.get("iface", ""))] if j.get("ip") is String else "none"
	return {"url": url, "text": "Join address: " + addr + (" — automatic" if j.get("auto") == true else ""), "warn": str(j.get("warning", ""))}


## The join-address picker items: [[value, label]] — '' (automatic) first, then every address of the box.
static func address_items(st: Variant) -> Array:
	var out := [["", "Automatic (venue network first)"]]
	var j: Variant = st.get("join") if st is Dictionary else null
	if j is Dictionary and j.get("addresses") is Array:
		for a in j.addresses:
			if a is Dictionary and str(a.get("kind", "")) != "loopback":
				out.append([str(a.ip), "%s — %s%s" % [str(a.ip), str(a.get("iface", "")), " (VPN)" if a.get("kind") == "vpn" else ""]])
	return out


## The QR payload of the server (n, hex rows) → {n, dark: PackedByteArray (row-major, 1 = dark)}; n 0 when invalid.
static func qr_matrix(qr: Variant) -> Dictionary:
	if not (qr is Dictionary) or not ((qr as Dictionary).get("rows") is Array):
		return {"n": 0, "dark": PackedByteArray()}
	var n := int(qr.get("n", 0))
	var rows: Array = qr.rows
	if n < 21 or rows.size() != n:
		return {"n": 0, "dark": PackedByteArray()}
	var dark := PackedByteArray()
	dark.resize(n * n)
	for r in n:
		var h := str(rows[r])
		for c in n:
			var d := h.substr(c >> 2, 1).hex_to_int() if (c >> 2) < h.length() else 0
			dark[r * n + c] = (d >> (3 - (c & 3))) & 1
	return {"n": n, "dark": dark}


## The QR dialog content of one row (a game or the world): {title, url, n, dark, ok}.
static func qr_dialog(row: Dictionary) -> Dictionary:
	var m := qr_matrix(row.get("qr"))
	var url: String = str(row.joinUrl) if row.get("joinUrl") is String else ""
	return {"title": str(row.get("title", "")), "url": url, "n": m.n, "dark": m.dark, "ok": m.n > 0 and url != ""}


## The look layer source of the join QR card (template/join_qr.html; the data is its CG ADD argument).
static func qr_source(row: Dictionary) -> Dictionary:
	var qr: Dictionary = row.get("qr", {}) if row.get("qr") is Dictionary else {}
	var title := str(row.get("title", ""))
	return {"type": "template", "value": "join_qr", "label": "Join QR — " + title,
		"data": {"title": title, "url": str(row.get("joinUrl", "")), "n": int(qr.get("n", 0)), "rows": qr.get("rows", []), "game": str(row.get("id", ""))}}


## The stored join-QR look of `game_id` among the project's looks (its first layer is a join_qr template of that game).
static func find_qr_look(scenes: Array, game_id: String) -> Dictionary:
	for s in scenes:
		if not (s is Dictionary) or not ((s as Dictionary).get("layers") is Array):
			continue
		for l in s.layers:
			if l is Dictionary and l.get("source") is Dictionary and str(l.source.get("value", "")) == "join_qr":
				var d: Variant = l.source.get("data")
				if d is Dictionary and str((d as Dictionary).get("game", "")) == game_id:
					return s
	return {}


## Request bodies (POST /api/games/hosting).
static func body_module(id: String, on: bool) -> Dictionary:
	return {"action": "module", "game": id, "on": on}


static func body_session(id: String, open: bool) -> Dictionary:
	return {"action": "session", "game": id, "open": open}


static func body_start(id: String, start: bool) -> Dictionary:
	return {"action": "start" if start else "stop", "game": id}


static func body_bots(id: String, n: int, level := "") -> Dictionary:
	var b := {"action": "bots", "game": id, "n": n}
	if level != "":
		b["level"] = level
	return b


static func body_main(id: String, v: int) -> Dictionary:
	return {"action": "main", "game": id, "value": v}


static func body_affect(id: String, mode: String) -> Dictionary:
	return {"action": "affect", "game": id, "mode": mode}


static func body_global(action: String, on: Variant) -> Dictionary:
	if action == "house":
		return {"action": "house", "level": clampf(float(on), 0.0, 1.0)}
	return {"action": action, "on": on == true}


## The error of a refused POST, never empty.
static func error_text(res: Dictionary) -> String:
	var d: Variant = res.get("data")
	if d is Dictionary and str((d as Dictionary).get("error", "")) != "":
		return str(d.error)
	var e := str(res.get("error", ""))
	return e if e != "" else "The request failed."
