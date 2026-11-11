extends RefCounted
## WO-1039 — PixelHue Outputs panel logic (pure): drafts, pending changes, bulk fill, validation, request bodies.
## Mirrors the Studio UI (public/outputs-ui.js, output-advanced.js) and what lib/studio-outputs.js, output-capacity.js
## and output-advanced.js accept. Output ids are the switcher's interface ids (JSON numbers → floats; keys are ints).

const KEYS := ["name", "timing", "timingMode", "colorDepth", "hdcp", "testPattern"]
const TIMING_KEYS := ["width", "height", "frame", "standardType", "interlaced"]
const CAPACITY := ["SL", "DL", "4K"]
const DEPTHS := [8, 10, 12]
const FORMAT_PREFIXES := ["colorSpace", "colorRange", "colorGamut"]


static func timing_same(a: Variant, b: Variant) -> bool:
	if not (a is Dictionary) or not (b is Dictionary):
		return a == null and b == null
	for k in TIMING_KEYS:
		if absf(float((a as Dictionary).get(k, 0.0)) - float((b as Dictionary).get(k, 0.0))) > 1e-9:
			return false
	return true


static func preset_timing(p: Dictionary) -> Dictionary:
	var out := {}
	for k in TIMING_KEYS:
		out[k] = p.get(k, 0)
	return out


static func make_drafts(outputs: Array) -> Dictionary:
	var d := {}
	for o in outputs:
		if o is Dictionary:
			d[int(o.get("id", 0))] = (o as Dictionary).duplicate(true)
	return d


static func _same(key: String, a: Variant, b: Variant) -> bool:
	if key == "timing":
		return timing_same(a, b)
	return a == b


## What changed against the read state, as Studio's `changes` list.
static func pending(outputs: Array, drafts: Dictionary) -> Array:
	var out: Array = []
	for row in outputs:
		if not (row is Dictionary) or not drafts.has(int(row.get("id", 0))):
			continue
		var draft: Dictionary = drafts[int(row.id)]
		var ch := {"id": int(row.id)}
		for k in KEYS:
			if not _same(k, draft.get(k), row.get(k)):
				ch[k] = draft.get(k)
		if ch.has("timing") and ch.timing is Dictionary:
			ch["timingMode"] = 0 if int(draft.get("timingMode", 3)) == 0 else 3
		if ch.has("timingMode") and not ch.has("timing") and draft.get("timing") is Dictionary:
			ch["timing"] = draft.timing
		if ch.has("timing") and ch.timing is Dictionary:
			ch["timing"] = _clean_timing(ch.timing)
		if ch.size() > 1:
			out.append(ch)
	return out


static func _clean_timing(t: Dictionary) -> Dictionary:
	return {"width": int(t.get("width", 0)), "height": int(t.get("height", 0)), "frame": float(t.get("frame", 0)),
		"standardType": int(t.get("standardType", 0)), "interlaced": int(t.get("interlaced", 0))}


static func find(outputs: Array, id: int) -> Dictionary:
	for o in outputs:
		if o is Dictionary and int(o.get("id", -1)) == id:
			return o
	return {}


## Changes that retime an output with a screen on it (or while sync is on) need the reset confirmation.
static func timing_affected(state: Dictionary, changes: Array) -> Array:
	var out: Array = []
	for c in changes:
		if c is Dictionary and c.has("timing") and (state.get("syncActive") == true or str(find(state.get("outputs", []), int(c.id)).get("screen", "")) != ""):
			out.append(c)
	return out


## Anything that can drop or re-lock an output's signal: timing or colour depth.
static func interrupts_signal(changes: Array) -> bool:
	for c in changes:
		if c is Dictionary and (c.has("timing") or c.has("colorDepth")):
			return true
	return false


## The body for POST outputs, with confirmTimingReset on the affected changes (call after the operator confirmed).
static func outputs_body(state: Dictionary, changes: Array) -> Dictionary:
	var ids := {}
	for c in timing_affected(state, changes):
		ids[int(c.id)] = true
	var out: Array = []
	for c in changes:
		var d: Dictionary = (c as Dictionary).duplicate()
		if ids.has(int(d.id)):
			d["confirmTimingReset"] = true
		out.append(d)
	return {"changes": out}


## Studio's own refusals, caught before the request ("" = fine).
static func validate(state: Dictionary, changes: Array) -> String:
	if changes.is_empty():
		return "Nothing to apply."
	var outputs: Array = state.get("outputs", [])
	for c in changes:
		var o := find(outputs, int(c.id))
		var nm := str(o.get("name", "Output"))
		if c.has("name"):
			var n := str(c.name)
			if n.strip_edges() == "" or n.to_utf8_buffer().size() > 32:
				return "Output name must contain 1–32 UTF-8 bytes."
		if c.has("timing") and c.timing is Dictionary:
			if o.get("timingEditable") != true:
				return "%s uses fixed/copy timing. Set the primary output instead." % nm
			var t: Dictionary = c.timing
			if int(t.interlaced) == 1 and o.get("interlacedAllowed") != true:
				return "This output does not support interlaced timing."
			if float(t.frame) < 1.0 or float(t.frame) > 240.0:
				return "Frame rate must be 1–240 Hz."
			var lim: Dictionary = o.get("limits", {}) if o.get("limits") is Dictionary else {}
			for key in lim:
				var r: Dictionary = lim[key]
				var v := int(t.get(key, 0))
				var step := maxi(1, int(r.get("step", 1)))
				if v < int(r.min) or v > int(r.max) or (v - int(r.min)) % step != 0:
					return "Output %s is outside the connector timing limits." % key
			if int(c.get("timingMode", 3)) == 0 and preset_for(o, t).is_empty():
				return "Choose a standard resolution supported by this output capacity."
		if c.has("colorDepth") and o.get("colorDepth") == null:
			return "Color depth is unavailable on this connector."
		for k in ["hdcp", "testPattern"]:
			if c.has(k) and o.get(k) == null:
				return "%s is unavailable on this connector." % k
	return ""


static func preset_for(row: Dictionary, timing: Dictionary) -> Dictionary:
	var want := preset_timing(timing)
	for p in row.get("presets", []):
		if p is Dictionary and timing_same(preset_timing(p), want):
			return p
	return {}


## Label of the draft's timing: the matching standard preset, else "Custom".
static func timing_label(row: Dictionary, draft: Dictionary) -> String:
	if draft.get("timing") is Dictionary and int(draft.get("timingMode", 3)) == 0:
		var p := preset_for(row, draft.timing)
		if not p.is_empty():
			return str(p.get("label", "Custom"))
	return "Custom"


## Union of the standard timings editable outputs offer: [{key, label}] (long: fill a menu only when it opens).
static func bulk_presets(outputs: Array) -> Array:
	var seen := {}
	var out: Array = []
	for o in outputs:
		if o is Dictionary and o.get("timingEditable") == true:
			for p in o.get("presets", []):
				if p is Dictionary and not seen.has(p.key):
					seen[p.key] = true
					out.append({"key": str(p.key), "label": str(p.label)})
	return out


## "Fill selected": name pattern ({n} = port number), timing preset key, depth (-1 keep), hdcp (-1 keep).
## Edits `drafts` in place; returns how many selected outputs could not take the timing.
static func bulk_fill(outputs: Array, drafts: Dictionary, checked: Dictionary, pattern: String, preset_key: String, depth: int, hdcp: int) -> int:
	var skipped := 0
	for row in outputs:
		if not (row is Dictionary) or not checked.has(int(row.id)) or not drafts.has(int(row.id)):
			continue
		var d: Dictionary = drafts[int(row.id)]
		if pattern != "":
			d["name"] = pattern.replace("{n}", str(int(row.get("number", 0)))).left(32)
		if preset_key != "" and row.get("timingEditable") == true:
			var hit: Dictionary = {}
			for p in row.get("presets", []):
				if p is Dictionary and str(p.key) == preset_key:
					hit = p
			if hit.is_empty():
				skipped += 1
			else:
				d["timing"] = preset_timing(hit)
				d["timingMode"] = 0
		elif preset_key != "":
			skipped += 1
		if depth >= 0 and row.get("colorDepth") != null:
			d["colorDepth"] = depth
		if hdcp >= 0 and row.get("hdcp") != null:
			d["hdcp"] = hdcp
	return skipped


static func set_custom_dimension(draft: Dictionary, key: String, value: float) -> void:
	var t: Dictionary = (draft.get("timing", {}) as Dictionary).duplicate()
	t[key] = value
	t["standardType"] = 0
	t["interlaced"] = 0
	draft["timing"] = t
	draft["timingMode"] = 3


static func set_preset(row: Dictionary, draft: Dictionary, key: String) -> void:
	for p in row.get("presets", []):
		if p is Dictionary and str(p.key) == key:
			draft["timing"] = preset_timing(p)
			draft["timingMode"] = 0
			return
	var t: Dictionary = (draft.get("timing", {}) as Dictionary).duplicate()
	t["standardType"] = 0
	t["interlaced"] = 0
	draft["timing"] = t
	draft["timingMode"] = 3


static func capacity_name(cap: Variant) -> String:
	var i := int(cap) if cap != null else -1
	return CAPACITY[i] if i >= 0 and i < CAPACITY.size() else "Managed"


static func port_title(row: Dictionary) -> String:
	return "%s %d · %s" % [str(row.get("role", "Output")), int(row.get("number", 0)), str(row.get("connector", ""))]


static func port_sub(state: Dictionary, row: Dictionary) -> String:
	var s := "Slot %d · Port %d" % [int(row.get("slotId", 0)), int(row.get("port", 0))]
	if row.get("copyFrom") != null and int(row.copyFrom) != 0:
		var p := find(state.get("outputs", []), int(row.copyFrom))
		s += " · Copy of port %s" % (str(int(p.port)) if p.has("port") else "?")
	return s


static func capacity_options(group: Dictionary) -> Array:
	var out: Array = []
	for o in group.get("options", []):
		if o is Dictionary:
			out.append({"value": int(o.value), "text": "%s · %d independent outputs" % [str(o.label), (o.independent as Array).size()]})
	return out


static func _option(group: Dictionary, value: int) -> Dictionary:
	for o in group.get("options", []):
		if o is Dictionary and int(o.value) == value:
			return o
	return {}


static func capacity_summary(group: Dictionary, value: int) -> String:
	var o := _option(group, value)
	var ind: PackedStringArray = []
	for i in o.get("independent", []):
		ind.append(str(int(i)))
	return "Independent HDMI: %s. Other HDMI ports copy their primary. Optical, AUX and MVR unchanged." % ", ".join(ind)


static func capacity_confirm_text(group: Dictionary, value: int) -> String:
	var o := _option(group, value)
	var ind: PackedStringArray = []
	for i in o.get("independent", []):
		ind.append(str(int(i)))
	return "Switch this P20 output card to %s? Independent HDMI outputs: %s. Normal screen configuration may reset; output copy relationships will change. Continue?" % [str(o.get("label", "")), ", ".join(ind)]


## "" = go ahead; else why not (pending edits, no change, unknown option).
static func capacity_block(group: Dictionary, value: int, pending_count: int) -> String:
	if pending_count > 0:
		return "Apply or discard pending output edits before changing capacity."
	if _option(group, value).is_empty() or (group.get("capacity") != null and int(group.capacity) == value):
		return "Nothing to change."
	return ""


static func capacity_body(group: Dictionary, value: int) -> Dictionary:
	return {"slotId": int(group.get("slotId", 0)), "capacity": value, "confirmReset": true}


# ---- Advanced · format and colour (output-advanced) ----

static func adv_sections(output: Dictionary) -> Array:
	var out: Array = []
	for f in output.get("fields", []):
		if f is Dictionary and not out.has(str(f.section)):
			out.append(str(f.section))
	return out


static func adv_fields(output: Dictionary, section: String) -> Array:
	var out: Array = []
	for f in output.get("fields", []):
		if f is Dictionary and str(f.section) == section:
			out.append(f)
	return out


static func adv_pending(output: Dictionary, values: Dictionary) -> Dictionary:
	var out := {}
	var base: Dictionary = output.get("values", {})
	for k in values:
		if not base.has(k) or absf(float(values[k]) - float(base[k])) > 1e-9:
			out[k] = values[k]
	return out


static func adv_quality_defaults(output: Dictionary) -> Dictionary:
	var out := {}
	for f in output.get("fields", []):
		if f is Dictionary and str(f.key).begins_with("imageQuality.") and (f.get("default") is float or f.get("default") is int):
			out[str(f.key)] = float(f.default)
	return out


static func adv_peers(outputs: Array, output: Dictionary) -> Array:
	var out: Array = []
	for o in outputs:
		if o is Dictionary and int(o.id) != int(output.id) and o.get("connector") == output.get("connector") and o.get("role") == output.get("role"):
			out.append(o)
	return out


## Current draft to the output and its peers; only settings each exposes and that differ.
static func adv_copy_changes(outputs: Array, output: Dictionary, values: Dictionary) -> Array:
	var out: Array = []
	var all: Array = [output]
	all.append_array(adv_peers(outputs, output))
	for o in all:
		var s := {}
		for f in o.get("fields", []):
			if f is Dictionary and values.has(f.key) and absf(float(values[f.key]) - float((o.get("values", {}) as Dictionary).get(f.key, INF))) > 1e-9:
				s[f.key] = values[f.key]
		if not s.is_empty():
			out.append({"id": int(o.id), "settings": s})
	return out


static func adv_is_format(settings: Dictionary) -> bool:
	for k in settings:
		if str(k).split(".")[0] in FORMAT_PREFIXES:
			return true
	return false


static func adv_validate(output: Dictionary, settings: Dictionary) -> String:
	var nm := str(output.get("name", "Output"))
	for k in settings:
		var f := {}
		for x in output.get("fields", []):
			if x is Dictionary and str(x.key) == str(k):
				f = x
		if f.is_empty():
			return "%s: this setting is not editable on the current connector." % nm
		var v := float(settings[k])
		if f.get("options") is Array:
			var ok := false
			for o in f.options:
				ok = ok or float(o[0]) == v
			if not ok:
				return "%s: choose a supported value." % str(f.label)
		elif v < float(f.get("min", -INF)) or v > float(f.get("max", INF)) or (float(f.get("step", 1)) == 1.0 and v != floorf(v)):
			return "%s: choose a supported value." % str(f.label)
	var vals: Dictionary = output.get("values", {})
	var space: float = float(settings.get("colorSpace.preset", vals.get("colorSpace.preset", 0)))
	var gamut: float = float(settings.get("colorGamut.preset", vals.get("colorGamut.preset", 0)))
	if gamut == 2.0 and space != 0.0 and (settings.has("colorSpace.preset") or settings.has("colorGamut.preset")):
		return "%s: DCI-P3 needs RGB 4:4:4 sampling." % nm
	return ""


static func adv_body(changes: Array) -> Dictionary:
	return {"changes": changes}
