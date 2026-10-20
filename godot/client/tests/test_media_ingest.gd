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
