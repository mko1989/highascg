extends RefCounted
## The casparcg.config pane of the logs window: state text, diff marks, sanity check, confirm and result wording.

const M := preload("res://app/config_view_model.gd")
var t

const GOOD := "<configuration>\n<channels>\n<channel>\n<video-mode>1080p5000</video-mode>\n</channel>\n</channels>\n</configuration>"


func test_state_text() -> void:
	t.eq(M.state_text({"dirty": false, "reasons": []}, "", false), "matches what the server would generate")
	t.ok(M.state_text({"dirty": true, "reasons": [{"code": "unwritten"}]}, "", false).contains("would generate a different config"))
	t.ok(M.state_text({"dirty": true, "reasons": [{"code": "unwritten"}]}, "", false).contains("Apply in Devices"))
	t.ok(M.state_text({"dirty": true, "reasons": [{"code": "running_differs"}]}, "", false).contains("running Caspar differs"))
	t.ok(M.state_text({"dirty": false}, "<x/>", false).contains("edited by hand"))
	t.ok(M.state_text({"dirty": false}, "", true).contains("not applied yet"))
	t.eq(M.state_text(null, "", false), "state unknown")
	t.ok(M.state_text({"offline_mode": true}, "", false).contains("offline"))


func test_written_text() -> void:
	var now := 1794316800.0
	t.ok(M.written_text(now * 1000.0 - 3600000.0, now).contains("today"))
	t.eq(M.written_text(null), "")
	t.eq(M.written_text(0), "")
	t.ok(M.written_text((now - 3 * 86400.0) * 1000.0, now).contains("2026-"))


func test_diff_marks() -> void:
	t.eq(M.diff("a\nb\nc", "a\nb\nc"), {"a": [], "b": [], "count": 0, "ok": true})
	var d := M.diff("a\nb\nc\nd", "a\nX\nc\nd\ne")
	t.eq(d.a, [1], "b only on disk")
	t.eq(d.b, [1, 4], "X and e only generated")
	t.eq(d.count, 3)
	t.eq(M.diff_note(d, "Generated"), "3 lines differ from Generated")
	t.eq(M.diff_note({"count": 1, "ok": true}, "Generated"), "1 line differs from Generated")
	t.eq(M.diff_note({"count": 0, "ok": true}, "Generated"), "identical to Generated")
	t.ok(M.diff_note({"ok": false}, "x").contains("too long"))


func test_jump_wraps() -> void:
	t.eq(M.jump([2, 5, 9], 2, true), 5)
	t.eq(M.jump([2, 5, 9], 9, true), 2, "wraps to the first")
	t.eq(M.jump([2, 5, 9], 5, false), 2)
	t.eq(M.jump([2, 5, 9], 2, false), 9, "wraps to the last")
	t.eq(M.jump([], 0, true), -1)


func test_sanity() -> void:
	t.eq(M.sanity(GOOD).ok, true)
	t.eq(M.sanity("").ok, false)
	var open := M.sanity("<configuration>\n<channels>\n<channel/>\n</channels>")
	t.eq(open.ok, false)
	t.ok(open.error.contains("never closed"))
	var cross := M.sanity("<configuration>\n<channels>\n<channel>\n</channels>\n</channel>\n</configuration>")
	t.eq(cross.ok, false)
	t.eq(cross.line, 4)
	t.ok(M.sanity("<foo><channels><channel/></channels></foo>").error.contains("<configuration>"))
	t.ok(M.sanity("<configuration><paths/></configuration>").error.contains("no <channels>"))
	t.ok(M.sanity("<configuration><channels></channels></configuration>").error.contains("no <channel>"))
	t.eq(M.sanity("<configuration><channels><channel/></channels></configuration>").ok, true)
	t.eq(M.sanity("not xml at all").ok, false)


func test_confirm_text() -> void:
	var one := M.confirm_text("highascg7579", false, false)
	t.ok(one.contains("highascg7579"))
	t.ok(one.contains("restart Caspar"))
	t.ok(one.contains("blank for a few seconds"))
	t.ok(one.contains("put back"))
	t.ok(one.contains("REPLACES it with the generated config"))
	t.ok(M.confirm_text("b", true, false).contains("writes THIS text again"))
	t.ok(M.confirm_text("b", false, true).contains("writes that override"))


func test_result_text() -> void:
	t.eq(M.result_text({"ok": true, "data": {"ok": true, "restartSent": true, "restored": {"looks": 2}}}), "Applied. Caspar restarted. restored 2 looks.")
	t.ok(M.result_text({"ok": true, "data": {"ok": true, "restartSent": false}}).contains("not restarted"))
	t.eq(M.result_text({"ok": false, "error": "http 400", "data": {"error": "Invalid path"}}), "FAILED: Invalid path")
	t.ok(M.result_text({"ok": true, "data": {"ok": false, "error": "boom"}}).contains("FAILED: boom"))
	t.ok(M.result_text({"ok": true, "data": {"ok": true, "restartSent": true, "layoutOk": false, "layoutProblem": "canvas"}}).contains("did not verify: canvas"))
