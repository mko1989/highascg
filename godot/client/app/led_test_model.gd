extends RefCounted
## WO-629 — LED test card helpers for the header switch and the "Test card…" dialog, pure (testable headless).
## The settings, target channels and the switch itself live in node (GET/POST /api/led-test-card/settings, …/master,
## …/channel); this only shapes what the client shows.

const BUILDER := "led-builder"


## "ch 1 · PGM · Screen · 1080p5000" for a GET …/settings channel row.
static func channel_label(row: Dictionary) -> String:
	var parts: Array = ["ch %d" % int(row.get("index", 0))]
	if row.get("program", false):
		parts.append("PGM")
	if str(row.get("outputs", "")) != "":
		parts.append(str(row.outputs))
	if str(row.get("videoMode", "")) != "":
		parts.append(str(row.videoMode))
	return " · ".join(parts)


## Is any channel on in a `{ "1": true }` map?
static func any_on(m: Variant) -> bool:
	return m is Dictionary and (m as Dictionary).values().has(true)


## Pattern picker rows: the bunny builder fills LED panels, so it needs some channel with the full grid (WO-588).
static func pattern_rows(patterns: Array, grid_any: bool) -> Array:
	var out := []
	for p in patterns:
		var id := str(p.get("id", ""))
		var off := id == BUILDER and not grid_any
		out.append({"id": id, "name": str(p.get("name", id)) + (" (needs Full LED grid)" if off else ""), "disabled": off})
	return out


## Which extra fields a pattern shows: the character count (bouncing / builder) and the builder's speed.
static func extras(pattern: String) -> Dictionary:
	var builder := pattern == BUILDER
	return {
		"chars": builder or pattern == "bouncing-element",
		"speed": builder,
		"chars_label": "Builder bunnies" if builder else "Bouncing HighAsCG characters",
	}


## A …/master or …/channel reply → a header notice, or {} when every channel took it.
static func switch_notice(res: Dictionary, enabled: bool) -> Dictionary:
	var d: Dictionary = res.get("data") if res.get("data") is Dictionary else {}
	var failures: Array = d.get("failures", []) if d.get("failures") is Array else []
	var why := ", ".join(failures.map(func(f: Variant) -> String: return "ch %d: %s" % [int(f.channel), str(f.error)]))
	if not res.get("ok", false):
		var err := why if why != "" else str(d.get("error", res.get("error", "")))
		return {"text": "Test card %s failed — %s" % ["on" if enabled else "off", err], "tone": "error"}
	if not failures.is_empty():
		var n: int = (d.get("targets", []) as Array).size() if d.get("targets") is Array else 0
		return {"text": "Test card on %d of %d channels — %s" % [n - failures.size(), n, why], "tone": "warn"}
	return {}
