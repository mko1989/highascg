extends VBoxContainer
## WO-604 — the Audio tab: the web's Audio Mixer Console (components/audio-mixer-view-console.js). Inputs bay on the
## left — "Live inputs" (dedicated DeckLink / live-audio / NDI channels) then one group per program channel with its
## look / timeline / live-audio / audio-only layer strips — and the PGM / PRV masters on the right with one meter per
## bus channel. Strips rebuild only when the strip list changes; values sync in place (never under a held fader).
## Console state (gains, mutes, solos) is the server's (GET /api/audio/mixer + `audioMixer` changes); look layers
## keep volume / muted on the look. Meters tick at 20 Hz while the tab is visible, from the shared OSC mirror.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const AM := preload("res://features/audio/audio_meter_model.gd")
const AA := preload("res://features/audio/audio_actions.gd")
const Strip := preload("res://features/audio/audio_strip.gd")
const DEBOUNCE_MS := 80
const EMPTY := "No active program inputs playing audio. Play a scene look with audio/video media to see channel strips here."

var osc: Node  # shell's OscMirror
var _mixer := {}
var _live_inputs: Variant = null
var _rows: Array = []
var _sig := ""
var _strips := {}  # key → Strip
var _metas := {}  # key → meter meta
var _smooth := {}  # meter key → smoothed 0…1
var _pending := {}  # key → [due_ms, gain]
var _tick_acc := 0.0
var _inputs: HBoxContainer
var _masters: HBoxContainer
var _status: Label


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var bays := HBoxContainer.new()
	bays.size_flags_vertical = Control.SIZE_EXPAND_FILL
	bays.add_theme_constant_override("separation", 8)
	add_child(bays)
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	bays.add_child(scroll)
	_inputs = HBoxContainer.new()
	_inputs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_inputs.add_theme_constant_override("separation", 10)
	scroll.add_child(_inputs)
	_masters = HBoxContainer.new()
	_masters.add_theme_constant_override("separation", 6)
	bays.add_child(_masters)
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	Store.changed.connect(_on_store)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _refresh())
	Settings.changed.connect(_refresh)
	Settings.loaded.connect(_refresh)
	visibility_changed.connect(_on_visible)
	_on_visible()


func _on_visible() -> void:
	if not is_visible_in_tree():
		return
	_refresh()
	var m: Dictionary = await Api.get_json("/api/audio/mixer")
	if m.ok and m.data is Dictionary:
		_mixer = m.data
	var li: Dictionary = await Api.get_json("/api/audio/live-inputs")
	if li.ok:
		_live_inputs = li.data
	_refresh()


func _on_store(path: String, value: Variant) -> void:
	if path == "audioMixer" and value is Dictionary:
		_mixer = value
	if path in ["*", "channelMap", "audioMixer", "timeline.playback"] or path.begins_with("scene"):
		_refresh()


func _state() -> Dictionary:
	var tl: Variant = Store.project.get("timelines")
	return {"channelMap": _d(Store.get_value("channelMap")), "live": _d(Store.get_value("scene.live")),
		"liveAudioOnly": _d(Store.get_value("scene.liveAudioOnly")), "playback": Store.get_value("timeline.playback"),
		"timelines": tl.get("timelines", []) if tl is Dictionary else [], "mixer": _mixer, "liveInputs": _live_inputs,
		"casparServer": _d(Settings.get_setting("casparServer", {}))}


static func _d(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


func _refresh() -> void:
	if not is_visible_in_tree():
		return
	var st := _state()
	var cm: Dictionary = st.channelMap
	_rows = AR.input_rows(cm, _mixer) + AR.program_rows(st)
	var sig := []
	for r in _rows:
		var bars := AR.bus_channel_count(Settings.settings, cm, r.ch) if r.get("isMaster", false) == true else 1
		sig.append([r.key, r.label, r.get("sceneId"), bars, r.get("liveAudioSlot")])
	var s := JSON.stringify(sig)
	if s != _sig:
		_sig = s
		_rebuild(cm)
	var solos: Array = _mixer.get("solos", []) if _mixer.get("solos") is Array else []
	for r in _rows:
		var strip: Strip = _strips.get(r.key)
		if strip == null:
			continue
		strip.row = r
		_metas[r.key] = AR.meter_meta(r)
		if not _pending.has(r.key):
			strip.set_gain(float(r.get("v", 1.0)))
		strip.set_muted(r.get("muted", false) == true)
		strip.set_solo(solos.has(r.key))


func _rebuild(cm: Dictionary) -> void:
	for c in _inputs.get_children() + _masters.get_children():
		c.get_parent().remove_child(c)
		c.queue_free()
	_strips.clear()
	_smooth.clear()
	_metas.clear()
	var progs: Array = cm.get("programChannels", []) if cm.get("programChannels") is Array and not cm.programChannels.is_empty() else [1]
	var live_inputs := _rows.filter(func(r: Dictionary) -> bool: return r.get("isLiveInput", false) == true)
	if not live_inputs.is_empty():
		_inputs.add_child(_group("Live inputs", live_inputs, cm))
	for i in progs.size():
		var list := _rows.filter(func(r: Dictionary) -> bool:
			return r.get("isMaster", false) != true and r.get("isLiveInput", false) != true and float(r.ch) == float(progs[i]))
		if not list.is_empty():
			_inputs.add_child(_group("PGM %d (ch %s) Inputs" % [i + 1, AR.R.s(progs[i])], list, cm))
	if _inputs.get_child_count() == 0:
		var e := Label.new()
		e.text = "🎚  " + EMPTY
		e.autowrap_mode = TextServer.AUTOWRAP_WORD
		e.custom_minimum_size.x = 420
		e.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_inputs.add_child(e)
	for r in _rows.filter(func(r: Dictionary) -> bool: return r.get("isMaster", false) == true):
		_masters.add_child(_strip(r, AR.bus_channel_count(Settings.settings, cm, r.ch), false))


func _group(title: String, rows: Array, _cm: Dictionary) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_DARK, ThemeBuilder.BORDER, 1, 6))
	var v := VBoxContainer.new()
	card.add_child(v)
	var h := Label.new()
	h.text = title
	h.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(h)
	var strips := HBoxContainer.new()
	strips.size_flags_vertical = Control.SIZE_EXPAND_FILL
	strips.add_theme_constant_override("separation", 4)
	v.add_child(strips)
	for r in rows:
		strips.add_child(_strip(r, 1, rows.size() > 4))
	return card


func _strip(r: Dictionary, bars: int, dense: bool) -> Strip:
	var s := Strip.new()
	s.setup(r, bars, dense)
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var key: String = r.key
	s.gain_changed.connect(func(g: float, final: bool) -> void: _on_gain(key, g, final))
	s.solo_pressed.connect(func(multi: bool) -> void: _on_solo(key, multi))
	s.mute_pressed.connect(func() -> void: _on_mute(key))
	_strips[key] = s
	_metas[key] = AR.meter_meta(r)
	return s


## Fader: the look's own layer takes the value (web patchLayer on change); the server gets a debounced write while
## the fader moves and an immediate one on release.
func _on_gain(key: String, g: float, final: bool) -> void:
	var s: Strip = _strips.get(key)
	if s == null:
		return
	var r: Dictionary = s.row
	if not AA.keyed(r):
		AA.patch_live_layer(Store.get_value("scene.live"), r.ch, r.layer, {"volume": g})
		if final and AA.patch_look_layer(Store.project, str(r.sceneId), r.layer, {"volume": g}):
			ProjectSync.deck_changed()
			ProjectSync.mark_dirty()
	if final:
		_pending.erase(key)
		_send(AA.volume_request(r, g))
	else:
		_pending[key] = [Time.get_ticks_msec() + DEBOUNCE_MS, g]


func _on_solo(key: String, multi: bool) -> void:
	var keys := AA.toggle_solo(_mixer.get("solos", []) if _mixer.get("solos") is Array else [], key, multi)
	for k in _strips:
		(_strips[k] as Strip).set_solo(keys.has(k))
	var res := await _send(AA.solo_request(keys))
	if not res.ok:
		_refresh()  # back to the server's set


func _on_mute(key: String) -> void:
	var s: Strip = _strips.get(key)
	if s == null:
		return
	var r: Dictionary = s.row
	var next := s.muted()
	if not AA.keyed(r):
		AA.patch_live_layer(Store.get_value("scene.live"), r.ch, r.layer, {"muted": next})
		if AA.patch_look_layer(Store.project, str(r.sceneId), r.layer, {"muted": next}):
			ProjectSync.deck_changed()
			ProjectSync.mark_dirty()
	_metas[key] = AR.meter_meta(r.merged({"muted": next}, true))
	_send(AA.mute_request(r, next, s.gain()))


func _send(req: Array) -> Dictionary:
	var res: Dictionary = await Api.post_json(req[1], req[2])
	_status.text = "" if res.ok else "%s failed: %s" % [req[1], res.get("error", res.get("status"))]
	return res


func _process(delta: float) -> void:
	if not is_visible_in_tree():
		return
	var now := Time.get_ticks_msec()
	for k in _pending.keys():
		if now >= _pending[k][0]:
			var s: Strip = _strips.get(k)
			var g: float = _pending[k][1]
			_pending.erase(k)
			if s:
				_send(AA.volume_request(s.row, g))
	_tick_acc += delta
	if _tick_acc < AM.TICK_S:
		return
	_tick_acc = 0.0
	var ctx := {"osc": osc.channels if osc else {}, "info": Store.get_value("channels"), "live": Store.get_value("scene.live"),
		"vars": Store.get_value("variables")}
	for key in _strips:
		var s: Strip = _strips[key]
		if s.row.get("isMaster", false) == true:  # one meter per program bus channel
			for i in s.meter.levels.size():
				_meter(ctx, "%s:bus:%d" % [key, i], {}, s, i)
		else:
			_meter(ctx, key, _metas.get(key, {}), s, 0)


func _meter(ctx: Dictionary, key: String, meta: Dictionary, s: Strip, bar: int) -> void:
	var r := AM.read_key(ctx, key, meta)
	var v := AM.smooth(_smooth.get(key, 0.0), r.level)
	_smooth[key] = v
	s.meter.set_bar(bar, v, AM.colour(r.level))
	if r.state != "":
		s.set_input_state(r.state)
