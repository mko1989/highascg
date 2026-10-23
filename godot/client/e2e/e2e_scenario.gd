extends RefCounted
## WO-719 — base of one end-to-end scenario. A scenario is a chain of steps; each step drives the GUI through `ui`
## (e2e_ui.gd) and returns "" for pass or the reason it failed. Once a step fails, the rest of the chain is skipped
## (they build on it). Every step ends with a screenshot, so a failure report shows what the operator would see.
## Server-side truth is read with `api()` — the GUI must not only look right, the show must be stored right.

var ui: RefCounted
var results: Array = []  ## {scenario, step, ok, skipped, why, ms, shot}
var name := ""
var _broken := false


## Override: the steps, in order.
func run() -> void:
	pass


func step(label: String, body: Callable) -> bool:
	if _broken:
		results.append({"scenario": name, "step": label, "ok": false, "skipped": true, "why": "earlier step failed", "ms": 0, "shot": ""})
		return false
	var t0 := Time.get_ticks_msec()
	var why: Variant = await body.call()
	var ok: bool = why == null or (why is String and why == "") or (why is bool and why)
	var reason := "" if ok else (str(why) if not (why is bool) else "returned false")
	var shot: String = await ui.shot("%s_%s" % [name, label])
	results.append({"scenario": name, "step": label, "ok": ok, "skipped": false, "why": reason,
		"ms": Time.get_ticks_msec() - t0, "shot": shot})
	print("[e2e] %s %s / %s%s" % ["PASS" if ok else "FAIL", name, label, "" if ok else " — " + reason])
	if not ok:
		_broken = true
	return ok


## "" when `cond` holds, else `msg` (the step's return value).
static func expect(cond: bool, msg: String) -> String:
	return "" if cond else msg


## Wait (polling the server) until `pred.call(data)` holds for GET `path`; returns "" or why not.
func await_api(path: String, pred: Callable, what: String, timeout_s := 8.0) -> String:
	var until := Time.get_ticks_msec() + int(timeout_s * 1000.0)
	var last: Variant = null
	while Time.get_ticks_msec() < until:
		var r: Dictionary = await api(path)
		last = r.get("data")
		if r.get("ok", false) and pred.call(last):
			return ""
		await ui.sleep(0.25)
	return "%s (GET %s → %s)" % [what, path, JSON.stringify(last).left(300)]


func api(path: String) -> Dictionary:
	return await Api.get_json(path)


func post(path: String, body: Variant) -> Dictionary:
	return await Api.post_json(path, body)
