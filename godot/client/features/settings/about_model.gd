extends RefCounted
## WO-616 attribution / AGPL §5(d) — the Settings → About rows from GET /api/about (src/api/routes-about.js), as
## [kind, text] pairs (kind "heading" | "note"). Pure, so tests can preload it without the Settings autoload.


## a = {} while loading or when the server is unreachable (error says why).
static func rows(a: Dictionary, error := "") -> Array:
	if a.is_empty():
		return [["note", "Could not load: %s" % error if error != "" else "Loading…"]]
	var out := [
		["heading", "%s %s" % [a.get("name", "HighAsCG"), a.get("version", "")]],
		["note", str(a.get("copyright", ""))],
		["note", "License: %s. %s" % [a.get("license", ""), a.get("warranty", "")]],
		["note", "Source code: %s" % a.get("source", "")],
		["note", "Full licence texts and third-party notices: %s." % a.get("notices", "")],
		["heading", "Credits"],
	]
	for c in a.get("credits", []):
		if c is Dictionary:
			out.append(["note", "%s — %s\n%s · %s · %s" % [c.get("name", ""), c.get("what", ""),
				c.get("license", ""), c.get("copyright", ""), c.get("url", "")]])
	return out
