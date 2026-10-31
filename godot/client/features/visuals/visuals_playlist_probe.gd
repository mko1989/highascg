extends RefCounted
## Dev probe of WO-895 (no pointer on the owner's screen): `--probe-visuals-playlist=<dir>[:<seconds>]` (visuals_tab.gd _ready).
## A probe client: it never saves the box's project (ProjectSync off) and ignores the box's project broadcasts, so it runs on
## its own copy of the slice. Builds a visual playlist of three looks through the editor's drop path — A (one layer, 4 s),
## B (two layers with a fader, 2 bars / 5 s without a tempo), C (until a drop / 4 s without a tempo) — runs it with Auto for
## `seconds` (default 22), and saves the canvas and the window at each entry: <dir>/entry-<n>-<look>.png and
## <dir>/window-<n>.png. Then Auto off and on again (the current entry again), shuffle with 1 s holds for ten changes
## (every entry once per pass, no back-to-back repeats), quit. Pair with --visuals-ring=<name> and --tab=Visuals.

const P := preload("res://features/visuals/visuals_playlist.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")


static func run(tab: Node, arg: String) -> void:
	var a := arg.split(":")
	var dir := a[0]
	var secs := float(a[1]) if a.size() > 1 else 22.0
	var tree: SceneTree = tab.get_tree()
	_isolate(tab)
	await tree.create_timer(3.0).timeout
	_isolate(tab)
	tab.mixer.set_running(true)
	tab.set_process(true)
	tab.work.set_mode("playlist")
	var ctl: Node = tab.show_ctl
	var looks := []
	for spec in [["A", ["tunnel"], [1.0]], ["B", ["starfield", "particles"], [1.0, 0.6]], ["C", ["rings", "spectrum"], [1.0, 1.0]]]:
		var ls := []
		for i in spec[1].size():
			ls.append(L.layer_of({"scene": spec[1][i], "opacity": spec[2][i]}))
		M.with_layers(tab.slice, ls)
		looks.append(Looks.capture(tab.slice, spec[0]))
	ctl.looks = looks
	ctl._looks_changed()
	ctl.plist._edited([])
	var panel: Node = ctl.plist.panel
	for i in looks.size():
		panel.drop(P.look_drag(looks[i], i), -1)
	var holds := [{"hold": "seconds", "seconds": 4.0}, {"hold": "bars", "bars": 2, "seconds": 5.0}, {"hold": "drop", "seconds": 4.0}]
	for i in holds.size():
		panel._edit_pl(P.with_hold(panel.playlists[panel.edit], i, holds[i]))
	var pl: Dictionary = ctl.plist.playlists[0]
	print("[probe-playlist] built %s: %s" % [pl.name, pl.entries.map(func(e: Dictionary) -> String: return "%s (%s, %d layers)" % [e.name, P.hold_text(e), e.layers.size()])])
	panel._run.toggled.emit(true)
	var t0 := Time.get_ticks_msec()
	var seen := -1
	var shots := 0
	var log := []
	while Time.get_ticks_msec() - t0 < secs * 1000.0:
		await tree.process_frame
		var at: int = ctl.plist.running().at
		if at != seen:
			seen = at
			var e: Dictionary = P.current(ctl.plist.running())
			var b: Variant = ctl._live_beat()
			log.append(e.name)
			print("[probe-playlist] t=%.2f s entry %d %s (%s) · stack %s · faders %s · look lit %d · tempo locked %s" % [
				(Time.get_ticks_msec() - t0) / 1000.0, at + 1, e.name, P.hold_text(e), tab.scene.ids(),
				tab.slice.layers.map(func(l: Dictionary) -> float: return l.opacity), ctl.showing,
				str(b.get("locked")) if b is Dictionary else "no beat"])
			print("[probe-playlist]   stack = its look's: %s" % (tab.slice.layers == looks[["A", "B", "C"].find(e.name)].layers))
			await tree.create_timer(1.3).timeout  # past the 1 s crossfade
			shots += 1
			tab.out_vp.get_texture().get_image().save_png("%s/entry-%d-%s.png" % [dir, shots, e.name])
			tab.get_viewport().get_texture().get_image().save_png("%s/window-%d.png" % [dir, shots])
			ctl.status()
			print("[probe-playlist]   note: %s" % tab.page.show_panel._auto_note.text)
	print("[probe-playlist] loop order: %s" % [log])
	var cur: int = ctl.plist.running().at
	panel._run.toggled.emit(false)
	await tree.create_timer(2.0).timeout
	print("[probe-playlist] Auto off: running %s, still entry %d, stack %s" % [ctl.plist.running() != null, cur + 1, tab.scene.ids()])
	panel._run.toggled.emit(true)
	print("[probe-playlist] Auto on again: entry %d (was %d), hold ms %.0f" % [ctl.plist.running().at + 1, cur + 1, ctl.plist.hold.ms])
	for i in 3:
		panel._edit_pl(P.with_hold(panel.playlists[panel.edit], i, {"hold": "seconds", "seconds": 1.0}))
	panel._mode.item_selected.emit(1)
	var order := [P.current_index(ctl.plist.running())]
	var pos: int = ctl.plist.running().at
	while order.size() < 10:  # every advance moves `at` (a new pass goes back to 0), so a repeat would show
		await tree.process_frame
		if ctl.plist.running().at != pos:
			pos = ctl.plist.running().at
			order.append(P.current_index(ctl.plist.running()))
	var repeats := 0
	for i in range(1, order.size()):
		repeats += 1 if order[i] == order[i - 1] else 0
	print("[probe-playlist] shuffle entries: %s · back-to-back repeats %d" % [order, repeats])
	tree.quit()


## Never write the box's project, never take the box's project in (the owner may be working on it).
static func _isolate(tab: Node) -> void:
	var ps: Node = tab._g("ProjectSync")
	if ps:
		ps.project_gone = true
	var st: Node = tab._g("Store")
	if st:
		for sig in ["project_changed", "changed"]:
			for c in st.get_signal_connection_list(sig):
				if (c.callable as Callable).get_object() == tab:
					st.disconnect(sig, c.callable)
