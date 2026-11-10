extends RefCounted
## WO-1029 — apply_plan_model.gd: the button state, the confirm text, progress lines and per-server results.

const M := preload("res://features/devices/apply_plan_model.gd")
var t


func _plan(me_dirty: Variant, other_dirty: Variant, other_online := true) -> Dictionary:
	return {"servers": [
		{"id": "a", "name": "Studio", "self": true, "online": true, "dirty": me_dirty, "screens": ["PGM 1", "Dioda"]},
		{"id": "b", "name": "Hall", "self": false, "online": other_online, "dirty": other_dirty, "screens": ["Proj"]}]}


func test_button_states() -> void:
	t.eq(M.button_state(null, false), {"known": false, "dirty": false, "tip": ""}, "no plan, not dirty: idle")
	t.ok(M.button_state(null, true).dirty, "no plan: the local flag still colours it")
	var s := M.button_state(_plan(true, true), false)
	t.ok(s.dirty and s.tip == "Restart needed on Studio, Hall", "both dirty")
	var clean := M.button_state(_plan(false, false), false)
	t.ok(not clean.dirty and clean.tip.begins_with("Nothing to apply"), "nothing to apply")
	t.ok(M.button_state(_plan(false, false), true).dirty, "local flag on a clean plan: still offered")
	t.ok(M.button_state(_plan(false, null), false).tip.contains("cannot tell for Hall"), "unknown is mentioned, not dirty")
	var off := M.button_state(_plan(false, true, false), false)
	t.ok(not off.dirty and off.tip.contains("Hall needs one but is offline"), "dirty but offline is not actionable")


func test_only_other_server_dirty() -> void:
	var p := _plan(false, true)
	t.eq(M.ids_to_apply(p), ["b"], "only the other server")
	var txt := M.confirm_text(p)
	t.ok(txt.contains("Hall — screens go dark: Proj"), "names the screens")
	t.ok(txt.contains("Studio (this server) — nothing changed"), "this server listed as not restarted")
	t.ok(txt.contains("This server is not restarted"), "says so plainly")
	t.ok(not txt.contains("Studio (this server) — screens"), "this server is not in the restart list")


func test_skip_reasons() -> void:
	t.eq(M.skip_reason({"dirty": false}), "clean", "clean")
	t.eq(M.skip_reason({"dirty": true, "online": false}), "offline", "offline")
	t.eq(M.skip_reason({"dirty": null, "build": "old"}), "old build", "old build")
	t.eq(M.skip_reason({"dirty": null}), "unknown", "unknown")
	t.eq(M.skip_reason({"dirty": true, "online": true}), "", "dirty")
	var txt := M.confirm_text({"servers": [{"id": "a", "self": true, "dirty": true, "screens": ["X"]}, {"id": "c", "name": "C", "dirty": null}, {"id": "d", "name": "D", "online": false, "dirty": true}]})
	t.ok(txt.contains("C — not known") and txt.contains("D — offline"), "skipped lines")
	t.ok(M.anyway_text(_plan(false, false)).ends_with("anyway?"), "nothing dirty: restart-anyway question")


func test_progress() -> void:
	var p := _plan(true, true)
	t.eq(M.progress_line({"phase": "start", "order": ["b", "a"]}, p), "Applying Caspar config on 2 servers…", "start")
	t.eq(M.progress_line({"phase": "server", "id": "b", "state": "applying", "index": 1, "total": 2}, p), "Applying 1/2 — Hall: restarting Caspar, then putting the screens back", "applying")
	var dn := M.progress_line({"phase": "server", "id": "b", "name": "Hall", "state": "done", "index": 1, "total": 2, "result": {"id": "b", "name": "Hall", "applied": true, "ok": true}}, p)
	t.eq(dn, "Applying 1/2 — Hall: restarted", "done")
	t.eq(M.progress_line({"phase": "done", "ok": true}, p), "", "done is not a progress line")
	t.eq(M.progress_line("x", p), "", "junk")


func test_results() -> void:
	var ans := {"results": [
		{"id": "b", "applied": true, "ok": true, "restored": {"looks": [{"channel": 1, "action": "take"}, {"channel": 2, "action": "take"}], "clips": [{"clip": "show.mp4", "at_s": 70, "resumed_s": 83}], "card": {"restored": true},
			"timeline": {"playing": true, "resumed_ms": 12000}, "skipped": [{"what": "record", "why": "not restarted"}], "ms": 4200}},
		{"id": "a", "applied": false, "skipped": "clean", "ok": true},
		{"id": "c", "applied": false, "ok": false, "error": "timeout"}]}
	var r := M.result(ans, _plan(false, true))
	t.ok(r.detail.contains("Hall: restarted, restored 2 looks, show.mp4 at 1:23, test card, timeline at 0:12 in 4.2 s; NOT restored: record (not restarted)"), "restored line")
	t.ok(r.detail.contains("Studio: skipped — clean"), "skipped row")
	t.ok(r.detail.contains("c: FAILED — timeout"), "failed row")
	t.ok(not r.ok, "a failure makes it not ok")
	var good := M.result({"servers": [{"id": "b", "applied": true, "ok": true, "restored": {"looks": 1, "skipped": [{"what": "x", "why": "y"}]}}]}, null)
	t.ok(good.ok and good.warn, "unrestored items: warn colour")
	t.eq(M.result({"ok": true, "message": "done"}, null).summary, "done", "old single answer")
	t.eq(M.restored_text({}), "", "no block")
	t.eq(M.mmss(3725), "62:05", "mm:ss")


func test_run_following() -> void:
	t.eq(M.run_to_follow(202, {"accepted": true, "run_id": "r1", "order": ["b"]}), {"run_id": "r1", "how": "started"}, "202")
	t.eq(M.run_to_follow(409, {"error": "an apply is already running", "run_id": "r0"}), {"run_id": "r0", "how": "attached"}, "409 attaches")
	t.eq(M.run_to_follow(400, {"error": "x"}).how, "", "400: nothing to follow")
	t.ok(M.finishes({"phase": "done", "run_id": "r1"}, "r1") and not M.finishes({"phase": "done", "run_id": "r2"}, "r1"), "done of OUR run")
	t.ok(M.finishes({"phase": "done", "run_id": "r2"}, ""), "attached without an id: any run")
	t.ok(not M.finishes({"phase": "server", "run_id": "r1"}, "r1"), "server event is not the end")
	var running := {"running": true, "run": {"run_id": "r1", "finished_at": null}}
	t.ok(M.finished_run(running, "r1").is_empty(), "still running")
	var fin := {"running": false, "run": {"run_id": "r1", "finished_at": 5, "ok": true, "results": [{"id": "b", "applied": true, "ok": true}]}}
	t.eq(M.finished_run(fin, "r1").ok, true, "finished run is returned")
	t.ok(M.finished_run(fin, "r9").is_empty(), "another run's status is not ours")
	t.ok(M.finished_run({"running": false, "run": null}, "").is_empty(), "no run")


func test_restored_null_with_reason() -> void:
	var row := {"id": "b", "name": "Hall", "applied": true, "ok": true, "restored": null, "restored_reason": "no restart"}
	t.eq(M.result_line(row, null), "Hall: restarted, no Caspar restart happened", "no restart")
	row.restored_reason = "snapshot failed: timeout"
	t.ok(M.result_line(row, null).contains("air state not restored (snapshot failed: timeout)"), "reason shown")
	var res := M.result({"ok": true, "results": [row]}, null)
	t.ok(res.warn, "an unrestored air state is amber")
	t.ok(M.result({"ok": true, "results": [{"id": "b", "name": "Hall", "applied": true, "ok": true, "restored": null, "restored_reason": "no restart"}]}, null).warn == false, "no restart: not amber")
	t.ok(M.result_line({"id": "a", "name": "A", "applied": false, "skipped": "stopped"}, null).contains("earlier server failed"), "stopped")


func test_consumers_and_plan_apply_flag() -> void:
	var txt := M.restored_text({"looks": [], "consumers": {"stream": {"restarted": true}, "records": [{"key": "rec1", "restarted": false}]}})
	t.ok(txt.contains("stream restarted") and txt.contains("recording rec1 (was running, NOT restarted)"), "stream restarted, recording reported")
	t.eq(M.skip_reason({"dirty": true, "online": true, "apply": false}), "unknown", "node says it would not apply it")
	t.eq(M.ids_to_apply({"servers": [{"id": "x", "dirty": true, "apply": true}, {"id": "y", "dirty": false, "apply": false}]}), ["x"], "apply order kept")
