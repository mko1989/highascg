extends RefCounted
## WO-900 — MIDI on the Visuals tab, end to end with synthetic InputEventMIDI: the APC40 faders pick the layer faders up
## (and then move the layer's opacity in the slice like a drag), a slider moved in the app puts its fader back to waiting
## with the ghost tick on the slider, the master and a parameter knob, the pads recall looks / mute layers / blackout /
## Auto, Learn and Unmap (by a control and by a click on the page), the mapping kept in ui.cfg, and the lights.

const Tab := preload("res://features/visuals/visuals_tab.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const Ghost := preload("res://features/midi/midi_ghost.gd")
const Leds := preload("res://features/midi/midi_leds.gd")
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


func _ghost_of(c: Control) -> Node:
	for n in c.get_children():
		if n is Ghost and not n.is_queued_for_deletion():
			return n
	return null


func test_fader_pickup_drives_the_layer() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	var row: Dictionary = tab.page.layer_list.rows[0]
	t.eq(midi.map.size() > 40, true, "no stored mapping: the APC40 map")
	t.eq(midi.cfg_path, "", "the test runner never writes ui.cfg")
	midi.handle(T.cc(0, 7, 10))
	t.eq([tab.slice.layers[0].opacity, row.slider.value], [0.6, 60.0], "fader 1 at 8 %: layer 1 stays at 60 %")
	var g := _ghost_of(row.slider)
	t.ok(g != null and absf(g.at - 10 / 127.0) < 1e-6, "the ghost tick shows the fader's position on the slider")
	t.ok(midi.waiting and midi.note.contains("bring it to 60 %"), "the MIDI line says where to bring it: " + midi.note)
	midi.handle(T.cc(0, 7, 60))
	midi.handle(T.cc(0, 7, 90))
	t.eq(tab.slice.layers[0].opacity, 0.71, "47 % → 71 % passes 60 %: picked up, the slice has the fader's value")
	t.eq(row.spin.value, 71.0, "the % field follows, like a drag")
	await t.process_frame
	t.eq(_ghost_of(row.slider), null, "picked up: no ghost")
	midi.handle(T.cc(0, 7, 127))
	t.eq(tab.slice.layers[0].opacity, 1.0, "it tracks")
	row.slider.value = 30.0  # a drag in the app (out of the tree a Range does not emit: as the drag would)
	row.slider.value_changed.emit(30.0)
	midi.tick()
	t.ok(_ghost_of(row.slider) != null, "moved in the app: waiting again, the ghost back at the fader")
	midi.handle(T.cc(0, 7, 120))
	t.eq(tab.slice.layers[0].opacity, 0.3, "the fader at 94 % does not jump it")
	midi.handle(T.cc(0, 7, 5))
	t.eq(tab.slice.layers[0].opacity, 0.04, "pulled down past 30 %: picked up on the way")
	midi.handle(T.cc(4, 7, 100))
	t.ok(midi.note.contains("not there"), "fader 5 on a 3-layer stack: nothing to drive — " + midi.note)
	tab.free()


func test_master_param_and_buttons() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	midi.handle(T.cc(0, 14, 127))
	t.eq(tab.mixer.level, 1.0, "master fader at the top = master at 100 %: picked up")
	midi.handle(T.cc(0, 14, 64))
	t.eq(snappedf(tab.mixer.level, 0.01), 0.5, "the master follows")
	var hue: float = tab.slice.params.hue
	midi.handle(T.cc(0, 50, 0))
	t.eq(tab.slice.params.hue, hue, "knob 3 at 0 vs hue at %.2f: waits" % hue)
	midi.handle(T.cc(0, 50, roundi(hue * 127.0)))
	midi.handle(T.cc(0, 50, 100))
	t.eq(tab.slice.params.hue, 0.79, "brought to the hue, then turned: the parameter follows")
	var a := Looks.capture(M.slice_of({"visuals": {"scene": "tunnel"}}), "A")
	var b := Looks.capture(M.slice_of({"visuals": {"scene": "starfield"}}), "B")
	tab.show_ctl.looks = [a, b]
	tab.show_ctl._looks_changed()
	midi.handle(T.note(0, 33, 127))
	t.eq([tab.show_ctl.showing, tab.scene.ids()], [1, ["starfield"]], "pad 1·2 recalls look 2 (as its button)")
	midi.handle(T.note(0, 33, 0))
	midi.handle(T.note(0, 34, 127))
	t.eq(tab.show_ctl.showing, 1, "pad 1·3: no look 3")
	tab.show_ctl.recall(0)
	M.with_layers(tab.slice, [L.layer_of({"scene": "tunnel"}), L.layer_of({"scene": "rings"})])
	tab.page.set_state(tab.slice, {})
	midi.handle(T.note(1, 52, 127))
	t.eq(tab.slice.layers[1].visible, false, "clip stop 2 mutes layer 2")
	midi.handle(T.note(1, 52, 127))
	t.eq(tab.slice.layers[1].visible, true, "and shows it again")
	midi.handle(T.note(0, 81, 127))
	t.eq(tab.mixer.blackout, true, "stop all clips = blackout")
	midi.handle(T.note(0, 83, 127))
	t.eq(tab.slice.auto.bars, 8, "scene 2: Auto on (8 bars)")
	midi.handle(T.note(0, 83, 127))
	t.eq(tab.slice.auto.bars, 0, "and off")
	var fired := [0]
	tab.page.burst_pressed.connect(func() -> void: fired[0] += 1)
	midi.handle(T.note(0, 82, 127))
	midi.handle(T.note(0, 82, 0))
	t.eq(fired[0], 1, "scene 1 = Burst, once per press")
	tab.free()


func test_learn_unmap_and_store() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	midi.cfg_path = "user://test_wo900_%d.cfg" % Time.get_ticks_usec()
	midi.panel.learn.toggled.emit(true)
	t.eq(midi.mode, "learn", "Learn on")
	midi.handle(T.cc(9, 21, 40))
	t.ok(midi.note.contains("now click"), "a control moved: click the target — " + midi.note)
	t.eq(midi.wants_click(), true, "the page's clicks pick the target now")
	midi.handle(T.note(9, 36, 100))
	midi.pick_target("param:glow")
	t.ok(midi.note.contains("pad or button"), "the last control was a pad: a slider refuses it")
	midi.handle(T.cc(9, 21, 40))
	midi.pick_target("param:glow")
	t.eq([midi.mode, midi.map.back()], ["", {"kind": "cc", "ch": 9, "num": 21, "target": "param:glow"}], "learned")
	var glow: float = tab.slice.params.glow
	midi.handle(T.cc(9, 21, roundi(glow * 127.0)))
	midi.handle(T.cc(9, 21, 127))
	t.eq(tab.slice.params.glow, 1.0, "the learned knob drives glow (picked up first)")
	var cfg := ConfigFile.new()
	cfg.load(midi.cfg_path)
	t.eq((cfg.get_value("midi", "map") as Array).back(), midi.map.back(), "kept in ui.cfg")
	midi.panel.unmap.toggled.emit(true)
	midi.handle(T.cc(9, 21, 3))
	t.eq([midi.mode, midi.map.any(func(b: Dictionary) -> bool: return b.num == 21)], ["", false], "Unmap by moving it")
	midi.panel.unmap.toggled.emit(true)
	midi.pick_target("master")
	t.eq(midi.map.any(func(b: Dictionary) -> bool: return b.target == "master"), false, "Unmap by clicking the target")
	var again: Node = load("res://features/visuals/visuals_midi.gd").new(tab, false)
	again.cfg_path = midi.cfg_path
	again._load()
	t.eq(again.map, midi.map, "a new client loads the stored mapping")
	again.free()
	midi.panel.ctl = midi  # the second controller took the panel over
	midi.panel.menu_picked.emit(1)
	t.eq(midi.map, [], "clear all")
	midi.panel.menu_picked.emit(0)
	t.eq(midi.map.size(), 66, "the APC40 map again (WO-913: + ◀ ▶ edit bank, Stop clear; WO-1054: + ◀ ▶ Device)")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(midi.cfg_path))
	tab.free()


func test_click_picks_the_target() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	var page: Control = tab.page
	t.root.add_child(page)
	page.size = Vector2(420, 1400)
	await t.process_frame
	await t.process_frame
	midi.panel.learn.toggled.emit(true)
	midi.handle(T.cc(0, 7, 64))
	var s: Control = tab.page.layer_list.rows[2].slider
	t.eq(midi.click_at(s.get_global_rect().get_center()), true, "a click on layer 3's fader is a target")
	t.eq(midi.map.filter(func(b: Dictionary) -> bool: return b.num == 7 and b.ch == 0)[0].target, "layer:3", "fader 1 → layer 3 now")
	t.eq(midi.click_at(Vector2(-50, -50)), false, "outside every target: the click goes on")
	t.root.remove_child(page)
	tab.free()


func test_lights_from_the_state() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	tab.show_ctl.looks = [Looks.capture(tab.slice, "A"), Looks.capture(tab.slice, "B")]
	tab.show_ctl._looks_changed()
	tab.show_ctl.recall(1)
	t.eq([midi.led_state("look:1"), midi.led_state("look:2"), midi.led_state("look:3")], [Leds.AVAIL, Leds.ON, Leds.OFF], "looks")
	tab.page.layer_list.rows[1].eye.button_pressed = false
	t.eq([midi.led_state("mute:1"), midi.led_state("mute:2"), midi.led_state("mute:8")], [Leds.ON, Leds.ALERT, Leds.OFF], "layers")
	t.eq(midi.led_state("param:pulse"), roundi(tab.slice.params.pulse * 127.0), "a knob ring = the value")
	var f := Leds.frame(midi.map, midi.led_state)
	t.eq([f.get("144:32"), f.get("144:33"), f.get("144:34"), f.get("145:52")], [2, 21, 0, 2], "pads: look 1 grey, 2 green, 3 dark; layer 2 blinks")
	midi.tick()
	t.eq(midi.out.sent, 0, "lights off (the default): nothing goes out")
	tab.free()


func test_hello_report_is_positions_not_moves() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	midi._hello_until = Time.get_ticks_msec() + 1500
	midi.handle(T.cc(0, 7, 0))  # the APC's report after the Generic intro: fader 1 at the bottom
	midi.handle(T.cc(1, 7, 76))  # fader 2 at 60 %
	midi.handle(T.cc(0, 15, 62))  # the crossfader (not mapped)
	t.eq([tab.slice.layers[0].opacity, tab.slice.layers[1].opacity], [0.6, 0.6], "a report sets nothing")
	t.ok(_ghost_of(tab.page.layer_list.rows[0].slider) != null, "fader 1 waits: its tick shows at once")
	t.eq(_ghost_of(tab.page.layer_list.rows[1].slider), null, "fader 2 is at its slider: live")
	t.eq(midi.note, "", "no per-control lines during the report")
	midi._hello_until = Time.get_ticks_msec() - 1
	midi.tick()
	t.ok(midi.note.begins_with("Controller ready — 1 fader waits"), midi.note)
	midi.handle(T.cc(1, 7, 90))
	t.eq(tab.slice.layers[1].opacity, 0.71, "fader 2 moves its layer straight away")
	midi.inputs._sig = "midiC4D0@1"
	t.eq(midi.inputs.held_elsewhere(), true, "a MIDI node with no input open: another program holds it")
	tab.free()
