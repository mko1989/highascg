extends "res://e2e/e2e_scenario.gd"
## WO-836 Part 3c — the remote EYES for agent-run test cards. Not a scripted scenario: it listens on 127.0.0.1:6299
## (`--e2e-remote-port=` overrides) for newline-delimited JSON commands and answers one JSON line each:
##   {"cmd":"find","label":"Take"}  →  {"ok":true,"result":{…},"ms":12}   |   {"ok":false,"error":"…","ms":3}
## It only LOOKS (e2e_eyes.gd): where each labelled control is on the screen, what is focused / open, a viewport shot.
## All INPUT is done by tools/test-agent/ui through xdotool on this client's Xvfb display — real X mouse and keyboard,
## like a human's hands. Run via `tools/test-agent/ui start` (sandbox or live); ends on `quit`.

const Eyes := preload("res://e2e/e2e_eyes.gd")
const UI := preload("res://e2e/e2e_ui.gd")

var _eyes: RefCounted
var _quit := false


func run() -> void:
	_eyes = Eyes.new(ui)
	var port := int(Config.args.get("e2e-remote-port", 6299))
	var srv := TCPServer.new()
	if srv.listen(port, "127.0.0.1") != OK:
		results.append({"scenario": name, "step": "listen", "ok": false, "skipped": false, "why": "cannot listen on 127.0.0.1:%d" % port, "ms": 0, "shot": ""})
		return
	print("[e2e] remote listening on 127.0.0.1:%d" % port)
	var conns: Array = []
	while not _quit:
		while srv.is_connection_available():
			conns.append({"peer": srv.take_connection(), "buf": ""})
		for c in conns.duplicate():
			var peer: StreamPeerTCP = c.peer
			peer.poll()
			if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
				conns.erase(c)
				continue
			var n := peer.get_available_bytes()
			if n > 0:
				c.buf += peer.get_utf8_string(n)
			var nl := (c.buf as String).find("\n")
			if nl >= 0:
				var line := (c.buf as String).left(nl).strip_edges()
				c.buf = (c.buf as String).substr(nl + 1)
				if line != "":
					var answer: String = await _handle(line)
					peer.poll()
					if peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
						peer.put_data((answer + "\n").to_utf8_buffer())
		await ui.frames(1)
	print("[e2e] remote: quit")
	await ui.sleep(0.3)  # let the last answer leave the socket


func _handle(line: String) -> String:
	var t0 := Time.get_ticks_msec()
	var msg: Variant = JSON.parse_string(line)
	var out := {}
	if not (msg is Dictionary) or not (msg as Dictionary).has("cmd"):
		out = {"ok": false, "error": "not a JSON object with a \"cmd\""}
	else:
		out = await _dispatch(str(msg.cmd), msg)
	out["ms"] = Time.get_ticks_msec() - t0
	return JSON.stringify(out)


func _ok(result: Variant) -> Dictionary:
	return {"ok": true, "result": result}


func _err(why: String) -> Dictionary:
	return {"ok": false, "error": why}


func _dispatch(cmd: String, a: Dictionary) -> Dictionary:
	match cmd:
		"ping":
			return _ok("pong")
		"list":
			var kind := str(a.get("kind", "all"))
			var base: Node = null
			if str(a.get("under", "")) != "":
				base = _eyes.resolve_under(str(a.under))
				if base == null:
					return _err("no container labelled '%s' (a tab title, a section heading, a tooltip or a node name)" % str(a.under))
			var es: Array = _eyes.entries(base, kind in ["all", "labels"]).filter(func(e: Dictionary) -> bool: return _eyes.kind_ok(e, kind))
			var total := es.size()
			var lim := int(a.get("limit", 250))
			if es.size() > lim:
				es = es.slice(0, lim)
			return _ok({"count": total, "shown": es.size(), "entries": es})
		"find":
			var r: Dictionary = _eyes.find(str(a.get("label", "")), a)
			if not r.ok:
				return r
			return _ok({"count": r.matches.size(), "matches": (r.matches as Array).slice(0, 12)})
		"wait_for":
			return await _wait_for(a)
		"reveal":
			return await _reveal(a)
		"state":
			return _ok(_state())
		"covered":
			var why: String = _eyes.covered_by(str(a.get("path", "")))
			return _ok({"covered": why != "", "why": why})
		"popups":
			return _ok(_eyes.popups())
		"shot":
			var p: String = await ui.shot(str(a.get("name", "shot")))
			return _ok(p) if p != "" else _err("no shot folder (--e2e-out missing)")
		"quit":
			_quit = true
			return _ok("bye")
	return _err("unknown command '%s' (ping list find wait_for reveal state covered popups shot quit)" % cmd)


## A control scrolled out of its scroll area (the deck's "+" after many looks) is not on screen, so `list`/`find` miss it.
## Scroll the areas above the `nth` control (tree order) whose text or tooltip is `label` until it shows — what the
## operator's wheel would do — and answer where it now is.
func _reveal(a: Dictionary) -> Dictionary:
	var label := str(a.get("label", ""))
	var contains := bool(a.get("contains", false))
	var hits := []
	for c in ui.all("Control", null, false):
		if not (c as Control).is_visible_in_tree():
			continue
		for s in [UI.label_of(c), (c as Control).tooltip_text.strip_edges()]:
			if s != "" and (s == label or (contains and s.contains(label))):
				hits.append(c)
				break
	var nth := maxi(int(a.get("nth", 1)), 1)
	if hits.size() < nth:
		return _err("no control labelled '%s' (%d found, even scrolled away)" % [label, hits.size()])
	var c: Control = hits[nth - 1]
	await ui.reveal(c)
	var text := UI.label_of(c)
	var e: Dictionary = _eyes._entry("button" if c is BaseButton else "control", c, text if text != "" else c.tooltip_text.strip_edges(), ui.screen_rect(c))
	if e.is_empty():
		return _err("'%s' is still off screen after scrolling (a collapsed or hidden section?)" % label)
	return _ok({"count": hits.size(), "match": e})


func _wait_for(a: Dictionary) -> Dictionary:
	var label := str(a.get("label", ""))
	var gone := bool(a.get("gone", false))
	var timeout := float(a.get("timeout", 8.0))
	var last := {}
	var ok: Variant = await ui.wait_for(func() -> bool:
		last = _eyes.find(label, a)
		return (not last.ok) if gone else bool(last.ok), timeout)
	if ok:
		return _ok({"gone": true} if gone else {"count": last.matches.size(), "matches": (last.matches as Array).slice(0, 12)})
	if gone:
		return _err("'%s' is still visible after %.0f s" % [label, timeout])
	return _err("timed out after %.0f s: %s" % [timeout, str(last.get("error", ""))])


func _state() -> Dictionary:
	var tabs: TabContainer = ui.root.shell.tabs
	return {
		"tab": tabs.get_tab_title(tabs.current_tab), "tab_index": tabs.current_tab,
		"tabs": range(tabs.get_tab_count()).map(func(i: int) -> String: return tabs.get_tab_title(i)),
		"focus": _eyes.focus_desc(), "windows": _eyes.windows(),
		"window": {"x": int(_eyes.origin().x), "y": int(_eyes.origin().y), "w": ui.vp().get_visible_rect().size.x, "h": ui.vp().get_visible_rect().size.y},
		"pointer": [int(ui.vp().get_mouse_position().x), int(ui.vp().get_mouse_position().y)],
		"server": Config.origin, "connected": Ws.is_open,
	}
