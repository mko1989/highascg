extends RefCounted
## WO-1106 — Visuals MIDI fixes: C2 the APC Generic-mode bank resend primes all 8 device knobs without a Sel note,
## B27 a stored map gains each default binding once (an Unmap stays), C5 Edit A / B disarms Sel's armed new slot, B29 one
## library fill at a time and a thumbnail colour computed once.

const Tab := preload("res://features/visuals/visuals_tab.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const MM := preload("res://features/midi/midi_map.gd")
const Defaults := preload("res://features/visuals/visuals_midi_defaults.gd")
const Lib := preload("res://features/visuals/visuals_midi_library.gd")
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


static func _cc(ch: int, num: int, val: int) -> Dictionary:
	return {"kind": "cc", "ch": ch, "num": num, "val": val}


## C2: Generic mode sends no track-select note; the resend is 8 CCs on the new channel and every one of them is a position.
func test_bank_resend_without_a_note_primes_all_8_c2() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	midi.apc = true
	midi._bank_until = 0
	for k in 8:
		t.eq(midi._bank(_cc(0, 16 + k, 60)), false, "bank 1: knob %d turns" % (k + 1))
	for k in 8:
		t.eq(midi._bank(_cc(1, 16 + k, 64 + k)), true, "bank 2's resend, knob %d: primes, never steps" % (k + 1))
	t.eq(midi.dev_bank, 1, "the knobs are on bank 2")
	for k in 8:
		t.eq(midi._bank(_cc(1, 16 + k, 70)), false, "knob %d's next CC on bank 2 is a turn" % (k + 1))
	# through the whole path: the knobs' controls do not move on the resend
	var ctl := []
	var was := []
	for k in 8:
		var c: Variant = midi.control_of("dev:%d" % (k + 1))
		if c is Range:
			ctl.append(c)
			was.append((c as Range).ratio)
	for k in 8:
		midi.handle(T.cc(2, 16 + k, 6 + 6 * k))  # bank 3's positions, far from where the knobs were (all < 64: no button edge)
	t.eq(ctl.map(func(c: Range) -> float: return c.ratio), was, "the resend of bank 3 moves none of the %d device knobs" % ctl.size())
	tab.free()


## B27: defaults_rev in ui.cfg [midi]: a map stored before it gains the new defaults once; an Unmap of one stays.
func test_defaults_arrive_once_b27() -> void:
	var path := "user://test_wo1106_b27_%d.cfg" % Time.get_ticks_usec()
	var stored := MM.apc40().filter(func(b: Dictionary) -> bool: return b.target != "edit:1" and b.target != "padbank:next")
	var c := ConfigFile.new()
	c.set_value("midi", "map", stored)  # no defaults_rev: a map from before WO-1106
	c.save(path)
	c.load(path)
	var m := Defaults.stored_map(c, path)
	t.ok(m.any(func(b: Dictionary) -> bool: return b.target == "edit:1"), "revision 0: the defaults it lacks arrive (once)")
	t.ok(m.any(func(b: Dictionary) -> bool: return b.target == "padbank:next"), "padbank too")
	c.load(path)
	t.eq(int(c.get_value("midi", Defaults.KEY, 0)), Defaults.current(), "the revision is written right away")
	var unmapped := MM.unbind_target(m, "edit:1")
	Defaults.save(unmapped, path)  # the operator's Unmap
	for i in 2:  # two restarts
		c = ConfigFile.new()
		c.load(path)
		t.ok(not Defaults.stored_map(c, path).any(func(b: Dictionary) -> bool: return b.target == "edit:1"), "the Unmap stays (restart %d)" % (i + 1))
	t.eq(Defaults.kinds_after(0), ["edit", "clear", "devpage", "padbank"], "revision 1's kinds")
	t.eq(Defaults.kinds_after(Defaults.current()), [], "nothing newer than the current revision")
	# the controller's own load + save use it
	var tab := _tab()
	var midi: Node = tab.midi
	midi.cfg_path = path
	midi._load()
	t.ok(not midi.map.any(func(b: Dictionary) -> bool: return b.target == "edit:1"), "the controller loads the Unmap as stored")
	midi.panel.menu_picked.emit(1)  # clear all
	var again: Node = load("res://features/visuals/visuals_midi.gd").new(tab, false)
	again.cfg_path = path
	again._load()
	t.eq(again.map, [], "a cleared map stays cleared after a restart")
	again.free()
	midi.panel.ctl = midi
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	tab.free()


## C5: Edit A / B (the buttons, visuals_dj.gd focus) disarms Sel's new slot like ◀ / ▶ on the controller.
func test_edit_bank_disarms_the_new_slot_c5() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	tab.dj.set_on(true)
	midi.clips.new_slot = 4  # Sel 5 on an empty track, on the edited bank
	var other: int = 1 - int(tab.mixer.live)
	tab.dj.focus(other)
	t.eq([int(tab.mixer.live), midi.clips.new_slot], [other, -1], "editing the other bank disarms the slot")
	tab.free()


## B29: a second fill while one runs only says so; a thumbnail's colour is computed once per texture.
func test_library_fill_guard_and_colour_cache_b29() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	Lib._filling_ms = Time.get_ticks_msec()  # a fill is running
	await Lib.fill(midi)
	t.ok(str(midi.note).contains("already"), "a second fill does not start: " + str(midi.note))
	Lib._filling_ms = -1
	Lib._colours.clear()
	var img := Image.create(16, 9, false, Image.FORMAT_RGB8)
	img.fill(Color(1, 0, 0))
	var tex := ImageTexture.create_from_image(img)
	var first: Color = Lib.colour_of("thumbs/a.png", tex)
	t.ok(Lib._colours.has("thumbs/a.png#%d" % tex.get_instance_id()), "kept per thumbnail texture")
	t.eq(Lib.colour_of("thumbs/a.png", tex), first, "the second fill reads the cache")
	t.eq(Lib._colours.size(), 1, "no second entry for the same texture")
	var other := ImageTexture.create_from_image(img)
	Lib.colour_of("thumbs/a.png", other)
	t.eq(Lib._colours.size(), 2, "a re-rendered thumbnail (a new texture) is read again")
	Lib._colours.clear()
	tab.free()
