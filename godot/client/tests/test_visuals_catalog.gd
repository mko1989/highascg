extends RefCounted
## WO-885 — Sources ▸ Visuals: the catalog (folders, themes, filter, drag payload, what a drop does to the slice), the
## thumbnail beat, the Inspector's Scene / Layer 2 lines, and the canvas taking a drop.

const C := preload("res://features/visuals/visuals_catalog.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Thumbs := preload("res://features/visuals/visuals_thumbs.gd")
const Tab := preload("res://features/visuals/visuals_tab.gd")
const VPanel := preload("res://features/live/visuals_sources_panel.gd")
var t

const SHADERS := [
	{"id": "sh-sa-warp-speed", "name": "Warp speed", "audio": true, "updatedAt": "2026-10-01"},
	{"id": "sh-bg-auroras", "name": "Auroras", "audio": false, "updatedAt": "2026-09-01"},
	{"id": "sh-sa-ribbons", "name": "Ribbons", "audio": true},
	{"id": "sh-sa-ribbons", "name": "Ribbons again", "audio": true},
	{"id": "sh-revision-qualification-2018-cupe", "name": "Revision Qualification 2018-Cupe", "audio": true},
	{"name": "no id"},
]
const GAMES := [{"name": "Contra (USA)", "path": "/g/Contra (USA).nes"}, {"name": "Tetris", "path": "/g/Tetris.gb"}]


func test_folders_and_order() -> void:
	var rows := C.rows(SHADERS, GAMES)
	var folders := rows.map(func(r: Dictionary) -> String: return r.folder)
	t.eq(folders.slice(0, 5), ["Scenes", "Scenes", "Scenes", "Scenes", "Scenes"], "the built-in scenes first")
	t.ok(not rows.any(func(r: Dictionary) -> bool: return r.payload.scene in ["shader", "game"] and r.folder == "Scenes"),
		"the two hosts are not scene rows")
	t.eq(rows.filter(func(r: Dictionary) -> bool: return r.payload.get("shader") == "sh-sa-ribbons").size(), 1, "a duplicate id once")
	t.eq(rows.size(), 5 + 4 + 2, "scenes + four shaders + two games (the row without an id is skipped)")
	var by := {}
	for r in rows:
		by[r.name] = r
	t.eq(by["Warp speed"].folder, "Audio-reactive/Tunnels & flight", "audio → Audio-reactive, theme from the words")
	t.eq(by["Auroras"].folder, "Backgrounds/Nature", "no audio → Backgrounds")
	t.eq(by["Revision Qualification 2018-Cupe"].folder, "Audio-reactive/Abstract", "a keyword inside a word does not match (…cat…)")
	t.eq(by["Contra (USA)"].folder, "Games/NES", "games by system")
	t.eq(by["Tetris"].folder, "Games/Game Boy", "")
	t.ok(folders.find("Games/NES") > folders.find("Backgrounds/Nature"), "Games last")
	t.eq(by["Ribbons"].payload, {"type": "visual", "label": "Ribbons", "scene": "shader", "shader": "sh-sa-ribbons"}, "shader payload")
	t.eq(by["Tunnel"].payload, {"type": "visual", "label": "Tunnel", "scene": "tunnel"}, "scene payload")
	t.eq(by["Contra (USA)"].thumb, "", "games use an icon")
	t.ok(by["Warp speed"].thumb.begins_with("sh-sa-warp-speed-") and by["Warp speed"].thumb != C.rows(
		[{"id": "sh-sa-warp-speed", "name": "Warp speed", "audio": true, "updatedAt": "2026-10-02"}], []).back().thumb,
		"an edited shader gets a new thumbnail key")


func test_filter() -> void:
	t.eq(C.rows(SHADERS, GAMES, "ribb").map(func(r: Dictionary) -> String: return r.name), ["Ribbons"], "by name")
	t.eq(C.rows(SHADERS, GAMES, "games/nes").size(), 1, "by folder")
	t.eq(C.rows(SHADERS, GAMES, "sh-bg").size(), 1, "by shader id")


func test_parse_and_drop() -> void:
	t.eq(C.parse({"type": "media", "value": "x"}), null, "a media row is not a visual")
	t.eq(C.parse({"type": "visual", "scene": ""}), null, "no scene")
	var s := M.slice_of({"visuals": {"scene": "tunnel", "overlay": "particles", "shader": "a"}})
	var d := C.apply_drop(s, {"type": "visual", "scene": "shader", "shader": "b"}, false)
	t.eq([d.scene, d.overlay, d.shader], ["shader", "particles", "b"], "main ← shader b, layer 2 kept")
	t.eq(s.scene, "tunnel", "the slice passed in is not changed")
	d = C.apply_drop(s, {"type": "visual", "scene": "particles"}, false)
	t.eq([d.scene, d.overlay], ["particles", ""], "the main scene never also sits on layer 2")
	d = C.apply_drop(s, {"type": "visual", "scene": "rings"}, true)
	t.eq([d.scene, d.overlay], ["tunnel", "rings"], "Shift / Layer 2 → layer 2")
	d = C.apply_drop(M.slice_of({"visuals": {"scene": "shader", "shader": "a"}}), {"type": "visual", "scene": "shader", "shader": "c"}, true)
	t.eq([d.scene, d.overlay, d.shader], ["shader", "", "c"], "a shader as layer 2 over a Shader main swaps the one shader")
	d = C.apply_drop(s, {"type": "visual", "scene": "game", "game": "/g/x.nes"}, false)
	t.eq([d.scene, d.game], ["game", "/g/x.nes"], "a ROM")


func test_describe() -> void:
	var s := {"shader": "sh-sa-ribbons", "game": "/g/Contra (USA).nes"}
	t.eq(C.describe("shader", s, {"sh-sa-ribbons": "Ribbons"}), "Shader · Ribbons", "")
	t.eq(C.describe("shader", {"shader": ""}, {}), "Shader · none picked", "")
	t.eq(C.describe("game", s, {}), "Game · Contra (USA)", "")
	t.eq(C.describe("tunnel", s, {}), "Tunnel", "")
	t.eq(C.describe("", s, {}), "None", "")


func test_beat_frame() -> void:
	var a := Thumbs.beat_frame(0.0)
	var b := Thumbs.beat_frame(0.25)
	t.eq(Marshalls.base64_to_raw(a.freq).size(), 512, "512 FFT bytes")
	t.eq(Marshalls.base64_to_raw(a.wave).size(), 512, "512 wave bytes")
	t.ok(Marshalls.base64_to_raw(a.freq)[2] > Marshalls.base64_to_raw(b.freq)[2], "the kick decays between beats")
	t.eq(Thumbs.beat_frame(0.0), a, "fixed: the same thumbnail every time")


func test_page_and_canvas_take_drops() -> void:
	var tab: Control = Tab.new()
	tab._ready()
	var got := []
	tab.page.visual_dropped.connect(func(p: Dictionary, o: bool) -> void: got.append([p.scene, o]))
	tab.drop_visual({"type": "visual", "scene": "tunnel"}, false)
	t.eq(tab.slice.scene, "tunnel", "a drop sets the main scene")
	tab.drop_visual({"type": "visual", "scene": "particles"}, true)
	t.eq([tab.slice.scene, tab.slice.overlay], ["tunnel", "particles"], "Shift → layer 2")
	t.eq(tab.page._main_label.text, "Tunnel", "the Inspector names the main scene")
	t.eq(tab.page._over_label.text, "Particles", "and layer 2")
	t.ok(tab.page._over_clear.visible, "layer 2 can be removed")
	tab.page._over_clear.pressed.emit()
	t.eq(tab.slice.overlay, "", "✕ removes layer 2")
	t.eq([tab.page._over_label.text, tab.page._over_clear.visible], ["None", false], "and the line says so")
	var row: Control = tab.page._main_label.get_parent()
	t.eq(row.mouse_filter, Control.MOUSE_FILTER_STOP, "the Scene row takes drops")
	tab.free()


func test_panel_builds() -> void:
	var p: Control = VPanel.new()
	p._ready()
	p._shaders = SHADERS
	p.rebuild()
	var tops: Array = p._tree.get_root().get_children().map(func(i: TreeItem) -> String: return i.get_text(0))
	t.ok(tops.size() >= 3 and tops[0] == "Scenes  5" and tops[1].begins_with("Audio-reactive"), "top folders with counts")
	t.ok(p._tree.get_root().get_child(1).get_child(0).has_meta("folder"), "Audio-reactive holds theme folders")
	var src := FileAccess.get_file_as_string("res://features/live/media_panel.gd")
	t.ok(src.contains('visuals.name = "Visuals"'), "Sources has the Visuals tab")
	t.ok(src.contains('get_tab_idx_from_control(templates), "CGs")'), "the Templates tab reads CGs")
	p.free()
