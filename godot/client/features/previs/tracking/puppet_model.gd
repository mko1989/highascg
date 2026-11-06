extends RefCounted
## WO-978 — the test puppet's status line and request body for the Markers section (puppet_row.gd). Server:
## GET / POST /api/tracking/puppet (src/tracking/puppet.js) — a simulated person writing hub marker 1 (source
## "puppet"), off at every server start, off by itself after its time limit.

const PATTERNS := ["circle", "figure8", "line", "walk", "hold"]
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


## Controls → POST body.
static func body(on: bool, pattern: String, speed: float, size: float) -> Dictionary:
	return {"enabled": on, "pattern": pattern if pattern in PATTERNS else "circle", "speed": snappedf(speed, 0.01),
		"size": snappedf(size, 0.01)}
