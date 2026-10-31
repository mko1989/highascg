extends RefCounted
## WO-877 the Visuals' show controls: looks (capture → apply round trip, stored looks made safe, which one is showing, keys
## 1–9), the mixer (a change fades in on the idle deck and the old deck is emptied after, same scenes = no fade, 0 s = cut,
## master / blackout fade) and the stage keeping an unchanged shader (no recompile, no time jump).

const Looks := preload("res://features/visuals/visuals_looks.gd")
const Mixer := preload("res://features/visuals/visuals_mixer.gd")
const Stage := preload("res://features/visuals/visuals_stage.gd")
const M := preload("res://features/visuals/visuals_model.gd")
var t


func test_capture_apply() -> void:
	var s := M.slice_of({"visuals": {"scene": "tunnel", "overlay": "particles", "params": {"pulse": 0.9}, "sync": 40}})
	var l := Looks.capture(s)
	t.eq(l.name, "Tunnel + Particles", "named after its scenes")
	t.eq(l.has("output") or l.has("sync") or l.has("looks"), false, "the picture only, never the plumbing")
	var other := M.slice_of({"visuals": {"scene": "rings", "sync": 120, "output": {"layer": 30}}})
	var back := Looks.apply(other, l)
	t.eq([back.scene, back.overlay, back.params.pulse], ["tunnel", "particles", 0.9], "apply puts the picture back")
	t.eq([back.sync, back.output.layer], [120.0, 30], "and keeps the output and sync")
	l.params.pulse = 0.1
	t.eq(back.params.pulse, 0.9, "a look is a copy, not a reference")
	t.eq(Looks.showing([Looks.capture(other), Looks.capture(back)], back), 1, "which stored look is on the canvas")
	t.eq(Looks.showing([Looks.capture(other)], back), -1, "none")
	var sh := Looks.capture(M.slice_of({"visuals": {"scene": "shader", "shader": "sh-sa-ribbons"}}), "  ")
	t.eq(sh.name, "Shader · ribbons", "a blank name → from the scenes and the shader")


func test_normalize() -> void:
	var raw := [{"scene": "nope", "name": "x".repeat(60)}, "junk", {"scene": "tunnel", "overlay": "tunnel"}]
	for i in 20:
		raw.append({"scene": "rings"})
	var n := Looks.normalize(raw)
	t.eq(n.size(), Looks.MAX, "at most MAX, junk dropped")
	t.eq([n[0].scene, n[0].name.length()], ["rings", 40], "unknown scene → rings; a long name cut")
	t.eq([n[1].overlay, n[1].name], ["", "Tunnel"], "never the same scene twice")
	t.ok(n[0].graph.nodes.size() > 0 and n[0].params.has("glow"), "every key present")
	t.eq(Looks.normalize(null), [], "nothing stored")


func test_keys() -> void:
	t.eq([Looks.key_index(KEY_1), Looks.key_index(KEY_9), Looks.key_index(KEY_KP_3)], [0, 8, 2], "1–9 and the keypad")
	t.eq([Looks.key_index(KEY_0), Looks.key_index(KEY_A)], [-1, -1], "anything else")


func test_mixer_fades() -> void:
	var m: Node = Mixer.new()
	m.stage_of(0).set_layers("rings", "")
	t.eq(m.decks.size(), 2, "two decks")
	m.go("rings", "", null, 1.0)
	t.eq([m.live, m.fading()], [0, false], "same scenes on air → no fade")
	m.go("tunnel", "particles", null, 1.0)
	t.eq([m.live, m.fading(), m.stage().ids()], [1, true, ["tunnel", "particles"]], "a change loads the idle deck and fades")
	t.eq(m.decks[0].render_target_update_mode, SubViewport.UPDATE_ALWAYS, "both decks render while fading")
	m.step(0.5)
	t.eq(m.x, 0.5, "halfway after half the fade")
	m.step(0.6)
	t.eq([m.x, m.fading()], [1.0, false], "done")
	t.eq([m.stage_of(0).ids(), m.decks[0].render_target_update_mode], [[], SubViewport.UPDATE_DISABLED],
		"the old deck is emptied and sleeps")
	m.go("starfield", "", null, 0.0)
	t.eq([m.live, m.x, m.fading()], [0, 0.0, false], "0 s cuts")
	m.go("starfield", "", null, 1.0, true)
	t.eq([m.live, m.fading()], [1, true], "force fades even with the same scenes (a look with other parameters)")
	m.set_running(false)
	t.eq([m.decks[0].render_target_update_mode, m.out_vp.render_target_update_mode],
		[SubViewport.UPDATE_DISABLED, SubViewport.UPDATE_DISABLED], "asleep: nothing renders")
	m.free()


func test_master_and_blackout() -> void:
	var m: Node = Mixer.new()
	m.blackout = true
	m.step(0.2)
	t.ok(m.master > 0.4 and m.master < 0.6, "blackout fades (half after 0.2 s)")
	m.step(0.3)
	t.eq(m.master, 0.0, "black")
	m.blackout = false
	m.level = 0.5
	for i in 10:
		m.step(0.1)
	t.eq(m.master, 0.5, "back to the fader's level")
	m.free()


func test_same_shader_is_kept() -> void:
	var s: Node3D = Stage.new()
	s._ready()
	s.set_layers("shader", "")
	var cfg := {"id": "x", "passes": []}
	s.set_shader(cfg)
	s.layers[0]._time = 5.0
	s.set_shader(cfg.duplicate(true))
	t.eq(s.layers[0]._time, 5.0, "the same shader again: no restart")
	s.set_shader({"id": "y"})
	t.eq(s.layers[0]._time, 0.0, "another shader restarts")
	s.free()


# WO-878 autopilot: picked looks land on the next beat, the next look every N bars and on drops, a 120 BPM clock without lock.
const Auto := preload("res://features/visuals/visuals_autopilot.gd")


func _b(n: int, locked := true) -> Dictionary:
	return {"n": n, "bpm": 128.0, "locked": locked, "phase": 0.0}


func test_autopilot_quantise() -> void:
	var st := Auto.new_state()
	var cfg := Auto.cfg_of({})
	t.eq([cfg.bars, cfg.drops, cfg.quantise], [0, false, true], "defaults: no timed changes, picks on the beat")
	Auto.step(st, cfg, _b(10), 0, 16.0, 0, 4)
	t.eq(Auto.pick(st, 2, cfg, _b(10)), false, "a tempo is locked → the pick waits")
	t.eq(Auto.step(st, cfg, _b(10), 0, 16.0, 0, 4), -1, "same beat → still waiting")
	t.eq(Auto.step(st, cfg, _b(11), 0, 16.0, 0, 4), 2, "the next beat → look 2")
	t.eq(Auto.step(st, cfg, _b(12), 0, 16.0, 2, 4), -1, "once")
	t.eq(Auto.pick(st, 1, cfg, _b(12, false)), true, "no lock → at once")
	t.eq(Auto.pick(st, 1, Auto.cfg_of({"quantise": false}), _b(12)), true, "quantise off → at once")
	Auto.pick(st, 3, cfg, _b(12))
	t.eq(Auto.step(st, cfg, _b(12, false), 0, 16.0, 1, 4), 3, "the lock goes while waiting → the look goes at once")


func test_autopilot_bars_and_drops() -> void:
	var st := Auto.new_state()
	var cfg := Auto.cfg_of({"bars": 4, "drops": true})
	t.eq(Auto.cfg_of({"bars": 5}).bars, 0, "only the offered bar counts")
	var got := []
	for n in range(0, 40):
		var r := Auto.step(st, cfg, _b(n), 0, 16.0, 1, 3)
		if r >= 0:
			got.append([n, r])
	t.eq(got, [[16, 2], [32, 2]], "every 16 beats (4 bars) → the next look after the current one")
	t.eq(Auto.bars_left(st, cfg), 3, "7 beats into the next 16: 2¼ bars left → 3")
	t.eq(Auto.step(st, cfg, _b(40), 0, 16.0, 2, 3), -1, "the drop count starts")
	t.eq(Auto.step(st, cfg, _b(40), 1, 16.0, 2, 3), 0, "a drop → the next look, wrapping")
	t.eq(Auto.bars_left(st, cfg), 4, "a change restarts the bar count")
	t.eq(Auto.step(st, cfg, _b(41), 2, 16.0, 0, 1), -1, "one look: nothing to go to")
	var free := Auto.new_state()
	var c8 := Auto.cfg_of({"bars": 4})
	var at := -1
	for f in 600:  # 10 s of frames without a tempo
		if Auto.step(free, c8, null, -1, 1000.0 / 60.0, 0, 2) >= 0:
			at = f
			break
	t.ok(at > 470 and at < 490, "no tempo: 4 bars on the 120 BPM clock ≈ 8 s (frame %d)" % at)


func test_tab_autopilot_drives_the_mixer() -> void:
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	var a := Looks.capture(M.slice_of({"visuals": {"scene": "tunnel"}}))
	var b := Looks.capture(M.slice_of({"visuals": {"scene": "starfield", "overlay": "particles"}}))
	tab.show_ctl.looks = [a, b]
	tab.slice.auto = Auto.cfg_of({"bars": 4})
	tab.show_ctl.recall(0)
	t.eq(tab.scene.ids(), ["tunnel"], "look 1 on stage")
	tab.show_ctl._beat_at = Time.get_ticks_msec()
	tab.show_ctl._beat = _b(100)
	tab._process(0.02)
	tab.show_ctl.pick(1)
	tab._process(0.02)
	t.eq(tab.show_ctl.showing, 0, "a picked look waits for the beat")
	tab.show_ctl._beat = _b(101)
	tab._process(0.02)
	t.eq([tab.show_ctl.showing, tab.scene.ids(), tab.mixer.fading()], [1, ["starfield", "particles"], true], "on the beat: look 2 fades in")
	for n in range(102, 118):
		tab.show_ctl._beat = _b(n)
		tab.show_ctl._beat_at = Time.get_ticks_msec()
		tab._process(0.1)
	t.eq([tab.show_ctl.showing, tab.scene.ids()], [0, ["tunnel"]], "4 bars later the autopilot goes back to look 1")
	tab.show_ctl.status()
	t.ok(tab.page.show_panel._auto_note.text.begins_with("Tempo 128 BPM"), "the page shows the tempo")
	tab.free()


# WO-879 tap tempo: the Tempo row's signals, Audio's state follows the frames' beat, the note says "Tapped".
func test_tap_row() -> void:
	var sp: VBoxContainer = preload("res://features/visuals/visuals_show.gd").new()
	var got := []
	sp.tapped.connect(func(auto: bool) -> void: got.append(auto))
	sp._tap.button_down.emit()
	sp._audio.pressed.emit()
	t.eq(got, [false, true], "Tap = a tap, Audio = back to the music")
	t.eq(sp._audio.button_pressed, true, "Audio stays pressed until a tap takes over")
	sp.set_tapped(true)
	t.eq(sp._audio.button_pressed, false, "tapped → Audio released")
	sp.free()
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	tab.show_ctl._beat_at = Time.get_ticks_msec()
	tab.show_ctl._beat = {"n": 3, "bpm": 124.0, "locked": true, "phase": 0.0, "tap": true}
	tab.show_ctl.status()
	t.ok(tab.page.show_panel._auto_note.text.begins_with("Tapped 124 BPM"), "the note: tapped")
	t.eq(tab.page.show_panel._audio.button_pressed, false, "and Audio is released")
	tab.show_ctl._beat = _b(4)
	tab.show_ctl.status()
	t.eq([tab.page.show_panel._audio.button_pressed, tab.page.show_panel._auto_note.text.begins_with("Tempo 128")], [true, true],
		"the music's beat again")
	tab.free()
