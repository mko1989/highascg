extends RefCounted
## WO-1054 — a Visuals layer's place (owner 13.11: "pan tilt the selected visual so i can position it where i want. there are
## 4 unused encoders on the right"): the layer fields (clamped, stored only when not the default, not in the key, kept by a
## pad swap), the deck's draw-rect transform (in `out` and in a route-key composite, in place, while fading, on a resize),
## the APC device page (knobs 5–8 = X / Y / Size / Rotate of the selected layer, 1–4 = the old page, ◀ / ▶ Device pages a
## shader's further key controls, back to page 1 on a new selection), the encoder steps, the stored map gaining ◀ / ▶ Device,
## and the Inspector's Position block (through the tab's layer edit path, Reset, hidden with no selection).

const Tab := preload("res://features/visuals/visuals_tab.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Deck := preload("res://features/visuals/visuals_deck.gd")
const MM := preload("res://features/midi/midi_map.gd")
const Lay := preload("res://features/midi/apc40_layout.gd")
const Leds := preload("res://features/midi/midi_leds.gd")
var t


func _tab(layers: Array, go := true) -> Control:
	var tab: Control = Tab.new()
	tab._ready()
	M.with_layers(tab.slice, L.normalize(layers))
	if go:
		tab._go(false)
	tab.page.set_state(tab.slice, {})
	return tab


func _select(tab: Control, i: int) -> void:  # a click on a layer row
	tab.page.layer_list.select(i)
	tab.page.layer_list.selected.emit(i)


func _labels(midi: Node) -> Array:
	midi.apc_view._page_at = -1000
	var out := []
	for i in 8:
		out.append(midi.apc_view.label("dev:%d" % (i + 1)))
	return out


func _cc(midi: Node, num: int, val: int) -> void:
	midi.handle_msg({"kind": "cc", "ch": 0, "num": num, "val": val})


func test_fields_normalise_and_clamp() -> void:
	var l: Dictionary = L.layer_of({"scene": "tunnel", "x": 0.25, "y": -2, "size": 10.0, "rot": "45"})
	t.eq([l.get("x"), l.get("y"), l.get("size"), l.has("rot")], [0.25, -1.0, 4.0, false],
		"x kept, y clamped to −1, size to 4, a non-number rot ignored")
	t.eq(L.layer_of({"scene": "tunnel", "size": 0.01, "rot": 999})["size"], 0.1, "size floor 0.1")
	t.eq(L.layer_of({"scene": "tunnel", "rot": -999})["rot"], -180.0, "rot clamped to −180")
	var plain := {"scene": "rings", "opacity": 0.5, "visible": true, "blend": "normal"}
	t.eq(L.layer_of({"scene": "rings", "opacity": 0.5, "x": 0, "y": 0.0, "size": 1.0, "rot": 0}), plain,
		"defaults are not stored")
	t.eq(JSON.stringify(L.normalize([plain])), JSON.stringify([plain]), "an older show's layer stays byte-identical")
	t.eq(L.key(l), L.key(L.layer_of({"scene": "tunnel"})), "the place is not in the key (a move never restarts the layer)")
	t.eq(L.place_of({"scene": "tunnel"}), {"x": 0.0, "y": 0.0, "size": 1.0, "rot": 0.0}, "place_of: the defaults")
	var moved := L.placed(l, {"x": 0.0, "size": 1.0, "rot": 30.0})
	t.eq([moved.has("x"), moved.has("size"), moved.get("y"), moved.get("rot")], [false, false, -1.0, 30.0],
		"placed(): back to a default drops the field, the rest kept")
	var keep: Dictionary = L.layer_of({"scene": "tunnel", "x": 0.5, "rot": 30.0, "opacity": 0.4})
	var swapped := L.from_payload({"type": "visual", "scene": "rings", "label": "Rings"}, keep)
	t.eq([swapped.scene, swapped.get("x"), swapped.get("rot"), swapped.opacity], ["rings", 0.5, 30.0, 0.4],
		"from_payload keeps the place of the layer it replaces")
	var r := L.drop([keep], {"type": "visual", "scene": "particles"}, 0)
	t.eq([r.layers[0].scene, r.layers[0].get("x")], ["particles", 0.5], "a pad swap / drop onto the layer keeps the place")
	t.eq(L.drop([keep], {"type": "visual", "scene": "particles"}, -1).layers[1].has("x"), false, "a new layer starts centred")


func test_deck_transform_out_route_key_and_fades() -> void:
	var d: Node = Deck.new()
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "rings", "x": 0.25, "y": 0.5, "size": 0.5, "rot": 90.0}]), {}, 0.0)
	var base: TextureRect = d.slots[0].rect
	var r: TextureRect = d.slots[1].rect
	t.eq([base.position, base.scale, base.rotation_degrees], [Vector2.ZERO, Vector2.ONE, 0.0], "an unplaced layer: full canvas")
	t.eq([r.pivot_offset, r.position, r.scale, r.rotation_degrees], [Vector2(640, 360), Vector2(320, -360), Vector2(0.5, 0.5), 90.0],
		"pivot = canvas centre, offset (x·W, −y·H), scale, rotation")
	t.ok((r.get_transform() * Vector2(640, 360)).is_equal_approx(Vector2(960, 0)), "its centre lands right a quarter, up a half")
	t.ok((r.get_transform() * Vector2(1280, 360)).is_equal_approx(Vector2(960, 320)),
		"rotated 90° clockwise around its centre at half size (the right edge's middle → below the centre)")
	var vp: SubViewport = d.slots[1].vp
	var stage: Node3D = d.stage_at(1)
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "rings", "x": -0.5}]), {}, 1.0)
	t.ok(d.slots[1].vp == vp and d.stage_at(1) == stage and d.leaving.is_empty() and d.slots[1].w == 1.0,
		"a move is in place: the same running slot, no fade")
	t.eq([r.position, r.scale, r.rotation_degrees], [Vector2(-640, 0), Vector2.ONE, 0.0], "…the rect moved at once")
	d.set_solo({2: "overlay"})
	t.ok(r.get_parent() == d.solo["overlay"], "routed to a key composite (WO-1053)")
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "rings", "y": -0.25, "size": 2.0}]), {}, 0.0)
	t.eq([r.get_parent() == d.solo["overlay"], r.position, r.scale, d.slots[1].vp == vp], [true, Vector2(0, 180), Vector2(2, 2), true],
		"in the route-key composite the transform applies too, still no restart")
	d.set_solo({})
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "rings", "y": -0.25, "size": 2.0}, {"scene": "starfield", "x": 0.1}]), {}, 1.0)
	var fresh: Dictionary = d.slots[2]
	t.eq([fresh.w, fresh.rect.position], [0.0, Vector2(128, 0)], "a layer fading in is placed from its first frame")
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "starfield", "x": 0.1}]), {}, 1.0)
	t.eq([d.leaving.size(), d.leaving[0].rect.position, d.leaving[0].rect.scale], [1, Vector2(0, 180), Vector2(2, 2)],
		"a layer fading out keeps its place")
	d.step(0.5)
	t.eq(d.leaving[0].rect.position, Vector2(0, 180), "…while it fades")
	d.resize(Vector2i(640, 360))
	t.eq([fresh.rect.pivot_offset, fresh.rect.position], [Vector2(320, 180), Vector2(64, 0)], "a resize re-places every rect")
	d.free()


func test_device_page_knobs_5_to_8_are_the_place() -> void:
	var tab := _tab([{"scene": "tunnel"}, {"scene": "particles"}])
	var midi: Node = tab.midi
	t.eq(_labels(midi), ["Cam yaw", "Cam pitch", "Cam zoom", "Burst", "X", "Y", "Size", "Rotate"], "8 entries: the fallback + the place")
	t.eq([midi.control_of("dev:1"), midi.control_of("dev:5")], [tab.page.control("param:cam_yaw"), null],
		"no layer selected: knobs 5–8 have nothing to move")
	_select(tab, 1)
	midi.apc_view._page_at = -1000
	var place: Node = tab.page.place
	t.eq([midi.control_of("dev:5"), midi.control_of("dev:6"), midi.control_of("dev:7"), midi.control_of("dev:8")],
		[place.sliders["x"], place.sliders["y"], place.sliders["size"], place.sliders["rot"]], "layer 2 selected: X / Y / Size / Rotate")
	t.eq(midi.control_of("dev:1"), tab.page.control("param:cam_yaw"), "knobs 1–4: the camera / burst page as before")
	var k5 := Lay.find(midi.apc_view.surface.controls, {"kind": "cc", "ch": 0, "num": 20})
	t.eq(midi.apc_view.info(k5).label, "X", "the virtual controller labels device knob 5 X")
	t.eq([midi.apc_view.label("devpage:next"), midi.led_state.call("devpage:next"), midi.led_state.call("devpage:prev")],
		["Keys 1/1 ▶", Leds.OFF, Leds.OFF], "one page: ◀ ▶ Device dark")
	tab.free()


func test_shader_keys_page_with_device_arrows() -> void:
	var tab := _tab([{"scene": "shader", "shader": "sh-x"}, {"scene": "shader", "shader": "sh-x"}, {"scene": "tunnel"}], false)
	var midi: Node = tab.midi
	_select(tab, 0)
	var sm: Node = tab.work._modes.shader.control
	var cards := []
	var knobs := []
	for i in 6:
		var s := HSlider.new()
		var card := VBoxContainer.new()
		card.add_child(s)
		cards.append({"label": "K%d" % (i + 1), "card": card})
		knobs.append(s)
	sm._key_cards = cards
	sm.shown = "sh-x"  # loaded: refresh() keeps its cards
	t.eq(_labels(midi), ["K1", "K2", "K3", "K4", "X", "Y", "Size", "Rotate"], "a 6-key shader: page 1 = keys 1–4")
	t.eq(midi.led_state.call("devpage:next"), Leds.AVAIL, "Device ▶ lit: there is a next page")
	midi.handle_msg({"kind": "note", "ch": 0, "num": 59, "val": 127})  # Device ▶
	t.eq(_labels(midi), ["K5", "K6", "—", "—", "X", "Y", "Size", "Rotate"], "Device ▶ → keys 5–6 on knobs 1–2, 3–4 empty")
	t.eq([midi.control_of("dev:1"), midi.control_of("dev:3"), midi.control_of("dev:5")], [knobs[4], null, tab.page.place.sliders["x"]],
		"knob 1 drives key 5; an empty knob drives nothing; knob 5 still X")
	t.eq([midi.apc_view.label("devpage:next"), midi.led_state.call("devpage:next"), midi.led_state.call("devpage:prev")],
		["Keys 2/2 ▶", Leds.OFF, Leds.AVAIL], "last page: ▶ dark, ◀ lit")
	midi.handle_msg({"kind": "note", "ch": 0, "num": 59, "val": 127})
	t.eq(midi.apc_view.dev_page, 1, "▶ on the last page stays there")
	midi.handle_msg({"kind": "note", "ch": 0, "num": 58, "val": 127})  # ◀ Device
	t.eq(_labels(midi).slice(0, 4), ["K1", "K2", "K3", "K4"], "◀ Device → back to keys 1–4")
	midi.handle_msg({"kind": "note", "ch": 0, "num": 59, "val": 127})
	t.eq(_labels(midi)[0], "K5", "▶ again")
	_select(tab, 1)  # the other layer running the same shader (its cards stay loaded)
	t.eq(_labels(midi)[0], "K1", "a new selection starts at page 1")
	_select(tab, 2)
	t.eq(_labels(midi).slice(0, 4), ["Cam yaw", "Cam pitch", "Cam zoom", "Burst"], "a non-shader layer: the fallback on 1–4")
	for c in cards:
		c.card.free()
	tab.free()


func test_encoder_steps_move_the_place() -> void:
	var tab := _tab([{"scene": "tunnel"}, {"scene": "particles"}])
	var midi: Node = tab.midi
	_select(tab, 0)
	midi.apc = true  # an APC plugged in: device knobs are relative encoders (WO-912)
	var deck: Node = tab.scene
	var vp: SubViewport = deck.slots[0].vp
	_cc(midi, 20, 64)  # primes
	_cc(midi, 20, 65)
	var x := float(tab.slice.layers[0].get("x", 0.0))
	t.ok(absf(x - 2.0 / 127.0) < 0.001, "one X step ≈ 1/127 of −1..1 (0.016 canvas): %s" % x)
	t.ok(is_equal_approx(deck.slots[0].rect.position.x, x * deck._size.x) and deck.slots[0].vp == vp,
		"the live deck's rect moved, the layer not restarted")
	for v in range(66, 128):
		_cc(midi, 20, v)
	x = float(tab.slice.layers[0].get("x", 0.0))
	t.ok(x >= 0.95, "63 steps (about a knob turn) ≈ one canvas width: %s" % x)
	_cc(midi, 21, 64)
	_cc(midi, 21, 65)
	var y := float(tab.slice.layers[0].get("y", 0.0))
	t.ok(absf(y - 2.0 / 127.0) < 0.001 and deck.slots[0].rect.position.y < 0.0, "Y up one step: the rect moves up (%s)" % y)
	_cc(midi, 22, 64)
	_cc(midi, 22, 65)
	var s1 := float(tab.slice.layers[0].get("size", 1.0))
	t.ok(s1 > 1.025 and s1 < 1.035, "one Size step ≈ ×1.03 (exponential): %s" % s1)
	for v in range(66, 76):
		_cc(midi, 22, v)
	var s11 := float(tab.slice.layers[0].get("size", 1.0))
	t.ok(absf(s11 / s1 - pow(40.0, 10.0 / 127.0)) < 0.01, "multiplicative: 10 more steps ×%.3f" % (s11 / s1))
	for v in range(74, 63, -1):
		_cc(midi, 22, v)
	t.ok(absf(float(tab.slice.layers[0].get("size", 1.0)) - 1.0) < 0.004, "and back down to ≈1")
	_cc(midi, 23, 64)
	_cc(midi, 23, 65)
	var rot := float(tab.slice.layers[0].get("rot", 0.0))
	t.ok(rot >= 2.5 and rot <= 3.0, "one Rotate step ≈ 360°/127: %s" % rot)
	for v in range(66, 128):
		_cc(midi, 23, v)
	t.ok(float(tab.slice.layers[0].rot) >= 170.0, "63 steps ≈ 180° (360° over about two turns)")
	t.ok(not tab.slice.layers[1].has("x") and not tab.slice.layers[1].has("rot"), "only the selected layer moved")
	tab.free()


func test_stored_map_gains_device_arrows() -> void:
	var m := MM.apc40()
	t.eq([MM.find(m, {"kind": "note", "ch": 0, "num": 58}).target, MM.find(m, {"kind": "note", "ch": 3, "num": 59}).target],
		["devpage:prev", "devpage:next"], "the default map: ◀ Device / Device ▶")
	t.eq([MM.is_range("pos:x"), MM.valid_target("devpage:next"), MM.describe({"kind": "note", "ch": 0, "num": 59}, true)],
		[true, true, "Device ▶"], "pos is a range, devpage a button, the APC names the button")
	var stored := [{"kind": "note", "ch": -1, "num": 96, "target": "edit:2"}]
	var got := MM.with_new_defaults(stored, ["edit", "clear", "devpage"])
	t.ok(got.any(func(b: Dictionary) -> bool: return b.target == "devpage:prev" and b.num == 58)
		and got.any(func(b: Dictionary) -> bool: return b.target == "devpage:next" and b.num == 59), "free: both added")
	t.eq(MM.with_new_defaults(got, ["edit", "clear", "devpage"]).size(), got.size(), "no duplicates on the next load")
	var taken := [{"kind": "note", "ch": 0, "num": 58, "target": "blackout"}]  # Learn binds on the control's own channel
	var kept := MM.with_new_defaults(taken, ["devpage"])
	t.eq(kept.map(func(b: Dictionary) -> String: return b.target), ["blackout", "devpage:next"], "◀ Device taken: only ▶ added")
	t.eq(MM.find(kept, {"kind": "note", "ch": 0, "num": 58}).target, "blackout", "the operator's binding still wins")
	t.eq(MM.with_new_defaults([{"kind": "note", "ch": -1, "num": 59, "target": "tap"}], ["devpage"]).map(
		func(b: Dictionary) -> String: return b.target), ["tap", "devpage:prev"], "▶ taken on ANY: only ◀ added")


func test_inspector_position_block() -> void:
	var tab := _tab([{"scene": "tunnel"}, {"scene": "particles"}])
	var place: Node = tab.page.place
	t.eq(place.visible, false, "hidden while no layer is selected")
	_select(tab, 1)
	t.eq([place.visible, place.sliders["x"].value, place.sliders["size"].value], [true, 0.0, 1.0], "layer 2 selected: shown at defaults")
	var deck: Node = tab.scene
	var vp: SubViewport = deck.slots[1].vp
	var sx: HSlider = place.sliders["x"]
	sx.value = 0.5
	sx.value_changed.emit(sx.value)  # (a drag; the page is not in a tree here)
	var sr: HSlider = place.sliders["rot"]
	sr.value = -45.0
	sr.value_changed.emit(sr.value)
	t.eq([tab.slice.layers[1].get("x"), tab.slice.layers[1].get("rot"), tab.sel], [0.5, -45.0, 1], "the slice took it (the tab's edit path)")
	t.eq([deck.slots[1].rect.position.x, deck.slots[1].rect.rotation_degrees, deck.slots[1].vp == vp], [0.5 * deck._size.x, -45.0, true],
		"the live deck's rect moved in place")
	t.eq(tab.slice.layers[0].has("x"), false, "the other layer untouched")
	_select(tab, 0)
	t.eq(sx.value, 0.0, "selecting layer 1 shows its place")
	_select(tab, 1)
	t.eq([sx.value, sr.value], [0.5, -45.0], "…and back to layer 2's")
	t.eq([tab.midi.control_of("pos:x"), "pos:rot" in tab.midi.targets()], [sx, true], "MIDI Learn targets the sliders")
	place.reset.pressed.emit()
	t.eq(tab.slice.layers[1], L.layer_of({"scene": "particles"}), "Reset: back to defaults, no place fields stored")
	t.eq([deck.slots[1].rect.position, deck.slots[1].rect.rotation_degrees, sx.value], [Vector2.ZERO, 0.0, 0.0], "…the rect back to full canvas")
	_select(tab, -1)
	t.eq([place.visible, tab.midi.control_of("pos:x")], [false, null], "no selection: hidden, nothing for MIDI")
	tab.free()
