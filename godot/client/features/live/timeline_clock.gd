extends RefCounted
## WO-998 — where the timeline on air is now, for the Live tab's times (deck timer bar, compose window rows). The
## engine sends `timeline.playback` on play / pause / stop / end-hold and `timeline.tick` (~150 ms) while playing;
## between ticks the position runs on locally. A timeline is on a bus while its sendTo names that bus and it plays
## or holds its end (the engine clears sendTo.program on stop, timeline-playback-runtime.js stop()).

static var _id := ""    # timelineId of the latest tick / playback
static var _pos := 0.0  # its position, ms
static var _at := 0.0   # when it arrived, ms (0 = never)
static var _listening := false


static func listen() -> void:
	var ws: Variant = _g("Ws")
	if _listening or ws == null:
		return
	_listening = true
	ws.on("timeline.tick", note)
	ws.on("timeline.playback", note)


static func note(d: Variant, now_ms := -1.0) -> void:
	if not (d is Dictionary) or str(d.get("timelineId", "")) == "" or not (d.get("position") is float or d.get("position") is int):
		return
	_id = str(d.timelineId)
	_pos = float(d.position)
	_at = now_ms if now_ms >= 0.0 else Time.get_unix_time_from_system() * 1000.0


static func reset() -> void:
	_id = ""
	_pos = 0.0
	_at = 0.0


## {id, name, elapsed, duration (s), playing} of the timeline on PGM (`pgm`) or PRV of main `main`, else {}.
static func on_air(pb: Variant, timelines: Array, pgm: bool, main: int, now_ms: float) -> Dictionary:
	if not (pb is Dictionary) or str(pb.get("timelineId", "")) == "":
		return {}
	var send: Dictionary = pb.sendTo if pb.get("sendTo") is Dictionary else {}
	var screen := int(send.get("screenIdx", 0)) if send.get("screenIdx") is float or send.get("screenIdx") is int else 0
	if send.get("program" if pgm else "preview") != true or screen != main:
		return {}
	var playing: bool = pb.get("playing") == true
	if not playing and pb.get("endHeld") != true:
		return {}
	var tid := str(pb.timelineId)
	var tl: Dictionary = {}
	for t in timelines:
		if t is Dictionary and str(t.get("id", "")) == tid:
			tl = t
			break
	var dur := float(tl.get("duration", 0)) / 1000.0 if tl.get("duration") is float or tl.get("duration") is int else 0.0
	if dur <= 0.0:
		return {}
	var pos := float(pb.position) if pb.get("position") is float or pb.get("position") is int else 0.0
	if _id == tid and _at > 0.0:
		pos = _pos + (maxf(0.0, now_ms - _at) if playing else 0.0)
	var sec := pos / 1000.0
	sec = fmod(sec, dur) if playing and pb.get("loop") == true else clampf(sec, 0.0, dur)
	return {"id": tid, "name": str(tl.get("name", "Timeline")), "elapsed": sec, "duration": dur, "playing": playing}


## project.timelines.timelines (the same JSON the web keeps).
static func project_timelines() -> Array:
	var store: Variant = _g("Store")
	var r: Variant = store.project.get("timelines") if store != null and store.project is Dictionary else null
	return r.timelines if r is Dictionary and r.get("timelines") is Array else []


## Autoloads by name: this script is preloaded by headless tests, where the autoload identifiers do not compile.
static func _g(name: String) -> Variant:
	var tree := Engine.get_main_loop() as SceneTree
	return tree.root.get_node_or_null(name) if tree != null else null
