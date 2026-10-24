extends RefCounted
## WO-744 — Live-tab rows for shm rings (features/live/shm_sources_model.gd) and their wiring into the Live panel.

const Shm := preload("res://features/live/shm_sources_model.gd")
const M := preload("res://features/live/live_sources_model.gd")
var t


func test_rows() -> void:
	var data := {"ok": true, "sources": [
		{"name": "vj", "value": "shm://vj", "width": 1280, "height": 720, "fps": 50, "writer": "godot", "signal": true},
		{"name": "grab", "value": "shm://grab", "width": 0, "height": 0, "fps": 0, "writer": "", "signal": false},
		{"name": "broken"}]}
	var rows := Shm.rows(data)
	t.eq(rows.size(), 2, "a source without a value is skipped")
	var vj: Dictionary = rows[0]
	t.eq(M.drag_payload(vj), {"type": "shm", "value": "shm://vj", "label": "vj", "resolution": "1280×720", "fps": 50,
		"routeType": "shm"}, "drags the shm:// value the server plays as SHM NAME")
	t.eq(M.meta(vj) + Shm.meta_suffix(vj), "1280×720 · 50 fps · godot", "meta line names the writer")
	t.eq(Shm.warning(vj), "", "frames arriving: no warning")
	t.eq(Shm.warning(rows[1]), "No frames from the writer", "stopped writer warns")
	t.eq(Shm.meta_suffix(rows[1]), "", "no writer name, no suffix")
	t.eq(Shm.rows(null), [], "API down: no rows")
	t.eq(Shm.warning({"type": "decklink"}), "", "other rows untouched")


func test_panel_wiring() -> void:
	var src := FileAccess.get_file_as_string("res://features/live/live_sources_panel.gd")
	t.ok(src.contains("Api.get_json(\"/api/shm/sources\")"), "panel fetches the rings on reload")
	t.ok(src.contains("+ Shm.rows(_shm)"), "rows appended after the live sources")
