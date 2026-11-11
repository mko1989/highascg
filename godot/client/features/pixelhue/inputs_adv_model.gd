extends RefCounted
## WO-1039 — Inputs sub-tab, pure logic for the Advanced part (public/input-advanced.js, input-edid-ui.js timing part):
## per-input settings diff, Mac tiles, bulk Mac mode and detailed timing. Bodies match lib/input-advanced.js
## (`PUT /api/input-advanced` {changes:[{id, settings, mosaic?}]}) and lib/input-edid.js (`PUT /api/input-timing` {id, timing}).

const AXES := [["horizontal", "H"], ["vertical", "V"]]


static func find_input(state: Dictionary, id: Variant) -> Dictionary:
	for i: Variant in state.get("inputs", []):
		if i is Dictionary and i.get("id") == id:
			return i
	return {}


static func input_title(i: Dictionary) -> String:
	return "%s · %s · Slot %d / Port %d" % [i.get("name", ""), i.get("connector", ""), int(i.get("slot", 0)), int(i.get("port", 0))]


## Settings whose staged value differs from the device's.
static func settings_diff(row: Dictionary, values: Dictionary) -> Dictionary:
	var out := {}
	var cur: Dictionary = row.get("values", {})
	for k: Variant in values:
		if values[k] != cur.get(k):
			out[k] = values[k]
	return out


static func mosaic_changed(row: Dictionary, mosaic: Dictionary) -> bool:
	var m: Dictionary = row.get("mosaic", {})
	return not mosaic.is_empty() and (mosaic.get("side") != m.get("side") or int(mosaic.get("group", 0)) != int(m.get("group", 0)))


static func pending_count(row: Dictionary, values: Dictionary, mosaic: Dictionary) -> int:
	if row.is_empty():
		return 0
	return settings_diff(row, values).size() + (1 if mosaic_changed(row, mosaic) else 0)


static func pending_label(count: int) -> String:
	return "%d pending advanced settings" % count if count > 0 else "No pending advanced settings"


static func field_of(row: Dictionary, key: String) -> Dictionary:
	for f: Variant in row.get("fields", []):
		if f is Dictionary and f.get("key") == key:
			return f
	return {}


## "" when `value` is a legal value of `field` (the server's checks), else Studio's sentence.
static func validate_setting(field: Dictionary, value: float) -> String:
	var label := str(field.get("label", ""))
	if field.has("options"):
		for o: Variant in field.options:
			if float(o[0]) == value:
				return ""
		return "%s: choose a supported value." % label
	var lo := float(field.get("min", 0))
	var hi := float(field.get("max", 0))
	var step := float(field.get("step", 1))
	if value < lo or value > hi or (step == 1.0 and value != floorf(value)):
		return "%s: choose a supported value." % label
	var k := (value - lo) / step
	if absf(k - roundf(k)) > 1e-7:
		return "%s: use steps of %s." % [label, str(step)]
	return ""


static func validate_changes(state: Dictionary, changes: Array) -> String:
	for c: Variant in changes:
		var row := find_input(state, c.get("id"))
		if row.is_empty():
			return "Input changed or duplicate interface. Refresh Advanced."
		var s: Dictionary = c.get("settings", {})
		if s.is_empty() and not c.has("mosaic"):
			return "Supply advanced input changes."
		for k: Variant in s:
			var f := field_of(row, str(k))
			if f.is_empty():
				return "%s: this setting is not editable on the current connector." % row.get("name", "")
			var e := validate_setting(f, float(s[k]))
			if e != "":
				return e
	return ""


## One change for the selected input (settings as a diff; the mosaic only when it moved).
static func change_for(row: Dictionary, values: Dictionary, mosaic: Dictionary) -> Dictionary:
	var c := {"id": _i(row.id), "settings": _num(settings_diff(row, values))}
	if mosaic_changed(row, mosaic):
		c["mosaic"] = {"side": mosaic.side, "group": int(mosaic.group)}
	return c


static func _i(v: Variant) -> int:
	return int(v)


## Option values are ints; sliders may be fractional (gamma, steps 0.01).
static func _num(d: Dictionary) -> Dictionary:
	var out := {}
	for k: Variant in d:
		var v: float = float(d[k])
		out[k] = int(v) if v == floorf(v) else v
	return out


## Side picker: Off keeps group 0; picking a side with no group puts the tile in group 1 (Studio).
static func set_side(mosaic: Dictionary, side: String) -> void:
	mosaic.side = side
	mosaic.group = 0 if side == "none" else (int(mosaic.get("group", 0)) if int(mosaic.get("group", 0)) > 0 else 1)


static func set_group(mosaic: Dictionary, group: int) -> void:
	mosaic.group = group
	if group == 0:
		mosaic.side = "none"


static func reset_quality(row: Dictionary, values: Dictionary) -> void:
	for f: Variant in row.get("fields", []):
		if f is Dictionary and not f.has("options") and f.has("default"):
			values[f.key] = f.default


static func has_defaults(row: Dictionary) -> bool:
	for f: Variant in row.get("fields", []):
		if f is Dictionary and not f.has("options") and f.has("default"):
			return true
	return false


## Inputs that can be in a Mac tile pair.
static func mosaic_inputs(state: Dictionary) -> Array:
	return (state.get("inputs", []) as Array).filter(func(i: Variant) -> bool: return i is Dictionary and bool(i.get("mosaicSupported", false)))


static func compat_inputs(state: Dictionary) -> Array:
	return (state.get("inputs", []) as Array).filter(func(i: Variant) -> bool: return i is Dictionary and not field_of(i, "compatibilityMode").is_empty())


static func compat_changes(state: Dictionary, mode: int) -> Array:
	return compat_inputs(state).map(func(i: Dictionary) -> Dictionary: return {"id": _i(i.id), "settings": {"compatibilityMode": mode}})


## First of groups 1–16 no tile uses (the "New tile group" default).
static func free_group(state: Dictionary) -> int:
	var used := {}
	for i: Dictionary in mosaic_inputs(state):
		used[int(i.get("mosaic", {}).get("group", 0))] = true
	for n in range(1, 17):
		if not used.has(n):
			return n
	return 1


static func used_groups(state: Dictionary) -> Array:
	var seen := {}
	for i: Dictionary in mosaic_inputs(state):
		var g := int(i.get("mosaic", {}).get("group", 0))
		if g > 0:
			seen[g] = true
	var out: Array = seen.keys()
	out.sort()
	return out


static func group_members(state: Dictionary, group: int) -> Array:
	return mosaic_inputs(state).filter(func(i: Dictionary) -> bool: return int(i.get("mosaic", {}).get("group", 0)) == group)


static func group_label(state: Dictionary, group: int) -> String:
	var parts: Array = []
	for i: Dictionary in group_members(state, group):
		parts.append("%s — %s" % [i.mosaic.side, i.name])
	return "Group %d: %s" % [group, " / ".join(parts)]


## "Apply tiled pair" → two changes (left, right) in `group`; [] with `error` set in the second slot when invalid.
static func pair_changes(left: int, right: int, group: int, compat_on: bool) -> Array:
	var out: Array = []
	for pair in [[left, "left"], [right, "right"]]:
		var c := {"id": pair[0], "mosaic": {"group": group, "side": pair[1]}}
		if compat_on:
			c["settings"] = {"compatibilityMode": 1}
		out.append(c)
	return out


static func remove_group_changes(state: Dictionary, group: int) -> Array:
	return group_members(state, group).map(func(i: Dictionary) -> Dictionary: return {"id": _i(i.id), "mosaic": {"side": "none", "group": 0}})


# ---- detailed timing ----

static func back_porch(axis: Dictionary) -> int:
	return int(axis.get("total", 0)) - int(axis.get("active", 0)) - int(axis.get("front", 0)) - int(axis.get("sync", 0))


static func timing_ok(t: Dictionary) -> bool:
	return back_porch(t.get("horizontal", {})) >= 0 and back_porch(t.get("vertical", {})) >= 0


## Studio's live line under the timing grid: derived back porch + pixel clock, or the reason Apply is off.
static func timing_info(t: Dictionary) -> String:
	if not timing_ok(t):
		return "Total must be at least active + front porch + sync."
	var h: Dictionary = t.horizontal
	var v: Dictionary = t.vertical
	var mhz := float(h.total) * float(v.total) * float(t.get("refresh", 0)) / 1e6
	return "Back porch H %d / V %d · pixel clock %.2f MHz" % [back_porch(h), back_porch(v), mhz]


## Server checks of applyInputTiming; "" = fine.
static func validate_timing(t: Dictionary) -> String:
	var r := float(t.get("refresh", 0))
	if r < 1.0 or r > 240.0 or absf(r * 100.0 - roundf(r * 100.0)) > 1e-6:
		return "Refresh rate must be 1–240 Hz with at most two decimals."
	for ax in AXES:
		var a: Dictionary = t.get(ax[0], {})
		var name: String = "Horizontal" if ax[0] == "horizontal" else "Vertical"
		var rules := [["active", "active", 64, 16384], ["front", "front porch", 0, 8192], ["sync", "sync", 1, 8192]]
		for rule in rules:
			var n := float(a.get(rule[0], -1))
			if n != floorf(n) or n < rule[2] or n > rule[3]:
				return "%s %s must be an integer %d–%d." % [name, rule[1], rule[2], rule[3]]
		var lo := int(a.active) + int(a.front) + int(a.sync)
		if int(a.total) < lo or int(a.total) > 32768:
			return "%s total must be an integer %d–32768." % [name, lo]
		if not int(a.get("polarity", 1)) in [0, 1]:
			return "Choose a valid %s sync polarity." % name.to_lower()
	return ""


## `PUT /api/input-timing` body.
static func timing_body(id: Variant, t: Dictionary) -> Dictionary:
	var body := {"id": _i(id), "timing": {"refresh": float(t.refresh)}}
	for ax in AXES:
		var a: Dictionary = t[ax[0]]
		body.timing[ax[0]] = {"active": int(a.active), "front": int(a.front), "sync": int(a.sync), "total": int(a.total), "polarity": int(a.polarity)}
	return body
