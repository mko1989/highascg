extends RefCounted
## WO-603 slice 1 — desktop-drop ingest helpers (drop target folder, status line).

const I := preload("res://features/live/media_ingest.gd")
var t


func test_drop_target_folder() -> void:
	t.eq(I.folder_for(null), "", "empty space → server default")
	t.eq(I.folder_for({"folder": "projects/airport"}), "projects/airport", "a folder row is itself")
	t.eq(I.folder_for({"type": "media", "value": "projects/airport/a.mov"}), "projects/airport", "a file → its folder")
	t.eq(I.folder_for({"type": "media", "value": "AMB"}), "", "a root file → the root")
	t.eq(I.folder_for({"type": "effect", "value": "blur/x"}), "", "an effect row is not a folder")
	t.eq(I.request(PackedStringArray(["/home/a.mov"]), "X"), {"paths": ["/home/a.mov"], "folder": "X"}, "body")


func test_status_line() -> void:
	t.eq(I.status_text({}), "", "idle → nothing")
	t.eq(I.status_text({"phase": "copying", "fileIndex": 1, "fileTotal": 3, "bytesDone": 50, "bytesTotal": 200, "fileRel": "Akt 1/sub/b.png"}), "Copying 2/3 · 25%  b.png", "progress")
	t.eq(I.status_text({"phase": "copying", "fileTotal": 2}), "Copying 1/2 · 0%", "first report")
	t.eq(I.status_text({"phase": "complete", "message": "Imported 2 file(s)"}), "✓ Imported 2 file(s)", "done")
	t.eq(I.status_text({"phase": "error", "message": "Ingest failed", "error": "ENOSPC"}), "✗ Ingest failed: ENOSPC", "error")
	t.eq(I.status_text({"phase": "cancelled", "message": "Ingest cancelled", "error": "Cancelled"}), "✗ Ingest cancelled", "cancel")
	t.ok(I.busy({"active": true}) and not I.busy({}), "busy")


func test_upload_plan_walks_folders_like_the_server() -> void:
	var root := OS.get_user_data_dir().path_join("wo603_plan_test")
	for d in ["show/sub", "show/.hidden"]:
		DirAccess.make_dir_recursive_absolute(root.path_join(d))
	for f in ["one.mov", "show/a.png", "show/sub/b.png"]:
		FileAccess.open(root.path_join(f), FileAccess.WRITE).store_string("x")
	var plan := I.upload_plan(PackedStringArray([root.path_join("one.mov"), root.path_join("show"), root.path_join("nope.mov")]), "projects/p")
	t.eq(plan.map(func(e: Dictionary) -> Array: return [e.file.trim_prefix(root + "/"), e.path]),
		[["one.mov", "projects/p"], ["show/a.png", "projects/p/show"], ["show/sub/b.png", "projects/p/show/sub"]],
		"a dropped folder keeps its name and subfolders; missing paths are skipped")
	t.eq(I.upload_plan(PackedStringArray([root.path_join("show/sub")]), "")[0].path, "sub", "root target")
	for f in ["one.mov", "show/a.png", "show/sub/b.png"]:
		DirAccess.remove_absolute(root.path_join(f))
	for d in ["show/sub", "show/.hidden", "show", ""]:
		DirAccess.remove_absolute(root.path_join(d))


func test_upload_and_download_lines() -> void:
	t.eq(I.upload_text(1, 5, 40, 100, "/x/clip.mov"), "Uploading 2/5 · 40%  clip.mov")
	t.eq(I.download_text({"active": true, "message": "Downloading from WeTransfer…", "progress": 41.6}), "Downloading from WeTransfer… 42%", "web poller line")
	t.eq(I.download_text({"active": true, "message": "", "progress": null}), "Working…")
	t.eq(I.download_text({"active": false, "error": "HTTP 404", "message": "Download failed"}), "✗ HTTP 404")
	t.eq(I.download_text({"active": false, "error": null, "message": "Downloaded clip.mov"}), "✓ Downloaded clip.mov")
