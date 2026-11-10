extends RefCounted
## WO-1029 — the pure side of "Apply Caspar config (restart)" across linked servers. The node answers
## GET /api/cluster/apply-plan with one entry per server (this one + every linked one):
##   { id, name, self, online, dirty (true / false / null = unknown), reason, screens: [labels], reachable }
## POST /api/cluster/apply answers per server { id, applied, skipped: 'clean'|'offline'|'old build', ok, error,
## restored: { looks, clips: [{channel, layer, clip, at_s, resumed_s}], layers, card, timeline, consumers,
## skipped: [{what, why}], ms } } and `cluster:apply` WS events report progress. Everything here turns those into the
## strings the Devices toolbar shows; the tolerant reads (list under `servers`, `results` or at the root) keep an
## engine-side rename from breaking the button.

const R := preload("res://features/devices/cable_rules.gd")

const APPLY := "Apply Caspar config (restart)"
const PHASES := {
	"snapshot": "saving what is on air", "restart": "restarting Caspar", "restarting": "restarting Caspar",
	"restore": "putting the screens back", "restoring": "putting the screens back", "done": "done",
	"skipped": "skipped", "failed": "failed", "error": "failed", "start": "starting", "waiting": "waiting for Caspar",
}


## The server rows of a plan or apply answer, however the node wrapped them.
static func servers(answer: Variant) -> Array:
	var rows: Array = []
	if answer is Array:
		rows = answer
	elif answer is Dictionary:
		for k in ["servers", "results", "plan"]:
			if answer.get(k) is Array:
				rows = answer[k]
				break
	var out: Array = []
	for r in rows:
		if r is Dictionary:
			out.append(r)
	return out


static func name_of(s: Dictionary) -> String:
	var n := R.s(s.get("name")).strip_edges()
	return n if n != "" else R.s(s.get("id"))


## Why a server is NOT restarted by a plain Apply: "" = it is. `apply` (the node's own default decision) wins when
## the row carries it; otherwise dirty + reachable. `build` says "old" for a peer without /api/caspar-config/dirty.
static func skip_reason(s: Dictionary) -> String:
	if s.get("online") == false or s.get("reachable") == false:
		return "offline"
	if s.get("dirty") == false:
		return "clean"
	if s.get("dirty") == null:
		return "old build" if R.s(s.get("build")) == "old" else "unknown"
	return "" if s.get("apply") != false else "unknown"


## The servers a plain Apply restarts, in the node's apply order (linked first, this box last).
static func to_apply(plan: Variant) -> Array:
	return servers(plan).filter(func(s: Dictionary) -> bool: return skip_reason(s) == "")


static func ids_to_apply(plan: Variant) -> Array:
	return to_apply(plan).map(func(s: Dictionary) -> String: return R.s(s.get("id")))


static func self_entry(plan: Variant) -> Dictionary:
	for s in servers(plan):
		if s.get("self") == true:
			return s
	return {}


static func _names(rows: Array) -> String:
	return ", ".join(rows.map(func(s: Dictionary) -> String: return name_of(s)))


static func _screens(s: Dictionary) -> String:
	var l: Array = R.a(s.get("screens")).map(func(x: Variant) -> String: return R.s(x)).filter(func(x: String) -> bool: return x != "")
	return ", ".join(l)


## What the button looks like: { known, dirty, tip }. `plan` is null / {} until the first answer; `local_dirty` is the
## client's own restart flag (a cable edited in this window) — a hint on top of the servers' own say-so.
static func button_state(plan: Variant, local_dirty: bool) -> Dictionary:
	var rows := servers(plan)
	if rows.is_empty():
		return {"known": false, "dirty": local_dirty, "tip": "Cabling changed — restart Caspar to apply" if local_dirty else ""}
	var todo := to_apply(plan)
	var unknown := rows.filter(func(s: Dictionary) -> bool: return skip_reason(s) in ["unknown", "old build"])
	var offline := rows.filter(func(s: Dictionary) -> bool: return s.get("dirty") == true and skip_reason(s) == "offline")
	if not todo.is_empty():
		var tip := "Restart needed on " + _names(todo)
		if not offline.is_empty():
			tip += " (" + _names(offline) + " offline — not reached)"
		return {"known": true, "dirty": true, "tip": tip}
	if local_dirty:
		return {"known": true, "dirty": true, "tip": "Cabling changed here, no server reports a restart yet — press to check"}
	var tip := "Nothing to apply — no server needs a restart"
	if not unknown.is_empty():
		tip += " (cannot tell for " + _names(unknown) + ")"
	if not offline.is_empty():
		tip += " (" + _names(offline) + " needs one but is offline)"
	return {"known": true, "dirty": false, "tip": tip}


static func _skip_text(s: Dictionary) -> String:
	var w := " (this server)" if s.get("self") == true else ""
	match skip_reason(s):
		"clean":
			return "%s%s — nothing changed" % [name_of(s), w]
		"offline":
			return "%s%s — offline" % [name_of(s), w]
		"old build":
			return "%s%s — old build, cannot tell if it needs a restart" % [name_of(s), w]
		_:
			return "%s%s — not known whether it needs a restart" % [name_of(s), w]


## The confirm dialog. Which servers restart (and which screens go dark on each), which are left alone and why.
static func confirm_text(plan: Variant) -> String:
	var todo := to_apply(plan)
	var lines: Array = []
	if todo.is_empty():
		lines.append("No server reports a change that needs a Caspar restart.")
	else:
		lines.append("Caspar will restart on:")
		for s in todo:
			var sc := _screens(s)
			lines.append("  - %s%s%s" % [name_of(s), " (this server)" if s.get("self") == true else "",
				" — screens go dark: " + sc if sc != "" else ""])
	var rest := servers(plan).filter(func(s: Dictionary) -> bool: return skip_reason(s) != "")
	if not rest.is_empty():
		lines.append("Not restarted:")
		for s in rest:
			lines.append("  - " + _skip_text(s))
	var me := self_entry(plan)
	if not me.is_empty() and skip_reason(me) != "" and not todo.is_empty():
		lines.append("This server is not restarted, so its screens stay on air.")
	if not todo.is_empty():
		lines.append("What is on air (looks, running clips, test card, timeline) is saved first and put back after the restart.")
	return "\n".join(lines)


## Nothing is dirty: the dialog offers a restart of this server anyway (re-applies the display layout, as before).
static func anyway_text(plan: Variant) -> String:
	return confirm_text(plan) + "\nRestart Caspar on this server anyway?"


## One `cluster:apply` event → the status line while the applies run. Events: {phase:'start', order, servers},
## {phase:'server', id, name, state:'applying'|'done', index, total, result?}, {phase:'done', ok, ms, results}.
static func progress_line(ev: Variant, plan: Variant) -> String:
	if not ev is Dictionary:
		return ""
	var phase := R.s(ev.get("phase"))
	if phase == "start":
		var n := R.a(ev.get("order")).size()
		return "Applying Caspar config on %s…" % _plural(n, "server")
	if phase != "server":
		return ""
	var name := R.s(ev.get("name"))
	if name == "":
		for s in servers(plan):
			if R.s(s.get("id")) == R.s(ev.get("id")):
				name = name_of(s)
	if name == "":
		name = R.s(ev.get("id"))
	var total := int(ev.get("total", 0))
	var idx := int(ev.get("index", 0))
	var pos := ""
	if total > 1:
		pos = " %d/%d" % [idx if idx >= 1 else idx + 1, total]  # the shapes file does not say whether index is 0- or 1-based
	if R.s(ev.get("state")) == "done":
		return "Applying%s — %s: %s" % [pos, name, result_line(R.d(ev.get("result")), plan).trim_prefix(name + ": ") if ev.get("result") is Dictionary else "done"]
	return "Applying%s — %s: restarting Caspar, then putting the screens back" % [pos, name]


## The run to follow after POST /api/cluster/apply { wait:false }: { run_id, how } — "" run_id = none to follow.
## 202 {accepted, run_id}; 409 {error, run_id} = a run is already going: attach to it.
static func run_to_follow(status: int, data: Variant) -> Dictionary:
	var d := R.d(data)
	if status == 202 and d.get("accepted") == true:
		return {"run_id": R.s(d.get("run_id")), "how": "started"}
	if status == 409:
		return {"run_id": R.s(d.get("run_id")), "how": "attached"}
	return {"run_id": "", "how": ""}


## Is this `cluster:apply` event the end of the run we follow? ("" run_id = any run).
static func finishes(ev: Variant, run_id: String) -> bool:
	return ev is Dictionary and ev.get("phase") == "done" and (run_id == "" or R.s(ev.get("run_id")) == run_id)


## GET /api/cluster/apply/status → the finished answer { results, ok } of the run, or {} while it is still going.
static func finished_run(status_answer: Variant, run_id: String) -> Dictionary:
	var d := R.d(status_answer)
	var run := R.d(d.get("run"))
	if d.get("running") == true or run.is_empty() or run.get("finished_at") == null:
		return {}
	if run_id != "" and R.s(run.get("run_id")) != run_id:
		return {}
	return run


static func _count(v: Variant) -> int:
	if v is Array:
		return v.size()
	if v is Dictionary:
		return 0 if v.is_empty() else 1
	if v is bool:
		return 1 if v else 0
	return int(v) if (v is int or v is float) else 0


static func mmss(sec: Variant) -> String:
	var n := maxi(0, int(float(sec)))
	return "%d:%02d" % [n / 60, n % 60]


static func _plural(n: int, one: String, many := "") -> String:
	return "%d %s" % [n, one if n == 1 else (many if many != "" else one + "s")]


## What came back after a restart, as one sentence ("" = the server reported no restored block).
static func restored_text(rs: Variant) -> String:
	if not rs is Dictionary or rs.is_empty():
		return ""
	var parts: Array = []
	var notes: Array = []
	if _count(rs.get("looks")) > 0:
		parts.append(_plural(_count(rs.looks), "look"))
	for c in R.a(rs.get("clips")):
		var cd := R.d(c)
		var at: Variant = cd.get("resumed_s", cd.get("at_s"))
		parts.append("%s%s%s" % [R.s(cd.get("clip")), (" at " + mmss(at)) if at != null else "", " (paused)" if cd.get("paused") == true else ""])
	if _count(rs.get("layers")) > 0:
		parts.append(_plural(_count(rs.layers), "layer"))
	var card: Variant = rs.get("card")
	if card is Dictionary and card.get("restored") != false and not card.is_empty() or card == true:
		parts.append("test card")
	var tl: Variant = rs.get("timeline")
	if tl is Dictionary and not tl.is_empty():
		var ms: Variant = tl.get("resumed_ms", tl.get("at_ms"))
		parts.append("timeline" + ((" at " + mmss(float(ms) / 1000.0)) if ms != null else "") + ("" if tl.get("playing") != false else " (paused)"))
	var cons := R.d(rs.get("consumers"))
	var stream := R.d(cons.get("stream"))
	if stream.get("restarted") == true:
		parts.append("stream restarted")
	elif not stream.is_empty():
		notes.append("stream (%s)" % R.s(stream.get("error", "not restarted")))
	for rec in R.a(cons.get("records")):
		if R.d(rec).get("restarted") != true:
			notes.append("recording %s (was running, NOT restarted)" % R.s(R.d(rec).get("key", R.d(rec).get("path"))))
	var out := ("restored " + ", ".join(parts)) if not parts.is_empty() else "nothing on air to restore"
	var ms2 := int(rs.get("ms", 0))
	if ms2 > 0:
		out += " in %.1f s" % (ms2 / 1000.0)
	for x in R.a(rs.get("skipped")):
		var d := R.d(x)
		notes.append("%s (%s)" % [R.s(d.get("what")), R.s(d.get("why"))] if d.has("what") else R.s(x))
	if not notes.is_empty():
		out += "; NOT restored: " + ", ".join(notes)
	return out


## `restored` or, when the server gave none, why ("no restart" is the normal answer for an apply that changed nothing).
static func restored_or_reason(rs: Variant, reason: Variant) -> String:
	var t := restored_text(rs)
	if t != "":
		return t
	var why := R.s(reason)
	if why == "":
		return ""
	return "no Caspar restart happened" if why == "no restart" else "air state not restored (%s)" % why


## One result row → "Box B: restarted, restored …" / "Box C: skipped — clean" / "Box D: FAILED — why".
static func result_line(r: Dictionary, plan: Variant) -> String:
	var name := name_of(r)
	if name == R.s(r.get("id")):
		for s in servers(plan):
			if R.s(s.get("id")) == R.s(r.get("id")):
				name = name_of(s)
	var sk := R.s(r.get("skipped"))
	if sk != "" and r.get("applied") != true:
		return "%s: skipped — %s" % [name, "an earlier server failed" if sk == "stopped" else sk]
	var rest := restored_or_reason(r.get("restored"), r.get("restored_reason"))
	if r.get("ok") == false or R.s(r.get("error")) != "":
		var e := R.s(r.get("error"))
		return "%s: FAILED — %s%s" % [name, e if e != "" else "no detail",
			("; " + rest) if rest != "" else ""]
	return "%s: restarted%s" % [name, (", " + rest) if rest != "" else ""]


## The final answer → { ok, warn, summary, detail }. `summary` is the one status line, `detail` its tooltip.
static func result(answer: Variant, plan: Variant) -> Dictionary:
	var rows := servers(answer)
	if rows.is_empty():
		var msg := R.s(R.d(answer).get("message"))
		var ok: bool = R.d(answer).get("ok") != false
		return {"ok": ok, "warn": false, "summary": msg if msg != "" else "Caspar config applied", "detail": msg}
	var lines: Array = rows.map(func(r: Dictionary) -> String: return result_line(r, plan))
	var failed := rows.filter(func(r: Dictionary) -> bool: return r.get("ok") == false or R.s(r.get("error")) != "")
	var warn := rows.any(func(r: Dictionary) -> bool:
		return restored_text(r.get("restored")).contains("NOT restored") or r.get("layoutOk") == false \
			or (r.get("applied") == true and r.get("restored") == null and R.s(r.get("restored_reason")) not in ["", "no restart"]))
	return {"ok": failed.is_empty() and R.d(answer).get("ok") != false, "warn": warn and failed.is_empty(), "summary": "  |  ".join(lines), "detail": "\n".join(lines)}
