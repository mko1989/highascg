extends RefCounted

const M := preload("res://features/live/placeholders_model.gd")

var t


func test_make() -> void:
	t.eq(M.base36(0), "0", "zero")
	t.eq(M.base36(35), "Z", "Z")
	t.eq(M.base36(1761000000000), "MGZPXKAO", "web Date.now().toString(36).toUpperCase()")
	var a := M.make({}, 36)
	t.eq(a.id, "PLC_COLOR_GRID_10", "default template id")
	t.eq(a.label, a.id, "label falls back to id")
	t.eq([a.resolution, a.durationMs, a.isPlaceholder, a.has("value")], ["1080p5000", 60000, true, false], "defaults")
	var s := M.make({"template": "solid", "label": " Wall ", "value": "#ff0000", "resolution": "2160p5000"}, 1)
	t.eq([s.id, s.label, s.value, s.resolution], ["PLC_SOLID_1", "Wall", "#ff0000", "2160p5000"], "solid")


func test_list_and_payload() -> void:
	var g := M.make({"label": "Grid"}, 5)
	var s := M.make({"template": "solid", "label": "Blue"}, 6)
	var proj := {"placeholders": [g, "junk", {"label": "no id"}, s]}
	t.eq(M.list_of(proj).size(), 2, "junk dropped")
	t.eq(M.list_of({}), [], "missing slice")
	t.eq(M.without(M.list_of(proj), g.id).size(), 1, "remove")
	t.eq(M.payload(g).value, g.id, "media value = id")
	t.eq(M.payload(s).value, M.DEFAULT_COLOR, "solid colour wins like the web spread")
	t.eq(M.payload(g).type, "media", "type")
	var rows := M.rows(M.list_of(proj), "")
	t.eq(rows.size(), 2, "rows")
	t.eq(rows[0].text, "Grid   1080p5000 · 1:00", "row text")
	t.eq(rows[1].tip.begins_with("Solid Color placeholder #3b82f6"), true, "tip")
	t.eq(M.rows(M.list_of(proj), "blu").size(), 1, "filter")
	t.eq(M.tab_visible(false), false, "online hides")
	t.eq(M.tab_visible(true), true, "offline shows")
