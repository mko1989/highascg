extends RefCounted
## WO-815 — the simulated server's console mixer, screen timers, pixel map, timelines and fixture reads
## (core/demo/demo_server.gd routes here). Shapes follow the node:
##   mixer   src/audio/mixer-state.js + routes-audio-mixer.js: {gains, muted, solos} keyed by strip key; a change
##           broadcasts `change audioMixer`. A look layer's fader carries no key (its volume lives on the look) → ok.
##   timers  src/engine/screen-timers.js: records {timerId, name, config, lastCmd, cmdAt, remainingSec, screens}; the
##           readout is computed by the client from cmdAt and serverNowMs — here "server now" is this computer's clock.
##   pixel   src/api/routes-pixel-map.js: GET/POST /api/fixtures/pixelmap {mappings} (POST replaces the list).

const LAYER_BAND := 980


static func route(s: RefCounted, verb: String, path: String, query: Dictionary, b: Variant) -> Variant:
	var body: Dictionary = b if b is Dictionary else {}
	if path.begins_with("/api/audio/"):
		return _audio(s, verb, path, body)
	if path.begins_with("/api/timers/"):
		return _timers(s, verb, path, body)
	if path.begins_with("/api/timelines"):
		return _timelines(s, verb, path, body)
	match [verb, path]:
		["GET", "/api/fixtures/pixelmap"]:
			return s.reply({"ok": true, "mappings": s.pixelmap})
		["POST", "/api/fixtures/pixelmap"]:
			return save_pixelmap(s, body.get("mappings"))
		["GET", "/api/fixtures/pixelmap/pixels"]:
			return s.reply(s.files.get("pixelmap_pixels", {}))
		["GET", "/api/fixtures/pixelmap/live"]:
			return s.reply({"ok": true, "at": s.now_ms.call(), "stats": {}, "channels": [], "mappings": []})
		["GET", "/api/fixtures/types"]:
			return s.reply(s.files.get("fixture_types", {}))
		["GET", "/api/fixtures/program"]:
			return s.reply({"values": {}})
		["GET", "/api/osc/audio-layers"]:
			return s.reply({"channels": {}, "updatedAt": s.now_ms.call()})
	return null


static func _audio(s: RefCounted, verb: String, path: String, body: Dictionary) -> Variant:
	match [verb, path]:
		["GET", "/api/audio/mixer"]:
			return s.reply(s.mixer.merged({"ok": true}))
		["POST", "/api/audio/volume"]:
			var v := maxf(0.0, float(body.get("volume", 1.0)))
			if is_key(body.get("key")):
				(s.mixer.gains as Dictionary)[str(body.key)] = v
				s.change("audioMixer", s.mixer)
			return s.reply({"ok": true, "volume": v, "demo": true})
		["POST", "/api/audio/mute"]:
			var muted: bool = body.get("muted") == true
			if is_key(body.get("key")):
				if muted:
					(s.mixer.muted as Dictionary)[str(body.key)] = true
				else:
					(s.mixer.muted as Dictionary).erase(str(body.key))
				s.change("audioMixer", s.mixer)
			return s.reply({"ok": true, "muted": muted, "volume": 0.0 if muted else float(body.get("volume", 1.0)), "demo": true})
		["POST", "/api/audio/solo"]:
			var keys: Array = (body.get("keys", []) as Array).filter(func(k: Variant) -> bool: return is_key(k)) if body.get("keys") is Array else []
			s.mixer["solos"] = keys
			s.change("audioMixer", s.mixer)
			return s.reply({"ok": true, "solos": keys})
		["GET", "/api/audio/live-inputs"]:
			return s.reply({"liveAudioInputChannels": [], "liveAudioCount": 0, "configured": {"count": 0, "slots": []},
				"status": {"enabled": false, "reason": "demo"}})
		["GET", "/api/audio/inputs/routing"]:
			return s.reply({"ok": true, "autoMix": true, "programChannels": (s.state.get("channelMap", {}) as Dictionary).get("programChannels", []),
				"inputs": []})
	return null


## src/audio/mixer-state.js KEY_RE: pgm|prv|input:<ch>[:layer:<n>].
static func is_key(k: Variant) -> bool:
	if not (k is String):
		return false
	var p := (k as String).split(":")
	return (p.size() == 2 or (p.size() == 4 and p[2] == "layer" and p[3].is_valid_int())) and p[0] in ["pgm", "prv", "input"] and p[1].is_valid_int()


static func _find_timer(s: RefCounted, id: String) -> Dictionary:
	for t in s.timers:
		if t is Dictionary and str(t.get("timerId", "")) == id:
			return t
	return {}


static func _timers(s: RefCounted, verb: String, path: String, body: Dictionary) -> Variant:
	if verb == "GET" and path == "/api/timers/list":
		return s.reply({"ok": true, "timers": s.timers, "serverNowMs": s.now_ms.call()})
	if verb != "POST":
		return null
	var id := str(body.get("timerId", ""))
	if id == "":
		return s.refuse(400, "timerId required")
	var rec := _find_timer(s, id)
	match path:
		"/api/timers/cmd":
			if rec.is_empty():
				return s.refuse(400, "Timer %s not assigned to any screens" % id)
			timer_cmd(rec, str(body.get("cmd", "")), s.now_ms.call())
			return s.reply({"ok": true, "timerId": id, "cmd": str(body.get("cmd", "")), "healed": false})
		"/api/timers/assign":
			var idx := int(body.get("screenIdx", 0))
			if rec.is_empty():
				rec = {"timerId": id, "name": "", "config": {}, "lastCmd": null, "cmdAt": null, "remainingSec": null, "screens": {}}
				s.timers.append(rec)
			if body.has("name"):
				rec["name"] = body.name
			if body.get("config") is Dictionary:
				(rec.config as Dictionary).merge(body.config, true)
			var pgm: Array = (s.state.get("channelMap", {}) as Dictionary).get("programChannels", [])
			if not (rec.screens as Dictionary).has(str(idx)):
				rec.screens[str(idx)] = {"channel": int(pgm[idx]) if idx < pgm.size() else 1, "layer": LAYER_BAND + (rec.screens as Dictionary).size(),
					"visible": false, "opacity": 1}
			return s.reply({"ok": true, "timerId": id, "screenIdx": idx, "record": rec})
		"/api/timers/unassign":
			if not rec.is_empty():
				(rec.screens as Dictionary).erase(str(int(body.get("screenIdx", 0))))
				if (rec.screens as Dictionary).is_empty():
					s.timers.erase(rec)
			return s.reply({"ok": true, "timerId": id, "screenIdx": int(body.get("screenIdx", 0))})
		"/api/timers/visible":
			var scr: Variant = (rec.get("screens", {}) as Dictionary).get(str(int(body.get("screenIdx", 0))))
			if scr is Dictionary:
				scr["visible"] = body.get("visible") == true
				if body.has("opacity"):
					scr["opacity"] = float(body.opacity)
			return s.reply({"ok": true, "timerId": id, "visible": body.get("visible") == true})
	return null


## routes-screen-timers.js: pause freezes remainingSec from the running clock; start resumes from it; reset clears it.
static func timer_cmd(rec: Dictionary, cmd: String, now: float) -> void:
	var cfg: Dictionary = rec.get("config", {}) if rec.get("config") is Dictionary else {}
	var duration := float(cfg.get("durationSec", 300))
	if cmd == "pause":
		var basis := float(rec.remainingSec) if rec.get("remainingSec") is float or rec.get("remainingSec") is int else duration
		var running: bool = rec.get("lastCmd") == "start" and (rec.get("cmdAt") is float or rec.get("cmdAt") is int)
		rec["remainingSec"] = maxf(0.0, basis - (now - float(rec.cmdAt)) / 1000.0) if running else basis
	elif cmd == "reset":
		rec["remainingSec"] = null
	rec["lastCmd"] = cmd
	rec["cmdAt"] = now


static func save_pixelmap(s: RefCounted, list: Variant) -> Dictionary:
	if not (list is Array):
		return s.refuse(400, "mappings must be an array")
	var errors := []
	for i in (list as Array).size():
		var m: Variant = list[i]
		if not (m is Dictionary) or str(m.get("fixtureId", "")) == "" or not (m.get("rect") is Dictionary):
			errors.append({"index": i, "id": str(m.get("id", "")) if m is Dictionary else "", "error": "fixtureId and rect required"})
	if not errors.is_empty():
		return {"ok": false, "status": 400, "data": {"ok": false, "errors": errors}, "error": "HTTP 400", "reason": ""}
	s.pixelmap = (list as Array).map(func(m: Dictionary) -> Dictionary: return m.merged({"problem": null}, true))
	s.project["pixelMappings"] = s.pixelmap.duplicate(true)
	return s.reply({"ok": true, "mappings": s.pixelmap})


static func _timelines(s: RefCounted, verb: String, path: String, body: Dictionary) -> Variant:
	var root: Dictionary = s.project.get("timelines", {}) if s.project.get("timelines") is Dictionary else {}
	var list: Array = root.get("timelines", [])
	if path == "/api/timelines":
		return s.reply(list) if verb == "GET" else null
	var seg := path.trim_prefix("/api/timelines/").split("/")
	var id := seg[0].uri_decode()
	var tl: Dictionary = {}
	for t in list:
		if t is Dictionary and str(t.get("id", "")) == id:
			tl = t
	if tl.is_empty():
		return s.refuse(404, "timeline %s not found" % id)
	if seg.size() == 1 and verb == "GET":
		return s.reply(tl)
	if seg.size() == 1 and verb == "PUT":
		tl.merge(body, true)
		return s.reply(tl)
	if seg.size() == 2 and seg[1] == "state" and verb == "GET":
		return s.reply({"position": 0, "playing": false, "loop": false, "timelineId": id, "sendTo": tl.get("sendTo", {})})
	return null
