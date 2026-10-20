extends RefCounted
## WO-603 slice 4 — hap_status.gd = the web client/lib/hap-encode-status.js. GOLD is the web module's output for the
## same inputs (node, 2026-10-20); the web's null progress line is "" here.

const H := preload("res://features/live/hap_status.gd")
const GOLD := "{\"fmt\":[{\"format\":\"hap\",\"label\":\"HAP\",\"downgraded\":false},{\"format\":\"hap_q\",\"label\":\"HAP Q\",\"downgraded\":false},{\"format\":\"hap_alpha\",\"label\":\"HAP Alpha\",\"downgraded\":false},{\"format\":\"hap_alpha\",\"label\":\"HAP Alpha\",\"downgraded\":true}],\"warn\":[[\"HAP Q has no alpha in this encoder \u2014 will encode HAP Alpha.\",\"Something is playing on-air. Encoding uses many CPU cores and can cause dropped frames.\"],[\"1 file has an alpha channel that will be dropped. Turn Alpha on to keep it.\",\"1 file will be skipped (already HAP, already encoded, or not a video).\"],[\"1 file will be skipped (already HAP, already encoded, or not a video).\"],[\"1 file has an alpha channel that will be dropped. Turn Alpha on to keep it.\"],[\"Nothing to encode: every selected file would be skipped.\"]],\"prog\":[null,\"Encoding HAP Q 2/3 \u00b7 43%\",\"Encoding HAP 1/1\"],\"sum\":[{\"text\":\"HAP: 2 encoded, 1 skipped, 1 resized to a multiple of 4\",\"kind\":\"ok\"},{\"text\":\"HAP: 1 encoded, 1 failed \u2014 a/b.mov: ffmpeg exit 1\",\"kind\":\"error\"},{\"text\":\"HAP: 2 skipped (already HAP)\",\"kind\":\"info\"},{\"text\":\"HAP: nothing to do\",\"kind\":\"info\"},{\"text\":\"HAP: 3 cancelled\",\"kind\":\"info\"}]}"
var t


func _gold() -> Dictionary:
	return JSON.parse_string(GOLD)


func test_format_and_warnings() -> void:
	var g := _gold()
	var i := 0
	for ah in [[false, false], [false, true], [true, false], [true, true]]:
		t.eq(H.format_for(ah[0], ah[1]), g.fmt[i], "format %s" % str(ah))
		i += 1
	var probe := [{"ok": true, "hasAlpha": true}, {"ok": true, "hasAlpha": false}, {"ok": false, "reason": "already HAP"}]
	var got := [
		H.modal_warnings(true, true, true, null),
		H.modal_warnings(false, false, false, probe),
		H.modal_warnings(true, false, false, probe),
		H.modal_warnings(false, false, false, [{"ok": true, "hasAlpha": true}]),
		H.modal_warnings(false, false, false, [{"ok": false}, {"ok": false}]),
	]
	for k in got.size():
		t.eq(Array(got[k]), g.warn[k], "warnings %d" % k)


func test_progress_and_summary() -> void:
	var g := _gold()
	t.eq(H.progress_text([]), "", "idle")
	t.eq(H.progress_text([{"finished": false, "format": "hap_q", "items": [{"state": "done"}, {"state": "running", "pct": 0.434}, {"state": "queued"}, {"state": "skipped"}]}]), g.prog[1], "running")
	t.eq(H.progress_text([{"finished": true, "items": []}, {"finished": false, "format": "hap", "items": [{"state": "queued"}]}]), g.prog[2], "queued after a finished job")
	var jobs := [
		{"counts": {"done": 2, "skipped": 1}, "items": [{"state": "done", "note": "resized"}, {"state": "done"}, {"state": "skipped", "reason": "x"}]},
		{"counts": {"done": 1, "failed": 1}, "items": [{"state": "done"}, {"id": "a/b.mov", "state": "failed", "reason": "ffmpeg exit 1"}]},
		{"counts": {"skipped": 2}, "items": [{"state": "skipped", "reason": "already HAP"}, {"state": "skipped"}]},
		{"counts": {}, "items": []},
		{"counts": {"cancelled": 3}, "items": []},
	]
	for k in jobs.size():
		t.eq(H.finished_summary(jobs[k]), g.sum[k], "summary %d" % k)
	t.ok(H.job_active({"finished": false}) and not H.job_active({"finished": true}) and not H.job_active(null), "active")
