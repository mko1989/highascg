extends VBoxContainer
## WO-608 — ALSA hardware mixer under Settings → Live audio (web settings-alsa-mixer-panel.js): card + view pickers,
## one vertical channel strip per control (name, volume fader + value + mute, or switch, or enum), Refresh, Launch
## alsamixer on :0. The strips wrap in a flow so many controls never push the width out.
## Slider moves post at most every 100 ms and once more on release (web debounceAlsaSet + change).

const NuclearGate := preload("res://app/nuclear_gate.gd")
const K := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/alsa_mixer_model.gd")
const SYSTEM := preload("res://features/settings/system_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const FaderCap := preload("res://features/audio/fader_cap.gd")
const STRIP_W := 48.0
const FADER_H := 110.0
const CAP_W := 26.0  # the 26 px fader cap (fader_cap.gd WIDTH)
const FONT_SIZE := 10  # name, value and mute text in a strip
const MUTE_W := 24.0
const STRIP_GAP := 6  # strip-to-strip gap (h and v)
const STRIP_PAD := 4  # inner padding of a strip panel

var _card := 0
var _picked := false
var _payload := {}
var _cards: OptionButton
var _view: OptionButton
var _status: Label
var _strips: HFlowContainer


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	K.heading(self, "ALSA mixer")
	K.note(self, "Hardware mixer for the sound card (like alsamixer in the terminal). Adjust capture gain before live "
		+ "inputs reach Caspar.")
	var bar := K.row(self)
	_cards = OptionButton.new()
	_cards.item_selected.connect(func(i: int) -> void:
		_picked = true
		_card = _cards.get_item_id(i)
		load_mixer(false))
	bar.add_child(_cards)
	_view = OptionButton.new()
	for v in M.VIEWS:
		_view.add_item(v[1])
	_view.item_selected.connect(func(_i: int) -> void: _render())
	bar.add_child(_view)
	K.button(bar, "Refresh", func() -> void: load_mixer(true))
	K.button(bar, "Launch alsamixer", _launch)
	_status = K.note(self, "")
	_strips = HFlowContainer.new()
	_strips.add_theme_constant_override("h_separation", STRIP_GAP)
	_strips.add_theme_constant_override("v_separation", STRIP_GAP)
	add_child(_strips)


func load_mixer(refresh: bool) -> void:
	_status.text = "Refreshing…" if refresh else "Loading…"
	var r: Dictionary = await Api.get_json("/api/audio/alsa-mixer?card=%d%s" % [_card, "&refresh=1" if refresh else ""])
	if not r.ok:
		_payload = {}
		_status.text = "Could not load ALSA mixer (%s). Use Launch alsamixer or run alsamixer on the host." % str(r.error)
		_render()
		return
	_payload = r.data if r.data is Dictionary else {}
	var n := M.normalize(_payload)
	_card = n.card
	if not _picked and n.suggested >= 0 and n.suggested != _card:
		_card = n.suggested
		await load_mixer(refresh)
		return
	_cards.clear()
	var list: Array = n.cards if not n.cards.is_empty() else [{"card": _card, "name": "Card %d" % _card}]
	for c in list:
		_cards.add_item("%s (%d)" % [c.name, c.card], c.card)
		if c.card == _card:
			_cards.select(_cards.item_count - 1)
	_render()
	_status.text = "%d control(s) on card %d." % [n.controls.size(), _card]


func _render() -> void:
	for c in _strips.get_children():
		c.queue_free()
	var view: String = M.VIEWS[maxi(0, _view.selected)][0]
	var shown: Array = M.normalize(_payload).controls.filter(func(c: Dictionary) -> bool: return M.matches_view(c, view))
	if shown.is_empty() and not _payload.is_empty():
		_status.text = "No %s controls on this card." % view
	for c in shown:
		var strip := PanelContainer.new()
		var box := ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1, 4)
		box.set_content_margin_all(STRIP_PAD)
		strip.add_theme_stylebox_override("panel", box)
		_strips.add_child(strip)
		var v := VBoxContainer.new()
		v.add_theme_constant_override("separation", STRIP_PAD)
		strip.add_child(v)
		var name := Label.new()
		name.text = str(c.get("name", c.get("id", "Control")))
		if c.get("channels") is Array:
			name.tooltip_text = ", ".join(PackedStringArray(c.channels))
			name.mouse_filter = Control.MOUSE_FILTER_PASS
		name.add_theme_font_size_override("font_size", FONT_SIZE)
		name.custom_minimum_size.x = STRIP_W
		name.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(name)
		match M.kind(c):
			"enum": _enum_strip(v, c)
			"bool": _bool_strip(v, c)
			_: _volume_strip(v, c)


## Volume column: vertical fader, value, then the mute toggle under it.
func _volume_strip(v: VBoxContainer, c: Dictionary) -> void:
	var slider := VSlider.new()
	slider.min_value = 0
	slider.max_value = 100
	slider.step = 1
	slider.value = M.percent(c)
	slider.custom_minimum_size = Vector2(CAP_W, FADER_H)
	slider.add_theme_icon_override("grabber", FaderCap.grabber())
	slider.add_theme_icon_override("grabber_highlight", FaderCap.grabber(true))
	slider.add_theme_stylebox_override("slider", FaderCap.track())
	slider.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(slider)
	var val := Label.new()
	val.text = M.value_text(c, M.percent(c))
	val.add_theme_font_size_override("font_size", FONT_SIZE)
	val.custom_minimum_size.x = STRIP_W
	val.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	val.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(val)
	var mute := Button.new()
	mute.toggle_mode = true
	mute.button_pressed = c.get("muted", c.get("mute")) == true
	mute.text = "M" if mute.button_pressed else "—"
	mute.tooltip_text = "Mute"
	mute.add_theme_font_size_override("font_size", FONT_SIZE)
	mute.custom_minimum_size.x = MUTE_W
	mute.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	mute.toggled.connect(func(on: bool) -> void:
		mute.text = "M" if on else "—"
		_post(c, {"mute": on}))
	v.add_child(mute)
	var last := [0]
	slider.value_changed.connect(func(f: float) -> void:
		val.text = "%d%%" % int(f)
		var now := Time.get_ticks_msec()
		if now - last[0] >= 100:
			last[0] = now
			_post(c, {"percent": int(f)}))
	slider.drag_ended.connect(func(_changed: bool) -> void: _post(c, {"percent": int(slider.value)}))


## Switch column: the check box is the whole control.
func _bool_strip(v: VBoxContainer, c: Dictionary) -> void:
	var chk := CheckBox.new()
	chk.button_pressed = M.switch_on(c)
	chk.text = "On" if chk.button_pressed else "Off"
	chk.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	chk.clip_text = true  # no minimum width from the text: the strip sets the width
	chk.add_theme_font_size_override("font_size", FONT_SIZE)
	chk.toggled.connect(func(on: bool) -> void:
		chk.text = "On" if on else "Off"
		_post(c, {"value": 1 if on else 0}))
	v.add_child(chk)


## Enum column: the drop-down sits under the name.
func _enum_strip(v: VBoxContainer, c: Dictionary) -> void:
	var ob := OptionButton.new()
	var cur := str(c.get("item", c.get("value", "")))
	var items: Array = c.get("items") if c.get("items") is Array else []
	for it in items:
		var val := str(it.get("value", it.get("name", ""))) if it is Dictionary else str(it)
		ob.add_item(str(it.get("label", it.get("name", val))) if it is Dictionary else val)
		ob.set_item_metadata(ob.item_count - 1, val)
		if val == cur:
			ob.select(ob.item_count - 1)
	ob.clip_text = true  # shrink to the strip width; long item names are clipped, not widened
	ob.fit_to_longest_item = false
	ob.add_theme_font_size_override("font_size", FONT_SIZE)
	ob.item_selected.connect(func(i: int) -> void: _post(c, {"item": ob.get_item_metadata(i)}))
	v.add_child(ob)


func _post(c: Dictionary, change: Dictionary) -> void:
	var r: Dictionary = await Api.post_json("/api/audio/alsa-mixer", M.body(_card, c, change))
	if not r.ok:
		_status.text = str(r.error)


func _launch() -> void:
	_status.text = "Launching alsamixer…"
	var res: Dictionary = await NuclearGate.post(self, "/api/system/gui-launch", {"action": "alsamixer"})
	var d: Dictionary = res.data if res.data is Dictionary else {}
	_status.text = SYSTEM.launch_note(d) if res.ok else str(d.get("error", res.error))
