extends RefCounted
## WO-616 T10d — the verification walk's pure half (walk_section.gd is the UI): the grid lines offered for walking and
## the status text for GET /api/tracking/verify (src/tracking/verify-walk.js). No autoloads, so tests can load it.


## The grid's edges and centre lines, walkable from end to end.
static func lines(g: Dictionary) -> Array:
	var x0: float = g.x_offset - g.width / 2.0
	var x1: float = g.x_offset + g.width / 2.0
	var y0: float = g.y_offset - g.depth / 2.0
	var y1: float = g.y_offset + g.depth / 2.0
	var out := []
	for l in [["Downstage edge", [x0, y0], [x1, y0]], ["Centre line, across", [x0, g.y_offset], [x1, g.y_offset]],
			["Upstage edge", [x0, y1], [x1, y1]], ["Centre line, up and down", [g.x_offset, y0], [g.x_offset, y1]],
			["Stage-left edge", [x1, y0], [x1, y1]], ["Stage-right edge", [x0, y0], [x0, y1]]]:
		out.append({"name": l[0], "a": l[1], "b": l[2], "z": g.z_offset})
	return out


## GET /api/tracking/verify status → the text under the buttons.
static func describe(st: Dictionary) -> String:
	if st.get("running") == true and st.get("live") is Dictionary:
		var l: Dictionary = st.live
		if l.get("person") == null:
			return "Walking — step onto the line: waiting for a person within 1 m of it."
		var w: Dictionary = l.world
		return "Walking — P%d · %d samples · %.1f s · off the line: mean %s cm · %d %% of the line walked" % [
			int(l.person), int(l.samples), float(l.elapsed_s), _cm(w.mean_cm), roundi(100.0 * float(l.covered))]
	var r: Variant = st.get("result")
	if not r is Dictionary:
		return "Walk the line shown in the camera view, at a steady pace, end to end."
	if r.get("ok") != true:
		return "Too few samples (%d) — nobody tracked on the line long enough. Walk again." % int(r.get("samples", 0))
	var w2: Dictionary = r.world
	var lines_out := ["P%d · %d samples · %.1f s · %d %% of the line walked" % [int(r.person), int(r.samples),
		float(r.duration_s), roundi(100.0 * float(r.covered))],
		"Tracked position off the line: mean %s · RMS %s · max %s cm" % [_cm(w2.mean_cm), _cm(w2.rms_cm), _cm(w2.max_cm)]]
	var cams: Dictionary = r.get("cameras", {})
	for id in cams:
		var c: Dictionary = cams[id]
		lines_out.append("%s alone: RMS %s · max %s cm (%d samples)" % [id, _cm(c.rms_cm), _cm(c.max_cm), int(c.n)])
	var src: Dictionary = r.get("sources", {})
	var parts := []
	for k in src:
		parts.append("%s %d %%" % [k, roundi(100.0 * float(src[k]) / maxf(1.0, float(r.samples)))])
	if not parts.is_empty():
		lines_out.append("Source: " + " · ".join(parts))
	return "\n".join(lines_out)


static func _cm(v: Variant) -> String:
	return "–" if v == null else str(snappedf(float(v), 0.1))
