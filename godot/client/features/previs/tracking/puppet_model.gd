extends RefCounted
## WO-978 — the test puppet's status line and request body for the Markers section (puppet_row.gd). Server:
## GET / POST /api/tracking/puppet (src/tracking/puppet.js) — a simulated person writing hub marker 1 (source
## "puppet"), off at every server start, off by itself after its time limit.

const PATTERNS := ["circle", "figure8", "line", "walk", "hold"]
const HEAD_M := 1.7  # the puppet's head above the floor it walks on (server DEFAULTS.z)
const LABELS := ["Circle", "Figure 8", "Line (left ↔ right)", "Walk (square)", "Hold (stand still)"]


## GET / POST answer (`data`, may be null) → one status line.
static func summary(s: Variant) -> String:
	if not (s is Dictionary) or (s as Dictionary).is_empty():
		return "No answer — the Tracking module is off on the server."
	var d: Dictionary = s
	if d.get("error") is String:
		return "Refused: %s" % d.error
	if d.get("enabled") == true:
		var p: Dictionary = d.get("position") if d.get("position") is Dictionary else {}
		return "ON — marker %d \"%s\" at %.1f, %.1f m · it switches itself off in %d min" % [int(d.get("id", 1)),
			str(d.get("name", "Puppet")), float(p.get("x", 0.0)), float(p.get("y", 0.0)), ceili(float(d.get("ends_in_s", 0.0)) / 60.0)]
	var why := ("Off — it switched itself off (time limit). " if d.get("stopped") == "ttl" else "Off. ")
	return why + "A simulated person for testing the lighting desk; never leave it on at a show."


## "Centre on marker": the path's centre = the marker's spot, head height above where the marker is. {} = no marker.
static func marker_body(m: Variant) -> Dictionary:
	if not (m is Dictionary) or not ((m as Dictionary).get("x") is float or m.get("x") is int) or not (m.get("y") is float or m.get("y") is int):
		return {}
	var z: float = float(m.get("z", 0.0)) if (m.get("z") is float or m.get("z") is int) else 0.0
	return {"centre": "custom", "x": snappedf(float(m.x), 0.01), "y": snappedf(float(m.y), 0.01), "z": snappedf(z + HEAD_M, 0.01)}


## "Centre on stage": back to the tracking stage's centre (the server reads the stage itself).
static func stage_body() -> Dictionary:
	return {"centre": "stage", "z": HEAD_M}


## Controls → POST body.
static func body(on: bool, pattern: String, speed: float, size: float) -> Dictionary:
	return {"enabled": on, "pattern": pattern if pattern in PATTERNS else "circle", "speed": snappedf(speed, 0.01),
		"size": snappedf(size, 0.01)}
