extends RefCounted
## WO-913 — visual pads: the APC palette (red / green / grey, a thumbnail's main colour), a visual dropped on a clip-grid pad
## (binding replaced, colour kept, the pad's light = its palette colour), the pad pressed (the column's layer replaced, a
## column past the layers adds one, A/B on: into the PRV bank, the bank on air untouched), what the surface accepts.
## WO-912: an APC knob is an encoder (relative steps, no pickup).

const Tab := preload("res://features/visuals/visuals_tab.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Leds := preload("res://features/midi/midi_leds.gd")
const Palette := preload("res://features/midi/apc40_palette.gd")
const Clips := preload("res://features/visuals/visuals_midi_clips.gd")
const Lay := preload("res://features/midi/apc40_layout.gd")
const T := preload("res://tests/test_midi_pickup.gd")
var t


func _tab() -> Control:
	var tab: Control = Tab.new()
	tab._ready()
	var ls := []
	for s in ["tunnel", "particles", "rings"]:
		ls.append(L.layer_of({"scene": s, "opacity": 0.6}))
	M.with_layers(tab.slice, ls)
	tab.page.set_state(tab.slice, {})
	return tab


func test_palette() -> void:
	t.eq(Palette.HEX.size(), 128, "the APC's 128 colours")
	t.eq([Palette.nearest(Color(1, 0, 0)), Palette.nearest(Color(0, 1, 0)), Palette.nearest(Color(0.5, 0.5, 0.5))], [5, 21, 3],
		"red = 5, green = 21 (midi_leds.gd's), a grey → white")
	var img := Image.create(64, 36, false, Image.FORMAT_RGB8)
	img.fill(Color(0.02, 0.02, 0.03))
	img.fill_rect(Rect2i(10, 10, 20, 10), Color(0.1, 0.3, 0.9))
	var c := Palette.main_color(img)
	t.ok(absf(c.h - Color(0.1, 0.3, 0.9).h) < 0.03 and c.v == 1.0, "a dark frame with a blue shape → that blue at full brightness")
	img.fill(Color(0.4, 0.4, 0.4))
	t.eq(Palette.main_color(img), Color.WHITE, "a grey frame → white")
	t.eq(Clips.clip_of({"scene": "tunnel", "label": "Tunnel", "color": "#ff8000"}),
		{"payload": {"scene": "tunnel", "label": "Tunnel"}, "color": "#ff8000"}, "the drag colour is the clip's, not the layer's")
	t.ok(str(Clips.clip_of({"scene": "game", "label": "Contra"}).color).length() == 7, "no thumbnail: a colour of its name")


func test_drop_and_fire() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	t.eq(T.MM.find(midi.map, {"kind": "note", "ch": 0, "num": 33}).target, "look:2", "pad 2·1 recalls look 2 (the APC map)")
	midi.clips.drop(33, {"type": "visual", "scene": "rings", "label": "Rings", "color": "#ff0000"})
	t.eq(T.MM.find(midi.map, {"kind": "note", "ch": 0, "num": 33}).target, "clip:33", "dropped: the pad loads the visual now")
	t.eq(midi.leds, false, "the test runner keeps no lights (no ui.cfg)")
	t.eq(Leds.frame(midi.map, midi.led_state, midi.clips.velocity)["144:33"], 5, "its light is its colour (red = 5)")
	t.eq(midi.apc_view.label("clip:33"), "Rings", "the surface names the visual")
	midi.handle(T.note(0, 33, 127))
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["tunnel", "rings", "rings"],
		"pressed: column 2 → layer 2 replaced")
	t.eq(tab.slice.layers[1].opacity, 0.6, "its fader kept")
	midi.clips.drop(37, {"type": "visual", "scene": "tunnel", "label": "Tunnel"})
	midi.handle(T.note(0, 37, 127))
	t.eq(tab.slice.layers.size(), 4, "column 6 of 3 layers: a new layer on top")


func test_fire_loads_into_prv() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	tab.dj.set_on(true)
	var air: int = tab.mixer.air()
	tab.dj.focus(air)  # editing the bank on air
	var on_air: Array = tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene)
	midi.clips.drop(32, {"type": "visual", "scene": "rings", "label": "Rings"})
	midi.handle(T.note(0, 32, 127))
	t.eq(tab.mixer.live, 1 - air, "A/B on: the pad edits the PRV bank")
	t.eq(tab.slice.layers[0].scene, "rings", "layer 1 of PRV holds the visual")
	t.eq(tab.slice.dj.other.layers.map(func(l: Dictionary) -> String: return l.scene), on_air, "the bank on air is untouched")


func test_surface_accepts_visuals_on_grid_pads() -> void:
	var tab := _tab()
	var s: Control = tab.midi.apc_view.surface
	var payload := {"type": "visual", "scene": "tunnel", "label": "Tunnel"}
	var by_num := func(kind: String, num: int) -> Dictionary:
		return s.controls.filter(func(c: Dictionary) -> bool: return c.kind == kind and int(c.num) == num)[0]
	t.eq(s.can_drop_cb.call(by_num.call("note", 20), payload), true, "a clip-grid pad takes a visual")
	t.eq(s.can_drop_cb.call(by_num.call("note", 82), payload), false, "scene launch does not")
	t.eq(s.can_drop_cb.call(by_num.call("cc", 48), payload), false, "a knob does not")
	t.eq(s.can_drop_cb.call(by_num.call("note", 20), {"type": "media"}), false, "a media file does not")


func test_apc_knob_is_an_encoder() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	midi.apc = true
	var hue: float = tab.slice.params.hue
	midi.handle(T.cc(0, 50, 0))
	t.eq(tab.slice.params.hue, hue, "the first turn only primes")
	midi.handle(T.cc(0, 50, 3))
	t.ok(absf(tab.slice.params.hue - (hue + 3 / 127.0)) < 0.011, "3 steps up from the knob's own 0: the hue moves up 3 steps from %.2f" % hue)
	t.eq(midi.waiting, false, "never waiting")
