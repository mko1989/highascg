extends RefCounted
## WO-603 slice 4 — "Encode to HAP" text helpers, ported from the web's pure client/lib/hap-encode-status.js (WO-575;
## goldens in tests/test_hap_status.gd come from running the web module under node). The encoding, the probe and the
## on-air decision are the server's (POST /api/media/hap-encode[/probe], `media:hap-encode`).

const FORMAT_LABEL := {"hap": "HAP", "hap_alpha": "HAP Alpha", "hap_q": "HAP Q"}


## Same rule as the server (`pickHapFormat`): FFmpeg has no HAP Q Alpha, alpha wins.
static func format_for(alpha: bool, hq: bool) -> Dictionary:
	if alpha:
		return {"format": "hap_alpha", "label": FORMAT_LABEL.hap_alpha, "downgraded": hq}
	if hq:
		return {"format": "hap_q", "label": FORMAT_LABEL.hap_q, "downgraded": false}
	return {"format": "hap", "label": FORMAT_LABEL.hap, "downgraded": false}


## Warnings under the toggles. `probe` = null until POST …/probe answers (advisory).
static func modal_warnings(alpha: bool, hq: bool, on_air: bool, probe: Variant) -> PackedStringArray:
	var out := PackedStringArray()
	if alpha and hq:
		out.append("HAP Q has no alpha in this encoder — will encode HAP Alpha.")
	if probe is Array:
		var todo: Array = (probe as Array).filter(func(p: Variant) -> bool: return p is Dictionary and p.get("ok", false) == true)
		if not alpha:
			var n := todo.filter(func(p: Dictionary) -> bool: return p.get("hasAlpha", false) == true).size()
			if n > 0:
				out.append("%d file%s an alpha channel that will be dropped. Turn Alpha on to keep it." % [n, " has" if n == 1 else "s have"])
		var skipped: int = (probe as Array).size() - todo.size()
		if skipped > 0 and todo.size() > 0:
			out.append("%d file%s will be skipped (already HAP, already encoded, or not a video)." % [skipped, "" if skipped == 1 else "s"])
		if todo.is_empty():
			out.append("Nothing to encode: every selected file would be skipped.")
	if on_air:
		out.append("Something is playing on-air. Encoding uses many CPU cores and can cause dropped frames.")
	return out


static func job_active(job: Variant) -> bool:
	return job is Dictionary and not (job as Dictionary).get("finished", false)


## One line for everything still running/queued ("Encoding HAP 2/5 · 43%"), "" when nothing is active.
static func progress_text(jobs: Array) -> String:
	var active := jobs.filter(job_active)
	if active.is_empty():
		return ""
	var items: Array = []
	for j in active:
		for it in j.get("items", []):
			if str(it.get("state", "")) != "skipped":
				items.append(it)
	var finished := items.filter(func(it: Dictionary) -> bool: return str(it.get("state", "")) in ["done", "failed", "cancelled"]).size()
	var running: Variant = null
	for it in items:
		if str(it.get("state", "")) == "running":
			running = it
			break
	var label: String = FORMAT_LABEL.get(str(active[0].get("format", "")), "HAP")
	var pct := (" · %d%%" % roundi(float(running.get("pct", 0) if running.get("pct") != null else 0) * 100.0)) if running != null else ""
	return "Encoding %s %d/%d%s" % [label, mini(items.size(), finished + 1), items.size(), pct]


## Final line for a finished job + its severity ("ok" | "error" | "info").
static func finished_summary(job: Dictionary) -> Dictionary:
	var c: Dictionary = job.get("counts", {}) if job.get("counts") is Dictionary else {}
	var bits := PackedStringArray()
	for k in [["done", "encoded"], ["skipped", "skipped"], ["failed", "failed"], ["cancelled", "cancelled"]]:
		if int(c.get(k[0], 0)) > 0:
			bits.append("%d %s" % [int(c[k[0]]), k[1]])
	var items: Array = job.get("items", [])
	var resized := items.filter(func(it: Dictionary) -> bool: return str(it.get("note", "")) != "" and it.get("note") != null).size()
	if resized > 0:
		bits.append("%d resized to a multiple of 4" % resized)
	var text := "HAP: %s" % (", ".join(bits) if not bits.is_empty() else "nothing to do")
	var first_fail: Variant = null
	for it in items:
		if str(it.get("state", "")) == "failed":
			first_fail = it
			break
	if first_fail != null:
		text += " — %s: %s" % [first_fail.get("id"), first_fail.get("reason")]
	elif int(c.get("done", 0)) == 0 and int(c.get("skipped", 0)) > 0:
		for it in items:
			if str(it.get("state", "")) == "skipped":
				if str(it.get("reason", "")) != "" and it.get("reason") != null:
					text += " (%s)" % it.reason
				break
	return {"text": text, "kind": "error" if int(c.get("failed", 0)) > 0 else ("ok" if int(c.get("done", 0)) > 0 else "info")}
