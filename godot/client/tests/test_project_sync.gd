extends RefCounted
## ProjectSync.decide() — the autosave response policy of client/app.js:164-218.

const PS := preload("res://core/project_sync_policy.gd")
var t


func test_ok_adopts_rev_and_echo_flag() -> void:
	var v: Dictionary = PS.decide({"ok": true, "status": 200, "data": {"ok": true, "rev": 7.0, "changed": true}}, 0)
	t.eq(v.action, "ok")
	t.eq(v.rev, 7)
	t.eq(v.changed, true)
	var u: Dictionary = PS.decide({"ok": true, "status": 200, "data": {"rev": 7.0, "changed": false}}, 0)
	t.eq(u.changed, false, "unchanged autosaves broadcast nothing → no echo latch")


func test_stale_rev_retries_three_times_then_fails() -> void:
	var r409 := {"ok": false, "status": 409, "data": {"reason": "stale_rev", "storedRev": 12.0}}
	t.eq(PS.decide(r409, 0).action, "retry")
	t.eq(PS.decide(r409, 0).rev, 12)
	t.eq(PS.decide(r409, 2).action, "retry")
	t.eq(PS.decide(r409, 3).action, "fail", "bounded like the web (≤ 3)")


func test_gone_latches() -> void:
	t.eq(PS.decide({"ok": false, "status": 410, "data": {"reason": "project_gone"}}, 0).action, "gone")


func test_other_conflicts_fail_without_retry() -> void:
	var v: Dictionary = PS.decide({"ok": false, "status": 409, "data": {"reason": "empty_over_nonempty"}}, 0)
	t.eq(v.action, "fail")
	t.eq(v.reason, "empty_over_nonempty")
	t.eq(PS.decide({"ok": false, "status": 0, "error": "transport error 4"}, 0).reason, "transport error 4")
