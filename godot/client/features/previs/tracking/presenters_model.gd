extends RefCounted
## WO-675 — pure helpers of presenters_section.gd (no autoloads, so tests/test_tracking_presenters.gd can load them).


## The persons the operator can bind: fused world persons (P-tags) when fused, else each camera's tracks.
static func persons(det: Dictionary) -> Array:
	var out := []
	var world: Dictionary = det.get("world", {}) if det.get("world") is Dictionary else {}
	if world.get("fused") == true:
		for w in world.get("persons", []):
			if w is Dictionary and float(w.get("age_s", 1)) == 0.0:
				out.append({"key": "w:%d" % int(w.id), "label": "P%d" % int(w.id)})
		return out
	for c in det.get("cameras", []):
		if c is Dictionary and c.get("stale") != true:
			for p in c.get("persons", []):
				if p is Dictionary and float(p.get("age_s", 1)) == 0.0:
					out.append({"key": "%s:%d" % [str(c.id), int(p.tid)], "label": "%s #%d" % [str(c.id), int(p.tid)]})
	return out


static func label_of(key: String) -> String:
	return "P" + key.get_slice(":", 1) if key.begins_with("w:") else key.replace(":", " #")


## One line under the name: where the presenter is, or what recognition thinks (face, and P2 body for wide shots).
static func status_of(p: Dictionary, suggestion: Dictionary) -> String:
	if p.get("person") != null and str(p.person) != "":
		return "On stage as %s — marker %d" % [label_of(str(p.person)), int(p.marker)]
	if not suggestion.is_empty():
		var via := str(suggestion.get("via", ""))
		var how := "" if via == "" else " by " + via.replace("+", " + ")
		return "Looks like %s%s (%d %%) — confirm?" % [label_of(str(suggestion.key)), how, roundi(float(suggestion.score) * 100.0)]
	var face := str(p.get("face", ""))
	var body := str(p.get("body", ""))
	if face == "pending" or body == "pending":
		return "Reading the photo…"
	if face == "ok" and body == "ok":
		return "Not on stage"
	if face == "ok":
		return "Not on stage · face only"
	if body == "ok":
		return "Not on stage · body only"
	if face == "none" and body == "none":
		return "No face or person found in the photo: bind by hand"
	if face == "none":
		return "No face found in the photo: bind by hand"
	return "Recognition unavailable: bind by hand"
