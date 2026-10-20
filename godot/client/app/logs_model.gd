extends RefCounted
## WO-608 — logs window rules (client/components/logs-modal-filter.js): categories, the /api/logs query, a WS
## `log_line` payload → record, the filter, and the capped text buffer.

const CATEGORIES := [
	["system", "System"], ["config", "Config"], ["os-display", "OS / xrandr"], ["amcp", "AMCP"],
	["playback", "Playback"], ["streaming", "Streaming"], ["audio", "Audio"], ["network", "Network"],
	["artnet", "Art-Net"], ["replication", "Replication"], ["websocket", "WebSocket"], ["device", "Device"],
	["sync", "Sync"], ["debug", "Debug"],
]
const LEVELS := ["info", "warn", "error", "debug"]
const DEFAULT_LEVELS := ["info", "warn", "error"]
const MAX_LINES := 2000


## Every category except Debug (the web default).
static func default_categories() -> Array:
	return CATEGORIES.map(func(c: Array) -> String: return c[0]).filter(func(id: String) -> bool: return id != "debug")


## HighAsCG lines only (Caspar is tailed separately); no category = "__none__" (server returns nothing).
static func query(categories: Array, levels: Array, lines := 500) -> String:
	return "/api/logs?lines=%d&caspar=0&categories=%s&levels=%s" % [lines,
		",".join(categories) if not categories.is_empty() else "__none__", ",".join(levels)]


static func record(payload: Variant) -> Dictionary:
	if payload is String:
		return {"line": payload, "level": "info", "category": "system"}
	if payload is Dictionary:
		var p: Dictionary = payload
		var line: String = str(p.get("line", "")) if str(p.get("line", "")) != "" else str(p.get("message", ""))
		return {"line": line, "level": str(p.get("level", "info")), "category": str(p.get("category", "system"))}
	return {}


static func matches(rec: Dictionary, categories: Array, levels: Array) -> bool:
	if rec.is_empty() or categories.is_empty() or not categories.has(rec.category):
		return false
	return levels.is_empty() or levels.has(rec.level)


## Append one line, keeping the last `cap` lines.
static func append(text: String, line: String, cap := MAX_LINES) -> String:
	var out := line if text == "" else text + "\n" + line
	var n := out.count("\n") + 1
	if n <= cap:
		return out
	var cut := 0
	for i in n - cap:
		cut = out.find("\n", cut) + 1
	return out.substr(cut)
