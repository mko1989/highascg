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
	return {"action": "fail", "reason": reason if reason != "" else str(res.get("error", "save failed"))}
