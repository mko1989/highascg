extends RefCounted
## WO-608 — Settings → Variables rules (web client/components/variables-panel.js).

const DISPLAY_VALUE_MAX := 56
## [label, key prefix] — the web filter buttons.
const CATEGORIES := [["All", ""], ["OSC", "osc_"], ["App", "app_"], ["Caspar", "caspar_"]]


## Sorted keys matching the search (case-insensitive substring) and the category prefix. A pasted
## "$(highascg:key)" reference searches for its key.
static func filtered(vars: Dictionary, search: String, prefix: String) -> Array:
	var s := search.strip_edges().to_lower().trim_prefix("$(highascg:").trim_suffix(")")
	var out: Array = []
	for k in vars:
		var key := str(k)
		if (s == "" or key.to_lower().contains(s)) and (prefix == "" or key.begins_with(prefix)):
			out.append(key)
	out.sort()
	return out


## Companion variable reference for a key.
static func clip(key: String) -> String:
	return "$(highascg:%s)" % key


## {text, tip} — huge values (base64 images) shortened like the web formatDisplayValue.
static func display(v: Variant) -> Dictionary:
	if v == null:
		return {"text": "", "tip": ""}
	var s: String = v if v is String else JSON.stringify(v)
	if s.length() <= DISPLAY_VALUE_MAX:
		return {"text": s, "tip": ""}
	return {"text": s.substr(0, DISPLAY_VALUE_MAX - 1) + "…", "tip": "%d characters" % s.length()}
