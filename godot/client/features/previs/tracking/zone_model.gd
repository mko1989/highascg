extends RefCounted
## WO-616 T7 — trigger zones (project.previs.tracking.zones), the client mirror of src/tracking/zone-engine.js
## normalizeZones and zone-actions.js parseAction. The server engine evaluates them (OpenFollow zones port); this
## client draws and edits them. Pure.
##   {enabled (master, default off), debounce_ms 200, hysteresis 0.05 m, list: [{id, name, color, vertices [[x, y]]
##    (PSN floor metres), enabled, triggered_by [marker ids] (empty = every marker), actions {kind: text}}]}

const KINDS := ["first_entry", "additional_entry", "partial_exit", "final_exit"]
const KIND_LABELS := {"first_entry": "First entry", "additional_entry": "Additional entry",
	"partial_exit": "Partial exit", "final_exit": "Final exit"}
const COLORS := ["#4fc3f7", "#ffb300", "#ab47bc", "#66bb6a", "#ef5350", "#26c6da"]
const ACTION_HINT := "look:<id> · look:<id>@preview · companion:<page>/<row>/<col> · blank = nothing"


static func _num(v: Variant, d: float, lo: float, hi: float) -> float:
	return clampf(float(v), lo, hi) if (v is float or v is int) else d


static func normalize(src: Variant) -> Dictionary:
	var z: Dictionary = src if src is Dictionary else {}
	var ids := {}
	var list := []
	var raw: Array = z.get("list", []) if z.get("list") is Array else []
	for i in raw.size():
		var r: Dictionary = raw[i] if raw[i] is Dictionary else {}
		var id := str(r.get("id", "")) if str(r.get("id", "")) != "" else "zone%d" % (i + 1)
		while ids.has(id):
			id += "_"
		ids[id] = true
		var verts := []
		for v in r.get("vertices", []) if r.get("vertices") is Array else []:
			if v is Array and v.size() >= 2 and (v[0] is float or v[0] is int) and (v[1] is float or v[1] is int):
				verts.append([float(v[0]), float(v[1])])
		var trig := []
		for t in r.get("triggered_by", []) if r.get("triggered_by") is Array else []:
			if (t is float or t is int) and int(t) >= 1 and int(t) <= 65535 and not trig.has(int(t)):
				trig.append(int(t))
		trig.sort()
		var acts: Dictionary = r.get("actions", {}) if r.get("actions") is Dictionary else {}
		var actions := {}
		for k in KINDS:
			actions[k] = str(acts.get(k, "")).strip_edges() if acts.get(k) is String else ""
		var col := str(r.get("color", ""))
		list.append({"id": id, "name": str(r.get("name", "Zone %d" % (i + 1))),
			"color": col if Color.html_is_valid(col) else COLORS[i % COLORS.size()],
			"vertices": verts, "enabled": r.get("enabled") != false, "triggered_by": trig, "actions": actions})
	return {"enabled": z.get("enabled") == true, "debounce_ms": _num(z.get("debounce_ms"), 200.0, 0.0, 60000.0),
		"hysteresis": _num(z.get("hysteresis"), 0.05, 0.0, 10.0), "list": list}


## A new zone: lowest free "zoneN" id, the next colour, no shape yet (the operator clicks it on the floor).
static func new_zone(list: Array) -> Dictionary:
	var used := {}
	for z in list:
		used[str(z.id)] = true
	var n := 1
	while used.has("zone%d" % n):
		n += 1
	var actions := {}
	for k in KINDS:
		actions[k] = ""
	return {"id": "zone%d" % n, "name": "Zone %d" % n, "color": COLORS[(n - 1) % COLORS.size()], "vertices": [],
		"enabled": true, "triggered_by": [], "actions": actions}


## "" if the action text is valid (or blank), else why not — the same grammar as zone-actions.js parseAction.
static func action_error(text: String) -> String:
	var s := text.strip_edges()
	if s == "":
		return ""
	var look := RegEx.create_from_string("^look:[^@\\s]+(@(program|preview))?$")
	var comp := RegEx.create_from_string("^companion:\\d{1,3}/\\d{1,3}/\\d{1,3}$")
	if look.search(s) != null or comp.search(s) != null:
		return ""
	return "unknown action \"%s\"" % s


## "1, 3" → [1, 3] (sorted, unique, 1–65535; anything else dropped). Empty = every marker.
static func parse_ids(text: String) -> Array:
	var out := []
	for part in text.replace(";", ",").replace(" ", ",").split(",", false):
		if part.is_valid_int() and int(part) >= 1 and int(part) <= 65535 and not out.has(int(part)):
			out.append(int(part))
	out.sort()
	return out


## Floor outline as a closed world loop at height `z` for drawing: [[x, y, z], …, first].
static func loop3(vertices: Array, z: float) -> Array:
	var out := []
	for v in vertices:
		out.append([float(v[0]), float(v[1]), z])
	if vertices.size() >= 3:
		out.append(out[0])
	return out
