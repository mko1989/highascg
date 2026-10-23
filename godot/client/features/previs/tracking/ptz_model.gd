extends RefCounted
## WO-711 — PTZ camera entries in project.previs.tracking.ptz (twin of src/ptz/ptz-model.js; both normalize the same
## way) and the aim geometry. World = PSN metres (X stage left, Y upstage, Z up); yaw 0 faces upstage, 90 stage left.
## Defaults match a PTZOptics unit (pan ±170° = ±2448 units → 14.4 units / degree, tilt −30…+90°); edit per camera.
## Pure: no nodes, no autoloads.

const PROTOCOLS := ["visca-udp", "visca-ip"]
const PROTOCOL_LABELS := {"visca-udp": "VISCA raw UDP (PTZOptics, Lumens)", "visca-ip": "VISCA over IP (Sony)"}
const DEFAULT_PORTS := {"visca-udp": 1259, "visca-ip": 52381}
const MAX_PINS := 32  # WO-713 R2: offset_map pins per camera


## Only a real `true` (JS `=== true`): 1, "true" are not.
static func _yes(v: Variant) -> bool:
	return v is bool and v


## A JSON-ish number (int / float / numeric string) or the default; booleans, null and "" are junk.
static func _num(v: Variant, d: float, lo: float, hi: float) -> float:
	var n := d
	if v is int or v is float:
		n = float(v)
	elif v is String and (v as String).strip_edges().is_valid_float():
		n = float((v as String).strip_edges())
	if is_nan(n) or is_inf(n):
		n = d
	return clampf(n, lo, hi)


static func _int(v: Variant, d: int, lo: int, hi: int) -> int:
	return int(floorf(_num(v, float(d), float(lo), float(hi)) + 0.5))  # JS Math.round: halves go up


static func _axis(src: Variant, lo: float, hi: float, upd: float) -> Dictionary:
	var o: Dictionary = src if src is Dictionary else {}
	var a := _num(o.get("min"), lo, -360.0, 360.0)
	var b := _num(o.get("max"), hi, -360.0, 360.0)
	if a > b:
		var t := a
		a = b
		b = t
	return {"min": a, "max": b, "units_per_deg": _num(o.get("units_per_deg"), upd, 0.01, 1000.0), "invert": _yes(o.get("invert"))}


## WO-713 R2: offset_map [{pan, tilt, dpan, dtilt}] — a pin needs four real numbers (int / float / numeric string; null,
## boolean, missing drop it), clamped like beam-offset.js normalizeMap; at most MAX_PINS, newest last.
static func normalize_pins(raw: Variant) -> Array:
	var out: Array = []
	if not raw is Array:
		return out
	for p in raw:
		if not p is Dictionary:
			continue
		var ok := true
		var v := {}
		for k in ["pan", "tilt", "dpan", "dtilt"]:
			var x: Variant = (p as Dictionary).get(k)
			ok = ok and (x is int or x is float or (x is String and (x as String).strip_edges().is_valid_float()))
			if ok:
				var f := float(x) if not x is String else float((x as String).strip_edges())
				ok = not is_nan(f) and not is_inf(f)
				v[k] = f
		if ok:
			out.append({"pan": clampf(v.pan, -720.0, 720.0), "tilt": clampf(v.tilt, -360.0, 360.0),
				"dpan": clampf(v.dpan, -180.0, 180.0), "dtilt": clampf(v.dtilt, -180.0, 180.0)})
	return out.slice(maxi(0, out.size() - MAX_PINS))


## beam-offset.js blend: inverse distance² of the pins in (pan, tilt) space; exact on a pin; {0, 0} without pins.
static func blend(pins: Array, pan: float, tilt: float) -> Dictionary:
	if pins.is_empty():
		return {"pan": 0.0, "tilt": 0.0}
	var w := 0.0
	var dp := 0.0
	var dt := 0.0
	for p in pins:
		var d2 := (float(p.pan) - pan) ** 2 + (float(p.tilt) - tilt) ** 2
		if d2 < 1e-12:
			return {"pan": float(p.dpan), "tilt": float(p.dtilt)}
		w += 1.0 / d2
		dp += float(p.dpan) / d2
		dt += float(p.dtilt) / d2
	return {"pan": dp / w, "tilt": dt / w}


static func normalize_camera(src: Variant, i := 0) -> Dictionary:
	var o: Dictionary = src if src is Dictionary else {}
	var pose: Dictionary = o.get("pose") if o.get("pose") is Dictionary else {}
	var speed: Dictionary = o.get("speed") if o.get("speed") is Dictionary else {}
	var home: Dictionary = o.get("home") if o.get("home") is Dictionary else {}
	var protocol: String = o.get("protocol") if PROTOCOLS.has(o.get("protocol")) else "visca-udp"
	var z: Variant = o.get("zoom")
	var zoom: Variant = null
	if not (z == null or (z is String and (z as String) == "")):
		zoom = _int(z, 0, 0, 65535)
	var id := str(o.get("id", ""))
	var nm := str(o.get("name", ""))
	return {
		"id": id if id != "" else "ptz%d" % (i + 1),
		"name": nm if nm != "" else "PTZ %d" % (i + 1),
		"enabled": _yes(o.get("enabled")),
		"auto": _yes(o.get("auto")),
		"protocol": protocol,
		"host": str(o.get("host", "")).strip_edges() if o.get("host") is String else "",
		"port": _int(o.get("port"), DEFAULT_PORTS[protocol], 1, 65535),
		"address": _int(o.get("address"), 1, 1, 7),
		"pose": {"x": _num(pose.get("x"), 0.0, -500.0, 500.0), "y": _num(pose.get("y"), -8.0, -500.0, 500.0),
			"z": _num(pose.get("z"), 2.5, -50.0, 200.0), "yaw": _num(pose.get("yaw"), 0.0, -360.0, 360.0),
			"pitch": _num(pose.get("pitch"), 0.0, -89.0, 89.0)},
		"pan": _axis(o.get("pan"), -170.0, 170.0, 14.4),
		"tilt": _axis(o.get("tilt"), -30.0, 90.0, 14.4),
		"speed": {"pan": _int(speed.get("pan"), 12, 1, 24), "tilt": _int(speed.get("tilt"), 10, 1, 20)},
		"aim_z": _num(o.get("aim_z"), 1.4, -5.0, 10.0),
		"home": {"preset": _int(home.get("preset"), 0, 0, 127)},
		"zoom": zoom,
		"offset_map": normalize_pins(o.get("offset_map")),
	}


## The saved list → normalized entries with unique ids (junk skipped).
static func normalize_list(src: Variant) -> Array:
	var out := []
	var seen := {}
	for raw in src if src is Array else []:
		if not raw is Dictionary:
			continue
		var c := normalize_camera(raw, out.size())
		while seen.has(c.id):
			c.id += "_"
		seen[c.id] = true
		out.append(c)
	return out


## A fresh entry: lowest free "ptzN" id, disabled and not auto (nothing is sent until the operator ticks Enabled).
static func new_camera(existing: Array) -> Dictionary:
	var used := {}
	for c in existing:
		used[str(c.id)] = true
	var n := 1
	while used.has("ptz%d" % n):
		n += 1
	return normalize_camera({"id": "ptz%d" % n, "name": "PTZ %d" % n}, n - 1)


static func wrap180(d: float) -> float:
	var r := fposmod(d + 180.0, 360.0) - 180.0
	return 180.0 if r == -180.0 else r


## {pan, tilt}: the pure geometry (unclamped, pan wrapped) pointing the camera at target {x, y, z} (aim_z added).
static func geom_angles(cam: Dictionary, target: Dictionary) -> Dictionary:
	var dx := float(target.x) - float(cam.pose.x)
	var dy := float(target.y) - float(cam.pose.y)
	var dz := float(target.z) + float(cam.aim_z) - float(cam.pose.z)
	var horiz := sqrt(dx * dx + dy * dy)
	var bearing: float = float(cam.pose.yaw) if horiz < 1e-6 else rad_to_deg(atan2(dx, dy))
	return {"pan": wrap180(bearing - float(cam.pose.yaw)), "tilt": rad_to_deg(atan2(dz, horiz)) - float(cam.pose.pitch)}


## {pan, tilt, clamped}: degrees (+ right / + up) pointing the camera at target {x, y, z} (aim_z added): the geometry
## plus the offset_map blend at those geometric angles, clamped to the ranges.
static func aim_angles(cam: Dictionary, target: Dictionary) -> Dictionary:
	var g := geom_angles(cam, target)
	var o := blend(cam.get("offset_map", []), g.pan, g.tilt)
	var pan_want: float = g.pan + o.pan
	var tilt_want: float = g.tilt + o.tilt
	var pan := clampf(pan_want, cam.pan.min, cam.pan.max)
	var tilt := clampf(tilt_want, cam.tilt.min, cam.tilt.max)
	return {"pan": pan, "tilt": tilt, "clamped": pan != pan_want or tilt != tilt_want}


## Degrees → signed 16-bit camera units.
static func to_units(axis: Dictionary, deg: float) -> int:
	var u := int(floorf(deg * float(axis.units_per_deg) + 0.5)) * (-1 if axis.invert else 1)
	return clampi(u, -32768, 32767)


## One line for the server's per-camera status (GET /api/tracking/auto `ptz`: {id, name, enabled, state, pan?, tilt?, error?}).
static func status_line(st: Variant) -> String:
	if not st is Dictionary:
		return "—"
	var s: Dictionary = st
	var txt := str(s.get("state", "—"))
	if s.get("pan") != null and s.get("tilt") != null:
		txt += "  %.1f° / %.1f°" % [float(s.pan), float(s.tilt)]
	if s.get("error") != null and str(s.error) != "":
		txt += "  — " + str(s.error)
	return txt
