extends RefCounted
## WO-900 dev probe (no pointer on the owner's screen): `--probe-midi=<dir>` drives the Visuals' MIDI through the engine's
## own input path — InputEventMIDI and mouse clicks fed to Input.parse_input_event, as the ALSA driver and a pointer would —
## and saves the window at each step: <dir>/01-waiting.png (fader 1 below layer 1's value: the amber tick), 02-picked.png,
## 03-rearmed.png (a look recall moved the slider: waiting again), 04-learned.png (Learn → a knob → a click on Pulse),
## 05-pad-look.png. `--probe-midi=<dir>:real` instead opens the real inputs (a plugged-in APC40 mkII), waits for its
## position report and saves <dir>/real-01-report.png. Never saves the box's project (ProjectSync off, the project
## broadcasts ignored). Pair with --tab=Visuals, --visuals-ring=<name> and its own XDG_DATA_HOME whose ui.cfg has
## "[live]\nauto=false" (Live-preview Auto would re-tile and POST the server-wide operator layout from the probe's window).

const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const PlaylistProbe := preload("res://features/visuals/visuals_playlist_probe.gd")


static func run(tab: Node, arg: String) -> void:
	var real := arg.ends_with(":real")
	var dir := arg.trim_suffix(":real")
	DirAccess.make_dir_recursive_absolute(dir)
	var tree: SceneTree = tab.get_tree()
	PlaylistProbe._isolate(tab)
	await tree.create_timer(3.0).timeout
	PlaylistProbe._isolate(tab)
	tab.mixer.set_running(true)
	tab.set_process(true)
	var midi: Node = tab.midi
	var ls := []
	for s in [["tunnel", 0.6], ["particles", 0.8], ["rings", 0.3]]:
		ls.append(L.layer_of({"scene": s[0], "opacity": s[1]}))
	M.with_layers(tab.slice, ls)
	tab._go(false)
	tab.page.set_state(tab.slice, tab._cm())
	_scroll_to(tab.page.layer_list)
	if real:
		await _real(tab, midi, dir)
		tree.quit()
		return
	midi.apc = true  # the APC's control names in the texts (no device in this client)
	await _cc(tree, 0, 7, 10)
	_shot(tab, dir, "01-waiting", "fader 1 at 8 %% under layer 1 at 60 %%: opacity %.2f, note: %s" % [tab.slice.layers[0].opacity, midi.note])
	for v in [40, 60, 90]:
		await _cc(tree, 0, 7, v)
	_shot(tab, dir, "02-picked", "after 40, 60, 90: opacity %.2f, note: %s" % [tab.slice.layers[0].opacity, midi.note])
	var low: Dictionary = tab.slice.duplicate(true)
	low.layers[0].opacity = 0.25
	tab.show_ctl.looks = [Looks.capture(low, "Low"), Looks.capture(tab.slice, "High")]
	tab.show_ctl._looks_changed()
	tab.show_ctl.recall(0)
	await tree.create_timer(0.4).timeout
	await _cc(tree, 0, 7, 100)
	_shot(tab, dir, "03-rearmed", "look Low recalled (25 %%), fader at 79 %%: opacity %.2f, note: %s" % [tab.slice.layers[0].opacity, midi.note])
	_scroll_to(midi.panel)
	await tree.create_timer(0.3).timeout
	_shot(tab, dir, "03b-panel", "the MIDI panel: %s" % midi.panel.note_text())
	await _click(tree, midi.panel.learn)
	await _cc(tree, 9, 21, 64)
	var pulse: Control = tab.page.control("param:pulse")
	_scroll_to(pulse)
	await tree.create_timer(0.2).timeout
	await _click(tree, pulse)
	var learned: Array = midi.map.filter(func(b: Dictionary) -> bool: return b.num == 21 and b.ch == 9)
	_shot(tab, dir, "04-learned", "Learn + CC 21 ch 10 + click on Pulse: %s, pulse %.2f, note: %s" % [learned, tab.slice.params.pulse, midi.note])
	await _note(tree, 0, 33)
	_shot(tab, dir, "05-pad-look", "pad 1·2: showing look %d, note: %s" % [tab.show_ctl.showing + 1, midi.note])
	tree.quit()


static func _real(tab: Node, midi: Node, dir: String) -> void:
	var tree: SceneTree = tab.get_tree()
	for i in 50:
		if midi.out.port != "" and midi._hello_until == 0 and midi.note != "":
			break
		await tree.create_timer(0.2).timeout
	midi._hello()  # greet again now that the probe's three layers exist: every fader reports against them
	await tree.create_timer(2.5).timeout
	var report := []
	for k in midi.pick:
		report.append("%s hw %.3f live %s" % [k, midi.pick[k].hw, midi.pick[k].live])
	_shot(tab, dir, "real-01-report", "inputs %s, port %s, held elsewhere %s, note: %s, pickup: %s" % [midi.inputs.names,
		midi.out.port, midi.inputs.held_elsewhere(), midi.note, report])


static func _cc(tree: SceneTree, ch: int, num: int, val: int) -> void:
	var e := InputEventMIDI.new()
	e.message = MIDI_MESSAGE_CONTROL_CHANGE
	e.channel = ch
	e.controller_number = num
	e.controller_value = val
	Input.parse_input_event(e)
	await tree.create_timer(0.15).timeout


static func _note(tree: SceneTree, ch: int, num: int) -> void:
	for vel in [127, 0]:
		var e := InputEventMIDI.new()
		e.message = MIDI_MESSAGE_NOTE_ON
		e.channel = ch
		e.pitch = num
		e.velocity = vel
		Input.parse_input_event(e)
		await tree.create_timer(0.15).timeout
	await tree.create_timer(0.4).timeout


## A left click at the centre of `c`, in window coordinates (what the display server would send).
static func _click(tree: SceneTree, c: Control) -> void:
	var at: Vector2 = c.get_viewport().get_final_transform() * (c.get_global_transform_with_canvas() * (c.size * 0.5))
	var mv := InputEventMouseMotion.new()
	mv.position = at
	mv.global_position = at
	Input.parse_input_event(mv)
	await tree.process_frame
	for down in [true, false]:
		var mb := InputEventMouseButton.new()
		mb.button_index = MOUSE_BUTTON_LEFT
		mb.pressed = down
		mb.position = at
		mb.global_position = at
		Input.parse_input_event(mb)
		await tree.create_timer(0.1).timeout


static func _scroll_to(c: Control) -> void:
	var p := c.get_parent()
	while p != null and not p is ScrollContainer:
		p = p.get_parent()
	if p != null:
		(p as ScrollContainer).ensure_control_visible(c)


static func _shot(tab: Node, dir: String, name: String, what: String) -> void:
	var err: int = tab.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [dir, name])
	print("[probe-midi] %s (%s): %s" % [name, error_string(err), what])
