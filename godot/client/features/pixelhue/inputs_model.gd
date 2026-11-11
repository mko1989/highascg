extends RefCounted
## WO-1039 — Inputs sub-tab, pure logic (no nodes): Studio's staged input edits (public/inputs.js), their request body
## (`PUT /api/inputs` {changes}, validated by lib/inputs.js planInputs) and the staged-edit helpers around it.
## Advanced settings / tiles / detailed timing live in inputs_adv_model.gd.

const EDID_KEYS := ["width", "height", "frame", "standardType", "interlaced"]
## [value "w,h,hz", label] — Studio's EDID presets (CEA, progressive).
const PRESETS := [["", "Keep current EDID"], ["1920,1080,60", "1080p60"], ["1920,1080,50", "1080p50"], ["3840,2160,30", "2160p30"], ["3840,2160,60", "2160p60"]]
const STANDARDS := [[0, "Custom"], [1, "DMT"], [2, "CVT"], [3, "CVT-RB v1"], [4, "CVT-RB v2"], [5, "CVT-RB v3"], [6, "CEA"], [7, "SMPTE"]]
const SCANS := [[0, "Progressive"], [1, "Interlaced"]]
const CAPACITY := ["SL", "DL", "4K"]
const MAX_NAME_BYTES := 32


static func capacity_label(value: Variant) -> String:
	var i := int(value) if value != null else -1
	return CAPACITY[i] if i >= 0 and i < CAPACITY.size() else "Device managed"


static func find_port(row: Dictionary, key: String) -> Dictionary:
	for p: Variant in row.get("ports", []):
		if p is Dictionary and str(p.get("key", "")) == key:
			return p
	return {}


## The staged copy of one row: what the controls edit until Apply.
static func make_draft(row: Dictionary) -> Dictionary:
	var ports: Array = row.get("ports", [])
	var port := find_port(row, str(row.get("portKey", "")))
	if port.is_empty() and not ports.is_empty() and ports[0] is Dictionary:
		port = ports[0]
	return {"key": row.get("key", ""), "portKey": row.get("portKey", ""), "capacity": row.get("capacity"),
		"name": str(port.get("name", "")), "edid": (port.get("edid", {}) as Dictionary).duplicate(true),
		"nameTouched": false, "edidTouched": false}


static func drafts_for(inputs: Array) -> Dictionary:
	var out := {}
	for row: Variant in inputs:
		if row is Dictionary:
			out[str(row.key)] = make_draft(row)
	return out


static func same_edid(a: Dictionary, b: Dictionary) -> bool:
	if a.is_empty() or b.is_empty():
		return false
	for k in EDID_KEYS:
		if a.get(k) != b.get(k):
			return false
	return true


## Choosing another physical port resets name + EDID to that port's own (as Studio does).
static func choose_port(row: Dictionary, draft: Dictionary, key: String) -> void:
	var port := find_port(row, key)
	if port.is_empty():
		return
	draft.portKey = key
	draft.name = str(port.get("name", ""))
	draft.edid = (port.get("edid", {}) as Dictionary).duplicate(true)
	draft.nameTouched = false
	draft.edidTouched = false


static func apply_preset(draft: Dictionary, value: String) -> void:
	if value == "":
		return
	var p := value.split(",")
	if p.size() != 3:
		return
	draft.edid = {"width": int(p[0]), "height": int(p[1]), "frame": float(p[2]), "standardType": 6, "interlaced": 0}
	draft.edidTouched = true


## The row's staged changes → `changes` entries, in Studio's shape; rows nobody touched are left out.
static func pending(inputs: Array, drafts: Dictionary) -> Array:
	var out: Array = []
	for row: Variant in inputs:
		if not (row is Dictionary) or not drafts.has(str(row.key)):
			continue
		var d: Dictionary = drafts[str(row.key)]
		var port := find_port(row, str(d.portKey))
		var mode_changed: bool = d.portKey != row.get("portKey") or d.capacity != row.get("capacity")
		var name_changed: bool = bool(d.nameTouched) and d.name != port.get("name")
		var edid_changed := false
		if bool(d.edidTouched):
			var pe: Dictionary = port.get("edid", {})
			edid_changed = not same_edid(d.edid, pe) or int(pe.get("mode", 0)) != 0
		if not mode_changed and not name_changed and not edid_changed:
			continue
		var c := {"key": row.key, "portKey": d.portKey, "capacity": _int(d.capacity)}
		if name_changed:
			c["name"] = d.name
		if edid_changed:
			var e := {}
			for k in EDID_KEYS:
				e[k] = d.edid.get(k)
			c["edid"] = e
		out.append(c)
	return out


static func has_num(arr: Array, v: float) -> bool:
	for x: Variant in arr:
		if float(x) == v:
			return true
	return false


static func _int(v: Variant) -> Variant:
	return int(v) if v is float or v is int else v


## Bulk "Fill selected": port family ("", "hdmi", "dp"), capacity text ("" keep), name template ({n}), EDID preset.
static func fill(inputs: Array, drafts: Dictionary, checked: Dictionary, family: String, capacity: String, name_tpl: String, preset: String) -> void:
	for row: Variant in inputs:
		if not (row is Dictionary) or not checked.has(str(row.key)) or not drafts.has(str(row.key)):
			continue
		var d: Dictionary = drafts[str(row.key)]
		if family != "" and not bool(row.get("fixedPort", false)):
			for p: Variant in row.get("ports", []):
				if p is Dictionary and int(p.get("type", -1)) == (6 if family == "hdmi" else 8):
					choose_port(row, d, str(p.key))
					break
		if capacity != "" and bool(row.get("capacityEditable", false)) and has_num(row.get("capacityChoices", []), float(capacity)):
			d.capacity = int(capacity)
		if name_tpl != "":
			d.name = name_tpl.replace("{n}", str(int(row.get("number", 0))))
			d.nameTouched = true
		if bool(row.get("supportsEdid", false)):
			apply_preset(d, preset)


## Checks Studio's server makes (lib/inputs.js planInputs) that a field can answer before the round trip; "" = fine.
static func validate(inputs: Array, changes: Array) -> String:
	for c: Variant in changes:
		var row := {}
		for r: Variant in inputs:
			if r is Dictionary and r.key == c.key:
				row = r
		var label := str(row.get("label", c.key))
		if c.has("name"):
			var n: String = str(c.name)
			if n.strip_edges() == "" or n.to_utf8_buffer().size() > MAX_NAME_BYTES:
				return "%s: name must contain 1–32 UTF-8 bytes, without control characters." % label
			for i in n.length():
				if n.unicode_at(i) < 32:
					return "%s: name must contain 1–32 UTF-8 bytes, without control characters." % label
		if c.has("edid"):
			var e: Dictionary = c.edid
			var wh_ok := true
			for k in ["width", "height"]:
				var v: Variant = e.get(k)
				if v == null or int(v) != float(v) or int(v) < 64 or int(v) > 8192:
					wh_ok = false
			var f: Variant = e.get("frame")
			if not wh_ok or f == null or float(f) < 1.0 or float(f) > 240.0:
				return "%s: enter a valid EDID resolution, frame rate (1–240 Hz), and timing standard." % label
	return ""


static func counts_label(state: Dictionary) -> String:
	var rows: Array = state.get("inputs", [])
	if state.is_empty():
		return "Not loaded"
	var sdi := 0
	var other := 0
	for r: Variant in rows:
		if r is Dictionary and r.get("family") == "SDI":
			sdi += 1
		elif r is Dictionary and r.get("family") == "Other":
			other += 1
	var s := "%d inputs · %d HDMI/DP + %d SDI" % [rows.size(), rows.size() - sdi - other, sdi]
	return s + (" + %d other" % other if other > 0 else "")


static func help_text(state: Dictionary) -> String:
	if state.is_empty():
		return "Connect a P10, P20, P80 or Q8 to load its inputs."
	var model := str((state.get("device", {}) as Dictionary).get("model", ""))
	if model in ["P80", "Q8"]:
		return "%s ports follow the installed cards. SDI uses source timing." % model
	return "Bulk EDID changes apply to HDMI/DP inputs. SDI uses source timing."


static func dirty_label(count: int) -> String:
	return "No pending input changes" if count == 0 else "%d pending input %s" % [count, "change" if count == 1 else "changes"]


## Second line under a port picker: signal text, "Inactive · " when the port is not the active one.
static func port_signal(port: Dictionary) -> String:
	if port.is_empty():
		return "Choose HDMI or DP"
	return ("" if int(port.get("workMode", 0)) == 0 else "Inactive · ") + str(port.get("signal", ""))


static func edid_note(port: Dictionary, touched: bool) -> String:
	if touched or port.is_empty():
		return ""
	var m := int((port.get("edid", {}) as Dictionary).get("mode", 0))
	if m == 2:
		var fn := str((port.edid as Dictionary).get("fileName", ""))
		return "File: %s · kept until edited" % (fn if fn != "" else "Imported EDID")
	if m == 1:
		return "Detailed timing · kept until edited"
	return ""


## Studio's own sentence for a finished apply.
static func applied_sentence() -> String:
	return "Inputs applied."
