extends RefCounted
## WO-913 — visual pads: the APC palette (red / green / grey, a thumbnail's main colour), a visual dropped on a clip-grid pad
## (binding replaced, colour kept, the pad's light = its palette colour), the pad pressed (into the selected layer, the top
## one when none is; A/B on: into the bank being edited, PGM included), ◀ / ▶ = edit bank A / B (lit, blinking on air),
## Stop = clear the selected layer, a stored map gaining them, a click on the drawing pressing a pad, what the surface takes.
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
	tab.sel = -1
	midi.handle(T.note(0, 33, 127))
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["tunnel", "particles", "rings"],
		"nothing selected: the top layer takes it (rings onto rings)")
	midi.clips.drop(37, {"type": "visual", "scene": "starfield", "label": "Starfield"})
	midi.handle(T.note(0, 51, 127))  # track select 1
	midi.handle(T.note(0, 37, 127))
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["starfield", "particles", "rings"],
		"track select 1, then the pad: layer 1 replaced, whatever the pad's column")
	t.eq(tab.slice.layers[0].opacity, 0.6, "its fader kept")
	midi.handle(T.note(0, 62, 127))  # WO-1052: Dev on/off = clear
	t.eq(tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene), ["particles", "rings"], "Dev on/off clears the selected layer")


## WO-1047 (owner 12.11): Sel on an empty track arms a new layer — the next pad adds on top instead of replacing.
func test_sel_on_an_empty_track_adds_a_layer() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	var scenes := func() -> Array: return tab.slice.layers.map(func(l: Dictionary) -> String: return l.scene)
	midi.clips.drop(37, {"type": "visual", "scene": "starfield", "label": "Starfield"})
	midi.clips.drop(38, {"type": "visual", "scene": "tunnel", "label": "Tunnel"})
	midi.handle(T.note(4, 51, 127))  # Sel 5 — three layers: empty track
	t.eq(midi.clips.new_slot, 4, "Sel 5 on an empty track arms a new slot")
	t.eq(midi.led_state.call("select:5"), Leds.ON, "its light is on")
	t.eq(midi.led_state.call("select:6"), Leds.OFF, "the other empty tracks stay dark")
	t.eq(midi.led_state.call("select:1"), Leds.AVAIL, "the selected layer is not lit while a new slot is armed")
	midi.handle(T.note(0, 37, 127))
	t.eq(scenes.call(), ["tunnel", "particles", "rings", "starfield"], "the pad ADDS its visual on top")
	t.eq([tab.sel, midi.clips.new_slot], [3, -1], "the new layer is selected, the slot disarmed")
	midi.handle(T.note(0, 38, 127))
	t.eq(scenes.call(), ["tunnel", "particles", "rings", "tunnel"], "the next pad replaces the new layer")
	midi.handle(T.note(5, 51, 127))  # Sel 6: armed
	midi.handle(T.note(1, 51, 127))  # Sel 2: an existing layer disarms
	t.eq([tab.sel, midi.clips.new_slot], [1, -1], "Sel on a layer picks it and disarms")
	midi.handle(T.note(5, 51, 127))
	tab.page.layer_selected.emit(0)
	t.eq(midi.clips.new_slot, -1, "a click on a layer disarms too")
	while tab.slice.layers.size() < L.MAX:
		tab.drop_visual({"type": "visual", "scene": "rings"}, -1)
	midi.handle(T.note(7, 51, 127))
	t.eq([tab.slice.layers.size(), midi.clips.new_slot, tab.sel], [L.MAX, -1, 7], "a full stack: Sel 8 picks layer 8, nothing to arm")


func test_arrows_pick_the_edited_bank() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	t.eq(midi.control_of("edit:1"), null, "A/B off: no banks to pick")
	tab.dj.set_on(true)
	var air: int = tab.mixer.air()
	var prv := 1 - air
	t.eq(tab.mixer.live, prv, "A/B on: editing PRV")
	var arrow := [97, 96]  # ◀ = A, ▶ = B
	t.eq(Leds.frame(midi.map, midi.led_state)["144:%d" % arrow[prv]], 1, "the edited bank's arrow is lit")
	midi.handle(T.note(0, arrow[air], 127))
	t.eq(tab.mixer.live, air, "the other arrow: editing the bank on air")
	t.ok(midi.note.contains("ON AIR"), "the MIDI line says edits are live: " + midi.note)
	t.eq(Leds.frame(midi.map, midi.led_state)["144:%d" % arrow[air]], 2, "its arrow blinks while the bank on air is edited")
	var prv_layers: Array = tab.slice.dj.other.layers.map(func(l: Dictionary) -> String: return l.scene)
	midi.clips.drop(32, {"type": "visual", "scene": "starfield", "label": "Starfield"})
	tab.sel = 0
	midi.handle(T.note(0, 32, 127))
	t.eq([tab.mixer.live, tab.slice.layers[0].scene], [air, "starfield"], "the pad loads into the bank on air (live)")
	t.eq(tab.slice.dj.other.layers.map(func(l: Dictionary) -> String: return l.scene), prv_layers, "PRV untouched")
	midi.handle(T.note(0, arrow[prv], 127))
	t.eq(tab.mixer.live, prv, "back to PRV")


func test_stored_map_gains_the_new_buttons() -> void:
	var stored := [{"kind": "note", "ch": -1, "num": 92, "target": "blackout"}]
	var m := T.MM.with_new_defaults(stored, ["edit", "clear"])
	t.eq(m.map(func(b: Dictionary) -> String: return b.target), ["blackout", "edit:1", "edit:2", "clear"],
		"◀ / ▶ added; note 92 keeps what the operator put on it; clear goes to its own default (WO-1052: Dev on/off)")
	t.eq(T.MM.with_new_defaults(m, ["edit", "clear"]).size(), 4, "no duplicates on the next load")


## WO-1052 (owner 13.11: "there is no clear layer button on my akai"): the mkII has no Stop — a stored note-92 binding moves
## to Dev on/off when that is free, and the drawing has no Stop button.
func test_phantom_stop_moves_to_dev_on_off() -> void:
	var stored := [{"kind": "note", "ch": -1, "num": 92, "target": "clear"}, {"kind": "note", "ch": 0, "num": 51, "target": "select:1"}]
	var m := T.MM.without_phantoms(stored)
	t.eq(m.map(func(b: Dictionary) -> Array: return [b.num, b.target]), [[62, "clear"], [51, "select:1"]], "Clear layer → Dev on/off")
	t.eq(stored[0].num, 92, "the stored array is not changed in place")
	var taken := [{"kind": "note", "ch": -1, "num": 62, "target": "blackout"}, {"kind": "note", "ch": -1, "num": 92, "target": "clear"}]
	t.eq(T.MM.without_phantoms(taken).map(func(b: Dictionary) -> String: return b.target), ["blackout"], "Dev on/off taken: dropped")
	t.ok(T.MM.apc40().any(func(b: Dictionary) -> bool: return b.target == "clear" and b.num == 62), "the default map: Dev on/off")
	var L := preload("res://features/midi/apc40_layout.gd")
	t.ok(not L.controls().any(func(c: Dictionary) -> bool: return c.kind == "note" and c.num == 92), "no Stop on the drawing")


func test_click_on_the_drawing_presses_a_pad() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	var s: Control = midi.apc_view.surface
	midi.clips.drop(20, {"type": "visual", "scene": "starfield", "label": "Starfield"})
	tab.sel = 2
	s.clicked.emit(s.controls.filter(func(c: Dictionary) -> bool: return c.kind == "note" and int(c.num) == 20)[0])
	t.eq([tab.slice.layers[2].scene, midi.mode], ["starfield", ""], "a click on the visual pad loads it, no Learn")
	s.clicked.emit(s.controls.filter(func(c: Dictionary) -> bool: return c.kind == "cc" and int(c.num) == 48)[0])
	t.eq(midi.mode, "learn", "a click on a knob still Learns")


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


## WO-1048 (owner 12.11: "on the real apc it seems to shift the encoders on the right to some other values"): Generic mode
## banks the device knobs per track select and resends the new bank's 8 positions — positions, not turns; rings follow.
func test_track_select_bank_resend_moves_nothing() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	midi.apc = true
	midi.handle(T.cc(0, 16, 60))  # bank 1: the encoder knows the knob is at 60
	midi.handle(T.note(1, 51, 127))  # Sel 2 on the hardware
	midi._hello_until = 0
	var c: Range = midi.control_of("dev:1")
	t.ok(c != null, "device knob 1 drives something on layer 2's page")
	var was := c.ratio
	midi.handle(T.cc(1, 16, 64))  # bank 2's stored position, 4 steps from bank 1's: read as a turn it stepped +4
	t.eq([c.ratio, midi.dev_bank], [was, 1], "the resend moves nothing; the knobs are on bank 2 (ch 1)")
	midi._bank_until = 0
	midi.handle(T.cc(1, 16, 66))
	t.ok(absf(c.ratio - clampf(was + 2 / 127.0, 0.0, 1.0)) < 0.011, "the next turn moves by its own 2 steps")
	var before := c.ratio
	midi.handle(T.cc(2, 16, 69))  # the bank changed while nobody listened (3 steps from 66)
	t.eq([c.ratio, midi.dev_bank], [before, 2], "a device CC on another channel primes, never steps")
	var f: Dictionary = Leds.frame(midi.map, midi.led_state, Callable(), midi.dev_bank)
	t.ok(f.has("178:16") and not f.has("176:16"), "the device rings go to the bank's channel (B2)")
	t.ok(f.has("176:48"), "the track knobs' rings stay on channel 0 (not banked)")
	midi.handle(T.note(1, 51, 127, true))
	t.eq(midi._bank_until > 0, true, "a hardware Sel opens the resend window")
