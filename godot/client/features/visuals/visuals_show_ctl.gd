extends Node
## WO-877 / WO-878 — the Visuals tab's show control: the looks (save, rename, delete, recall with the fade), the autopilot
## (picked looks on the beat, the next look every N bars / on drops), master and blackout, tap tempo (WO-879) and the show
## keys. Lives under the
## tab (visuals_tab.gd) and edits its slice; split out of it for the line limit.

const Looks := preload("res://features/visuals/visuals_looks.gd")
const Auto := preload("res://features/visuals/visuals_autopilot.gd")
const AUDIO_STALE_MS := 1000

var tab: Node
var looks := []
var showing := -1  # the look on the canvas
var _st := Auto.new_state()
var _beat: Variant = null  # the newest frame's beat grid and drop count
var _beat_at := -AUDIO_STALE_MS
var _drop_n := -1


func _init(t: Node) -> void:
	tab = t
	_wire(tab.page.show_panel)


## The slice was (re)loaded: its looks made safe, the panel's state, which look shows.
func from_slice() -> void:
	looks = Looks.normalize(tab.slice.looks)
	tab.slice.looks = looks
	tab.page.show_panel.set_state(tab.slice.fade, tab.mixer.level, tab.mixer.blackout, tab.slice.auto)
	showing = Looks.showing(looks, tab.slice)
	tab.page.show_panel.set_looks(looks, showing)


## An `audio_fft` WS frame: its beat grid and drop count.
func audio(d: Variant) -> void:
	_beat = d.get("beat") if d is Dictionary else null
	_beat_at = Time.get_ticks_msec()
	var drop: Variant = d.parts.get("drop") if d is Dictionary and d.get("parts") is Dictionary else null
	_drop_n = int(drop.get("n", -1)) if drop is Dictionary else -1


## One frame: the autopilot may recall a look.
func step(delta: float) -> void:
	var next := Auto.step(_st, tab.slice.auto, _live_beat(), _drop_n, delta * 1000.0, showing, looks.size())
	if next >= 0:
		recall(next)


func _wire(sp: Node) -> void:
	sp.recall.connect(pick)
	sp.auto_changed.connect(func(cfg: Dictionary) -> void:
		tab.slice.auto = Auto.cfg_of(cfg)
		status()
		tab._store())
	sp.save.connect(func(i: int) -> void:
		var l := Looks.capture(tab.slice, str(looks[i].name) if i >= 0 and i < looks.size() else "")
		if i >= 0 and i < looks.size():
			looks[i] = l
		elif looks.size() < Looks.MAX:
			looks.append(l)
		_looks_changed())
	sp.rename.connect(func(i: int, n: String) -> void:
		if i >= 0 and i < looks.size():
			looks[i].name = n.strip_edges().left(40) if n.strip_edges() != "" else Looks.auto_name(looks[i])
			_looks_changed())
	sp.remove.connect(func(i: int) -> void:
		if i >= 0 and i < looks.size():
			looks.remove_at(i)
			_looks_changed())
	sp.fade_changed.connect(func(v: float) -> void:
		tab.slice.fade = v
		tab._store())
	sp.level_changed.connect(func(v: float) -> void: tab.mixer.level = v)
	sp.blackout_toggled.connect(func(on: bool) -> void: tab.mixer.blackout = on)
	sp.tapped.connect(tap)


## WO-879: a tap (or `auto` = the music's beat again) to the node's beat clock — every consumer (these Visuals, the Caspar
## shaders, the autopilot) gets the tapped beat through the audio frames.
func tap(auto := false) -> void:
	var api: Variant = get_node_or_null("/root/Api")  # an autoload, named at runtime: the test runner compiles this without it
	if api == null:
		return
	var r: Dictionary = await api.post_json("/api/audio/tap", {"auto": true} if auto else {})
	if r.get("ok", false):
		tab.page.show_panel.set_tapped(bool(r.get("tap", false)))
	elif auto:
		tab.page.show_panel.set_tapped(false)


## WO-878: a look picked by hand (button, key): now, or on the next beat when "on the beat" is on and a tempo is locked.
func pick(i: int) -> void:
	if i < 0 or i >= looks.size():
		return
	if Auto.pick(_st, i, tab.slice.auto, _live_beat()):
		recall(i)
	else:
		tab.page.show_panel.set_looks(looks, i)
		status()


func _live_beat() -> Variant:
	return _beat if Time.get_ticks_msec() - _beat_at < AUDIO_STALE_MS else null


## WO-878: the tempo, a look waiting for its beat, and the bars until the next timed change.
func status() -> void:
	var b: Variant = _live_beat()
	var tapped: bool = b is Dictionary and b.get("tap", false)
	tab.page.show_panel.set_tapped(tapped)
	var parts := [("Tapped %d BPM" if tapped else "Tempo %d BPM") % roundi(float(b.bpm)) if Auto.locked(b)
		else "No tempo locked (120 BPM clock) — T taps one"]
	if _st.pending >= 0:
		parts.append("look %d on the next beat" % (_st.pending + 1))
	var left := Auto.bars_left(_st, tab.slice.auto)
	if left >= 0 and looks.size() > 1:
		parts.append("next look in %d bar%s" % [left, "" if left == 1 else "s"])
	tab.page.show_panel.set_auto_note(" · ".join(parts))


## WO-877: look `i` on stage with the fade (its scenes, shader, game, parameters and Flow).
func recall(i: int) -> void:
	if i < 0 or i >= looks.size():
		return
	showing = i
	tab.slice = Looks.apply(tab.slice, looks[i])
	tab.flow.set_graph(tab.slice.graph)
	tab.page.set_state(tab.slice, tab._cm())
	tab.page.show_panel.set_looks(looks, i)
	tab._store()
	tab._go(true)


func _looks_changed() -> void:
	tab.slice.looks = looks
	tab.page.show_panel.set_looks(looks, Looks.showing(looks, tab.slice))
	tab._store()


## Show keys while the Visuals are shown (text fields take their own keys first): 1–9 recall a look, Space bursts, B blackout,
## T taps the tempo.
func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo or not tab.is_visible_in_tree() or k.is_command_or_control_pressed() or k.alt_pressed:
		return
	var i := Looks.key_index(k.keycode)
	if i >= 0 and i < looks.size():
		pick(i)
	elif k.keycode == KEY_SPACE:
		tab.scene.fire()
	elif k.keycode == KEY_B:
		tab.mixer.blackout = not tab.mixer.blackout
		tab.page.show_panel.set_state(tab.slice.fade, tab.mixer.level, tab.mixer.blackout, tab.slice.auto)
	elif k.keycode == KEY_T:
		tap()
	else:
		return
	get_viewport().set_input_as_handled()
