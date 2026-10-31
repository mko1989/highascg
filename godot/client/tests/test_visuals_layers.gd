extends RefCounted
## WO-890 — the Visuals' layer stack: the model (stored layers made safe, the pre-WO-890 slice migrated, the derived old
## fields, drops: add on top / replace / one game / the cap, order), the deck (edits in place, a new layer fading in, a removed
## one fading out at its place then freed, opacity / mute / blend on the composite, the bottom layer as the base), the
## Inspector's layer list, the looks keeping the whole stack, and Sources ▸ Visuals highlighting every layer's visual.

const L := preload("res://features/visuals/visuals_layers.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Deck := preload("res://features/visuals/visuals_deck.gd")
const List := preload("res://features/visuals/visuals_layer_list.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const VPanel := preload("res://features/live/visuals_sources_panel.gd")
var t


func _ids(ls: Array) -> Array:
	return ls.map(func(l: Dictionary) -> String: return l.scene)


func test_normalize_and_migrate() -> void:
	var n := L.normalize([{"scene": "tunnel", "opacity": 3}, {"scene": "nope"}, "junk",
		{"scene": "shader", "shader": "sh-a", "opacity": "0.25", "visible": false, "blend": "add", "label": " A "},
		{"scene": "game", "game": "/g/a.nes"}, {"scene": "game", "game": "/g/b.nes"}, {"scene": "rings", "blend": "weird"}])
	t.eq(_ids(n), ["tunnel", "shader", "game", "rings"], "unknown scenes and a second game dropped")
	t.eq([n[0].opacity, n[0].visible, n[0].blend], [1.0, true, "normal"], "opacity clamped, defaults")
	t.eq(n[1], {"scene": "shader", "shader": "sh-a", "opacity": 0.25, "visible": false, "blend": "add", "label": "A"}, "kept")
	t.eq(n[3].blend, "normal", "an unknown blend → normal")
	var many := []
	for i in 20:
		many.append({"scene": "rings"})
	t.eq(L.normalize(many).size(), L.MAX, "at most MAX layers")
	var old := L.migrate({"scene": "tunnel", "overlay": "shader", "shader": "sh-b"})
	t.eq([_ids(old), old[1].shader, old[1].blend, old[0].blend], [["tunnel", "shader"], "sh-b", "add", "normal"],
		"an old layer-2 shader was additive: it stays additive")
	t.eq(_ids(L.migrate({})), ["rings"], "nothing stored → rings, as before")
	t.eq(_ids(L.migrate({"scene": "game", "game": "/g/x.nes", "overlay": "game"})), ["game"], "never the main twice")
	t.eq(L.compat(old), {"scene": "tunnel", "overlay": "shader", "shader": "sh-b", "game": ""}, "the old fields, derived")
	t.eq(L.compat([]), {"scene": "rings", "overlay": "", "shader": "", "game": ""}, "an empty stack")


func test_slice_round_trip() -> void:
	var s := M.slice_of({"visuals": {"scene": "starfield", "overlay": "particles"}})
	t.eq(_ids(s.layers), ["starfield", "particles"], "an old project migrates")
	var three := M.slice_of({"visuals": {"layers": [{"scene": "rings"}, {"scene": "shader", "shader": "sh-c"}, {"scene": "tunnel"}],
		"scene": "starfield"}})
	t.eq([_ids(three.layers), three.scene, three.overlay, three.shader], [["rings", "shader", "tunnel"], "rings", "shader", "sh-c"],
		"layers win over stale old fields, which are derived again")
	t.eq(M.slice_of({"visuals": {"layers": []}}).layers, [], "an empty stack stays empty")
	var back := M.slice_of({"visuals": JSON.parse_string(JSON.stringify(three))})
	t.eq(back.layers, three.layers, "survives the project's JSON")


func test_drops() -> void:
	var ls := L.normalize([{"scene": "tunnel", "opacity": 0.4, "blend": "add"}])
	var r := L.drop(ls, {"type": "visual", "label": "Ribbons", "scene": "shader", "shader": "sh-r"}, -1)
	t.eq([_ids(r.layers), r.index, r.layers[1].label, r.layers[1].opacity], [["tunnel", "shader"], 1, "Ribbons", 1.0], "added on top")
	t.eq(ls.size(), 1, "the list passed in is not changed")
	r = L.drop(ls, {"type": "visual", "scene": "particles"}, 0)
	t.eq([_ids(r.layers), r.layers[0].opacity, r.layers[0].blend], [["particles"], 0.4, "add"], "a replace keeps fader and blend")
	var g: Array = L.drop(r.layers, {"type": "visual", "scene": "game", "game": "/g/a.nes"}, -1).layers
	r = L.drop(g, {"type": "visual", "scene": "game", "game": "/g/b.nes"}, -1)
	t.eq([_ids(r.layers), r.layers[1].game, r.index], [["particles", "game"], "/g/b.nes", 1], "one game: a second ROM goes on it")
	t.ok(r.note != "", "and says so")
	r = L.drop(g, {"type": "visual", "scene": "game", "game": "/g/c.nes"}, 0)
	t.eq([_ids(r.layers), r.layers[0].game, r.index], [["game"], "/g/c.nes", 0], "a game dropped on another layer moves there")
	var full := []
	for i in L.MAX:
		full.append({"scene": "rings", "opacity": 1.0, "visible": true, "blend": "normal"})
	r = L.drop(full, {"type": "visual", "scene": "tunnel"}, -1)
	t.eq([r.index, r.layers.size()], [-1, L.MAX], "full: refused")
	t.ok(str(r.note).contains("limit"), "with the reason")
	t.eq(L.drop(full, {"type": "visual", "scene": "tunnel"}, 3).layers[3].scene, "tunnel", "a replace still works when full")
	t.eq(_ids(L.moved(L.normalize([{"scene": "rings"}, {"scene": "tunnel"}, {"scene": "particles"}]), 0, 2)),
		["tunnel", "particles", "rings"], "moved to the top")


func test_runs_highlight() -> void:
	var ls := L.normalize([{"scene": "tunnel"}, {"scene": "shader", "shader": "sh-a"}, {"scene": "shader", "shader": "sh-b"}])
	t.ok(L.runs(ls, {"type": "visual", "scene": "shader", "shader": "sh-b"}), "a shader on the third layer")
	t.ok(not L.runs(ls, {"type": "visual", "scene": "shader", "shader": "sh-c"}), "another shader")
	t.ok(L.runs(ls, {"type": "visual", "label": "Tunnel", "scene": "tunnel"}), "a scene")
	var p: Control = VPanel.new()
	p._ready()
	p._shaders = [{"id": "sh-a", "name": "A", "audio": true}, {"id": "sh-b", "name": "B", "audio": false},
		{"id": "sh-c", "name": "C", "audio": true}]
	p._filter.text = "sh-"  # filtered: every folder open
	p.rebuild()
	p.mark_live({"layers": ls})
	var lit: Array = p._all.filter(func(it: TreeItem) -> bool: return it.get_custom_color(0) == preload("res://app/theme_builder.gd").ACCENT)
	t.eq(lit.map(func(it: TreeItem) -> String: return it.get_text(0)), ["A", "B"], "every layer's visual is highlighted")
	p.free()


func test_deck_edits_in_place() -> void:
	var d: Node = Deck.new()
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "particles"}]), {}, 0.0)
	var tunnel: Node3D = d.stage_at(0)
	t.eq([d.ids(), d.slots[0].w, d.slots[1].w], [["tunnel", "particles"], 1.0, 1.0], "a cut: both at full weight")
	t.eq([d.slots[0].stage.base, d.slots[1].stage.base, d.slots[0].vp.transparent_bg, d.slots[1].vp.transparent_bg],
		[true, false, false, true], "the bottom layer is the base (opaque, tinted); the one above is transparent")
	t.eq(d.slots[1].stage.layers[0].name, "particles", "one scene per layer world")
	d.apply(L.normalize([{"scene": "tunnel", "opacity": 0.5}, {"scene": "particles"}, {"scene": "rings"}]), {}, 1.0)
	t.ok(d.stage_at(0) == tunnel, "an unchanged layer keeps running (same stage)")
	t.eq(d.slots[0].mat.get_shader_parameter("opacity"), 0.5, "its fader at once")
	t.eq(d.slots[2].w, 0.0, "a new layer starts invisible…")
	t.eq(d.slots[2].vp.render_target_update_mode, SubViewport.UPDATE_DISABLED, "…and does not render yet")
	d.step(0.5)
	t.eq(d.slots[2].mat.get_shader_parameter("opacity"), 0.5, "…and fades in")
	t.eq(d.slots[2].vp.render_target_update_mode, SubViewport.UPDATE_ALWAYS, "rendering once it shows")
	d.step(0.6)
	d.apply(L.normalize([{"scene": "tunnel", "opacity": 0.5}, {"scene": "rings"}]), {}, 1.0)
	t.eq([d.ids(), d.leaving.size(), d.leaving[0].at], [["tunnel", "rings"], 1, 1], "a removed layer fades out at its place")
	t.eq(d.out.get_child_count(), 4, "backdrop + three drawn while it fades")
	t.eq(d.leaving[0].rect.get_index(), 2, "drawn between the two it sat between")
	d.step(1.1)
	t.eq([d.leaving.size(), d.out.get_child_count()], [0, 3], "then freed")
	d.apply(L.normalize([{"scene": "rings"}, {"scene": "tunnel", "opacity": 0.5, "visible": false, "blend": "add"}]), {}, 1.0)
	t.eq([d.slots[0].stage.base, d.slots[1].stage.base, d.slots[1].rect.get_index()], [true, false, 2], "reordered, no rebuild")
	t.ok(d.stage_at(1) == tunnel, "the same tunnel")
	t.eq([d.slots[1].rect.visible, d.slots[1].vp.render_target_update_mode], [false, SubViewport.UPDATE_DISABLED],
		"a muted layer neither draws nor renders")
	t.eq(d.slots[1].mat.shader.code.contains("blend_add"), true, "blend add")
	t.eq(d.slots[0].mat.shader.code.contains("blend_premul_alpha"), true, "normal = premultiplied over")
	d.set_running(false)
	t.eq([d.slots[0].vp.render_target_update_mode, d.out.render_target_update_mode],
		[SubViewport.UPDATE_DISABLED, SubViewport.UPDATE_DISABLED], "asleep: nothing renders")
	d.apply([], {}, 0.0)
	t.eq([d.ids(), d.is_empty()], [[], true], "an empty stack (a cut frees at once)")
	d.free()


func test_deck_two_shaders() -> void:
	var d: Node = Deck.new()
	var cfg_a := {"id": "a", "passes": []}
	d.apply(L.normalize([{"scene": "shader", "shader": "a"}, {"scene": "shader", "shader": "b"}]), {"a": cfg_a, "b": {"id": "b"}}, 0.0)
	t.ok(d.stage_at(0).layers[0].runner != d.stage_at(1).layers[0].runner, "each shader layer has its own runner")
	d.stage_at(0).layers[0]._time = 4.0
	d.apply(L.normalize([{"scene": "shader", "shader": "a", "opacity": 0.3}, {"scene": "shader", "shader": "b"}]),
		{"a": cfg_a.duplicate(true)}, 1.0)
	t.eq(d.stage_at(0).layers[0]._time, 4.0, "a fader move: no recompile, no time jump")
	d.free()


func test_layer_list() -> void:
	var list: VBoxContainer = List.new()
	var got := []
	list.changed.connect(func(ls: Array) -> void: got.append(ls))
	var ls := L.normalize([{"scene": "tunnel"}, {"scene": "shader", "shader": "sh-a"}])
	list.set_layers(ls, {"sh-a": "Aurora"}, {1: "boom"})
	t.eq([list.rows.size(), list._box.get_child(0) == list.rows[1].panel], [2, true], "two rows, the top layer first")
	t.eq(list.rows[1].name.text, "⚠ Shader · Aurora", "a dark shader is flagged")
	var panel: Control = list.rows[0].panel
	list.rows[0].slider.set_value_no_signal(40.0)
	list.rows[0].slider.value_changed.emit(40.0)  # (a Range outside the tree does not signal)
	t.eq([got.size(), got[-1][0].opacity, list.rows[0].spin.value], [1, 0.4, 40.0], "the fader: opacity 0..1, the % field follows")
	list.set_layers(got[-1])
	t.ok(list.rows[0].panel == panel, "a value change does not rebuild the rows (a dragged fader keeps its grab)")
	list.rows[0].spin.set_value_no_signal(75.0)
	list.rows[0].spin.value_changed.emit(75.0)
	t.eq([got[-1][0].opacity, list.rows[0].slider.value], [0.75, 75.0], "the % field moves the fader")
	list.rows[0].eye.toggled.emit(false)
	t.eq(got[-1][0].visible, false, "the eye mutes")
	list.rows[0].blend.toggled.emit(true)
	t.eq(got[-1][0].blend, "add", "Add")
	list.select(0)
	list.rows[0].up.pressed.emit()
	t.eq([_ids(got[-1]), list.sel], [["shader", "tunnel"], 1], "▲ moves it up, still selected")
	t.eq([list.rows[1].up.disabled, list.rows[0].down.disabled], [true, true], "no ▲ on the top, no ▼ on the bottom")
	list.rows[1].del.pressed.emit()
	t.eq(_ids(got[-1]), ["tunnel"], "✕")
	list.set_layers([])
	t.eq([list.rows.size(), list._empty.visible], [0, true], "empty: says how to add one")
	list.free()


func test_looks_keep_the_stack() -> void:
	var s := M.slice_of({"visuals": {"layers": [{"scene": "tunnel", "opacity": 0.6}, {"scene": "shader", "shader": "sh-sa-ribbons",
		"label": "Ribbons", "blend": "add"}, {"scene": "particles", "visible": false}]}})
	var l := Looks.capture(s)
	t.eq([l.layers, l.name, l.scene, l.overlay], [s.layers, "Tunnel + Ribbons + Particles", "tunnel", "shader"],
		"the whole stack with faders, named after it, the old fields for an older client")
	var other := M.with_layers(M.slice_of({}), L.normalize([{"scene": "rings"}]))
	var back := Looks.apply(other, l)
	t.eq([back.layers, back.scene, back.shader], [s.layers, "tunnel", "sh-sa-ribbons"], "recalled with the derived fields")
	t.eq(Looks.showing([Looks.capture(other), l], back), 1, "showing")
	back.layers[0].opacity = 0.7
	t.eq(Looks.showing([l], back), -1, "a fader moved: no longer that look")
	var old := Looks.normalize([{"scene": "starfield", "overlay": "particles", "name": "Old"}])
	t.eq([_ids(old[0].layers), old[0].name], [["starfield", "particles"], "Old"], "a look saved before WO-890 migrates")
