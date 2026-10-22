extends RefCounted
## WO-675 — the backstage presenter roster (server src/tracking/presenters.js, GET /api/tracking/presenters) as quick
## picks in the lower-third inspector: Title = the name, Subtitle = the tech's note (role / company). Presenters on
## stage (bound to a tracked person) come first, then in intake order.


## snapshot → [{id, label, title, subtitle, on_stage}]
static func picks(snap: Variant) -> Array:
	var list: Array = snap.get("presenters", []) if snap is Dictionary and snap.get("presenters") is Array else []
	var out := []
	for p in list:
		if not p is Dictionary or str(p.get("name", "")).strip_edges() == "":
			continue
		var on_stage: bool = p.get("person") != null and str(p.get("person")) != ""
		var bits := PackedStringArray([str(p.name).strip_edges()])
		if str(p.get("mic", "")).strip_edges() != "":
			bits.append("mic " + str(p.mic).strip_edges())
		if on_stage:
			bits.append("on stage")
		out.append({"id": str(p.get("id", "")), "label": " · ".join(bits), "title": str(p.name).strip_edges(),
			"subtitle": str(p.get("note", "")).strip_edges(), "on_stage": on_stage, "created": float(p.get("created", 0))})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if a.on_stage != b.on_stage:
			return a.on_stage
		return a.created < b.created)
	return out
