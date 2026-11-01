extends RefCounted
## WO-921 — a new media version takes its own name: the confirm says what the media list and the looks will read; old
## versions are listed under their names (versions stashed before WO-921 have none).

const M := preload("res://features/live/media_versions_model.gd")
var t


func test_upload_text_names_the_new_file() -> void:
	var s := M.upload_text("intro_v2.mov", "intro_v3.mov")
	t.ok(s.begins_with("Replace \"intro_v2.mov\" with \"intro_v3.mov\"?"), "names both files")
	t.ok(s.contains("every look will read \"intro_v3.mov\""), "says the looks follow the new name")
	t.ok(s.contains("kept in the version list"), "the old one is kept")
	t.ok(M.upload_text("show.mov", "show.mov").contains("Every look plays it."), "same name: plain replace")


func test_old_rows_carry_their_names() -> void:
	t.ok(M.old_text({"v": 1, "name": "intro_v2.mov", "replacedAt": 0}).begins_with("intro_v2.mov · replaced"), "named")
	t.eq(M.old_text({"v": 1, "replacedAt": 0}), "replaced ", "pre-WO-921 version: no name")
	t.eq(M.fmt_size(5e6), "5 MB", "size")


func test_purge_confirm_names_the_file() -> void:
	t.eq(M.purge_text({"v": 3, "name": "intro_v4.mp4"}), "Delete version v3 (intro_v4.mp4) permanently? This cannot be undone.", "named")
	t.eq(M.purge_text({"v": 2}), "Delete version v2 permanently? This cannot be undone.", "pre-WO-921 version")



class FakePusher:
	var calls: Array = []
	func schedule(id: String, m: int) -> void: calls.append([id, m])


class FakeEditor:
	extends Control
	var scene_id := "a"
	var main := 0
	var pusher := FakePusher.new()
	var lk: Dictionary = {}
	func look() -> Dictionary: return lk


func test_open_look_editor_restages_when_its_media_moves() -> void:
	const Backdrop := preload("res://features/live/look_editor_backdrop.gd")
	var ed := FakeEditor.new()
	var look := func(v: String) -> Dictionary: return {"layers": [{"source": {"value": v}, "x": 0}]}
	ed.lk = look.call("_wo921/intro_v2.mov")
	ed.set_meta("sources_key", Backdrop.sources_key("a", ed.lk))  # what Backdrop.open records
	ed.lk["layers"][0]["x"] = 10
	Backdrop.follow_media(ed)
	t.eq(ed.pusher.calls.size(), 0, "a move or resize is not a media change")
	ed.lk = look.call("_wo921/intro_v3.mov")
	Backdrop.follow_media(ed)
	t.eq(ed.pusher.calls, [["a", 0]], "the new version's file is staged on PRV")
	Backdrop.follow_media(ed)
	t.eq(ed.pusher.calls.size(), 1, "once")
	ed.free()
