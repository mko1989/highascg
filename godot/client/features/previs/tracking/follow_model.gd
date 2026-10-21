extends RefCounted
## WO-616 T11 — the follow patch `project.fixtures` (Godot-owned slice; the engine is server-side,
## src/fixtures/follow-patch.js normalizes the same way): a manual generic moving-head profile per fixture
## (GDTF comes with WO-615 T1), its marker, and the beam the server's aim draws in the camera view.
##   {output: {enabled, protocol "psn" | "artnet", psn {group, port, iface, system_name, axes}, through {enabled, offset,
##   fade_s}}, dmx {enabled, priority, universes ["artnet:0", "sacn:1"]} (WO-615 T4 master for typed fixtures),
##   patch: [{id, name, enabled, protocol "artnet" | "sacn", universe, address, dest ("" + sACN = multicast),
##    typeId, mode (WO-615 T3 GDTF type — the server derives pan / tilt / channels from it), pan / tilt {ch, fine,
##    range, invert}, pose {x, y, z, hang "truss" | "floor", yaw}, fixed "ch=value, …", follow (marker id), aim_z}]}

const DEFAULT_DEST := "255.255.255.255"
const PORT_ADDRESS_MAX := 32767
const SACN_UNIVERSE_MAX := 63999


static func _num(v: Variant, d: float, lo: float, hi: float) -> float:
	return clampf(float(v), lo, hi) if (v is float or v is int) else d


static func _axis(a: Variant, ch: int, fine: int, range_deg: float) -> Dictionary:
	var o: Dictionary = a if a is Dictionary else {}
	return {"ch": int(_num(o.get("ch"), ch, 1, 512)), "fine": int(_num(o.get("fine"), fine, 0, 512)),
		"range": _num(o.get("range"), range_deg, 1, 1080), "invert": o.get("invert") == true}


static func normalize_fixture(f: Variant, i: int) -> Dictionary:
	var o: Dictionary = f if f is Dictionary else {}
	var pose: Dictionary = o.get("pose") if o.get("pose") is Dictionary else {}
	var dest := str(o.get("dest", "")).strip_edges()
	var sacn: bool = o.get("protocol") == "sacn"
	var type_id := str(o.get("typeId", ""))
	var hex := RegEx.create_from_string("^[0-9a-f]{12}$")
	return {
		"id": str(o.get("id", "")) if str(o.get("id", "")) != "" else "fx%d" % (i + 1),
		"name": str(o.get("name", "")) if str(o.get("name", "")) != "" else "Fixture %d" % (i + 1),
		"enabled": o.get("enabled") != false, "protocol": "sacn" if sacn else "artnet",
		"universe": int(_num(o.get("universe"), 1, 1, SACN_UNIVERSE_MAX)) if sacn
			else int(_num(o.get("universe"), 0, 0, PORT_ADDRESS_MAX)),
		"address": int(_num(o.get("address"), 1, 1, 512)),
		"dest": dest if dest != "" or sacn else DEFAULT_DEST,
		"typeId": type_id if hex.search(type_id) else "", "mode": str(o.get("mode", "")).left(128),
		"pan": _axis(o.get("pan"), 1, 2, 540.0), "tilt": _axis(o.get("tilt"), 3, 4, 270.0),
		"pose": {"x": _num(pose.get("x"), 0, -500, 500), "y": _num(pose.get("y"), 0, -500, 500),
			"z": _num(pose.get("z"), 6, -50, 200), "hang": "floor" if pose.get("hang") == "floor" else "truss",
			"yaw": _num(pose.get("yaw"), 0, -360, 360)},
		"fixed": str(o.get("fixed", "")), "follow": int(_num(o.get("follow"), 0, 0, 65535)),
		"aim_z": _num(o.get("aim_z"), 1, -5, 10),
	}


static func normalize(slice: Variant) -> Dictionary:
	var s: Dictionary = slice if slice is Dictionary else {}
	var out := []
	var ids := {}
	var list: Array = s.get("patch") if s.get("patch") is Array else []
	for i in list.size():
		var fx := normalize_fixture(list[i], i)
		while ids.has(fx.id):
			fx.id += "_"
		ids[fx.id] = true
		out.append(fx)
	var o: Dictionary = s.get("output") if s.get("output") is Dictionary else {}
	return {"output": {"enabled": o.get("enabled") == true,
		"protocol": "artnet" if o.get("protocol") == "artnet" else "psn", "psn": normalize_psn(o.get("psn")),
		"through": normalize_through(o.get("through"))}, "dmx": normalize_dmx(s.get("dmx")), "patch": out,
		"groups": preload("res://features/previs/fixtures/programmer_model.gd").normalize_groups(s.get("groups"))}


## WO-615 T4 fixtures.dmx — twin of gdtf-patch.js normalizeDmx (the universes list is kept in order, deduplicated).
static func normalize_dmx(raw: Variant) -> Dictionary:
	var o: Dictionary = raw if raw is Dictionary else {}
	var pr: Variant = o.get("priority")
	var re := RegEx.create_from_string("^(artnet|sacn):(\\d{1,5})$")
	var unis := []
	for u in (o.get("universes") if o.get("universes") is Array else []):
		var m := re.search(str(u))
		if m == null:
			continue
		var n := int(m.get_string(2))
		var ok := n <= PORT_ADDRESS_MAX if m.get_string(1) == "artnet" else (n >= 1 and n <= SACN_UNIVERSE_MAX)
		var key := "%s:%d" % [m.get_string(1), n]
		if ok and not unis.has(key):
			unis.append(key)
	return {"enabled": o.get("enabled") == true,
		"priority": clampi(roundi(float(pr)), 0, 200) if pr is int or pr is float else 100, "universes": unis}


## WO-632 output.through — twin of follow-through.js normalizeThrough (read the console's Art-Net first).
static func normalize_through(raw: Variant) -> Dictionary:
	var o: Dictionary = raw if raw is Dictionary else {}
	var off: Variant = o.get("offset")
	var fade: Variant = o.get("fade_s")
	return {"enabled": o.get("enabled") == true,
		"offset": clampi(roundi(float(off)), -PORT_ADDRESS_MAX, PORT_ADDRESS_MAX) if off is int or off is float else 0,
		"fade_s": clampf(float(fade), 0.0, 30.0) if fade is int or fade is float else 1.0}


## WO-631 output.psn — the twin of follow-patch.js normalizePsn (multicast group, port, interface IPv4 or "", name, axes).
static func normalize_psn(raw: Variant) -> Dictionary:
	var o: Dictionary = raw if raw is Dictionary else {}
	var g := str(o.get("group", "")).strip_edges()
	var first := int(g.get_slice(".", 0)) if g.is_valid_ip_address() and g.count(".") == 3 else 0
	var iface := str(o.get("iface", "")).strip_edges()
	var name := str(o.get("system_name", "")).strip_edges().left(64)
	return {
		"group": g if first >= 224 and first <= 239 else "236.10.10.10",
		"port": clampi(int(o.port), 1, 65535) if o.get("port") is int or o.get("port") is float else 56565,
		"iface": iface if iface.is_valid_ip_address() and iface.count(".") == 3 else "",
		"system_name": name if name != "" else "HighAsCG",
		"axes": "y_up" if o.get("axes") == "y_up" else "stage",
	}


## A new fixture after the last one: same universe / destination / type, the next free address, the given marker.
## type_fp = the last fixture's GDTF mode footprint when it has a type (the client knows it from /api/fixtures/types).
static func new_fixture(patch: Array, marker_id: int, type_fp := 0) -> Dictionary:
	var n := 1
	var ids := patch.map(func(f: Dictionary) -> String: return f.id)
	while ids.has("fx%d" % n):
		n += 1
	var fx := normalize_fixture({"id": "fx%d" % n, "name": "Fixture %d" % n, "follow": marker_id}, n - 1)
	if not patch.is_empty():
		var last: Dictionary = patch[-1]
		fx.protocol = last.get("protocol", "artnet")
		fx.universe = last.universe
		fx.dest = last.dest
		fx.typeId = last.get("typeId", "")
		fx.mode = last.get("mode", "")
		fx.address = mini(512, int(last.address) + maxi(footprint(last), type_fp))
		fx.pan = last.pan.duplicate()
		fx.tilt = last.tilt.duplicate()
		fx.fixed = last.fixed
		fx.pose = last.pose.duplicate()
		fx.pose.x = float(last.pose.x) + 2.0
	return fx


## Channels the profile spans (highest offset it writes).
static func footprint(fx: Dictionary) -> int:
	var hi := maxi(maxi(fx.pan.ch, fx.pan.fine), maxi(fx.tilt.ch, fx.tilt.fine))
	for part in str(fx.fixed).replace(";", ",").split(",", false):
		var kv := part.strip_edges().split("=")
		if kv.size() == 2 and kv[0].is_valid_int():
			hi = maxi(hi, int(kv[0]))
	return hi


## Beam direction (PSN, unit) for pan / tilt degrees — the server's follow-ik.js beam().
static func beam(pose: Dictionary, pan: float, tilt: float) -> Vector3:
	var s := 1.0 if pose.hang == "floor" else -1.0
	var yaw := deg_to_rad(float(pose.yaw))
	var u := Vector3(0, 0, s)
	var f := Vector3(sin(yaw), cos(yaw), 0)
	var g := Vector3(s * cos(yaw), -s * sin(yaw), 0)
	var p := deg_to_rad(pan)
	var t := deg_to_rad(tilt)
	return cos(t) * u + sin(t) * (cos(p) * f + sin(p) * g)


## Where the drawn beam ends: as far as its marker's aim point, else down to the floor (≤ 40 m). PSN [x, y, z].
static func beam_end(fx: Dictionary, aim: Dictionary, target: Variant, floor_z: float) -> Array:
	var o := Vector3(fx.pose.x, fx.pose.y, fx.pose.z)
	var d := beam(fx.pose, float(aim.get("pan", 0.0)), float(aim.get("tilt", 0.0)))
	var reach := 40.0
	if target is Array:
		reach = o.distance_to(Vector3(target[0], target[1], float(target[2]) + float(fx.aim_z)))
	elif d.z < -1e-3:
		reach = minf(reach, (floor_z - o.z) / d.z)
	var e := o + d * reach
	return [e.x, e.y, e.z]


## Beams to draw in the camera view from the server's aims: [{name, from, to, live}] (PSN [x, y, z]).
## `targets` = marker id → [x, y, z]; a fixture the server does not report is not drawn.
static func beams(patch: Array, aims: Dictionary, targets: Dictionary, floor_z: float) -> Array:
	var out := []
	for fx in patch:
		var a: Variant = aims.get(fx.id)
		if not (a is Dictionary) or (a.get("problem") != null and str(a.problem) != ""):
			continue
		var from := [float(fx.pose.x), float(fx.pose.y), float(fx.pose.z)]
		out.append({"name": fx.name, "from": from, "to": beam_end(fx, a, targets.get(fx.follow), floor_z),
			"live": a.get("state") == "following"})
	return out


## WO-624 E3 — the fixture with a calibration solve applied (POST /api/tracking/follow/calibrate → solve): the solved
## position and yaw (the hang stays the operator's), and Invert pan flipped when the server says the pan runs mirrored.
static func apply_solve(fx: Dictionary, solve: Dictionary) -> Dictionary:
	var out := fx.duplicate(true)
	if solve.get("ok") != true:
		return out
	var p: Dictionary = solve.pose
	for k in ["x", "y", "z", "yaw"]:
		out.pose[k] = float(p[k])
	if solve.get("flip_pan") == true:
		out.pan.invert = not bool(out.pan.invert)
	return out


## One line for the Inspector from a calibration session reply.
static func calib_summary(sess: Dictionary) -> String:
	var n: int = (sess.get("points", []) as Array).size()
	var s: Dictionary = sess.get("solve", {}) if sess.get("solve") is Dictionary else {}
	if s.get("ok") != true:
		var need := int(s.get("need", 3 - n))
		return "%d point%s — %d more to solve." % [n, "" if n == 1 else "s", need]
	var p: Dictionary = s.pose
	var txt := "%d points · fit %.2f° RMS (max %.2f°) → X %.2f  Y %.2f  Z %.2f  yaw %.1f°" % [n, float(s.rms_deg),
		float(s.max_deg), float(p.x), float(p.y), float(p.z), float(p.yaw)]
	if s.get("flip_pan") == true:
		txt += "\nPan runs the other way — Apply also flips Invert pan."
	if s.get("warning") != null and str(s.warning) != "":
		txt += "\n" + str(s.warning)
	return txt


## WO-616 T13b: the server's beam-spot reply (POST …/calibrate/spot) → one line for the calibration Inspector.
static func spot_line(spot: Variant) -> String:
	if not (spot is Dictionary) or not (spot.get("at") is Array):
		return ""
	var px: Array = spot.get("px") if spot.get("px") is Array else [0, 0]
	return "Beam spot at X %.2f  Y %.2f (pixel %d, %d · contrast %d%s)" % [float(spot.at[0]), float(spot.at[1]),
		int(px[0]), int(px[1]), int(spot.get("contrast", 0)), " · vs reference" if spot.get("reference") == true else ""]
