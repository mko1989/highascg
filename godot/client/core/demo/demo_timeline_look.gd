extends RefCounted
## WO-865 — the timeline on air as a picture. The node's timeline runtime plays a timeline's clips on the Caspar channels
## its `sendTo` names (program and / or preview of a main); here the air timeline (demo_timeline.gd: `tl_air`, its cell) is
## turned into a synthetic live entry — the clips under the playhead as layers of a look — which demo_server.gd bus() hands
## to the channel's bus model instead of `scene.live[ch]`, so a playing demo timeline changes the PGM / PRV pictures (and
## fades in / out like a take). Per clip: source, loop, opacity and the fill rectangle (`fillPx`, canvas pixels). Not
## simulated: keyframes, in / out points, a clip started mid-way (a clip plays from its first frame when it appears).

const Tr := preload("res://core/demo/demo_transition.gd")

## → [entry, fx] for channel `ch` at `now` (seconds): the timeline's entry when one is on air for that channel, else the
## `entry` / `fx` the caller passed.
static func apply(s: RefCounted, ch: int, entry: Dictionary, fx: Dictionary, now: float) -> Array:
	var tl := _air_for(s, ch)
	var shown := str(tl.get("id", ""))
	var was: String = s.tl_shown.get(ch, "")  # what this channel showed last frame: a change starts a fade
	s.tl_shown[ch] = shown
	if shown == "":
		if was != "":  # the timeline left: back to the look on the bus, faded
			fx = {"kind": "take", "transition": _mix(), "fps": float(fx.get("fps", 25.0)), "at": now}
		return [entry, fx]
	var layers := _layers(s, tl, ch)
	var e := {"sceneId": "timeline:%s" % shown, "updatedAt": ",".join(PackedStringArray(layers.map(func(l: Dictionary) -> String: return str(l.id)))),
		"scene": {"id": "timeline:%s" % shown, "name": str(tl.get("name", "Timeline")), "layers": layers}}
	if was != shown:
		fx = {"kind": "take", "transition": _mix(), "fps": float(fx.get("fps", 25.0)), "at": now}
	return [e, fx]


static func _mix() -> Dictionary:
	return {"type": "MIX", "duration": 12, "tween": "linear"}


## The air timeline when its sendTo reaches channel `ch` ({} otherwise).
static func _air_for(s: RefCounted, ch: int) -> Dictionary:
	var id: String = s.tl_air
	if id == "":
		return {}
	var tl := _find(s, id)
	var st: Variant = tl.get("sendTo")
	var cm: Variant = s.state.get("channelMap")
	if tl.is_empty() or not (st is Dictionary) or not (cm is Dictionary):
		return {}
	for bus in [["program", "programChannels"], ["preview", "previewChannels"]]:
		if st.get(bus[0]) != true:
			continue
		var list: Variant = cm.get(bus[1])
		if not (list is Array):
			continue
		for mi in (list as Array).size():
			var screen: Variant = st.get("screenIdx")
			if list[mi] != null and int(list[mi]) == ch and (screen == null or int(screen) == mi):
				return tl
	return {}


static func _find(s: RefCounted, id: String) -> Dictionary:
	for t in s.tl_list:
		if t is Dictionary and str(t.get("id", "")) == id:
			return t
	return {}


## The clips under the playhead, timeline layer 1 at the bottom (layerNumber 10, 11, …).
static func _layers(s: RefCounted, tl: Dictionary, ch: int) -> Array:
	var c: Dictionary = s.tl_cells.get(str(tl.id), {})
	var pos := float(c.get("p0", 0.0)) + (float(s.now_ms.call()) - float(c.get("t0", 0.0))) if c.get("playing") == true else float(c.get("position", 0.0))
	var by: Variant = (s.state.get("channelMap", {}) as Dictionary).get("channelResolutionsByChannel")
	var res: Variant = (by as Dictionary).get(str(ch)) if by is Dictionary else null
	var w := maxf(1.0, float(res.get("w", 1920))) if res is Dictionary else 1920.0
	var h := maxf(1.0, float(res.get("h", 1080))) if res is Dictionary else 1080.0
	var out := []
	var rows: Array = tl.get("layers", []) if tl.get("layers") is Array else []
	for i in rows.size():
		for clip in (rows[i].get("clips", []) if rows[i] is Dictionary and rows[i].get("clips") is Array else []):
			var st := float(clip.get("startTime", 0))
			if not (clip is Dictionary) or pos < st or pos >= st + float(clip.get("duration", 0)):
				continue
			var f: Variant = clip.get("fillPx")
			out.append({"id": str(clip.get("id", "")), "layerNumber": 10 + i, "source": clip.get("source", {}), "loop": clip.get("loop") == true or clip.get("loopAlways") == true,
				"opacity": float(clip.get("opacity", 1)), "contentFit": str(clip.get("contentFit", "native")), "aspectLocked": clip.get("aspectLocked") != false,
				"fill": {"x": float(f.get("x", 0)) / w, "y": float(f.get("y", 0)) / h, "scaleX": float(f.get("w", w)) / w, "scaleY": float(f.get("h", h)) / h} if f is Dictionary else {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}})
	return out
