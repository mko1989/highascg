extends RefCounted
## WO-1088 — "keeping up", pure: this client's own fps check (against the cap app/render_pacer.gd holds, with the same
## rise / fall hysteresis as the server's src/health/keeping-up-model.js), merged with the server's checks
## (GET /api/health/keeping-up · WS health:keeping-up) into one list, offenders first; the worst one names the header
## label ("Visuals at 38 of 50 fps"). Levels: 0 ok · 1 behind (amber) · 2 failing (red).

const OK := 0
const BEHIND := 1
const FAILING := 2
const STATUS := ["ok", "behind", "failing"]
const GROUP_RANK := {"caspar": 0, "output": 1, "source": 2, "client": 3, "server": 4, "box": 5}
const RISE := 3  # the cap moving (raise / lower) takes the per-second fps average ~2 s to follow
const FALL := 5
const FPS_HINT := "This client renders fewer frames than its cap: the GUI stutters%s. A busy GPU or CPU, or a heavy tab (previs 3D), is the usual cause."


## Raw level of this client's fps. Publishing (Visuals on air), below the channel rate itself is failing: Caspar repeats
## frames. Otherwise behind under 80 % of the cap, failing under half.
static func fps_level(fps: float, target: float, publishing: bool, channel_fps: float) -> int:
	if fps < 0.0 or target <= 0.0:
		return OK
	if publishing:
		if channel_fps > 0.0 and fps < 0.95 * channel_fps:
			return FAILING
		return BEHIND if fps < 0.85 * target else OK
	if fps < 0.5 * target:
		return FAILING
	return BEHIND if fps < 0.8 * target else OK


## One hysteresis step: {status, up, up_min, down, down_max} → the same with the new status.
static func step(st: Dictionary, raw: int, rise := RISE, fall := FALL) -> Dictionary:
	var s := st.duplicate()
	var cur := int(s.get("status", OK))
	if raw > cur:
		s.down = 0
		s.up = int(s.get("up", 0)) + 1
		s.up_min = raw if s.up == 1 else mini(int(s.get("up_min", FAILING)), raw)
		if s.up >= rise:
			s.status = s.up_min
			s.up = 0
	elif raw < cur:
		s.up = 0
		s.down = int(s.get("down", 0)) + 1
		s.down_max = raw if s.down == 1 else maxi(int(s.get("down_max", OK)), raw)
		if s.down >= fall:
			s.status = s.down_max
			s.down = 0
	else:
		s.up = 0
		s.down = 0
	s.status = int(s.get("status", OK))
	return s


## This client's fps as a check row (same shape as the server's). `name` is "This client" locally, the reported copy
## carries the client's name for the others.
static func fps_check(fps: float, target: int, why: String, level: int, publishing: bool, name := "This client") -> Dictionary:
	var f := roundi(maxf(fps, 0.0))
	return {"key": "client-fps", "group": "client", "name": name, "level": level, "status": STATUS[level], "target": target,
		"measured": f, "unit": "fps", "text": "%d / %d fps · %s" % [f, target, why],
		"label": "%s at %d of %d fps" % [name, f, target] if level > OK else "",
		"hint": FPS_HINT % (", and the Visuals it feeds judder on air" if publishing else ""), "severity": target - f}


## Server summary + this client's own checks → {level, status, label, short, checks, incidents} (`short`: the worst
## check's name, for the narrow header). The server's copy of this
## client's report (key client:<my_id>:…) is left out: the local one is fresher.
static func merge(server: Variant, local: Array, my_id: String) -> Dictionary:
	var checks: Array = []
	var incidents: Array = []
	if server is Dictionary:
		for c in (server as Dictionary).get("checks", []):
			if c is Dictionary and not str(c.get("key", "")).begins_with("client:%s:" % my_id):
				checks.append(c)
		incidents = (server as Dictionary).get("incidents", []) if (server as Dictionary).get("incidents") is Array else []
	checks.append_array(local)
	checks.sort_custom(_before)
	var worst: Dictionary = checks[0] if not checks.is_empty() and int(checks[0].get("level", 0)) > OK else {}
	var lvl := int(worst.get("level", OK))
	return {"level": lvl, "status": STATUS[lvl], "label": str(worst.get("label", worst.get("name", ""))) if lvl > OK else "",
		"short": str(worst.get("name", "")) if lvl > OK else "", "checks": checks, "incidents": incidents}


static func _before(a: Dictionary, b: Dictionary) -> bool:
	var la := int(a.get("level", 0))
	var lb := int(b.get("level", 0))
	if la != lb:
		return la > lb
	var ga := int(GROUP_RANK.get(str(a.get("group", "")), 9))
	var gb := int(GROUP_RANK.get(str(b.get("group", "")), 9))
	if ga != gb:
		return ga < gb
	return str(a.get("key", "")) < str(b.get("key", ""))


## "21:43:10" from a server epoch-ms, in the box's local time.
static func clock(ms: float) -> String:
	if ms <= 0.0:
		return "—"
	var bias := int(Time.get_time_zone_from_system().get("bias", 0)) * 60
	var t := Time.get_time_dict_from_unix_time(int(ms / 1000.0) + bias)
	return "%02d:%02d:%02d" % [t.hour, t.minute, t.second]


## One history entry without its clock: "12 s · Visuals at 38 of 50 fps — worst 31 / 50 fps" (open: "ongoing · …").
static func incident_line(i: Dictionary) -> String:
	var dur := ("%d s" % int(i.durationS)) if i.get("durationS") != null else "ongoing"
	return "%s · %s — worst %s" % [dur, str(i.get("label", "")), str(i.get("worst", ""))]


## The whole history line: "21:43:10 · 12 s · Visuals at 38 of 50 fps — worst 31 / 50 fps".
static func incident_text(i: Dictionary) -> String:
	return "%s · %s" % [clock(float(i.get("startedAt", 0))), incident_line(i)]
