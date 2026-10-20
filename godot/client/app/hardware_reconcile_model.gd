extends RefCounted
## WO-608 — project hardware reconcile (web project-import-flow.js + project-hardware-reconcile-modal.js): pure
## decisions for hardware_reconcile.gd. The node computes the report (GET /api/project/hardware-check).

const POLICIES := ["ask", "apply_saved", "keep_live"]
const POLICY_LABELS := ["Ask every time", "Always apply project hardware", "Always keep live hardware (looks only)"]
const MAX_ITEMS := 12
const TITLE := "Hardware does not match this project"
const FOOTER := "After applying project hardware: verify Device View, OS layout, Caspar config, and restart Caspar if prompted."
const KEEP_NOTICE := "Live routing kept — check Devices"  # web banner; the full line is the tooltip


static func policy_of(v: Variant) -> String:
	return str(v) if POLICIES.has(str(v)) else "ask"


## report + remembered policy → "none" (nothing to do) | "apply" | "keep" | "ask" (web: apply_saved never
## auto-applies a hard mismatch).
static func decide(report: Dictionary, policy: String) -> String:
	if report.get("prompt", false) != true:
		return "none"
	if policy == "apply_saved" and str(report.get("severity", "")) != "hard":
		return "apply"
	if policy == "keep_live":
		return "keep"
	return "ask"


static func lead(report: Dictionary) -> String:
	var name := str(report.get("projectName", "This project"))
	var tail := "The active hardware configuration on this machine differs from what was saved." if report.get("sameMachine", false) == true else "This machine differs from what was saved."
	return "%s includes Device View cabling, screen destinations, and Caspar screen settings. %s" % [name, tail]


## [[text, severity]…], at most MAX_ITEMS plus an "…and N more" line.
static func diff_lines(items: Variant) -> Array:
	var list: Array = items if items is Array and not (items as Array).is_empty() else [{"section": "Hardware", "message": "Saved routing differs from the live machine.", "severity": "soft"}]
	var out: Array = []
	for it in list.slice(0, MAX_ITEMS):
		out.append(["%s — %s" % [str(it.get("section", "")), str(it.get("message", ""))], str(it.get("severity", "soft"))])
	if list.size() > MAX_ITEMS:
		out.append(["…and %d more difference(s)." % (list.size() - MAX_ITEMS), "soft"])
	return out


## Remember ticked: an explicit policy pick wins; otherwise apply / keep become the policy (web close()).
static func remembered(choice: String, picked: String) -> String:
	if POLICIES.has(picked) and picked != "ask":
		return picked
	if choice == "apply_saved" or choice == "keep_live":
		return choice
	return picked if picked == "ask" else ""


## POST /api/project/hardware-apply answer → header notice.
static func apply_notice(ok: bool, data: Variant) -> Dictionary:
	if not ok or not (data is Dictionary) or data.get("ok", false) != true:
		var err := str(data.get("error", "")) if data is Dictionary else ""
		return {"text": "Project hardware apply failed" + (": " + err if err != "" else ""), "tone": "error", "sticky": true}
	var steps: Array = data.get("steps", [])
	var warns: Array = data.get("warnings", [])
	var msg := " · ".join(steps) if not steps.is_empty() else "Project hardware applied"
	if not warns.is_empty():
		return {"text": "%s (%s)" % [msg, str(warns[0])], "tone": "warn"}
	return {"text": msg, "tone": "ok"}


static func _count(n: int, one: String) -> String:
	return "%d %s%s" % [n, one, "" if n == 1 else "s"]


## GET /api/project/missing-assets → sticky header notice (web showMissingMediaBanner), {} when clean. The tooltip
## carries the first 6 refs (+N more), like the web banner preview.
static func missing_notice(report: Variant) -> Dictionary:
	if not (report is Dictionary) or report.get("isClean", true) == true:
		return {}
	var mm: Array = report.get("missingMedia", []) if report.get("missingMedia") is Array else []
	var mt: Array = report.get("missingTemplates", []) if report.get("missingTemplates") is Array else []
	if mm.is_empty() and mt.is_empty():
		return {}
	var parts: Array = []
	if not mm.is_empty():
		parts.append(_count(mm.size(), "media clip"))
	if not mt.is_empty():
		parts.append(_count(mt.size(), "template"))
	var all: Array = mm.duplicate()
	for x in mt:
		all.append("template:" + str(x))
	var tip := "\n".join(all.slice(0, 6).map(func(x: Variant) -> String: return str(x)))
	if all.size() > 6:
		tip += "\n(+%d more)" % (all.size() - 6)
	return {"text": "Missing assets — %s not found on this server" % " and ".join(parts), "tone": "warn", "sticky": true, "tip": tip}

