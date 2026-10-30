extends RefCounted
## WO-825 — Settings → GDTF library texts.

const M := preload("res://features/settings/library_model.gd")
var t


func test_size() -> void:
	t.eq(M.size(2048), "2 kB", "kB")
	t.eq(M.size(70 * 1048576), "70 MB", "MB")
	t.eq(M.size(12.1 * 1073741824.0), "12.1 GB", "GB")


func test_library_line() -> void:
	t.ok(M.library_line({}).begins_with("Not built yet"), "empty")
	t.eq(M.library_line({"library": {"ready": true, "count": 10487, "bytes": 70 * 1048576, "builtAt": "2026-10-30T10:00:00Z"}}),
		"10487 fixtures — description and thumbnail of every fixture (70 MB on disk). Built 2026-10-30.", "ready")


func test_full_line_and_confirm() -> void:
	var st := {"full": {"files": 10487, "bytes": 12.0 * 1073741824.0, "doneFiles": 487, "doneBytes": 2.0 * 1073741824.0}}
	t.eq(M.full_line(st), "2.0 GB of 12.0 GB downloaded (487 of 10487 fixtures).", "progress")
	t.ok(M.confirm_full(st).contains("10.0 GB"), "only what is left")
	t.ok(M.full_line({"full": {"error": "offline"}}).contains("12 GB"), "no estimate: says the rule of thumb")


func test_job_line() -> void:
	var run := {"job": {"kind": "full", "state": "running", "total": 100, "done": 3, "skipped": 4, "failed": 1, "current": "Robe Robin"}}
	t.ok(M.running(run), "running")
	t.eq(M.job_line(run), "Model download: 7 of 100 — 1 failed — Robe Robin", "running line")
	var stop := {"job": {"kind": "library", "state": "cancelled", "total": 10, "done": 2, "skipped": 0, "failed": 0}}
	t.ok(not M.running(stop) and M.job_line(stop).contains("continue where it left off"), "cancelled is resumable")
	t.eq(M.job_line({"job": {"kind": "full", "state": "error", "error": "not enough disk space"}}), "Model download stopped: not enough disk space", "error")
	t.eq(M.job_line({}), "", "no job")


func test_pending() -> void:
	t.eq(M.pending_line({"pending": 0}), "", "none")
	t.ok(M.pending_line({"pending": 2}).begins_with("2 fixture(s)"), "count")
