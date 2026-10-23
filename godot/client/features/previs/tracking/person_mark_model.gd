extends RefCounted
## WO-713 — calibrate on a person standing on a stage mark (owner 23.10: "…a person standing on mark # where i can
## position camera or a head to person standing on the mark"). Pure.
## R1 (Lighting → Calibrate heads, Person on the mark): is a detected person near the picked mark, and how far off.
## R3 (tracking camera calibration, Person is on <mark>): the one person a camera sees → the calibration point
## {world: the mark, screen: their feet}.
## Input = the WS `tracking:detections` snapshot (src/tracking/register.js withPins): cameras[] {id, stale,
## persons[] {tid, box [x1, y1, x2, y2] 0–1 of the picture, age_s, floor [x, y, z] | null}}, world {fused,
## persons[] {x, y, age_s}}.

const NEAR_M := 0.5  # further than this from the mark, the person seen is probably not the one standing on it
const FEET_CUT := 0.995  # a box bottom this low (0–1) touches the picture's edge (tools/tracking-detect/detector.py clips)


## Floor spots [x, y] (PSN m) of the persons seen this frame: the fused world persons while 2+ cameras fuse, else
## each camera's own feet points (a solved camera only: detect-model.js boxToFloor). Coasting tracks are left out.
static func floor_spots(snap: Dictionary) -> Array:
	var out := []
	var w: Variant = snap.get("world")
	if w is Dictionary and w.get("fused") == true:
		for p in w.get("persons", []):
			if p is Dictionary and float(p.get("age_s", 0.0)) <= 0.0:
				out.append([float(p.get("x", 0.0)), float(p.get("y", 0.0))])
		return out
	for c in snap.get("cameras", []):
		if not (c is Dictionary) or c.get("stale") == true:
			continue
		for p in c.get("persons", []):
			var f: Variant = p.get("floor") if p is Dictionary else null
			if f is Array and (f as Array).size() >= 2 and float(p.get("age_s", 0.0)) <= 0.0:
				out.append([float(f[0]), float(f[1])])
	return out


## {n: persons on the floor, d: metres from `mark` (x, y) to the nearest — INF when none}.
static func nearest(snap: Dictionary, mark: Dictionary) -> Dictionary:
	var spots := floor_spots(snap)
	var d := INF
	for s in spots:
		d = minf(d, Vector2(s[0] - float(mark.get("x", 0.0)), s[1] - float(mark.get("y", 0.0))).length())
	return {"n": spots.size(), "d": d}


## The heads fold's one line while detection runs ("" while it does not, or no mark is picked).
static func near_line(snap: Dictionary, mark: Dictionary) -> String:
	if snap.get("enabled") != true or snap.get("running") != true or mark.is_empty():
		return ""
	var r := nearest(snap, mark)
	if r.n == 0:
		return "Detection sees nobody on the floor (a solved camera places them)"
	var line := "Person %.2f m off %s%s" % [r.d, mark.get("name", "the mark"), " (nearest of %d)" % r.n if r.n > 1 else ""]
	return line + (" — is someone on the mark?" if r.d > NEAR_M else "")


## Bottom centre of a detection box (0–1 of the picture) in the camera's raster pixels (where calibration clicks
## are) — the feet, the cast the server's floor points make (detect-model.js boxPoint, pin_point bottom).
static func feet_px(b: Array, raster: Vector2) -> Vector2:
	return Vector2((float(b[0]) + float(b[2])) / 2.0 * raster.x, float(b[3]) * raster.y)


## The calibration point a person standing on `mark` gives tracking camera `ce` (tracking_model camera entry):
## {ok: true, point: {id, label, world, screen}} with exactly one person in that camera's picture this frame,
## else {ok: false, error: one line}.
static func person_point(snap: Dictionary, ce: Dictionary, mark: Dictionary) -> Dictionary:
	if ce.is_empty() or mark.is_empty():
		return _no("Pick a stage mark first (Lighting → Calibrate heads places them).")
	if snap.get("enabled") != true or snap.get("running") != true:
		return _no("Person detection is not running (Detect).")
	for c in snap.get("cameras", []):
		if not (c is Dictionary) or str(c.get("id", "")) != str(ce.id):
			continue
		if c.get("stale") == true:
			return _no("No detection frames from %s yet." % ce.name)
		var ps: Array = (c.get("persons", []) as Array).filter(func(p: Variant) -> bool:
			return p is Dictionary and p.get("box") is Array and (p.box as Array).size() >= 4 and float(p.get("age_s", 0.0)) <= 0.0)
		if ps.is_empty():
			return _no("%s detects nobody — the person on %s must be in its picture." % [ce.name, mark.name])
		if ps.size() > 1:
			return _no("%s detects %d persons — only the one on %s may be in the picture." % [ce.name, ps.size(), mark.name])
		if float(ps[0].box[3]) >= FEET_CUT:  # the sidecar clips boxes to the frame: the box bottom is not the feet
			return _no("The person's feet are cut off at the bottom of %s's picture." % ce.name)
		var px := feet_px(ps[0].box, Vector2(float(ce.raster[0]), float(ce.raster[1])))
		return {"ok": true, "point": {"id": "person:%d" % int(mark.id), "label": "Person on %s" % mark.name,
			"world": [float(mark.x), float(mark.y), float(mark.z)], "screen": [snappedf(px.x, 0.01), snappedf(px.y, 0.01)]}}
	return _no("Detection does not watch %s (switch it on in Detect)." % ce.name)


## `points` with `p` in place of any point of its id (the same mark again: the latest feet, the mark's current spot).
static func with_point(points: Array, p: Dictionary) -> Array:
	var out := points.filter(func(q: Variant) -> bool: return not (q is Dictionary and str(q.get("id", "")) == str(p.id)))
	out.append(p)
	return out


static func _no(why: String) -> Dictionary:
	return {"ok": false, "error": why}
