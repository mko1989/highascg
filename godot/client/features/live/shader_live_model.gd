extends RefCounted
## WO-606 — Shader Live, pure helpers for the Godot panel. The node owns the working copy and the control
## synthesis (GET/POST /api/shader-live…, src/shaderfx/shader-live-session.js); this only shapes the view.

## Web MIXER_ROWS (shader-live-rows.js): universal Caspar-mixer rides, available for every shader.
const MIXER_ROWS := [
	{"cmd": "OPACITY", "label": "opacity", "min": 0.0, "max": 1.0, "step": 0.01, "def": 1.0},
	{"cmd": "BRIGHTNESS", "label": "brightness", "min": 0.0, "max": 3.0, "step": 0.01, "def": 1.0},
	{"cmd": "SATURATION", "label": "saturation", "min": 0.0, "max": 3.0, "step": 0.01, "def": 1.0},
	{"cmd": "CONTRAST", "label": "contrast", "min": 0.0, "max": 3.0, "step": 0.01, "def": 1.0},
]


## "sh-galaxy — PGM ch1 L3 (Look A)" (web renderInstanceList).
static func instance_label(i: Dictionary) -> String:
	var where := "%s ch%d L%d" % ["PRV" if i.get("isPrv", false) else "PGM", int(i.get("channel", 0)), int(i.get("pLayer", 0))]
	return "%s — %s (%s)" % [str(i.get("shaderId", "")), where, str(i.get("sceneName", ""))]


## Keep the selection; a playlist hop replaces the instance on the same channel-layer → FOLLOW that layer
## (issues 01.08) instead of snapping back to the first; else the first (PGM sorts first). "" when none.
static func follow_key(list: Array, selected: String) -> String:
	if list.is_empty():
		return ""
	for i in list:
		if str(i.get("key", "")) == selected:
			return selected
	var at := selected.find("@")
	if at >= 0:
		var tail := selected.substr(at)
		for i in list:
			if str(i.get("key", "")).ends_with(tail):
				return str(i.key)
	return str(list[0].get("key", ""))


static func find_instance(list: Array, key: String) -> Dictionary:
	for i in list:
		if i is Dictionary and str(i.get("key", "")) == key:
			return i
	return {}


## Web fmt: decimals from the step (0.01 → 2, 1 → 0, capped at 4).
static func decimals(step: float) -> int:
	if step >= 1.0:
		return 0
	return mini(4, ceili(-log(step if step > 0.0 else 0.01) / log(10.0) - 1e-9))


static func fmt(v: float, step: float) -> String:
	return ("%." + str(decimals(step)) + "f") % v


static func to_color(values: Array) -> Color:
	var a := float(values[3]) if values.size() > 3 else 1.0
	return Color(float(values[0]), float(values[1]), float(values[2]), a)


## Picker → param values, rounded like the web (#rrggbb → 4 dp); a vec3 drops alpha.
static func from_color(c: Color, vec: int) -> Array:
	var r4 := func(x: float) -> float: return roundf(x * 10000.0) / 10000.0
	var out: Array = [r4.call(c.r), r4.call(c.g), r4.call(c.b)]
	if vec == 4:
		out.append(r4.call(c.a))
	return out


static func params_by_key(view: Dictionary) -> Dictionary:
	var out := {}
	for p in view.get("params", []):
		if p is Dictionary:
			out[str(p.get("key", ""))] = p
	return out


## Key controls grouped in the server's section order (Motion, Shape, Look, Colour, Audio).
static func sections(view: Dictionary) -> Array:
	var out: Array = []
	for title in view.get("sections", []):
		var items: Array = []
		for c in view.get("controls", []):
			if c is Dictionary and str(c.get("section", "")) == str(title):
				items.append(c)
		if not items.is_empty():
			out.append({"title": str(title), "controls": items})
	return out


## "6 key controls · 42 more in Advanced" (web slc-summary); the hidden-restore link is a separate button.
static func summary(view: Dictionary) -> String:
	var n: int = (view.get("controls", []) as Array).size()
	if n == 0:
		return "No obvious controls detected in this shader — open Advanced to see every value, and ★ the ones you want here."
	var more := int(view.get("hiddenCount", 0))
	return "%d key controls%s" % [n, (" · %d more in Advanced" % more) if more > 0 else ""]


## A param's display name: the operator label wins, else the scanner's name.
static func param_name(p: Dictionary) -> String:
	var l := str(p.get("label", ""))
	return l if l != "" else str(p.get("name", ""))


## Tooltip = pass + auto name + the raw ◆ code context (web paramRowHtml).
static func param_tip(p: Dictionary) -> String:
	var t := "%s — %s" % [str(p.get("passKey", "")), str(p.get("name", ""))]
	if str(p.get("context", "")) != "":
		t += "\n" + str(p.context)
	return t


## The short line under a deep row: what the value does, else the raw calculation.
static func param_line(p: Dictionary) -> String:
	if not p.get("deep", false):
		return ""
	return str(p.get("desc", "")) if str(p.get("desc", "")) != "" else str(p.get("expr", ""))


## Push errors → one status line ("" when clean).
static func push_note(res: Dictionary) -> String:
	var push: Variant = res.get("push")
	if not (push is Dictionary):
		return ""
	var errs: Array = push.get("errors", [])
	if not errs.is_empty():
		return "CG UPDATE failed: %s" % str(errs[0])
	if int(push.get("targets", 0)) == 0:
		return "Not on air — the edit is kept, nothing to update"
	return ""
