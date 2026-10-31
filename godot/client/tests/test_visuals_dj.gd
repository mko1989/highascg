extends RefCounted
## WO-908 — A/B banks for the Visuals (visuals_dj.gd + visuals_mixer.gd `dj`): both decks stay on stage, the edited bank
## swaps with `slice.dj.other`, a hand-picked look goes to PRV (cut, the canvas untouched), AUTO / CUT / the crossfader
## take it, a landed take moves editing to the new PRV, the autopilot takes by itself, off keeps the bank on air.

const Looks := preload("res://features/visuals/visuals_looks.gd")
const Mixer := preload("res://features/visuals/visuals_mixer.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Auto := preload("res://features/visuals/visuals_autopilot.gd")
var t


func _tab() -> Control:
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	tab.show_ctl.looks = [Looks.capture(M.slice_of({"visuals": {"scene": "tunnel"}})),
		Looks.capture(M.slice_of({"visuals": {"scene": "starfield", "overlay": "particles"}}))]
	tab.show_ctl.recall(0)
	tab.mixer.step(5.0)  # the first look's fade done
	return tab


func test_mixer_dj_mode() -> void:
	var m: Node = Mixer.new()
	m.go([{"scene": "tunnel"}], {}, 0.0, true)
	t.eq([m.live, m.x, m.air()], [1, 1.0, 1], "a look cut in on deck 1")
	m.set_dj(true, 0, 1.0)
	t.eq([m.dj, m.live, m.air(), m.fading()], [true, 0, 1, false], "A/B on: editing deck 0 (PRV), deck 1 on air")
	m.go([{"scene": "rings"}], {}, 2.0, true)
	t.eq([m.deck_of(0).ids(), m.deck_of(1).ids(), m.x], [["rings"], ["tunnel"], 1.0], "a look into PRV: the canvas untouched")
	t.eq(m.deck_of(0).slots[0].w, 1.0, "PRV cuts (nobody sees it change)")
	m.step(0.1)
	t.eq([m.deck_of(1).ids(), m.deck_of(0).running], [["tunnel"], true], "both decks keep running (no idle-deck clear)")
	m.fade_s = 1.0
	m.take()
	m.step(0.5)
	t.eq([snappedf(m.x, 0.01), m.fading()], [0.5, true], "AUTO crossfades over fade_s")
	m.take()
	m.step(0.6)
	t.eq([m.x, m.goal, m.air()], [0.0, -1.0, 0], "and lands on the other bank (a second AUTO does not reverse it)")
	m.set_x(0.3)
	t.eq([m.weight(0), m.weight(1)], [0.7, 0.3], "the crossfader mixes both")
	m.take(true)
	t.eq(m.x, 1.0, "CUT jumps to the other side")
	m.set_dj(false)
	t.eq([m.dj, m.live], [false, 1], "off: the bank on air stays live")
	m.step(0.1)
	t.eq(m.deck_of(0).is_empty(), true, "and the other deck is emptied")
	m.free()


func test_tab_banks_swap_and_take() -> void:
	var tab := _tab()
	var air: int = tab.mixer.air()
	tab.dj.set_on(true)
	t.eq([tab.mixer.dj, tab.mixer.air(), tab.mixer.live], [true, air, 1 - air], "on: the look stays on air, editing the PRV copy")
	t.eq([tab.mixer.deck_of(1 - air).ids(), tab.slice.dj.other.layers[0].scene], [["tunnel"], "tunnel"], "PRV starts as a copy")
	tab.show_ctl.pick(1)
	t.eq([tab.mixer.deck_of(air).ids(), tab.mixer.deck_of(1 - air).ids()], [["tunnel"], ["starfield", "particles"]],
		"a picked look goes to PRV only")
	t.eq([tab.slice.layers[0].scene, tab.slice.dj.other.layers[0].scene], ["starfield", "tunnel"], "the slice holds the edited bank")
	tab.slice.params.hue = 0.25
	tab.dj.focus(air)
	t.eq([tab.mixer.live, tab.slice.layers[0].scene, tab.slice.dj.other.params.hue], [air, "tunnel", 0.25],
		"editing the bank on air swaps the pictures (the PRV edit kept)")
	t.eq(tab.mixer.deck_of(1 - air).ids(), ["starfield", "particles"], "the decks are untouched by the swap")
	tab.dj.focus(1 - air)
	tab.slice.fade = 0.5
	tab.dj.take()
	for i in 10:
		tab._process(0.1)
	t.eq([tab.mixer.air(), tab.mixer.live], [1 - air, air], "the take landed: editing moved to the new PRV bank")
	t.eq(tab.slice.layers[0].scene, "tunnel", "and the slice holds that bank")
	t.eq(tab.slice.dj.x, float(1 - air), "the crossfader position is saved")
	var fader := tab.midi.control_of("xfade") as Range
	t.ok(fader != null and tab.midi.control_of("take") != null, "MIDI reaches the crossfader, AUTO and CUT")
	fader.value_changed.emit(0.5)
	t.eq(tab.mixer.x, 0.5, "a MIDI crossfader move mixes the banks")
	tab.dj.set_on(false)
	t.eq(tab.midi.control_of("xfade"), null, "A/B off: not there")
	tab.free()


func test_tab_autopilot_takes() -> void:
	var tab := _tab()
	tab.dj.set_on(true)
	var air: int = tab.mixer.air()
	tab.slice.fade = 0.0
	tab.show_ctl.recall(1, true)
	tab._process(0.02)
	t.eq([tab.mixer.air(), tab.mixer.deck_of(1 - air).ids()], [1 - air, ["starfield", "particles"]], "the autopilot loads PRV and takes it")
	tab.free()


func test_off_keeps_air_and_reload_keeps_banks() -> void:
	var tab := _tab()
	tab.dj.set_on(true)
	tab.show_ctl.pick(1)
	var stored: Dictionary = tab.slice.duplicate(true)
	t.eq([stored.dj.on, stored.dj.other.layers[0].scene], [true, "tunnel"], "the banks are part of the slice")
	var again: Dictionary = M.slice_of({"visuals": stored})
	t.eq(again.dj.other.layers[0].scene, "tunnel", "and survive the model (raw)")
	tab.slice = again
	tab.dj.from_slice()
	t.eq([tab.dj.on, tab.mixer.dj], [true, true], "a reload keeps A/B on")
	var air: int = tab.mixer.air()
	tab.dj.set_on(false)
	t.eq([tab.mixer.dj, tab.mixer.live, tab.slice.layers[0].scene, tab.slice.has("dj")], [false, air, "tunnel", false],
		"off: the bank on air becomes the Visuals' picture")
	tab.free()
