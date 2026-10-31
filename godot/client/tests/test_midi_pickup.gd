extends RefCounted
## WO-900 — MIDI, the pure parts: pickup (soft takeover) from below / above, a jump past the value, the tolerance, an app-side
## change re-arming it, 7-bit values on 0..100 and 0..1 sliders; decoding InputEventMIDI; the bindings (find exact vs any
## channel, learn replaces, unbind, normalize); the APC40 mkII default map and names; the lights frame / diff / port; the
## input helpers (can_open guards the Dummy-driver crash, the /dev/snd signature, the virtual port left out).

const P := preload("res://features/midi/midi_pickup.gd")
const MM := preload("res://features/midi/midi_map.gd")
const Leds := preload("res://features/midi/midi_leds.gd")
const MI := preload("res://features/midi/midi_input.gd")
var t


static func cc(ch: int, num: int, val: int) -> InputEventMIDI:
	var e := InputEventMIDI.new()
	e.message = MIDI_MESSAGE_CONTROL_CHANGE
	e.channel = ch
	e.controller_number = num
	e.controller_value = val
	return e


static func note(ch: int, num: int, vel: int, on := true) -> InputEventMIDI:
	var e := InputEventMIDI.new()
	e.message = MIDI_MESSAGE_NOTE_ON if on else MIDI_MESSAGE_NOTE_OFF
	e.channel = ch
	e.pitch = num
	e.velocity = vel
	return e


## Physical 7-bit values `vals` against a slider; [value after each move].
func _run(st: Dictionary, s: Range, vals: Array) -> Array:
	var out := []
	for v in vals:
		var to := P.move(st, v / 127.0, s.ratio)
		if to >= 0.0:
			s.ratio = to
			P.took(st, s.ratio)
		out.append(s.value)
	return out


func test_pickup_from_below_and_above() -> void:
	var s := HSlider.new()
	s.max_value = 100.0
	s.step = 1.0
	s.value = 60.0
	var st := P.new_state()
	t.eq(_run(st, s, [10, 30, 50, 70, 80]), [60.0, 60.0, 60.0, 60.0, 63.0], "from below: nothing until 70 → 80 (55 → 63 %) passes 60")
	s.value = 60.0
	var up := P.new_state()
	t.eq(_run(up, s, [127, 110, 90, 77, 70]), [60.0, 60.0, 60.0, 61.0, 55.0], "from above: 77 (60.6 %) is within tolerance, then it tracks")
	s.free()


func test_pickup_rules() -> void:
	var s := HSlider.new()
	s.max_value = 100.0
	s.step = 1.0
	s.value = 60.0
	var st := P.new_state()
	t.eq(_run(st, s, [10, 40, 60]), [60.0, 60.0, 60.0], "below: 10, 40, 60/127=47 % — still under 60 %: no change")
	t.eq(P.waiting(st), true, "waiting with a known position (the ghost)")
	t.eq(_run(st, s, [76]), [60.0], "76/127 = 59.8 %: within tolerance → picked up, set to 60")
	t.eq(P.waiting(st), false, "live")
	t.eq(_run(st, s, [80, 100, 127]), [63.0, 79.0, 100.0], "live: it tracks")
	s.value = 20.0  # a look recall / a UI drag
	P.observe(st, s.ratio)
	t.eq(P.waiting(st), true, "the app moved it: waiting again")
	t.eq(_run(st, s, [120, 90, 60]), [20.0, 20.0, 20.0], "from above: no change while over 20 %")
	t.eq(_run(st, s, [20]), [16.0], "60 → 20 jumps past 20 % (25.4 → 15.7): picked up on the crossing, takes the fader's value")
	t.eq(_run(st, s, [26]), [20.0], "and tracks")
	var j := P.new_state()
	s.value = 50.0
	t.eq(_run(j, s, [0, 127]), [50.0, 100.0], "one message from 0 to 127 over 50 %: a crossing")
	var first := P.new_state()
	s.value = 50.0
	t.eq(_run(first, s, [127]), [50.0], "the first message far away: no previous position, no crossing — waits")
	t.eq(_run(first, s, [64]), [50.0], "64/127 = 50.4 % within tolerance: picked up (50.4 rounds to 50)")
	t.eq(P.waiting(first), false, "live")
	s.free()


func test_pickup_tolerance_and_7bit_steps() -> void:
	t.ok(P.TOL > 0.5 / 127.0 and P.TOL < 2.0 / 127.0, "tolerance: between half and two 7-bit steps")
	var f := HSlider.new()  # a 0..1 slider (the parameters, master)
	f.max_value = 1.0
	f.step = 0.01
	for target in [0.0, 0.33, 0.55, 0.99, 1.0]:
		f.value = target
		var st := P.new_state()
		var hits := 0
		for v in 128:  # a slow sweep up: the pickup happens near the target, and every step after it is taken
			var to := P.move(st, v / 127.0, f.ratio)
			if to >= 0.0:
				if hits == 0:
					t.ok(absf(to - target) <= P.TOL + 1e-6, "%.2f picked up at %.3f" % [target, to])
				f.ratio = to
				P.took(st, f.ratio)
				hits += 1
		t.eq(f.value, 1.0, "the sweep ends at the top (%.2f)" % target)
	var st2 := P.new_state()
	f.value = 0.5
	P.move(st2, 64 / 127.0, f.ratio)
	f.ratio = 64 / 127.0
	P.took(st2, f.ratio)
	t.eq(f.value, 0.5, "0.5039 on a 0.01 slider reads back 0.50")
	P.observe(st2, f.ratio)
	t.eq(P.waiting(st2), false, "its own rounding is not an app-side change")
	f.free()


func test_decode() -> void:
	t.eq(MM.decode(cc(2, 7, 99)), {"kind": "cc", "ch": 2, "num": 7, "val": 99}, "CC")
	t.eq(MM.decode(note(0, 32, 127)), {"kind": "note", "ch": 0, "num": 32, "val": 127}, "Note On")
	t.eq(MM.decode(note(0, 32, 0)).kind, "off", "Note On velocity 0 = off")
	t.eq(MM.decode(note(0, 32, 64, false)).kind, "off", "Note Off")
	var clock := InputEventMIDI.new()
	clock.message = MIDI_MESSAGE_TIMING_CLOCK
	t.eq(MM.decode(clock), {}, "clock ignored")


func test_bindings() -> void:
	var m := [{"kind": "cc", "ch": MM.ANY, "num": 14, "target": "master"}, {"kind": "cc", "ch": 2, "num": 7, "target": "layer:3"}]
	t.eq(MM.find(m, MM.decode(cc(5, 14, 1))).target, "master", "ANY channel matches")
	t.eq(MM.find(m, MM.decode(cc(1, 7, 1))), {}, "a track CC on another channel does not")
	m.append({"kind": "cc", "ch": 5, "num": 14, "target": "fade"})
	t.eq(MM.find(m, MM.decode(cc(5, 14, 1))).target, "fade", "an exact channel wins over ANY")
	var l := MM.learn(m, MM.decode(cc(2, 7, 50)), "param:hue")
	t.eq(l.filter(func(b: Dictionary) -> bool: return b.num == 7).map(func(b: Dictionary) -> String: return b.target), ["param:hue"],
		"learn replaces what the control drove")
	t.eq(MM.unbind_source(l, MM.decode(cc(5, 14, 0))).size(), l.size() - 2, "unbind a control: its exact and ANY bindings")
	t.eq(MM.unbind_target(l, "master").size(), l.size() - 1, "unbind a target")
	t.eq(MM.normalize([{"kind": "cc", "ch": 0, "num": 7, "target": "layer:1"}, {"kind": "cc", "ch": 0.0, "num": 7.0, "target": "master"},
		{"kind": "pitch", "ch": 0, "num": 1, "target": "master"}, {"kind": "cc", "ch": 0, "num": 300, "target": "nope"}, "junk"]),
		[{"kind": "cc", "ch": 0, "num": 7, "target": "master"}], "normalize: known kinds and targets, one per source (last wins)")
	t.eq(MM.key({"kind": "note", "ch": MM.ANY, "num": 32}), "note:*:32", "keys")
	t.eq([MM.is_range("layer:2"), MM.is_range("param:hue"), MM.is_range("look:1"), MM.is_range("auto")], [true, true, false, false], "ranges")


func test_apc40_map() -> void:
	var m := MM.apc40()
	t.eq(MM.normalize(m), m, "the default map is already normal (one binding per control)")
	for tr in 8:
		t.eq(MM.find(m, MM.decode(cc(tr, 7, 0))).target, "layer:%d" % (tr + 1), "fader %d → layer %d opacity" % [tr + 1, tr + 1])
		t.eq(MM.find(m, MM.decode(note(tr, 52, 127))).target, "mute:%d" % (tr + 1), "clip stop %d → mute" % (tr + 1))
	t.eq(MM.find(m, MM.decode(cc(0, 14, 0))).target, "master", "master fader")
	t.eq(MM.find(m, MM.decode(cc(0, 48, 0))).target, "param:pulse", "knob 1 → pulse")
	t.eq(MM.find(m, MM.decode(cc(0, 55, 0))).target, "fade", "knob 8 → fade")
	t.eq(MM.find(m, MM.decode(cc(3, 16, 0))).target, "dev:1", "device knob 1 on any channel (generic mode banks it by track) → the auto page (WO-909)")
	t.eq(MM.find(m, MM.decode(note(2, 51, 127))).target, "select:3", "track select 3 → select layer 3")
	t.eq(MM.find(m, MM.decode(note(0, 32, 127))).target, "look:1", "top-left pad → look 1")
	t.eq(MM.find(m, MM.decode(note(0, 39, 127))).target, "look:8", "top-right pad → look 8")
	t.eq(MM.find(m, MM.decode(note(0, 27, 127))).target, "look:12", "row 2, pad 4 → look 12")
	t.eq([MM.find(m, MM.decode(note(0, 82, 127))).target, MM.find(m, MM.decode(note(0, 83, 127))).target,
		MM.find(m, MM.decode(note(0, 84, 127))).target, MM.find(m, MM.decode(note(0, 99, 127))).target,
		MM.find(m, MM.decode(note(0, 81, 127))).target], ["burst", "auto", "audio", "tap", "blackout"], "scene launch, tap, stop all")
	t.eq(MM.find(m, MM.decode(cc(0, 15, 0))).target, "xfade", "the crossfader → the A/B banks (WO-908)")
	t.eq([MM.describe(MM.decode(cc(2, 7, 0)), true), MM.describe(MM.decode(note(0, 32, 1)), true), MM.describe(MM.decode(note(0, 0, 1)), true),
		MM.describe(MM.decode(cc(0, 14, 0)), true), MM.describe(MM.decode(cc(2, 7, 0)))],
		["Fader 3", "Pad 1·1", "Pad 5·1", "Master fader", "CC 7 · ch 3"], "names: the APC's own, else CC / channel")
	t.eq([MM.target_label("layer:2"), MM.target_label("param:cam_zoom"), MM.target_label("look:4")],
		["Layer 2 opacity", "Camera zoom", "Look 4"], "target labels")


func test_leds() -> void:
	var m := [{"kind": "note", "ch": MM.ANY, "num": 32, "target": "look:1"}, {"kind": "note", "ch": 2, "num": 52, "target": "mute:3"},
		{"kind": "cc", "ch": MM.ANY, "num": 48, "target": "param:pulse"}, {"kind": "cc", "ch": 0, "num": 7, "target": "layer:1"}]
	var st := {"look:1": Leds.ON, "mute:3": Leds.ALERT, "param:pulse": 64, "layer:1": 127}
	var f := Leds.frame(m, func(id: String) -> int: return st[id])
	t.eq(f, {"144:32": 21, "146:52": 2, "176:48": 64}, "pad green, clip stop 3 blinking on its track channel, knob ring; no fader")
	t.eq(Leds.diff({}, f).split(" ").size(), 9, "a full frame: three messages")
	st["look:1"] = Leds.AVAIL
	var g := Leds.frame(m, func(id: String) -> int: return st[id])
	t.eq(Leds.diff(f, g), "90 20 02", "only what changed")
	t.eq(Leds.diff(g, {}), "90 20 00 92 34 00", "off: the lights go dark (rings left)")
	t.eq(Leds.port_of("Dir Device    Name\nIO  hw:1,0,0  nanoKONTROL2\nIO  hw:4,0,0  APC40 mkII MIDI 1\n"), "hw:4,0,0", "amidi -l → port")
	t.eq(Leds.port_of("Dir Device    Name\n"), "", "none")


func test_input_helpers() -> void:
	t.eq(MI.can_open("Linux", "Dummy", "X11"), false, "the Dummy driver has no libasound: open_midi_inputs() would crash")
	t.eq(MI.can_open("Linux", "PulseAudio", "X11"), true, "PulseAudio loads libasound for MIDI")
	t.eq(MI.can_open("Linux", "ALSA", "headless"), false, "never headless")
	t.eq(MI.can_open("macOS", "CoreAudio", "macOS"), true, "CoreMIDI elsewhere")
	var times := {"/dev/snd/midiC4D0": 100}
	var sig := MI.signature(PackedStringArray(["controlC0", "midiC4D0", "pcmC0D0p", "seq"]), func(p: String) -> int: return times.get(p, 0))
	t.eq(sig, "midiC4D0@100", "the rawmidi nodes and their times")
	times["/dev/snd/midiC4D0"] = 160
	t.ok(MI.signature(PackedStringArray(["midiC4D0"]), func(p: String) -> int: return times.get(p, 0)) != sig, "a re-plug (new node) changes it")
	t.eq(MI.real(PackedStringArray(["Virtual RawMIDI", "APC40 mkII"])), PackedStringArray(["APC40 mkII"]), "the virtual port is no device")


func test_seen_report() -> void:
	var st := P.new_state()
	P.seen(st, 0.0, 0.6)
	t.eq([st.live, st.hw, P.waiting(st)], [false, 0.0, true], "a reported position far from the value: waiting, the ghost knows where")
	t.eq(P.move(st, 0.3, 0.6), -1.0, "and a move under it still waits")
	var at := P.new_state()
	P.seen(at, 76 / 127.0, 0.6)
	t.eq([at.live, P.waiting(at)], [true, false], "reported at the value: live at once")
	P.observe(at, 0.6)
	t.eq(at.live, true, "the value it was seen at is its own")
	var back := P.new_state()
	P.seen(back, 0.0, 0.6)
	P.observe(back, 0.3)
	t.eq(P.waiting(back), true, "WO-909: the value moving elsewhere keeps it waiting")
	P.observe(back, 0.005)
	t.eq([back.live, P.waiting(back), back.sent], [true, false, 0.005], "WO-909: the value coming to the control's position = in sync")


func test_encoder_turn() -> void:
	var st := P.new_state()
	t.eq(P.turn(st, 1.0, 0.5), -1.0, "WO-912: the first message of an APC knob only primes (even at the top of its own range)")
	t.eq(P.turn(st, 126 / 127.0, 0.5), 0.5 - 1 / 127.0, "a step down from there moves the value down from where IT is")
	t.ok(absf(P.turn(st, 1.0, 0.4) - (0.4 + 1 / 127.0)) < 1e-6, "a step up moves it up: the knob's own position never matters")
	t.eq([st.live, P.waiting(st)], [true, false], "an encoder is never waiting (no ghost)")
	t.eq(P.turn(st, 0.5, 0.4), -1.0, "a jump > 10 steps (the APC took a ring value) primes again")
	t.ok(absf(P.turn(st, 0.5 + 2 / 127.0, 0.4) - (0.4 + 2 / 127.0)) < 1e-6, "and the next step moves")
	t.eq(P.turn(st, 0.5 + 9 / 127.0, 0.99), 1.0, "clamped at 1")


func test_rings_only() -> void:
	var f := {"144:32": 21, "176:48": 64, "176:16": 3, "151:50": 1}
	t.eq(Leds.rings(f), {"176:48": 64, "176:16": 3}, "WO-912: with the pad lights off only the knob rings are sent")
