extends RefCounted
## WO-895 visual playlists: stored lists made safe and the slice round trip (restart), entries from looks and Sources rows
## (the layer stack kept), loop and shuffle order, holds (bars on the beat grid, seconds, until a drop; seconds while no tempo
## is locked), edits keeping the position, and the tab: Auto runs a playlist, off and on again replays the current entry,
## the editor panel and the Show block's Auto picker.

const P := preload("res://features/visuals/visuals_playlist.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const Auto := preload("res://features/visuals/visuals_autopilot.gd")
var t


func _look(ids: Array, name: String, pulse := 0.2) -> Dictionary:
	var s := M.slice_of({"visuals": {"layers": ids.map(func(id: String) -> Dictionary: return {"scene": id, "opacity": 0.6}),
		"graph": M.default_graph()}})  # a stored graph (normalized: floats), as a project loads it
	s.params.pulse = pulse
	return Looks.capture(s, name)


func _visual(scene: String, label: String) -> Dictionary:
	return {"type": "visual", "label": label, "scene": scene}


func _pl(n: int, mode := "loop") -> Dictionary:
	var p := P.new_playlist([], "Set")
	for i in n:
		p = P.add_entry(p, P.entry_of_drop(_visual(["tunnel", "rings", "starfield", "particles", "spectrum"][i % 5], "v%d" % i)))
	return P.with_mode(p, mode, RandomNumberGenerator.new())


func _b(n: int, locked := true) -> Dictionary:
	return {"n": n, "bpm": 128.0, "locked": locked, "phase": 0.0}


func test_entries_from_drops() -> void:
	var look := _look(["tunnel", "particles", "rings"], "Three", 0.9)
	var e: Dictionary = P.entry_of_drop(P.look_drag(look, 0))
	t.eq([e.kind, e.name, e.layers.size(), e.params.pulse, e.hold, e.bars, e.seconds], ["look", "Three", 3, 0.9, "bars", 8, 30.0],
		"a look: its whole stack and parameters, 8 bars / 30 s by default")
	var s := P.apply(M.slice_of({"visuals": {"scene": "rings", "sync": 50}}), e)
	t.eq([Looks.showing([look], s), s.sync], [0, 50.0], "an entry replays its look exactly (the plumbing kept)")
	t.eq(s.layers.map(func(l: Dictionary) -> float: return l.opacity), [0.6, 0.6, 0.6], "faders too")
	var v: Dictionary = P.entry_of_drop({"type": "visual", "label": "Ribbons", "scene": "shader", "shader": "sh-sa-ribbons"})
	t.eq([v.kind, v.name, v.layers.size(), v.layers[0].shader, v.has("params")], ["visual", "Ribbons", 1, "sh-sa-ribbons", false],
		"a Sources row: a one-layer stack")
	var base := M.slice_of({"visuals": {"params": {"pulse": 0.7}, "layers": [{"scene": "tunnel"}, {"scene": "rings"}]}})
	var vs := P.apply(base, v)
	t.eq([vs.layers.size(), vs.layers[0].scene, vs.params.pulse, vs.shader], [1, "shader", 0.7, "sh-sa-ribbons"],
		"a visual replaces the stack and keeps the parameters; compat fields follow")
	t.eq([P.entry_of_drop({"type": "visual", "scene": ""}), P.entry_of_drop("x"), P.can_drop({"type": "visual_look"})], [null, null, false],
		"junk is refused")


func test_normalize_and_restart_round_trip() -> void:
	var raw := [{"id": "a", "name": "  ", "mode": "zigzag", "entries": [{"layers": []}, "junk",
			{"kind": "visual", "layers": [{"scene": "tunnel"}], "hold": "seconds", "seconds": 0}], "at": 9, "order": [3, 1]},
		{"id": "a", "name": "Dup", "entries": [{"kind": "look", "layers": [{"scene": "rings"}], "params": {"pulse": 2}}]}]
	var n := P.normalize(raw)
	t.eq([n[0].name, n[0].mode, n[0].entries.size(), n[0].entries[0].seconds, n[0].order, n[0].at],
		["Visual playlist", "loop", 1, 1.0, [0], 0], "defaults, empty entries dropped, clamps, a bad order rebuilt")
	t.eq([n[1].id != "a", n[1].entries[0].params.pulse, n[1].entries[0].graph.nodes.size() > 0], [true, 1.0, true],
		"duplicate ids made unique; a look entry made safe by the look rules")
	var p := P.with_mode(_pl(4), "shuffle", RandomNumberGenerator.new())
	p = P.next(p, RandomNumberGenerator.new())
	p = P.next(p, RandomNumberGenerator.new())
	var project := {"visuals": {"playlists": [p], "auto": {"bars": 0, "playlist": p.id}, "layers": [{"scene": "tunnel"}]}}
	var s1 := M.slice_of(project)
	s1.playlists = P.normalize(s1.playlists)
	var stored: Variant = JSON.parse_string(JSON.stringify({"visuals": s1}))  # what the project file holds after a save
	var s2 := M.slice_of(stored)
	s2.playlists = P.normalize(s2.playlists)
	t.eq(s2.playlists, s1.playlists, "normalize → JSON → normalize: the playlists unchanged")
	t.eq([s2.auto.playlist, s2.playlists[0].at, s2.playlists[0].order, typeof(s2.playlists[0].at)], [p.id, 2, p.order, TYPE_INT],
		"the running playlist, its pass order and position survive a restart (ints again after JSON)")
	t.eq(P.active(s2).id, p.id, "and Auto runs it again")
	t.eq(Auto.cfg_of({"bars": 4}).playlist, "", "no playlist: Auto cycles looks as before")


func test_loop_order() -> void:
	var rng := RandomNumberGenerator.new()
	var p := _pl(3)
	var seen := []
	for i in 7:
		seen.append(P.current_index(p))
		p = P.next(p, rng)
	t.eq(seen, [0, 1, 2, 0, 1, 2, 0], "in order, again from the top")
	t.eq(P.current_index(P.jump(p, 2)), 2, "jump")
	t.eq(P.next(P.new_playlist([]), rng).entries, [], "an empty playlist stays put")


func test_shuffle_passes() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 895
	for n in [2, 3, 5]:
		var p := P.with_mode(_pl(n), "shuffle", rng)
		var prev := -1
		var repeats := 0
		var orders := {}
		for pass_i in 60:
			var got := []
			for k in n:
				var c := P.current_index(p)
				repeats += 1 if c == prev else 0
				prev = c
				got.append(c)
				p = P.next(p, rng)
			var sorted := got.duplicate()
			sorted.sort()
			t.eq(sorted, range(n), "%d entries, pass %d: every entry once" % [n, pass_i])
			orders[str(got)] = true
		t.eq(repeats, 0, "%d entries: never the same entry twice in a row across 60 passes" % n)
		t.ok(orders.size() > 1 or n == 2, "%d entries: the order changes between passes (2: it can only alternate)" % n)
	var one := P.with_mode(_pl(1), "shuffle", rng)
	t.eq(P.current_index(P.next(one, rng)), 0, "one entry: it repeats (nothing else is left)")
	var p3 := P.next(_pl(3), rng)
	t.eq(P.current_index(P.with_mode(p3, "shuffle", rng)), 1, "switching to shuffle stays on the current entry")


func test_holds() -> void:
	var e: Dictionary = P.entry_of({"kind": "visual", "layers": [{"scene": "tunnel"}], "hold": "bars", "bars": 2, "seconds": 5})
	var st := P.new_hold()
	var at := -1
	for n in range(100, 120):
		if P.hold_done(st, e, _b(n), 0, 16.0):
			at = n
			break
	t.eq(at, 108, "2 bars = 8 locked beats after the start beat")
	st = P.new_hold()
	P.hold_done(st, e, _b(1), 0, 16.0)
	t.eq(P.left(st, e, _b(1)), "next in 2 bars", "status: bars")
	t.eq(P.left(st, e, null), "next in 5 s (no tempo locked)", "status: no tempo")
	var frames := 0
	st = P.new_hold()
	while not P.hold_done(st, e, null, -1, 1000.0 / 60.0) and frames < 1000:
		frames += 1
	t.ok(frames >= 298 and frames <= 300, "no tempo: a bars hold ends after its seconds (frame %d ≈ 5 s)" % frames)
	var s: Dictionary = P.with_hold({"entries": [e], "order": [0], "at": 0, "mode": "loop"}, 0, {"hold": "seconds", "seconds": 2}).entries[0]
	st = P.new_hold()
	var done := []
	for f in 200:  # locked beats do not matter to a seconds hold
		if P.hold_done(st, s, _b(f), 0, 16.0):
			done.append(f)
			break
	t.eq(done, [124], "seconds: 2 s of frames (125 × 16 ms), whatever the beat")
	var d: Dictionary = P.entry_of({"kind": "visual", "layers": [{"scene": "tunnel"}], "hold": "drop", "seconds": 3})
	st = P.new_hold()
	t.eq([P.hold_done(st, d, _b(1), 4, 16.0), P.hold_done(st, d, _b(2), 4, 99999.0), P.hold_done(st, d, _b(3), 5, 16.0)],
		[false, false, true], "until a drop: only a new drop ends it while locked (not the time)")
	st = P.new_hold()
	t.eq([P.hold_done(st, d, null, -1, 2000.0), P.hold_done(st, d, null, -1, 1000.0)], [false, true],
		"until a drop with no tempo: its seconds")
	t.eq([P.hold_text(e), P.hold_text(s), P.hold_text(d)], ["2 bars", "2 s", "until a drop"], "hold texts")


func test_edits_keep_the_position() -> void:
	var rng := RandomNumberGenerator.new()
	var p := P.next(_pl(3), rng)  # on entry 1 (rings)
	var names := func(x: Dictionary) -> Array: return x.entries.map(func(e: Dictionary) -> String: return e.name)
	var a := P.add_entry(p, P.entry_of_drop(_visual("spectrum", "new")), 0)
	t.eq([names.call(a), a.entries[P.current_index(a)].name], [["new", "v0", "v1", "v2"], "v1"], "insert before: still on v1")
	var r := P.remove_entry(p, 0)
	t.eq([names.call(r), r.entries[P.current_index(r)].name], [["v1", "v2"], "v1"], "remove before: still on v1")
	var rc := P.remove_entry(p, 1)
	t.eq(rc.entries[P.current_index(rc)].name, "v2", "remove the current one: the next takes its place")
	var m := P.move_entry(p, 1, 2)
	t.eq([names.call(m), m.entries[P.current_index(m)].name, m.order], [["v0", "v2", "v1"], "v1", [0, 1, 2]], "move: still on v1")
	rng.seed = 7
	var sh := P.with_mode(_pl(4), "shuffle", rng)
	sh = P.next(sh, rng)
	var cur: String = sh.entries[P.current_index(sh)].name
	for x in [P.add_entry(sh, P.entry_of_drop(_visual("rings", "z"))), P.remove_entry(sh, (P.current_index(sh) + 1) % 4),
			P.move_entry(sh, 0, 3)]:
		var sorted: Array = x.order.duplicate()
		sorted.sort()
		t.eq([sorted, x.entries[P.current_index(x)].name], [range(x.entries.size()), cur], "shuffle edit: a valid order, same entry")
	var full := P.new_playlist([])
	for i in P.MAX_ENTRIES + 3:
		full = P.add_entry(full, P.entry_of_drop(_visual("rings", "x")))
	t.eq(full.entries.size(), P.MAX_ENTRIES, "at most MAX_ENTRIES")


func _tab() -> Control:
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	return tab


func _run_frames(tab: Control, secs: float, log: Array) -> void:
	for f in int(secs / 0.1):
		tab._process(0.1)
		var ids: Array = tab.scene.ids()
		if log.is_empty() or log[-1] != ids:
			log.append(ids)


func test_tab_runs_a_playlist() -> void:
	var tab := _tab()
	var ctl: Node = tab.show_ctl
	var panel: Node = ctl.plist.panel
	t.ok(tab.work._modes.has("playlist") and tab.work._modes.playlist.button.text == "Visual playlist", "the work area's mode")
	tab.work.set_mode("playlist")
	t.eq(panel.visible, true, "its panel shows")
	var a := _look(["tunnel"], "A")
	var b := _look(["starfield", "particles"], "B", 0.8)
	ctl.looks = [a, b]
	ctl._looks_changed()
	panel.drop(P.look_drag(a, 0), -1)  # no playlist yet → a first one
	panel.drop(_visual("rings", "Rings"), -1)
	panel.drop(P.look_drag(b, 1), 1)  # onto row 2 = before it
	var pls: Array = tab.slice.playlists
	t.eq([pls.size(), pls[0].entries.map(func(e: Dictionary) -> String: return e.name)], [1, ["A", "B", "Rings"]], "built by drops")
	t.eq(panel.rows.size(), 3, "three rows")
	panel.rows[0].hold.item_selected.emit(1)  # A: seconds
	panel.rows[0].secs.value_changed.emit(1.0)  # a committed field (outside the tree .value does not emit)
	panel.rows[1].hold.item_selected.emit(0)  # B: bars → 2 s without a tempo
	panel.rows[1].secs.value_changed.emit(2.0)
	panel.rows[2].hold.item_selected.emit(2)  # Rings: until a drop → 1 s without a tempo
	panel.rows[2].secs.value_changed.emit(1.0)
	var es: Array = tab.slice.playlists[0].entries
	t.eq(es.map(func(e: Dictionary) -> Array: return [e.hold, e.seconds]), [["seconds", 1.0], ["bars", 2.0], ["drop", 1.0]], "mixed holds")
	t.eq([tab.scene.ids(), tab.slice.auto.playlist], [["rings"], ""], "before Run: the tab's own picture, Auto off")
	panel._run.toggled.emit(true)
	t.eq([tab.slice.auto.playlist, tab.scene.ids(), ctl.showing], [pls[0].id, ["tunnel"], 0], "Run: Auto shows the first entry")
	t.eq(tab.page.show_panel._auto.get_item_text(tab.page.show_panel._auto.selected), "Visual playlist · Visual playlist 1",
		"the Show block's Auto says so")
	var log := []
	_run_frames(tab, 5.95, log)  # no tempo: 1 s, 2 s, 1 s, then A again at 4 s, B at 5 s
	t.eq(log, [["tunnel"], ["starfield", "particles"], ["rings"], ["tunnel"], ["starfield", "particles"]], "in order, each for its hold, looping")
	t.eq([tab.slice.params.pulse, ctl.showing], [0.8, 1], "a look entry brings its parameters; its look lights up")
	ctl.status()
	t.ok(tab.page.show_panel._auto_note.text.contains("Visual playlist Visual playlist 1 2/3 B · next in"), "status: " + tab.page.show_panel._auto_note.text)
	tab.page.show_panel._auto.select(0)  # Auto off mid-entry
	tab.page.show_panel._emit_auto()
	t.eq(tab.slice.auto.playlist, "", "Auto off")
	log = []
	_run_frames(tab, 3.0, log)
	t.eq(log, [["starfield", "particles"]], "off: nothing changes")
	tab.page.show_panel._auto.select(Auto.BARS.size())  # and on again
	tab.page.show_panel._emit_auto()
	t.eq([tab.slice.auto.playlist, tab.slice.playlists[0].at, ctl.plist.hold.ms], [pls[0].id, 1, 0.0],
		"on again: the current entry, its hold from the start")
	log = []
	_run_frames(tab, 1.9, log)
	t.eq(log, [["starfield", "particles"]], "it plays its whole hold again")
	_run_frames(tab, 0.2, log)
	t.eq(log[-1], ["rings"], "then the next")
	panel.rows[0].panel.gui_input.emit(_dbl())
	t.eq([tab.scene.ids(), tab.slice.playlists[0].at], [["tunnel"], 0], "double-click shows an entry now")
	tab.free()


func _dbl() -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_LEFT
	e.pressed = true
	e.double_click = true
	return e


func test_reload_keeps_the_run() -> void:
	var tab := _tab()
	var ctl: Node = tab.show_ctl
	var p := P.next(_pl(3), RandomNumberGenerator.new())
	tab.slice = M.slice_of(JSON.parse_string(JSON.stringify({"visuals": {"playlists": [p], "auto": {"playlist": p.id},
		"layers": [{"scene": "rings"}]}})))
	ctl.from_slice()  # a restart: the stored slice loads
	t.eq([ctl.plist.running().id, ctl.plist.running().at, tab.slice.layers[0].scene], [p.id, 1, "rings"],
		"running again on the entry it was on; the picture is the stored one (no recall)")
	t.eq(tab.page.show_panel._pl_ids, [p.id], "Auto offers it")
	ctl.plist.hold.ms = 1234.0
	ctl.from_slice()  # a reload that did not move it (another client's autosave)
	t.eq(ctl.plist.hold.ms, 1234.0, "the hold goes on")
	tab.slice.playlists[0].at = 2
	ctl.from_slice()
	t.eq(ctl.plist.hold.ms, 0.0, "moved elsewhere: the hold starts over")
	ctl.plist.panel._del.pressed.emit()
	t.eq([tab.slice.playlists, tab.slice.auto.playlist], [[], ""], "deleting the running playlist turns Auto off")
	tab.slice.auto = Auto.cfg_of({"bars": 4})
	t.eq(ctl.plist.auto_cfg(tab.slice.auto).bars, 4, "no playlist: the look cycling's own bars")
	tab.free()
