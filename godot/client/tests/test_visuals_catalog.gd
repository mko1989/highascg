extends RefCounted
## WO-885 — Sources ▸ Visuals: the catalog (folders, themes, filter, drag payload, what a drop does to the slice), the
## thumbnail beat, the Inspector's layer list (WO-890), and the canvas taking a drop.

const C := preload("res://features/visuals/visuals_catalog.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
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
	var s := M.slice_of({"visuals": {"scene": "tunnel", "overlay": "particles"}})
	var r := C.apply_drop(s, {"type": "visual", "label": "Ribbons", "scene": "shader", "shader": "b"}, -1)
	var d: Dictionary = r.slice
	t.eq(d.layers.map(func(l: Dictionary) -> String: return l.scene), ["tunnel", "particles", "shader"], "WO-890: a drop adds on top")
	t.eq([r.index, d.shader, d.scene, d.overlay], [2, "b", "tunnel", "particles"], "the derived fields follow")
	t.eq(s.layers.size(), 2, "the slice passed in is not changed")
	r = C.apply_drop(d, {"type": "visual", "scene": "rings"}, 0)
	t.eq([r.slice.layers[0].scene, r.slice.scene, r.index], ["rings", "rings", 0], "a target replaces that layer")
	r = C.apply_drop(s, {"type": "visual", "scene": "game", "game": "/g/x.nes"}, -1)
	t.eq([r.slice.layers[2].scene, r.slice.game], ["game", "/g/x.nes"], "a ROM")


func test_describe() -> void:
	var names := {"sh-sa-ribbons": "Ribbons"}
	t.eq(L.describe({"scene": "shader", "shader": "sh-sa-ribbons"}, names), "Shader · Ribbons", "")
	t.eq(L.describe({"scene": "shader", "shader": "sh-x", "label": "X ray"}, {}), "Shader · X ray", "the row's label before the list")
	t.eq(L.describe({"scene": "shader", "shader": ""}, {}), "Shader · none picked", "")
	t.eq(L.describe({"scene": "game", "game": "/g/Contra (USA).nes"}, {}), "Game · Contra (USA)", "")
	t.eq(L.describe({"scene": "tunnel"}, {}), "Tunnel", "")


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
	tab.page.visual_dropped.connect(func(p: Dictionary, target: int) -> void: got.append([p.scene, target]))
	M.with_layers(tab.slice, [])
	tab.drop_visual({"type": "visual", "scene": "tunnel"})
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["tunnel"], "a drop on an empty stack adds a layer")
	tab.drop_visual({"type": "visual", "scene": "particles"})
	t.eq([tab.slice.scene, tab.slice.overlay, tab.sel], ["tunnel", "particles", 1], "a second drop: a layer on top, selected")
	var list: Control = tab.page.layer_list
	t.eq(list.rows.size(), 2, "the Inspector lists both layers")
	t.eq([list.rows[0].name.text, list.rows[1].name.text], ["Tunnel", "Particles"], "named")
	t.eq(list._box.get_child(0), list.rows[1].panel, "top layer first")
	tab.run_visual({"type": "visual", "scene": "rings"})
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["tunnel", "rings"], "double-click replaces the selected layer")
	list.rows[1].del.pressed.emit()
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["tunnel"], "✕ removes it")
	t.eq(list.rows.size(), 1, "and the list follows")
	t.eq(list.rows[0].panel.mouse_filter, Control.MOUSE_FILTER_STOP, "a layer row takes drops")
	list.dropped.emit({"type": "visual", "scene": "starfield"}, 0)  # what a row's drop forwarding emits
	t.eq(got, [["starfield", 0]], "a row drop reaches the page with its layer")
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["starfield"], "and replaces that layer")
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
