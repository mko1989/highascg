extends RefCounted
## WO-1085 — Auto follow "spot handover" settings (project.fixtures.handover) and what the Inspector / previs show.
## normalize() is the twin of src/fixtures/follow-handover.js normalizeHandover: Split (WO-708, the default) or Spot
## handover (N heads per person, threshold margin, cross-fade, nobody → home or dark), the automation levels
## universe for a console (PSN only) and the LD's grant channel (read-through only).

const PORT_ADDRESS_MAX := 32767
const SACN_UNIVERSE_MAX := 63999
const MODES := [["split", "Split — every Auto head follows"], ["handover", "Spot handover — N heads per person"]]
const IDLE := [["home", "Nobody: heads go home"], ["dark", "Nobody: all dark"]]
const STUB := 3.0  # a threshold that misses the tracking grid is drawn ± this many metres around its point


static func _num(v: Variant, d: float, lo: float, hi: float) -> float:
	return clampf(float(v), lo, hi) if (v is int or v is float) and is_finite(float(v)) else d


static func _int(v: Variant, d: int, lo: int, hi: int) -> int:
	return int(round(_num(v, d, lo, hi)))


static func normalize(raw: Variant) -> Dictionary:
	var o: Dictionary = raw if raw is Dictionary else {}
	var l: Dictionary = o.get("levels") if o.get("levels") is Dictionary else {}
	var g: Dictionary = o.get("grant") if o.get("grant") is Dictionary else {}
	var sacn: bool = l.get("protocol") == "sacn"
	var dest: String = str(l.get("dest")).strip_edges().left(64) if l.get("dest") is String else ""
	return {
		"mode": "handover" if o.get("mode") == "handover" else "split",
		"heads": _int(o.get("heads"), 3, 1, 16),
		"margin_m": _num(o.get("margin_m"), 0.5, 0, 5),
		"fade_s": _num(o.get("fade_s"), 1, 0, 10),
		"idle": "dark" if o.get("idle") == "dark" else "home",
		"levels": {"enabled": l.get("enabled") == true, "protocol": "sacn" if sacn else "artnet",
			"universe": _int(l.get("universe"), 100, 1, SACN_UNIVERSE_MAX) if sacn else _int(l.get("universe"), 100, 0, PORT_ADDRESS_MAX),
			"address": _int(l.get("address"), 1, 1, 512), "dest": dest},
		"grant": {"enabled": g.get("enabled") == true, "universe": _int(g.get("universe"), 0, 0, PORT_ADDRESS_MAX),
			"address": _int(g.get("address"), 512, 1, 512), "per_head": g.get("per_head") == true},
	}


## The server's thresholds [{at: [x, y], dir: [ux, uy]}] (PSN floor, `dir` = the rig axis) → floor segments
## [[Vector2, Vector2]] across the rig, clipped to the tracking grid (tracking_model.gd normalize_grid).
static func segments(thresholds: Variant, grid: Dictionary) -> Array:
	var out := []
	if not thresholds is Array:
		return out
	var hw: float = float(grid.get("width", 0)) / 2.0
	var hd: float = float(grid.get("depth", 0)) / 2.0
	var lo := Vector2(float(grid.get("x_offset", 0)) - hw, float(grid.get("y_offset", 0)) - hd)
	var hi := Vector2(float(grid.get("x_offset", 0)) + hw, float(grid.get("y_offset", 0)) + hd)
	for t in thresholds:
		if not (t is Dictionary and t.get("at") is Array and t.get("dir") is Array and t.at.size() == 2 and t.dir.size() == 2):
			continue
		var at := Vector2(float(t.at[0]), float(t.at[1]))
		var across := Vector2(-float(t.dir[1]), float(t.dir[0]))
		if across.length() < 1e-6:
			continue
		var clip := _clip(at, across.normalized(), lo, hi)
		out.append(clip if not clip.is_empty() else [at - across.normalized() * STUB, at + across.normalized() * STUB])
	return out


## The line at + s·d inside the rectangle lo…hi (Liang–Barsky), or [] when it misses.
static func _clip(at: Vector2, d: Vector2, lo: Vector2, hi: Vector2) -> Array:
	var s0 := -INF
	var s1 := INF
	for k in 2:
		if absf(d[k]) < 1e-9:
			if at[k] < lo[k] or at[k] > hi[k]:
				return []
			continue
		var a := (lo[k] - at[k]) / d[k]
		var b := (hi[k] - at[k]) / d[k]
		s0 = maxf(s0, minf(a, b))
		s1 = minf(s1, maxf(a, b))
	return [at + d * s0, at + d * s1] if s1 > s0 else []


## One status line from GET /api/tracking/follow `handover` (the engine's status).
static func status_text(st: Variant) -> String:
	if not st is Dictionary or st.is_empty():
		return "Server not reporting the handover (Tracking module off, or an older server)."
	if st.get("mode") != "handover":
		return "Split: every Auto head follows its person (WO-708)."
	var parts := ["%d threshold%s" % [st.get("thresholds", []).size(), "" if st.get("thresholds", []).size() == 1 else "s"]]
	var lv: Dictionary = st.get("levels") if st.get("levels") is Dictionary else {}
	if lv.get("enabled") == true:
		parts.append("levels: " + (str(lv.problem) if lv.get("problem") != null and str(lv.get("problem")) != "" else
			"%d packets" % int(lv.get("packets", 0)) if lv.get("live") == true else "waits for the output master"))
	var g: Dictionary = st.get("grant") if st.get("grant") is Dictionary else {}
	if g.get("enabled") == true:
		parts.append("grant: " + grant_text(g))
	var nd: Array = st.get("no_dimmer") if st.get("no_dimmer") is Array else []
	if not nd.is_empty():
		parts.append("no Dimmer channel: " + ", ".join(nd.map(func(x: Variant) -> String: return str(x))))
	return " · ".join(parts)


## The LD's grant channel, said plainly (state from follow-handover.js _readGrant; value = the channel's byte).
static func grant_text(g: Dictionary) -> String:
	if g.get("needs_through") == true:
		return "needs Art-Net read-through (the heads must have a console to go back to)"
	var on: bool = (g.get("value") is int or g.get("value") is float) and float(g.value) >= 128.0
	match str(g.get("state")):
		"live":
			return ("HighAsCG drives the spot" if on else "the console has the heads") + (" (%d)" % int(g.value) if g.get("value") != null else "")
		"held":
			return "console silent — last grant held"
		"lost":
			return "console lost — heads handed back to its last frame"
		"none":
			return "no console frame on U%d yet — the console has the heads" % int(g.get("universe", 0))
	return str(g.get("state", "off"))
