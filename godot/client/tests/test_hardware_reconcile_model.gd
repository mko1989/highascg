extends RefCounted

const M := preload("res://app/hardware_reconcile_model.gd")

var t


func test_decide() -> void:
	var hard := {"prompt": true, "severity": "hard"}
	var soft := {"prompt": true, "severity": "soft"}
	t.eq(M.decide({"prompt": false, "severity": "hard"}, "ask"), "none", "no prompt")
	t.eq(M.decide(hard, "ask"), "ask", "ask")
	t.eq(M.decide(soft, "apply_saved"), "apply", "apply soft")
	t.eq(M.decide(hard, "apply_saved"), "ask", "hard never auto-applies")
	t.eq(M.decide(hard, "keep_live"), "keep", "keep")
	t.eq(M.policy_of("bogus"), "ask", "unknown policy")
	t.eq(M.policy_of("keep_live"), "keep_live", "known policy")


func test_lead_and_lines() -> void:
	t.eq(M.lead({"projectName": "Tour", "sameMachine": false}).begins_with("Tour includes"), true, "name")
	t.eq(M.lead({"sameMachine": true}).ends_with("differs from what was saved."), true, "same machine tail")
	t.eq(M.diff_lines([]), [["Hardware — Saved routing differs from the live machine.", "soft"]], "fallback line")
	var many: Array = []
	for i in 14:
		many.append({"section": "S", "message": str(i), "severity": "hard"})
	var lines := M.diff_lines(many)
	t.eq(lines.size(), 13, "12 + more")
	t.eq(lines[12], ["…and 2 more difference(s).", "soft"], "more line")
	t.eq(lines[0], ["S — 0", "hard"], "first")


func test_remembered() -> void:
	t.eq(M.remembered("apply_saved", "ask"), "apply_saved", "choice when picker untouched")
	t.eq(M.remembered("cancel", "keep_live"), "keep_live", "explicit pick wins")
	t.eq(M.remembered("device_view", "ask"), "ask", "ask stays ask")


func test_apply_notice() -> void:
	t.eq(M.apply_notice(true, {"ok": true, "steps": ["A", "B"], "warnings": []}), {"text": "A · B", "tone": "ok"}, "steps")
	t.eq(M.apply_notice(true, {"ok": true, "steps": [], "warnings": ["W"]}).text, "Project hardware applied (W)", "warning")
	t.eq(M.apply_notice(false, {"error": "nope"}).text, "Project hardware apply failed: nope", "error")


func test_missing_notice() -> void:
	t.eq(M.missing_notice({"isClean": true}), {}, "clean")
	t.eq(M.missing_notice(null), {}, "no data")
	var n := M.missing_notice({"isClean": false, "missingMedia": ["a.mov"], "missingTemplates": ["T1", "T2"]})
	t.eq(n.text, "Missing assets — 1 media clip and 2 templates not found on this server", "text")
	t.eq(n.tip, "a.mov\ntemplate:T1\ntemplate:T2", "tip")
	t.eq(n.sticky, true, "sticky")
	var many: Array = []
	for i in 8:
		many.append("c%d" % i)
	t.eq(M.missing_notice({"isClean": false, "missingMedia": many}).tip.ends_with("c5\n(+2 more)"), true, "more")
