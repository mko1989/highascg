extends RefCounted
## WO-869 — the mapping node page's slice section as data (pure): the slice list (one row per slice), the selected
## slice's fields, and per output the backend the server's planner picked (GET /api/device-view `mappingSlicePlans`,
## the updateMappingSlices answer's `plan`). Rendered by slice_inspector.gd; numbers are RULES.md math fields.
## Field keys are slice_model.gd paths ("src.x", "dst.rect.w", "dst.warp.2.0", "feather.l", …).

const SM := preload("res://features/devices/slice_model.gd")
const R := preload("res://features/devices/cable_rules.gd")
const S := preload("res://features/devices/cable_seed.gd")
const NF := preload("res://core/numeric_field.gd")

## [key, tip, lo, hi, decimals]
const SRC := [["src.x", "X", -INF, INF, 0], ["src.y", "Y", -INF, INF, 0], ["src.w", "W", 1, INF, 0], ["src.h", "H", 1, INF, 0]]
const DST := [["dst.rect.x", "X", -INF, INF, 0], ["dst.rect.y", "Y", -INF, INF, 0], ["dst.rect.w", "W", 1, INF, 0],
	["dst.rect.h", "H", 1, INF, 0]]
const FEATHER := [["feather.l", "Left", 0, INF, 0], ["feather.t", "Top", 0, INF, 0], ["feather.r", "Right", 0, INF, 0],
	["feather.b", "Bottom", 0, INF, 0]]
const CORNER_NAMES := ["Top left", "Top right", "Bottom right", "Bottom left"]


static func backend_text(row: Dictionary) -> String:
	match str(row.get("backend", "")):
		"direct":
			return "SDI placement (1:1)" if row.get("sink") == "decklink" else "GPU head (1:1)"
		"screen-slices":
			return "Slice window (live edits)"
		"route-slices":
			return "Route slices (one extra channel)"
		"refused":
			return "Not drawn — %s" % str(row.get("reason", ""))
	return "Not cabled"


## The planner's row for one output of node `id` ({} when the payload has none).
static func plan_row(plans: Variant, id: String, out_id: String) -> Dictionary:
	for p in R.a(plans):
		if p is Dictionary and R.s(p.get("nodeId")) == id:
			for o in R.a(p.get("outputs")):
				if o is Dictionary and R.s(o.get("outputId")) == out_id:
					return o
	return {}


## The program screen the node's input is cabled from: {screen (1-based, its live picture is the "pgm<screen>"
## surface), channel (its PGM channel, for the caption)}, or {} when the input is not cabled to a screen.
static func feed_screen(payload: Dictionary, id: String, channel_map: Variant) -> Dictionary:
	var graph := R.d(payload.get("graph"))
	var in_id := ""
	for c in R.a(graph.get("connectors")):
		if c is Dictionary and R.s(c.get("deviceId")) == id and c.get("kind") == "pixel_map_in":
			in_id = R.s(c.get("id"))
	for e in R.a(graph.get("edges")):
		if e is Dictionary and in_id != "" and R.s(e.get("sinkId")) == in_id:
			var b := S.output_binding(payload, R.s(e.get("sourceId")), "pgm")
			if b.get("type") != "screen":
				return {}
			var pgm := R.a(R.d(channel_map).get("programChannels"))
			var i := int(b.get("index", 0)) - 1
			return {"screen": i + 1, "channel": int(pgm[i]) if i >= 0 and i < pgm.size() and pgm[i] != null else 0}
	return {}


static func _num(s: Dictionary, f: Array) -> Dictionary:
	var v: Variant = SM.get_at(s, f[0])
	return {"t": "num", "key": f[0], "tip": f[1], "lo": f[2], "hi": f[3], "dec": f[4],
		"value": NF.fmt(snappedf(float(v), pow(10.0, -f[4])), f[4] == 0)}


## outputs = [{id, label}]; sel = selected slice index (-1 = none); drawn = [[output label, backend_text]].
static func items(slices: Array, outputs: Array, sel: int, drawn := []) -> Array:
	var labels := {}
	for o in outputs:
		labels[str(o.id)] = str(o.label)
	var out := [{"t": "heading", "text": "Slices"}]
	for d in drawn:
		out.append({"t": "readout", "text": "%s: %s" % [d[0], d[1]]})
	out.append({"t": "button", "text": "Edit slices", "key": "slices.edit"})
	if slices.is_empty():
		out.append({"t": "note", "text": "No slices: nothing is drawn on the outputs. Add one, or draw it on the input picture in Edit slices."})
	for i in slices.size():
		var s: Dictionary = slices[i]
		out.append({"t": "slice_row", "i": i, "selected": i == sel, "enabled": SM.not_false(s.get("enabled")),
			"text": "%s → %s" % [str(s.name), labels.get(str(s.outputId), str(s.outputId))]})
	out.append({"t": "button", "text": "+ Add slice", "key": "slices.add"})
	if sel < 0 or sel >= slices.size():
		return out
	var s: Dictionary = slices[sel]
	out.append_array([{"t": "subtitle", "text": str(s.name)}, {"t": "caption", "text": "Name"},
		{"t": "input", "key": "name", "value": str(s.name)},
		{"t": "caption", "text": "Output"},
		{"t": "select", "key": "outputId", "value": str(s.outputId), "options": outputs.map(func(o: Dictionary) -> Array: return [str(o.id), str(o.label)])},
		{"t": "check", "key": "enabled", "text": "Enabled", "value": SM.not_false(s.get("enabled"))},
		{"t": "caption", "text": "Source on the input (px)"}, {"t": "row", "items": SRC.map(func(f: Array) -> Dictionary: return _num(s, f))},
		{"t": "caption", "text": "Placement on the output (px)"}, {"t": "row", "items": DST.map(func(f: Array) -> Dictionary: return _num(s, f))},
		{"t": "caption", "text": "Rotation (°) · Opacity"},
		{"t": "row", "items": [_num(s, ["dst.rotation", "Rotation", -360, 360, 2]), _num(s, ["opacity", "Opacity 0–1", 0, 1, 2])]},
		{"t": "row", "items": [{"t": "check", "key": "dst.flipH", "text": "Flip H", "value": SM.is_true(s.dst.get("flipH"))},
			{"t": "check", "key": "dst.flipV", "text": "Flip V", "value": SM.is_true(s.dst.get("flipV"))}]},
		{"t": "caption", "text": "Corner warp (px, keystone)"}])
	for c in 4:
		out.append({"t": "row", "label": CORNER_NAMES[c], "items": [_num(s, ["dst.warp.%d.0" % c, CORNER_NAMES[c] + " X", -INF, INF, 0]),
			_num(s, ["dst.warp.%d.1" % c, CORNER_NAMES[c] + " Y", -INF, INF, 0])]})
	out.append_array([{"t": "caption", "text": "Feather (px)"}, {"t": "row", "items": FEATHER.map(func(f: Array) -> Dictionary: return _num(s, f))},
		{"t": "row", "items": [{"t": "button", "text": "Raise", "key": "slice.raise"}, {"t": "button", "text": "Lower", "key": "slice.lower"},
			{"t": "button", "text": "Duplicate", "key": "slice.duplicate"}, {"t": "button", "text": "Delete", "key": "slice.delete"}]}])
	return out
