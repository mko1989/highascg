extends RefCounted
## WO-1050 — APC fader 3 → a PixelHue layer's opacity: the "pxl:<layerId>" target (a range, labelled by the switcher
## layer's name), the Visuals page's PixelHue block (one slider per program layer with an opacity, following the switcher
## when idle), Learn (fader 3 = CC 7 ch 2 onto a PixelHue slider replaces layer:3, kept in ui.cfg), a MIDI move posting
## the opacity (soft takeover first), the client throttle (one post per THROTTLE_MS per layer, latest wins), the virtual
## controller's "PH <name>".

const Tab := preload("res://features/visuals/visuals_tab.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const PH := preload("res://features/visuals/visuals_pixelhue.gd")
const Pxl := preload("res://features/visuals/visuals_midi_pxl.gd")
const T := preload("res://tests/test_midi_pickup.gd")
var t

const L1 := 88145920
const L2 := 88145921


## As GET /api/pixelhue/layers?scene=pgm answers on the box's P80 (12.11), trimmed: a multiviewer, Screen 1, an AUX.
static func layers(op2 := 100.0) -> Dictionary:
	var lay := func(id: int, name: String, type: String, op := 100.0, en := true) -> Dictionary:
		return {"layerId": float(id), "name": name, "scene": "pgm", "type": type, "enabled": en, "opacity": op}
	return {"ok": true, "screens": [
		{"screenId": 1.0, "name": "MVR 1", "enabled": true, "layers": [lay.call(21168128, "Layer1", "mvr")]},
		{"screenId": 5.0, "name": "Screen 1", "enabled": true, "layers": [lay.call(88342528, "", "bkg", 100.0, false),
			lay.call(L1, "Layer 1", "normal"), lay.call(L2, "Layer 2", "normal", op2), lay.call(88539138, "1", "cut"),
			lay.call(88145922, "Off", "normal", 100.0, false)]},
		{"screenId": 6.0, "name": "flex1-delay", "enabled": true, "layers": [lay.call(104988672, "Layer 1", "aux")]},
		{"screenId": 3.0, "name": "", "enabled": false, "layers": [lay.call(5, "Gone", "normal")]},
	]}


func _tab(posts: Array) -> Control:
	var tab: Control = Tab.new()
	tab._ready()
	var ls := []
	for s in ["tunnel", "particles", "rings"]:
		ls.append(L.layer_of({"scene": s, "opacity": 0.6}))
	M.with_layers(tab.slice, ls)
	tab.page.set_state(tab.slice, {})
	tab.page.pixelhue.poster = func(id: int, v: int) -> void: posts.append([id, v])
	tab.page.pixelhue.set_layers(layers(), 0)
	return tab


func test_target_label_and_range() -> void:
	t.eq(T.MM.is_range("pxl:%d" % L2), true, "a PixelHue layer's opacity is a slider target")
	t.eq(T.MM.valid_target("pxl:%d" % L2), true, "it survives the stored map's normalize")
	t.eq(T.MM.normalize([{"kind": "cc", "ch": 2, "num": 7, "target": "pxl:%d" % L2}]).size(), 1, "kept on load")
	var posts := []
	var tab := _tab(posts)
	t.eq(T.MM.target_label("pxl:%d" % L2), "PixelHue Layer 2 opacity", "named after the switcher layer")
	t.eq(T.MM.target_label("pxl:12345"), "PixelHue layer 12345 opacity", "a layer it has not seen: its id")
	t.eq(tab.midi.apc_view.label("pxl:%d" % L2), "PH Layer 2", "the virtual controller's name")
	tab.free()


func test_block_lists_program_layers_with_an_opacity() -> void:
	t.eq(PH.layers_of(layers()).map(func(l: Dictionary) -> int: return l.id), [L1, L2],
		"Screen 1's enabled normal layers only — no multiviewer, background, cut, AUX, disabled layer or disabled screen")
	var posts := []
	var tab := _tab(posts)
	var ph: Node = tab.page.pixelhue
	t.eq(ph.visible, true, "a PixelHue answers: the block shows")
	t.eq(Pxl.targets(tab.page), ["pxl:%d" % L1, "pxl:%d" % L2], "Learn can click both")
	var s: Range = tab.midi.control_of("pxl:%d" % L2)
	t.ok(s != null and s == ph.slider_of(L2), "the target's control is the layer's slider")
	t.eq(tab.midi.control_of("pxl:999"), null, "a layer the switcher does not list: not there")
	ph.set_layers(layers(35.0), 10000)
	t.eq([s.value, posts], [35.0, []], "a refresh: the slider follows the switcher, nothing posted")
	t.eq(tab.midi.control_of("pxl:%d" % L2), s, "the same slider (its MIDI pickup stays)")
	var now := Time.get_ticks_msec()
	s.set_value_no_signal(70.0)
	s.value_changed.emit(70.0)  # a hand drag (a Range emits by itself only inside the tree)
	t.eq(posts.back(), [L2, 70], "a hand move posts")
	ph.set_layers(layers(35.0), now + 200)
	t.eq(s.value, 70.0, "moved a moment ago: the slider is not snapped back to a stale read")
	ph.set_layers(layers(35.0), now + PH.FOLLOW_IDLE_MS + 10)
	t.eq(s.value, 35.0, "idle: it follows again")
	var gone := layers()
	gone.screens[1].layers.remove_at(2)
	ph.set_layers(gone, now + 20000)
	t.eq(tab.midi.control_of("pxl:%d" % L2), null, "a layer gone from the switcher: no target")
	tab.free()


func test_throttle_latest_wins() -> void:
	var posts := []
	var ph := PH.new()
	ph.poster = func(id: int, v: int) -> void: posts.append([id, v])
	ph.queue(L2, 10, 1000)
	for v in range(11, 60):
		ph.queue(L2, v, 1010)
	ph.queue(L1, 5, 1010)
	t.eq(posts, [[L2, 10], [L1, 5]], "the first move goes at once, the next wait THROTTLE_MS — per layer")
	ph.flush(1000 + PH.THROTTLE_MS - 1)
	t.eq(posts.size(), 2, "not before THROTTLE_MS")
	ph.flush(1000 + PH.THROTTLE_MS)
	t.eq(posts, [[L2, 10], [L1, 5], [L2, 59]], "then only the newest value — no backlog")
	ph.flush(5000)
	t.eq(posts.size(), 3, "nothing waits any more")
	ph.queue(L2, 250, 6000)
	t.eq(posts.back(), [L2, 100], "clamped to 0..100")
	ph.free()


func test_learn_fader_3_onto_a_pixelhue_slider() -> void:
	var posts := []
	var tab := _tab(posts)
	var midi: Node = tab.midi
	midi.cfg_path = "user://test_wo1050_%d.cfg" % Time.get_ticks_usec()
	t.eq(T.MM.find(midi.map, {"kind": "cc", "ch": 2, "num": 7}).target, "layer:3", "fader 3 drives Visuals layer 3 (APC map)")
	midi.panel.learn.toggled.emit(true)
	midi.handle(T.cc(2, 7, 64))
	var target := "pxl:%d" % L2
	midi.pick_target(target)
	t.eq(T.MM.find(midi.map, {"kind": "cc", "ch": 2, "num": 7}), {"kind": "cc", "ch": 2, "num": 7, "target": target},
		"Learn: fader 3 → the PixelHue layer, replacing layer:3")
	t.eq(midi.map.filter(func(b: Dictionary) -> bool: return b.target == "layer:3"), [], "layer:3 has no fader now")
	t.ok(midi.note.contains("PixelHue Layer 2 opacity"), "the MIDI line names it — " + midi.note)
	var cfg := ConfigFile.new()
	cfg.load(midi.cfg_path)
	t.eq(T.MM.normalize(cfg.get_value("midi", "map")).back().target, target, "kept in ui.cfg (and loads back)")
	var s: Range = midi.control_of(target)
	midi.handle(T.cc(2, 7, 20))
	t.eq([s.value, posts], [100.0, []], "soft takeover: the fader at 16 % does not jump the slider at 100 %")
	midi.handle(T.cc(2, 7, 127))
	t.eq(s.value, 100.0, "picked up at the slider's value")
	midi.handle(T.cc(2, 7, 64))
	t.eq(s.value, 50.0, "then it drives it")
	t.eq(posts.back(), [L2, 50], "and the opacity is posted")
	t.ok(midi.note.contains("PixelHue Layer 2 opacity 50 %"), "the MIDI line — " + midi.note)
	midi.panel.unmap.toggled.emit(true)
	midi.pick_target(target)
	t.eq(T.MM.find(midi.map, {"kind": "cc", "ch": 2, "num": 7}), {}, "Unmap by clicking the PixelHue slider")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(midi.cfg_path))
	tab.free()


func test_click_picks_a_pixelhue_slider() -> void:
	var posts := []
	var tab := _tab(posts)
	var midi: Node = tab.midi
	var page: Control = tab.page
	t.root.add_child(page)
	page.size = Vector2(420, 1800)
	await t.process_frame
	await t.process_frame
	midi.panel.learn.toggled.emit(true)
	midi.handle(T.cc(2, 7, 64))
	var s: Control = page.pixelhue.slider_of(L1)
	t.eq(midi.click_at(s.get_global_rect().get_center()), true, "a click on a PixelHue slider is a Learn target")
	t.eq(T.MM.find(midi.map, {"kind": "cc", "ch": 2, "num": 7}).target, "pxl:%d" % L1, "fader 3 → PixelHue Layer 1")
	t.eq(posts, [], "the click picked the target, it did not move the slider")
	t.root.remove_child(page)
	tab.free()


func test_virtual_controller_moves_post() -> void:
	var posts := []
	var tab := _tab(posts)
	var midi: Node = tab.midi
	midi.map = T.MM.learn(midi.map, {"kind": "cc", "ch": 2, "num": 7}, "pxl:%d" % L1)
	midi.handle_msg({"kind": "cc", "ch": 2, "num": 7, "val": 32, "virtual": true, "ratio": 0.25})
	t.eq(posts.back(), [L1, 25], "the drawn fader 3 sets the layer's opacity as is (no pickup)")
	tab.free()
