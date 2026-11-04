extends RefCounted
## WO-909 — the APC40 profile: the drawn unit (apc40_layout.gd / apc40_surface.gd) covers every control of the default map,
## a control shows its live name and value, the device knobs follow the selected layer (a shader's key sliders, else the
## camera / burst page), track select picks the layer, a touch flashes its control, a click starts Learn for it.
## WO-946: the drawing is a virtual unit — faders / knobs dragged or wheeled with the mouse drive their target directly.

const Tab := preload("res://features/visuals/visuals_tab.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Lay := preload("res://features/visuals/visuals_layers.gd")
const MM := preload("res://features/midi/midi_map.gd")
const L := preload("res://features/midi/apc40_layout.gd")
const T := preload("res://tests/test_midi_pickup.gd")
var t


func _tab() -> Control:
	var tab: Control = Tab.new()
	tab._ready()
	var ls := []
	for s in ["tunnel", "particles"]:
		ls.append(Lay.layer_of({"scene": s, "opacity": 0.6}))
	M.with_layers(tab.slice, ls)
	tab.page.set_state(tab.slice, {})
	return tab


func test_layout_covers_the_map() -> void:
	var cs := L.controls()
	var keys := {}
	for c in cs:
		keys[L.key(c)] = true
		t.ok(c.rect.position.x >= 0.0 and c.rect.end.x <= L.W and c.rect.end.y <= L.H, "%s inside the panel" % c.name)
	t.eq(keys.size(), cs.size(), "one control per message")
	var missing := MM.apc40().filter(func(b: Dictionary) -> bool:
		return L.find(cs, {"kind": b.kind, "ch": maxi(0, int(b.ch)), "num": b.num}).is_empty())
	t.eq(missing, [], "every control of the APC40 map is drawn")
	t.eq(L.find(cs, {"kind": "off", "ch": 0, "num": 32}).name, "Pad 1·1", "a note off finds its pad (top-left = 32)")
	t.eq(L.find(cs, {"kind": "cc", "ch": 4, "num": 7}).name, "Fader 5", "a track fader by its channel")


func test_controls_show_live_names_and_values() -> void:
	var tab := _tab()
	var apc: Node = tab.midi.apc_view
	var f2 := L.find(apc.surface.controls, {"kind": "cc", "ch": 1, "num": 7})
	var d: Dictionary = apc.info(f2)
	t.eq([d.label, snappedf(d.value, 0.01)], ["2 Particles", 0.6], "fader 2 = layer 2 by its name, at its opacity")
	t.ok(str(d.line).contains("Fader 2 → Layer 2 opacity: 2 Particles"), "hover line: " + str(d.line))
	var free := L.find(apc.surface.controls, {"kind": "note", "ch": 0, "num": 91})
	t.eq(apc.info(free).label, "", "Play is not mapped")
	tab.free()


func test_device_knobs_follow_the_selected_layer() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	t.eq(midi.apc_view.label("dev:1"), "Cam yaw", "no shader layer: the camera page")
	t.eq(midi.control_of("dev:1"), tab.page.control("param:cam_yaw"), "dev:1 drives the camera yaw slider")
	t.eq(midi.control_of("dev:5"), null, "the fallback page has 4 knobs")
	midi.handle(T.note(1, 51, 127))
	t.eq([tab.sel, tab.page.layer_list.sel], [1, 1], "track select 2 → layer 2 selected")
	var sm: Node = tab.work._modes.shader.control
	var s := HSlider.new()
	var card := VBoxContainer.new()
	card.add_child(s)
	sm._key_cards = [{"label": "Zoom", "card": card}]
	sm.shown = "sh-x"  # loaded: refresh() keeps its cards
	tab.slice.layers[1] = Lay.layer_of({"scene": "shader", "shader": "sh-x"})
	midi.apc_view._page_at = -1000
	t.eq([midi.apc_view.label("dev:1"), midi.control_of("dev:1")], ["Zoom", s], "a shader layer: its key sliders by name")
	card.free()
	tab.free()


func test_touch_flashes_and_click_learns() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	var surf: Control = midi.apc_view.surface
	midi.handle(T.cc(0, 48, 10))
	t.ok(surf._touched.has("cc:-1:48"), "a moved knob flashes on the drawing")
	surf.picked.emit(L.find(surf.controls, {"kind": "note", "ch": 0, "num": 91}))
	t.eq([midi.mode, midi.learned.get("num")], ["learn", 91], "a click on Play starts Learn for it")
	tab.free()


## WO-946 (owner 04.11: "use the virtual akai apc40 controller like a real one (moving faders, encoders etc with a mouse)").
func test_virtual_fader_and_knob_move_their_targets() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	var apc: Node = midi.apc_view
	var surf: Control = apc.surface
	var f2 := L.find(surf.controls, {"kind": "cc", "ch": 1, "num": 7})
	var op: Range = midi.control_of("layer:2")
	t.eq(snappedf(surf.playable(f2), 0.01), 0.6, "a mapped fader is playable from its app value")
	surf.turned.emit(f2, 0.85)
	t.eq(snappedf(op.ratio, 0.001), 0.85, "dragging fader 2 sets layer 2's opacity at once (no pickup wait)")
	t.ok(surf._touched.has("cc:1:7"), "and it flashes like the unit")
	midi.handle(T.cc(1, 7, 10))
	t.eq(snappedf(op.ratio, 0.001), 0.85, "the real fader 2, far away, then waits for pickup — no jump")
	midi.handle(T.cc(1, 7, 108))
	t.eq(snappedf(op.ratio, 0.01), 0.85, "…and takes over when it reaches the value")
	var k1 := L.find(surf.controls, {"kind": "cc", "ch": 0, "num": 16})
	var yaw: Range = midi.control_of("dev:1")
	surf.turned.emit(k1, 0.25)
	t.eq(snappedf(yaw.ratio, 0.001), 0.25, "device knob 1 turned with the mouse → camera yaw")
	var play := L.find(surf.controls, {"kind": "note", "ch": 0, "num": 91})
	t.eq([surf.playable(play), surf.playable(L.find(surf.controls, {"kind": "cc", "ch": 0, "num": 47}))], [-1.0, -1.0],
		"buttons and unmapped controls are not dragged (a click presses / Learns them)")
	midi._set_mode("learn")
	surf.turned.emit(f2, 0.5)
	t.eq([midi.learned.get("kind"), midi.learned.get("num"), snappedf(op.ratio, 0.01)], ["cc", 7, 0.85],
		"in Learn mode a virtual move is captured like a real one, the target untouched")
	tab.free()


func test_drag_geometry() -> void:
	var surf: Control = preload("res://features/midi/apc40_surface.gd").new()
	surf._scale = 10.0  # 1 unit = 10 px: a track fader's slot is 46 px tall
	var f := L.find(surf.controls, {"kind": "cc", "ch": 0, "num": 7})
	var x := L.find(surf.controls, {"kind": "cc", "ch": 0, "num": 15})
	var k := L.find(surf.controls, {"kind": "cc", "ch": 0, "num": 16})
	t.eq(snappedf(surf.drag_value(f, 0.5, Vector2(0, 100), Vector2(0, 77)), 0.001), 1.0, "a fader follows the mouse: 23 px up of 46 = +0.5")
	t.eq(surf.drag_value(f, 0.5, Vector2(0, 100), Vector2(0, 200)), 0.0, "clamped at the bottom")
	t.eq(snappedf(surf.drag_value(x, 0.5, Vector2(100, 0), Vector2(131, 0)), 0.001), 1.0, "the crossfader sideways (62 px slot)")
	t.eq(snappedf(surf.drag_value(k, 0.5, Vector2(0, 100), Vector2(0, 20)), 0.001), 1.0, "a knob: 80 px up = half a turn")
	surf.free()
