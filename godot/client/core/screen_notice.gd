extends RefCounted
## WO-1029 plan 07 (C15) — the one place that words the answer of a by-screen request on a screen that may be on
## another linked server. Pure: callers pass the Api result `res` ({ok, status, data, error}), channelMap and the
## cluster snapshot (Store.fail_text / Store.ok_text do that for them).
## Server contract (src/api/screen-not-here.js): 409 {error, code:"NOT_HERE", screen, destId, owners:[server ids]}.
## ASSUMED relay answer (DEST-SHAPES.md not final): data.via = [{id, name, ok, status, error}] — one entry per server
## the request was relayed to; a request is fine when every entry is ok.

const SC := preload("res://core/screen_channels.gd")


static func is_not_here(res: Variant) -> bool:
	return res is Dictionary and (res as Dictionary).get("data") is Dictionary and str(((res as Dictionary).data as Dictionary).get("code", "")) == "NOT_HERE"


static func via(res: Variant) -> Array:
	var d: Variant = (res as Dictionary).get("data") if res is Dictionary else null
	return (d as Dictionary).get("via") if d is Dictionary and (d as Dictionary).get("via") is Array else []


static func _via_name(v: Dictionary) -> String:
	return str(v.get("name", v.get("id", "another server")))


## "highascg5867: <error>" for each relayed server that failed; "" when there was no relay or all took it.
static func via_failures(res: Variant) -> String:
	var bits := PackedStringArray()
	for v in via(res):
		if v is Dictionary and (v as Dictionary).get("ok") != true:
			var why := str(v.get("error", ""))
			if why == "" and v.get("status") != null:
				why = "HTTP %d" % int(v.status)
			bits.append("%s: %s" % [_via_name(v), why if why != "" else "no answer"])
	return "; ".join(bits)


## Server names a relayed request reached ("highascg5867"), "" without a relay.
static func via_names(res: Variant) -> String:
	var bits := PackedStringArray()
	for v in via(res):
		if v is Dictionary and (v as Dictionary).get("ok") == true:
			bits.append(_via_name(v))
	return ", ".join(bits)


## Why `res` failed, in words: NOT_HERE → "Screen 3 is on highascg5867 — not reachable from here: <reason>"; a relayed
## answer → the per-server failures; else res.error. "" for a successful answer.
static func reason(res: Dictionary, cm: Variant = null, cluster: Variant = null) -> String:
	if res.get("ok", false) == true:
		var f := via_failures(res)
		return ("not done on " + f) if f != "" else ""
	var vf := via_failures(res)
	if is_not_here(res):
		var d: Dictionary = res.data
		var idx := int(d.get("screen", -1)) if d.get("screen") != null else -1
		var where := ""
		if idx >= 0:
			where = str(SC.host(cm, idx, cluster).get("name", ""))
		if where == "":
			var ow: Array = d.get("owners", []) if d.get("owners") is Array else []
			where = ", ".join(PackedStringArray(ow.map(func(o: Variant) -> String: return str(o)))) if not ow.is_empty() else "another server"
		var head := ("Screen %d is on %s" % [idx + 1, where]) if idx >= 0 else "This screen is on %s" % where
		var why := vf if vf != "" else str(d.get("reason", ""))
		return "%s — not reachable from here%s" % [head, (": " + why) if why != "" else ""]
	if vf != "":
		return vf
	return str(res.get("error", ""))


## ASSUMED (src/api/screen-not-here.js notHereList): an "all screens" answer lists the screens it did NOT act on as
## data.notHere / data.notHereList = [{screen (0-based), destId, owners: [ids]}] → "Screens 2, 3 are on highascg5867: not done".
static func not_done(res: Dictionary, cm: Variant = null, cluster: Variant = null) -> String:
	var d: Variant = res.get("data")
	if not (d is Dictionary) or not via(res).is_empty():
		return ""
	var raw: Variant = d.get("notHere", d.get("notHereList"))
	if not (raw is Array) or (raw as Array).is_empty():
		return ""
	var nums := PackedStringArray()
	var where := ""
	for it in raw:
		if it is Dictionary and it.get("screen") != null:
			nums.append(str(int(it.screen) + 1))
			if where == "":
				where = str(SC.host(cm, int(it.screen), cluster).get("name", ""))
	return "Screen%s %s %s on %s: not done" % ["s" if nums.size() > 1 else "", ", ".join(nums), "are" if nums.size() > 1 else "is", where if where != "" else "another server"]


## {ok, text, tone} for a header notice: success (maybe "via X"), partial relay failure (warn), failure (error).
static func summary(what: String, res: Dictionary, cm: Variant = null, cluster: Variant = null) -> Dictionary:
	var r := reason(res, cm, cluster)
	if res.get("ok", false) == true:
		if r != "":
			return {"ok": false, "text": "%s %s" % [what, r], "tone": "warn"}
		var nd := not_done(res, cm, cluster)
		if nd != "":
			return {"ok": true, "text": "%s ok here — %s" % [what, nd], "tone": "warn"}
		var vn := via_names(res)
		return {"ok": true, "text": "%s ok%s" % [what, (" (on " + vn + ")") if vn != "" else ""], "tone": "ok"}
	return {"ok": false, "text": "%s refused: %s" % [what, r], "tone": "error"}
