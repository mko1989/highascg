extends RefCounted
## WO-1029 C10 — media_needs_model.gd: row states, the Spread button, confirm text, look tips, progress.

const M := preload("res://features/live/media_needs_model.gd")
const S := preload("res://features/live/media_spread_text.gd")
var t


func _needs() -> Dictionary:
	return {"servers": [{"id": "a", "name": "Box A", "self": true, "online": true, "known": true},
			{"id": "b", "name": "Box B", "online": true, "known": true}, {"id": "c", "name": "Box C", "online": true, "known": false}],
		"files": [
			{"id": "X/here.mov", "size": 100, "on": ["a", "b"], "needed_on": [], "missing_on": [], "differs_on": []},
			{"id": "X/need.mov", "size": 2048, "on": ["a"], "missing_on": ["b"], "differs_on": [],
				"needed_on": [{"server": "b", "destinations": [{"id": "d2", "label": "Screen 2"}], "looks": ["Intro"]}]},
			{"id": "X/diff.mov", "size": 50, "on": ["a", "b"], "missing_on": [], "differs_on": ["b"], "newer_on": ["b"], "needed_on": []},
			{"id": "X/theirs.mov", "size": 10, "on": ["b"], "missing_on": ["a"], "differs_on": [], "needed_on": []}]}


func test_no_linked_servers_means_nothing() -> void:
	var solo := {"servers": [{"id": "a", "name": "A", "self": true}], "files": [{"id": "x", "on": ["a"], "missing_on": ["b"]}]}
	t.eq(M.linked(solo), false, "one server is not linked")
	t.eq(M.states(solo), {}, "no markers")
	t.eq(M.button(solo).visible, false, "no button at all")
	t.eq(M.remote_rows(solo, []), [], "no remote rows")
	t.eq(M.button(null).visible, false, "no answer")
	t.eq(M.look_tips(solo), {}, "no look tips")


func test_row_states() -> void:
	var s := M.states(_needs())
	t.eq(s["X/HERE.MOV"].state, "unknown", "present, but peer C is unknown: quiet")
	t.eq(s["X/HERE.MOV"].text, "", "unknown has no marker")
	t.eq(s["X/HERE.MOV"].amber, false, "unknown is never amber")
	t.eq(s["X/NEED.MOV"].state, "needed", "needed on B")
	t.eq(s["X/NEED.MOV"].text, "needed on Box B (Screen 2)", "wording")
	t.eq(s["X/NEED.MOV"].amber, true, "amber")
	t.eq(s["X/DIFF.MOV"].state, "differs", "differs")
	t.eq(s["X/DIFF.MOV"].text, "differs on Box B", "wording")
	t.eq(s["X/THEIRS.MOV"].state, "elsewhere", "only on B")
	t.eq(s["X/THEIRS.MOV"].text, "on Box B", "wording")
	t.eq(s["X/THEIRS.MOV"].grey, true, "greyed")
	var all_known := _needs()
	all_known.servers[2].known = true
	t.eq(M.states(all_known)["X/HERE.MOV"].state, "here", "everywhere: here")


## Owner 10.11: "ZZ_TL_RAMP needed on highascg5867" although 5867 holds the file — used there is not a notice.
func test_used_where_it_already_is_has_no_notice() -> void:
	var n := _needs()
	n.files.append({"id": "X/there.mov", "size": 9, "on": ["b"], "missing_on": [], "differs_on": [],
		"needed_on": [{"server": "b", "destinations": [{"id": "d2", "label": "Screen 2"}], "looks": ["Ramp"]}]})
	var st: Dictionary = M.states(n)["X/THERE.MOV"]
	t.eq(st.state, "elsewhere", "only on B, and B is where it is used")
	t.eq(st.text, "on Box B", "no 'needed on' wording")
	t.eq(st.amber, false, "not amber")


func test_unknown_peer_is_never_missing() -> void:
	var n := _needs()
	n.files.append({"id": "X/maybe.mov", "size": 5, "on": ["a"], "missing_on": ["c"], "needed_on": [{"server": "c", "destinations": [], "looks": ["L"]}]})
	t.eq(M.states(n)["X/MAYBE.MOV"].amber, false, "unknown inventory: no amber")
	t.eq(M.plan(n).filter(func(i: Dictionary) -> bool: return i.id == "X/maybe.mov"), [], "not in the plan")
	t.eq(M.look_tips(n).has("L"), false, "no look tip")


func test_older_differing_copy_is_replaced_newer_is_not() -> void:
	var n := _needs()
	n.files.append({"id": "X/old.mov", "size": 7, "on": ["a", "b"], "missing_on": [], "differs_on": ["b"], "newer_on": [], "needed_on": []})
	t.eq(M.button(n).text, "Spread (3)", "diff.mov is NEWER on B: skipped; old.mov is replaced")
	t.ok(M.confirm_text(n).contains("1 older copy will be replaced") or M.confirm_text(n).contains("older copy"), "replacement is said")
	t.ok(M.confirm_text(n).contains("NEWER"), "newer is listed as not copied")


func test_server_answer_shapes() -> void:
	var n := _needs()
	n["self_id"] = "a"
	n["elsewhere"] = [{"id": "CLIPS/ONLY_ON_B", "path": "CLIPS/only_on_b.png", "size": 12, "on": ["b"]}]
	n["looks"] = [{"id": "look1", "name": "Stream A", "missing": [{"file": "X/need.mov", "server": "b", "destination": "d2"}]},
		{"id": "look2", "name": "Fine", "missing": [{"file": "X/q.mov", "server": "c"}]}]
	var rows := M.remote_rows(n, [])
	t.ok(rows.any(func(r: Dictionary) -> bool: return r.id == "CLIPS/ONLY_ON_B" and r.type == "STILL"), "elsewhere rows with a type from the extension")
	var tips := M.look_tips(n)
	t.eq(tips.get("Stream A"), "Media missing on the box that outputs this screen — Box B: need.mov", "by name")
	t.eq(tips.get("look1"), tips.get("Stream A"), "and by id")
	t.eq(tips.has("Fine"), false, "unknown peer C: not missing")
	t.eq(S.start_outcome(409, {"error": "x", "run": {"id": "ms_1", "files": []}}).run_id, "ms_1", "409 run id")


func test_remote_rows() -> void:
	var rows := M.remote_rows(_needs(), [{"id": "x/here.mov"}])
	t.eq(rows.map(func(r: Dictionary) -> String: return r.id), ["X/theirs.mov"], "only files no local row has")
	t.eq(rows[0].remote, true, "flagged")


func test_button_and_confirm() -> void:
	var b := M.button(_needs())
	t.eq(b.text, "Spread (2)", "need.mov to B, theirs.mov to A (diff.mov is newer on B)")
	t.eq(b.disabled, false, "enabled")
	t.eq(b.bytes, 2058.0, "total size")
	t.eq(M.button(_needs(), true).disabled, true, "disabled while running")
	var idle := _needs()
	idle.files = [idle.files[0]]
	var bi := M.button(idle)
	t.eq(bi.text, "Spread (0)", "zero")
	t.eq(bi.disabled, true, "disabled at 0")
	t.eq(bi.tip, "every linked server has the media its screens use", "tooltip")
	var c := M.confirm_text(_needs())
	t.ok(c.contains("To Box B (2 KB):  need.mov"), "what goes where")
	t.ok(c.contains("1 file differ"), "newer-differs skipped, with why")
	t.ok(c.contains("Box C — its media is not known"), "unknown skipped")
	var off := _needs()
	off.servers[1].online = false
	t.ok(M.confirm_text(off).contains("Box B is offline"), "offline skipped")
	t.eq(M.button(off).text, "Spread (1)", "offline peer gets nothing; B -> A still goes")


func test_look_tips_and_take_notice() -> void:
	var tips := M.look_tips(_needs())
	t.eq(tips.get("Intro"), "Media missing on the box that outputs this screen — Box B: need.mov", "tip names clip and box")
	t.eq(tips.size(), 1, "other looks are clean")
	t.eq(M.take_notice({"media_missing": [{"id": "X/need.mov", "server": "b"}]}, _needs()), "⚠ Media missing: need.mov on Box B — Spread copies it", "notice")
	t.eq(M.take_notice({"ok": true}), "", "clean take")
	t.eq(M.take_notice({"media_missing": []}), "", "empty list")


func test_progress_and_result() -> void:
	var st := {"running": true, "run": {"bytes": 3221225472, "done_bytes": 1073741824, "files": [
		{"id": "X/a.mov", "to": "b", "state": "done", "bytes": 1}, {"id": "X/b.mov", "to": "b", "state": "copying"}, {"id": "X/c.mov", "to": "a", "state": "queued"}]}}
	t.eq(S.progress_line(st, _needs()), "Spreading 2 of 3 · b.mov → Box B · 1.0 GB / 3.0 GB", "progress")
	t.eq(S.is_running(st), true, "running")
	var fin := {"running": false, "run": {"files": [{"id": "X/a.mov", "to": "b", "state": "done", "bytes": 1048576},
		{"id": "X/b.mov", "to": "b", "state": "failed", "error": "no space"}, {"id": "X/c.mov", "to": "a", "state": "skipped"}]}}
	var r := S.result(fin, _needs())
	t.eq(r.ok, false, "failure")
	t.eq(r.text, "✗ Spread: 1 copied, 1 failed, 1 skipped", "line")
	t.eq(r.tip, "b.mov → Box B: no space", "failures listed")
	t.eq(S.result({"run": {"files": [{"id": "a", "state": "done", "bytes": 1048576}]}}).text, "✓ Spread: 1 copy (1 MB)", "success")
	t.eq(S.finishes({"phase": "done"}), true, "done event")
	t.eq(S.event_line({"phase": "start"}), "Spreading media…", "start event")


func test_explicit_send() -> void:
	var n := _needs()
	t.eq(S.send_targets(n).map(func(s: Dictionary) -> String: return s.id), ["b"], "C unknown: not offered")
	t.eq(S.sendable(["A/x", "", "A/x", "B"]), ["A/x", "B"], "once each, no blanks")
	var one := {"servers": [{"id": "a", "name": "A", "self": true}, {"id": "b", "name": "highascg5867", "online": true, "known": true}],
		"files": [{"id": "TESTOWE/BIG", "size": 36720000000, "on": ["a"]}]}
	t.eq(S.send_confirm(one, ["TESTOWE/BIG"], ["b"]), "Copy 1 file (34.2 GB) to highascg5867, same folder: TESTOWE/. The originals stay here.", "confirm")
	one.files[0].on = ["a", "b"]
	t.ok(S.send_confirm(one, ["TESTOWE/BIG"], ["b"]).contains("Already there, skipped: BIG on highascg5867"), "already there")
	t.eq(S.send_body(["x"], ["b"]), {"files": ["x"], "to": ["b"]}, "body")
	var st := {"running": true, "run": {"bytes": 36720000000, "done_bytes": 13314398617, "files": [{"id": "T/BIG", "to": "b", "state": "copying", "bytes": 36720000000, "done_bytes": 13314398617}]}}
	t.eq(S.progress_line(st, one), "Spreading 1 of 1 · BIG → highascg5867 (12.4 GB / 34.2 GB)", "bytes of one big file")
	t.ok(S.progress_line(st, one, 600.0).ends_with("~18 min left"), "eta")
	t.eq(S.eta_text(10, 100, 2), "", "too early")
	var skip := {"run": {"files": [{"id": "T/BIG", "to": "b", "state": "skipped", "error": "already there"}]}}
	t.eq(S.result(skip, one).text, "Nothing copied — BIG → highascg5867: already there", "all skipped")


func test_final_shapes() -> void:
	var n := _needs()
	n["summary"] = {"to_send": {"transfers": 3, "files": 5, "bytes": 9000}}
	t.eq(M.button(n).text, "Spread (5)", "N is the server's own count")
	n["looks"] = [{"id": "l", "name": "Stream A", "missing": [{"file": "X/need.mov", "server": "b", "server_name": "highascg5867", "destination": "d", "screen": "PGM"}]}]
	t.eq(M.look_tips(n).get("Stream A"), "Media missing on the box that outputs this screen — highascg5867: need.mov (PGM)", "server_name + screen")
	var m := _needs()
	m.files[1].needed_on[0]["timelines"] = ["Show 1"]
	t.ok(M.states(m)["X/NEED.MOV"].tip.contains("timeline Show 1"), "timelines named")
	var lib := S.library_index([{"id": "T/Free", "size": 36720000000, "on": ["a", "b"]}])
	t.eq(S.size_of(null, "t/free", [], lib), 36720000000.0, "library size, never 'size unknown'")
	t.eq(S.already_there(null, "T/FREE", "b", lib), true, "already there known before sending")
	t.eq(S.size_of(null, "q", [{"id": "q", "fileSize": 77}]), 77.0, "/api/media fileSize fallback")
	var st := {"running": true, "run": {"bytes": 10, "done_bytes": 5, "files": [{"id": "A/x", "to": "b", "state": "copying", "bytes": 10, "done_bytes": 5, "throttle_kbps": 9765}]}}
	t.ok(S.progress_line(st).contains("rate-limited while on air"), "throttle number shows")
	st.run.files[0]["throttle_kbps"] = null
	t.eq(S.progress_line(st).contains("rate-limited"), false, "null = idle: nothing")
	var snap := S.apply_event({}, {"event": "start", "run": {"bytes": 100, "done_bytes": 0, "files": [{"id": "A/x", "state": "queued"}]}})
	snap = S.apply_event(snap, {"event": "file", "index": 0, "file": {"id": "A/x", "to": "b", "state": "copying", "bytes": 100, "done_bytes": 40}, "done_bytes": 40})
	t.eq(snap.files[0].done_bytes, 40, "file event folded")
	t.eq(snap.done_bytes, 40, "run bytes")
	t.eq(S.skip_reason({"reason": "already there", "error": ""}), "already there", "reason carries it")
	t.eq(S.start_outcome(400, {"error": "nothing to send", "skipped": [{"id": "T/BIG", "to": "b", "reason": "already there"}]}).error, "nothing to send — BIG: already there", "400 lists why")
	t.eq(S.result({"run": {"state": "cancelled", "files": [{"id": "a", "state": "done", "bytes": 1048576}]}}).text, "Spread cancelled — 1 copied (1 MB)", "cancelled")


func test_start_outcome() -> void:
	t.eq(S.start_outcome(202, {"run_id": "r1"}), {"how": "started", "run_id": "r1"}, "202")
	t.eq(S.start_outcome(409, {"run": {"run_id": "r0", "files": []}}).how, "attached", "409 attaches")
	t.eq(S.start_outcome(500, {"error": "boom"}).how, "refused", "refused")
