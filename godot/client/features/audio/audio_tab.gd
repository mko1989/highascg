extends VBoxContainer
## WO-604 — the Audio tab: the web's Audio Mixer Console (components/audio-mixer-view-console.js). Inputs bay on the
## left — "Live inputs" (dedicated DeckLink / live-audio / NDI channels) then one group per program channel with its
## look / timeline / live-audio / audio-only layer strips — and the PGM / PRV masters on the right with one meter per
## bus channel. Strips rebuild only when the strip list changes; values sync in place (never under a held fader).
## Console state (gains, mutes, solos) is the server's (GET /api/audio/mixer + `audioMixer` changes); look layers
## keep volume / muted on the look. Meters tick at 20 Hz while the tab is visible, from the shared OSC mirror.
## WO-604 slice 3: live-input routing (Ch buttons, audio send, AUTO MIX, START) and audio-only STOP are server calls;
## the routing state is GET /api/audio/inputs/routing + the `audioInputRouting` change.
## Look strips' Screens row (cross-screen audio) is server-planned (POST /api/audio/cross-screen/plan, refetched on
## every strip rebuild) and toggled through POST /api/audio/cross-screen; the returned targets land on the look layer.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const AM := preload("res://features/audio/audio_meter_model.gd")
const AA := preload("res://features/audio/audio_actions.gd")
const Strip := preload("res://features/audio/audio_strip.gd")
const LL := preload("res://features/audio/layer_levels.gd")
const AlsaMixer := preload("res://features/settings/alsa_mixer_panel.gd")
const Split := preload("res://features/audio/audio_tab_split.gd")
const LiveInputDialog := preload("res://features/devices/live_input_dialog.gd")
const DEBOUNCE_MS := 80
const EMPTY := "No active program inputs playing audio. Play a scene look with audio/video media to see channel strips here."

signal inspect_destination(id: String)  ## a live-audio strip → its host-channel page in Devices
signal caspar_changed  ## a live input was added: Devices shows Apply + restart

var osc: Node  # shell's OscMirror
var _mixer := {}
var _live_inputs: Variant = null
var _routing := {}
var _xplan := {}  # cross-screen plan for the current strips
var _auto_mix: Button
var _rows: Array = []
var _sig := ""
var _strips := {}  # key → Strip
var _metas := {}  # key → meter meta
var _smooth := {}  # meter key → smoothed 0…1
var _pending := {}  # key → [due_ms, gain]
var _tick_acc := 0.0
var _layer_data := {}  # WO-800: last GET /api/osc/audio-layers (polled while visible)
var _poll_acc := 0.0
var _polling := false
var _inputs: HBoxContainer
var _masters: HBoxContainer
var _status: Label
var _add: LiveInputDialog
var _alsa: AlsaMixer  # WO-799: the ALSA hardware mixer, docked under the CasparCG mixer
var _alsa_loaded := false


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var bays := HBoxContainer.new()
	bays.size_flags_vertical = Control.SIZE_EXPAND_FILL
	bays.add_theme_constant_override("separation", 8)
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
	_alsa = AlsaMixer.new()  # WO-799: bottom pane; the panel loads its card on the first show (_on_visible)
	add_child(Split.dock(bays, _alsa))
	var foot := HBoxContainer.new()
	add_child(foot)
	_status = Label.new()
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	foot.add_child(_status)
	_add = LiveInputDialog.new()
	add_child(_add)
	_add.dirty.connect(caspar_changed.emit)
	_add.added.connect(_on_visible)
	var plus := Button.new()
	plus.text = "+ Live audio input"
	plus.tooltip_text = "Add a live audio (ALSA / USB) input. Its device and routing: Settings → Live audio; remove it from its strip."
	plus.pressed.connect(func() -> void: _add.open("live_audio"))
	foot.add_child(plus)
	Store.changed.connect(_on_store)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _refresh())
	Settings.changed.connect(_refresh)
	Settings.loaded.connect(_refresh)
	visibility_changed.connect(_on_visible)
	_on_visible()


func _on_visible() -> void:
	if not is_visible_in_tree():
		_layer_data = {}  # never show a level from before the tab was hidden
		return
	if not _alsa_loaded:  # WO-799: first show only; later refreshes are the panel's own Refresh button
		_alsa_loaded = true
		_alsa.load_mixer(false)
	_refresh()
	var m: Dictionary = await Api.get_json("/api/audio/mixer")
	if m.ok and m.data is Dictionary:
		_mixer = m.data
	var li: Dictionary = await Api.get_json("/api/audio/live-inputs")
	if li.ok:
		_live_inputs = li.data
	var ro: Dictionary = await Api.get_json("/api/audio/inputs/routing")
	if ro.ok and ro.data is Dictionary:
		_routing = ro.data
	_refresh()


func _on_store(path: String, value: Variant) -> void:
	if path == "audioMixer" and value is Dictionary:
		_mixer = value
	if path == "audioInputRouting" and value is Dictionary:
		_routing = value
	if path in ["*", "channelMap", "audioMixer", "audioInputRouting", "timeline.playback"] or path.begins_with("scene"):
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
	var sig := [_programs(cm)]
	for r in _rows:
		var bars := AR.bus_channel_count(Settings.settings, cm, r.ch) if r.get("isMaster", false) == true else 1
		sig.append([r.key, r.label, r.get("sceneId"), bars, r.get("liveAudioSlot")])
	var s := JSON.stringify(sig)
	if s != _sig:
		_sig = s
		_rebuild(cm)
		_fetch_plan()
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
		strip.set_routing(AA.routing_entry(_routing, r))
		strip.set_screens(AA.cross_screen_buttons(_xplan, r), AA.cross_screen_targets(r))
	if _auto_mix:
		_auto_mix.set_pressed_no_signal(_routing.get("autoMix", true) != false)


func _rebuild(cm: Dictionary) -> void:
	for c in _inputs.get_children() + _masters.get_children():
		c.get_parent().remove_child(c)
		c.queue_free()
	_strips.clear()
	_smooth.clear()
	_metas.clear()
	var progs := _programs(cm)
	_auto_mix = null
	var live_inputs := _rows.filter(func(r: Dictionary) -> bool: return r.get("isLiveInput", false) == true)
	if not live_inputs.is_empty():
		var g := _group("Live inputs", live_inputs, cm)
		_auto_mix = _auto_mix_button()
		g.get_child(0).get_child(0).add_child(_auto_mix)
		_inputs.add_child(g)
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


static func _programs(cm: Dictionary) -> Array:
	return cm.get("programChannels", []) if cm.get("programChannels") is Array and not cm.programChannels.is_empty() else [1]


## Mixer-wide audio-follows-video at TAKE time; deliberately not retroactive (the next take applies it).
func _auto_mix_button() -> Button:
	var b := Button.new()
	b.text = "AUTO MIX"
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 11)
	b.tooltip_text = "ON: takes bring AFV inputs' audio with the video. OFF: takes bring live inputs in silent — mix with the strips. Applies from the next take."
	b.add_theme_stylebox_override("pressed", ThemeBuilder.box(ThemeBuilder.ACCENT.darkened(0.35), ThemeBuilder.ACCENT, 1, 4))
	b.pressed.connect(func() -> void:
		var res := await _send(AA.auto_mix_request(b.button_pressed))
		_status.text = ("Auto mix %s — applies from the next take." % ("ON" if b.button_pressed else "OFF")) if res.ok else _status.text)
	return b


func _group(title: String, rows: Array, cm: Dictionary) -> Control:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_DARK, ThemeBuilder.BORDER, 1, 6))
	var v := VBoxContainer.new()
	card.add_child(v)
	var h := Label.new()
	h.text = title
	h.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var head := HBoxContainer.new()  # the title, then any group-wide control (Live inputs: AUTO MIX)
	head.add_child(h)
	v.add_child(head)
	var strips := HBoxContainer.new()
	strips.size_flags_vertical = Control.SIZE_EXPAND_FILL
	strips.add_theme_constant_override("separation", 4)
	v.add_child(strips)
	for r in rows:
		strips.add_child(_strip(r, 1, rows.size() > 4, _programs(cm)))
	return card


func _strip(r: Dictionary, bars: int, dense: bool, programs: Array = []) -> Strip:
	var s := Strip.new()
	s.setup(r, bars, dense, programs)
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var key: String = r.key
	s.gain_changed.connect(func(g: float, final: bool) -> void: _on_gain(key, g, final))
	s.solo_pressed.connect(func(multi: bool) -> void: _on_solo(key, multi))
	s.mute_pressed.connect(func() -> void: _on_mute(key))
	s.route_toggled.connect(func(ch: int, on: bool) -> void: _after(await _send(AA.route_request(s.row, ch, on))))
	s.screen_toggled.connect(func(ch: int, on: bool) -> void: _on_screen(key, ch, on))
	s.send_selected.connect(func(send: String) -> void: _after(await _send(AA.send_request(s.row, send))))
	s.start_pressed.connect(func() -> void:
		var res := await _send(AA.start_request(s.row))
		if res.ok:
			_status.text = "%s capture started (%d route(s) restored)." % [str(s.row.label), int(_d(res.get("data")).get("routesRestored", 0))])
	s.stop_pressed.connect(func() -> void: _send(AA.audio_only_stop_request(s.row)))
	s.inspect_requested.connect(func() -> void: inspect_destination.emit(
		AR.HC.destination_id("live_audio_input", s.row.get("hostChannel", s.row.ch), AA.inspect_slot(s.row))))
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


func _fetch_plan() -> void:
	var req := AA.cross_screen_plan_request(_rows)
	if (req[2].sources as Array).is_empty():
		_xplan = {}
		return
	var res: Dictionary = await Api.post_json(req[1], req[2])
	_xplan = _d(res.get("data")) if res.ok else {}
	_refresh()


## A Screens toggle: on success the server's target list becomes the look layer's audioScreens (web patchLayer).
func _on_screen(key: String, ch: int, on: bool) -> void:
	var s: Strip = _strips.get(key)
	if s == null:
		return
	var r: Dictionary = s.row
	var res := await _send(AA.cross_screen_request(r, ch, on))
	if res.ok:
		var targets: Array = _d(res.get("data")).get("targets", [])
		AA.patch_live_layer(Store.get_value("scene.live"), r.ch, r.layer, {"audioScreens": targets})
		if AA.patch_look_layer(Store.project, str(r.sceneId), r.layer, {"audioScreens": targets}):
			ProjectSync.deck_changed()
			ProjectSync.mark_dirty()
		r.audioScreens = targets
	elif str(_d(res.get("data")).get("reasonText", "")) != "":
		_status.text = str(res.data.reasonText)
	_refresh()


## A refused routing call puts the toggles back on the server's state.
func _after(res: Dictionary) -> void:
	if not res.ok:
		_refresh()


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
	_poll_acc += delta
	if _poll_acc >= LL.POLL_S and not _polling:
		_poll_acc = 0.0
		_poll_layers()
	_tick_acc += delta
	if _tick_acc < AM.TICK_S:
		return
	_tick_acc = 0.0
	var ctx := {"osc": osc.channels if osc else {}, "info": Store.get_value("channels"), "live": Store.get_value("scene.live"),
		"vars": Store.get_value("variables")}
	var banks: Variant = Store.get_value("scene.programLayerBankByChannel")
	for key in _strips:
		var s: Strip = _strips[key]
		if s.row.get("isMaster", false) == true:  # one meter per program bus channel
			for i in s.meter.levels.size():
				_meter(ctx, "%s:bus:%d" % [key, i], {}, s, i)
		else:
			_meter(ctx, key, _metas.get(key, {}), s, 0)
			if s.meter.lane_on:
				_lane(key, s, banks)


func _meter(ctx: Dictionary, key: String, meta: Dictionary, s: Strip, bar: int) -> void:
	var r := AM.read_key(ctx, key, meta)
	var v := AM.smooth(_smooth.get(key, 0.0), r.level)
	_smooth[key] = v
	s.meter.set_bar(bar, v, AM.colour(r.level))
	if r.state != "":
		s.set_input_state(r.state)


## WO-800: the layer's own level in the strip's thin lane (same smoothing / colours as the bars; nothing when silent-absent).
func _lane(key: String, s: Strip, banks: Variant) -> void:
	var lk := key + ":lane"
	var t := LL.lane_tick(_smooth.get(lk, 0.0), LL.read(_layer_data, s.row, banks))
	if t[0] < 0.0:
		_smooth.erase(lk)
	else:
		_smooth[lk] = t[0]
	s.meter.set_lane(t[0], t[1])


## One request at a time; a failed read clears the lanes rather than freezing them.
func _poll_layers() -> void:
	if not _strips.values().any(func(s: Strip) -> bool: return s.meter.lane_on):
		_layer_data = {}
		return
	_polling = true
	var res: Dictionary = await Api.get_json(LL.PATH)
	_polling = false
	_layer_data = res.data if res.ok and res.get("data") is Dictionary and is_visible_in_tree() else {}
