extends RefCounted

const M := preload("res://features/live/usb_import_model.gd")

var t


func test_is_media() -> void:
	t.eq(M.is_media("clip.MOV"), true, "upper-case ext")
	t.eq(M.is_media("a.b.wav"), true, "last ext")
	t.eq(M.is_media("readme.txt"), false, "txt")
	t.eq(M.is_media("noext"), false, "no dot")


func test_format_size() -> void:
	t.eq(M.format_size(0), "", "0 → empty")
	t.eq(M.format_size(null), "", "null")
	t.eq(M.format_size(512), "512 B", "bytes")
	t.eq(M.format_size(1536), "1.5 KB", "KB")
	t.eq(M.format_size(5 * 1024 * 1024), "5.0 MB", "MB")
	t.eq(M.format_size(3.0 * 1024 * 1024 * 1024), "3.00 GB", "GB")


func test_drive_label_and_paths() -> void:
	t.eq(M.drive_label({"id": "sdb1", "label": "STICK", "size": "64G"}), "STICK (64G)", "label")
	t.eq(M.drive_label({"id": "sdb1"}), "sdb1 (—)", "no label/size")
	t.eq(M.parent_rel("a/b/c"), "a/b", "parent")
	t.eq(M.parent_rel("a"), "", "top")
	t.eq(M.parent_rel(""), "", "root")
	t.eq(M.crumbs("a/b"), [["/", ""], ["a", "a"], ["b", "a/b"]], "crumbs")
	t.eq(M.summary(2), "2 file(s) selected", "summary")


func test_progress() -> void:
	var idle := M.progress({"active": false, "phase": "idle", "progress": null, "message": "", "error": null, "fileRel": ""})
	t.eq(idle.show, false, "idle hidden")
	var poll := M.progress({"active": true, "phase": "copying", "progress": 42.4, "message": "Copying", "fileRel": "a/b.mov", "fileIndex": 0, "fileTotal": 2})
	t.eq([poll.show, poll.pct, poll.line], [true, 42.4, "Copying — a/b.mov"], "poll line")
	var ws := M.progress({"phase": "copying", "progress": 150, "fileRel": "x.mp4", "fileIndex": 1, "fileTotal": 3})
	t.eq([ws.pct, ws.line], [100.0, "x.mp4 (2/3)"], "ws frame clamps + counts")
	var done := M.progress({"active": false, "phase": "complete", "progress": 100, "message": "Done", "fileRel": ""})
	t.eq([done.show, done.done, done.error], [true, true, ""], "complete")
	var bad := M.progress({"active": false, "phase": "error", "error": "disk full", "message": ""})
	t.eq([bad.show, bad.error], [true, "disk full"], "error")
