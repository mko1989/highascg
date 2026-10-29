extends RefCounted
## WO-815 phase 2 — the simulated server's timeline engine (core/demo/demo_server.gd routes here; its tick() runs once a
## frame from core/ws.gd). The node's engine (src/engine/timeline-engine.js + timeline-playback-runtime.js) keeps the
## timelines apart from the project document and a playback cell per timeline {position, playing, loop}; the one on air
## advances on the clock. The demo does the same on this computer's clock (s.now_ms) and sends what the client listens
## to: `timeline.playback` (getPlayback: {position, playing, loop, timelineId, sendTo}) on every transport change and
## `timeline.tick {timelineId, position}` at most every 165 ms while playing (TIMELINE_TICK_BROADCAST_MS). Past the
## end: loop → play from 0, else stop. Nothing plays out: no Caspar layers, no pictures, no flags (pause / jump flags
## are not simulated).
## Routes (src/api/routes-timeline.js): GET / POST /api/timelines, GET / PUT / DELETE /api/timelines/:id,
## POST …/play {from} | pause | stop | seek {ms} | sendto | loop {loop} | take, GET …/state.

const TICK_BROADCAST_MS := 165.0


## The engine's timelines from the stored project (the node loads them the same way at boot).
static func seed(project: Dictionary) -> Array:
	var root: Variant = project.get("timelines")
	var list: Variant = (root as Dictionary).get("timelines") if root is Dictionary else null
	return (list as Array).duplicate(true) if list is Array else []


static func route(s: RefCounted, verb: String, path: String, body: Dictionary) -> Variant:
	if path == "/api/timelines":
		if verb == "GET":
			return s.reply(s.tl_list)
		if verb == "POST":
			return s.reply(upsert(s, str(body.get("id", "")), body))
		return null
	var seg := path.trim_prefix("/api/timelines/").split("/")
	if seg.size() > 2 or seg[0] == "":
		return null
	var id := seg[0].uri_decode()
	var action := seg[1] if seg.size() == 2 else ""
	var tl := find(s, id)
	if action == "":
		match verb:
			"GET":
				return s.reply(tl) if not tl.is_empty() else s.refuse(404, "Not found")
			"PUT":
				return s.reply(upsert(s, id, body))
			"DELETE":
				if s.tl_air == id:
					stop(s, id)
				s.tl_list.erase(tl)
				s.tl_cells.erase(id)
				return s.reply({"ok": true})
		return null
	if verb == "GET" and action == "state":
		return s.reply(playback(s, id)) if not tl.is_empty() else s.refuse(404, "Timeline not found")
	if verb != "POST":
		return null
	if tl.is_empty() and action in ["play", "take", "seek", "sendto"]:
		return s.refuse(404, "Timeline not found")
	match action:
		"play":
			play(s, id, body.get("from"))
		"pause":
			pause(s, id)
		"stop":
			stop(s, id)
		"seek":
			if not (body.get("ms") is float or body.get("ms") is int) or float(body.ms) < 0.0:
				return s.refuse(400, "ms required (number >= 0)")
			seek(s, id, float(body.ms))
		"sendto":
			set_send_to(s, body, id)
		"loop":
			cell(s, id)["loop"] = body.get("loop") == true
			emit(s, id)
		"take":  # runTimelineDirectTake: on PGM only, from where it stands (no Caspar transition to run here)
			set_send_to(s, {"preview": false, "program": true, "screenIdx": body.get("screenIdx", 0)}, id)
			play(s, id, now_pos(s, id), true)
			return s.reply({"ok": true, "transition": {"type": str(body.get("transition", "MIX"))}, "forceCut": false, "demo": true})
		_:
			return null
	return s.reply({"ok": true})


static func find(s: RefCounted, id: String) -> Dictionary:
	for t in s.tl_list:
		if t is Dictionary and str(t.get("id", "")) == id:
			return t
	return {}


## PUT (create when missing) / POST: the whole timeline, its id kept.
static func upsert(s: RefCounted, id: String, body: Dictionary) -> Dictionary:
	var tl := body.duplicate(true)
	if id == "":
		id = "tl-demo-%d" % int(s.now_ms.call())
	tl["id"] = id
	for k in [["name", "Timeline"], ["duration", 30000.0], ["fps", 25.0], ["flags", []], ["layers", []]]:
		if not tl.has(k[0]):
			tl[k[0]] = k[1]
	var old := find(s, id)
	if old.is_empty():
		s.tl_list.append(tl)
	else:
		old.clear()
		old.merge(tl)
		tl = old
	return tl


## createPlaybackCell.
static func cell(s: RefCounted, id: String) -> Dictionary:
	if not s.tl_cells.has(id):
		s.tl_cells[id] = {"position": 0.0, "playing": false, "loop": false, "t0": s.now_ms.call(), "p0": 0.0}
	return s.tl_cells[id]


## cellNowMs: a playing cell runs on the clock from where it was last set.
static func now_pos(s: RefCounted, id: String) -> float:
	var c := cell(s, id)
	return float(c.p0) + (float(s.now_ms.call()) - float(c.t0)) if c.playing else float(c.position)


static func _set_pos(s: RefCounted, c: Dictionary, pos: float) -> void:
	c["position"] = pos
	c["p0"] = pos
	c["t0"] = s.now_ms.call()


## normalizeTimelineSendTo.
static func send_to(raw: Variant) -> Dictionary:
	if not (raw is Dictionary):
		return {"preview": true, "program": false, "screenIdx": 0}
	var si: Variant = raw.get("screenIdx")
	return {"preview": raw.get("preview") != false, "program": raw.get("program") == true,
		"screenIdx": null if si == null or str(si) == "all" else (int(si) if (si is float or si is int or str(si).is_valid_int()) else 0)}


static func playback(s: RefCounted, id: String) -> Dictionary:
	var c := cell(s, id)
	return {"position": now_pos(s, id), "playing": c.playing, "loop": c.loop, "timelineId": id,
		"sendTo": send_to(find(s, id).get("sendTo"))}


## _emitPb → index.js broadcasts `timeline.playback`.
static func emit(s: RefCounted, id: String) -> void:
	var pb := playback(s, id)
	s.write_path(s.state, "timeline.playback", pb)
	s.send("timeline.playback", pb)


static func _leave_air(s: RefCounted, id: String) -> void:
	var prev: String = s.tl_air
	if prev != "" and prev != id and cell(s, prev).playing:
		_set_pos(s, cell(s, prev), now_pos(s, prev))
		cell(s, prev)["playing"] = false
		emit(s, prev)


## play: a paused timeline on air resumes where it stands (the client's `from` is stale then); `restart` (a take)
## starts at `from`.
static func play(s: RefCounted, id: String, from: Variant, restart := false) -> void:
	var c := cell(s, id)
	var resume: bool = s.tl_air == id and not c.playing and not restart
	_leave_air(s, id)
	var pos := float(c.position) if resume or not (from is float or from is int) else float(from)
	s.tl_air = id
	_set_pos(s, c, pos)
	c["playing"] = true
	s.tl_sent_at = -INF
	emit(s, id)


static func pause(s: RefCounted, id: String) -> void:
	var c := cell(s, id)
	if not c.playing and s.tl_air != id:
		return
	_set_pos(s, c, now_pos(s, id))
	c["playing"] = false
	emit(s, id)


## stop: back to 0; leaving air resets a PGM routing to PRV-only (only a Take puts a timeline on PGM).
static func stop(s: RefCounted, id: String) -> void:
	if id == "":
		return
	if s.tl_air == id:
		s.tl_air = ""
		var tl := find(s, id)
		if tl.get("sendTo") is Dictionary and tl.sendTo.get("program") == true:
			tl["sendTo"] = {"preview": true, "program": false, "screenIdx": tl.sendTo.get("screenIdx", 0)}
	var c := cell(s, id)
	_set_pos(s, c, 0.0)
	c["playing"] = false
	emit(s, id)


## seek: a timeline that is not on air becomes the air one, paused at `ms`.
static func seek(s: RefCounted, id: String, ms: float) -> void:
	var c := cell(s, id)
	var pos := clampf(ms, 0.0, float(find(s, id).get("duration", 0)))
	if s.tl_air != id:
		_leave_air(s, id)
		s.tl_air = id
		c["playing"] = false
	_set_pos(s, c, pos)
	emit(s, id)


static func set_send_to(s: RefCounted, raw: Dictionary, id: String) -> void:
	var tl := find(s, id)
	if tl.is_empty():
		return
	tl["sendTo"] = send_to(send_to(tl.get("sendTo")).merged(raw, true))
	emit(s, id)


## Once a frame: the air timeline's clock, its end (loop or stop) and the throttled `timeline.tick`.
static func tick(s: RefCounted) -> void:
	var id: String = s.tl_air
	if id == "" or not cell(s, id).playing:
		return
	var tl := find(s, id)
	if tl.is_empty():
		return
	var ms := now_pos(s, id)
	if ms >= float(tl.get("duration", 0)):
		if cell(s, id).loop:
			play(s, id, 0.0, true)
		else:
			stop(s, id)
		return
	cell(s, id)["position"] = ms
	var now := float(s.now_ms.call())
	if now - float(s.tl_sent_at) >= TICK_BROADCAST_MS:
		s.tl_sent_at = now
		s.send("timeline.tick", {"timelineId": id, "position": ms})
