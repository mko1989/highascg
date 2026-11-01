extends RefCounted
## WO-598/599 — autosave response policy (client/app.js:164-218), no autoload references (unit-testable).

const MAX_STALE_RETRIES := 3


## Pure policy (unit-tested): what to do with one autosave response.
static func decide(res: Dictionary, retries: int) -> Dictionary:
	var data: Variant = res.get("data")
	var d: Dictionary = data if data is Dictionary else {}
	if res.get("ok", false):
		return {"action": "ok", "rev": int(d.get("rev", 0)), "changed": d.get("changed", true) == true}
	var status := int(res.get("status", 0))
	var reason := str(d.get("reason", res.get("reason", "")))
	if status == 410 or reason == "project_gone":
		return {"action": "gone"}
	if status == 409 and reason == "stale_rev" and d.has("storedRev") and retries < MAX_STALE_RETRIES:
		return {"action": "retry", "rev": int(d["storedRev"])}
	# WO-918: the server has another show open than the one this client edits (a Load elsewhere) → adopt it
	if status == 409 and reason == "not_active":
		return {"action": "switched", "active": str(d.get("activeSlug", ""))}
	# WO-918 F10: a rename onto the name of another stored show — never overwrite it, take the old name back
	if status == 409 and reason == "name_taken":
		return {"action": "name_taken", "reason": str(d.get("error", "That name is taken"))}
	return {"action": "fail", "reason": reason if reason != "" else str(res.get("error", "save failed"))}


## WO-918 F27/F28: every write says which show this client is editing (the slug the server handed it), so the server
## can tell a rename (editing the active show under a new name) from a stale client (the server switched shows).
static func body_for(project: Dictionary) -> Dictionary:
	var body := {"project": project}
	var slug := str(project.get("slug", ""))
	if slug != "":
		body["editingSlug"] = slug
	return body
