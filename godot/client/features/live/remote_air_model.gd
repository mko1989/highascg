extends RefCounted
## WO-1029 plan 07 (C15, plan 3.5) — what is on air on a screen that is on ANOTHER linked server, from
## state.scene.remoteLive (published by the owner through dest.air; WS cluster:dest-air updates it). Pure.
## Shape (src/cluster/dest-air-view.js, read from the server code; DEST-SHAPES.md was not written yet): remoteLive is an
## Array by screen index (null = nobody reported); an entry is {server: {id, name}, destId, screen, unknown, age_ms,
## pgm: {sceneId, name, at, age_ms}|null, prv, testcard: bool|null, ftb: bool|null, timeline: {id, state,
## position_ms, at, age_ms}|null, holder, clips: [...]}; `unknown: true` carries nulls and last_seen_age_ms.
## A null entry or `unknown: true` is UNKNOWN, never "nothing on air"; only a known entry's `pgm: null` is "nothing".
## Also tolerated: a Dictionary keyed by the index, timeline `position` / `age` without the _ms suffix.
## Without remoteLive (older server) every answer is unknown.

const UNKNOWN := "unknown"


static func entry(scene: Variant, idx: int) -> Dictionary:
	var r: Variant = (scene as Dictionary).get("remoteLive") if scene is Dictionary else null
	var e: Variant = null
	if r is Array and idx >= 0 and idx < (r as Array).size():
		e = (r as Array)[idx]
	elif r is Dictionary:
		e = (r as Dictionary).get(str(idx))
	return e if e is Dictionary else {}


static func is_known(e: Dictionary) -> bool:
	return not e.is_empty() and e.get("unknown") != true and e.get("expired") != true


## {state: "look" | "empty" | "unknown", id, name} for bus "pgm" | "prv".
static func look(e: Dictionary, bus: String) -> Dictionary:
	if not is_known(e) or not e.has(bus):
		return {"state": UNKNOWN, "id": "", "name": ""}
	var l: Variant = e.get(bus)
	if l is Dictionary and (str((l as Dictionary).get("sceneId", "")) != "" or str((l as Dictionary).get("name", "")) != ""):
		return {"state": "look", "id": str(l.get("sceneId", "")), "name": str(l.get("name", l.get("sceneId", "")))}
	if l is String and l != "":
		return {"state": "look", "id": l, "name": l}
	return {"state": "empty", "id": "", "name": ""}


## The owning server's name as the owner reported it ("" when not given).
static func server_name(e: Dictionary) -> String:
	var s: Variant = e.get("server")
	return str((s as Dictionary).get("name", (s as Dictionary).get("id", ""))) if s is Dictionary else ""


## Current position (s) of a reported clip {position_s, length_s|null, paused, loop, age_ms}: position_s plus (paused ? 0 :
## age_ms/1000 + the time since the message arrived), wrapped by length_s when it loops, else clamped to it.
static func clip_pos_s(c: Dictionary, waited_ms := 0.0) -> float:
	var pos := float(c.get("position_s", 0.0))
	if c.get("paused") != true:
		pos += maxf(0.0, float(c.get("age_ms", 0.0))) / 1000.0 + maxf(0.0, waited_ms) / 1000.0
	var len: Variant = c.get("length_s")
	if len != null and float(len) > 0.0:
		pos = fposmod(pos, float(len)) if c.get("loop") == true else minf(pos, float(len))
	return pos


## The first reported clip of bus "pgm" | "prv" as {name, pos_s} ({} when none / unknown).
static func clip_of(e: Dictionary, bus: String, waited_ms := 0.0) -> Dictionary:
	if not is_known(e):
		return {}
	for c in (e.get("clips") if e.get("clips") is Array else []):
		if c is Dictionary and str(c.get("bus", "pgm")) == bus:
			var segs := str(c.get("clip", "")).replace("\\", "/").split("/", false)
			return {"name": segs[segs.size() - 1] if segs.size() > 0 else "", "pos_s": clip_pos_s(c, waited_ms)}
	return {}


## "on" | "off" | "unknown" for `testcard` / `ftb`.
static func flag(e: Dictionary, key: String) -> String:
	if not is_known(e) or not e.has(key) or e.get(key) == null:
		return UNKNOWN
	return "on" if e.get(key) == true else "off"


## Playback position in ms extrapolated from `position + age` (+ `extra_ms` the client has waited since it got the
## state) while the timeline plays; the plain position when paused / stopped; -1 = unknown or no timeline.
static func timer_ms(e: Dictionary, extra_ms := 0.0) -> float:
	var tl: Variant = e.get("timeline") if is_known(e) else null
	if not (tl is Dictionary) or ((tl as Dictionary).get("position_ms") == null and (tl as Dictionary).get("position") == null):
		return -1.0
	var pos := float(tl.get("position_ms", tl.get("position", 0)))
	if str(tl.get("state", "")) == "playing":
		pos += maxf(0.0, float(tl.get("age_ms", tl.get("age", e.get("age_ms", e.get("age", 0.0)))))) + maxf(0.0, extra_ms)
	return pos


## One quiet line for a tile/card: "PGM Name · PRV Name · test card · FTB" ("" when nothing is known).
static func summary(e: Dictionary) -> String:
	if not is_known(e):
		return ""
	var bits := PackedStringArray()
	for bus in ["pgm", "prv"]:
		var l := look(e, bus)
		bits.append("%s %s" % [bus.to_upper(), l.name if l.state == "look" else ("—" if l.state == "empty" else "?")])
	if flag(e, "testcard") == "on":
		bits.append("test card")
	if flag(e, "ftb") == "on":
		bits.append("FTB")
	return " · ".join(bits)
