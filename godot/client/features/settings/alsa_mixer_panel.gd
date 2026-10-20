extends VBoxContainer
## WO-608 — ALSA hardware mixer under Settings → Live audio (web settings-alsa-mixer-panel.js): card + view pickers,
## a row per control (volume slider + mute, switch, or enum), Refresh, Launch alsamixer on :0.
## Slider moves post at most every 100 ms and once more on release (web debounceAlsaSet + change).

const NuclearGate := preload("res://app/nuclear_gate.gd")
const K := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/alsa_mixer_model.gd")
const SYSTEM := preload("res://features/settings/system_model.gd")

var _card := 0
var _picked := false
var _payload := {}
var _cards: OptionButton
var _view: OptionButton
var _status: Label
var _grid: GridContainer


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
	_grid = GridContainer.new()
	_grid.columns = 4
	_grid.add_theme_constant_override("h_separation", 12)
	add_child(_grid)


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
	for c in _grid.get_children():
		c.queue_free()
	var view: String = M.VIEWS[maxi(0, _view.selected)][0]
	var shown: Array = M.normalize(_payload).controls.filter(func(c: Dictionary) -> bool: return M.matches_view(c, view))
	if shown.is_empty() and not _payload.is_empty():
		_status.text = "No %s controls on this card." % view
	for c in shown:
		var name := Label.new()
		name.text = str(c.get("name", c.get("id", "Control")))
		if c.get("channels") is Array:
			name.tooltip_text = ", ".join(PackedStringArray(c.channels))
			name.mouse_filter = Control.MOUSE_FILTER_PASS
		name.custom_minimum_size.x = 200
		_grid.add_child(name)
		match M.kind(c):
			"enum": _enum_row(c)
			"bool": _bool_row(c)
			_: _volume_row(c)


func _volume_row(c: Dictionary) -> void:
	var mute := Button.new()
	mute.toggle_mode = true
	mute.button_pressed = c.get("muted", c.get("mute")) == true
	mute.text = "M" if mute.button_pressed else "—"
	mute.tooltip_text = "Mute"
	mute.custom_minimum_size.x = 36
	mute.toggled.connect(func(on: bool) -> void:
		mute.text = "M" if on else "—"
		_post(c, {"mute": on}))
	_grid.add_child(mute)
	var slider := HSlider.new()
	slider.min_value = 0
	slider.max_value = 100
	slider.step = 1
	slider.value = M.percent(c)
	slider.custom_minimum_size = Vector2(360, 24)
	_grid.add_child(slider)
	var val := Label.new()
	val.text = M.value_text(c, M.percent(c))
	_grid.add_child(val)
	var last := [0]
	slider.value_changed.connect(func(v: float) -> void:
		val.text = "%d%%" % int(v)
		var now := Time.get_ticks_msec()
		if now - last[0] >= 100:
			last[0] = now
			_post(c, {"percent": int(v)}))
	slider.drag_ended.connect(func(_changed: bool) -> void: _post(c, {"percent": int(slider.value)}))


func _bool_row(c: Dictionary) -> void:
	var chk := CheckBox.new()
	chk.button_pressed = M.switch_on(c)
	chk.text = "On" if chk.button_pressed else "Off"
	chk.toggled.connect(func(on: bool) -> void:
		chk.text = "On" if on else "Off"
		_post(c, {"value": 1 if on else 0}))
	_grid.add_child(chk)
	_grid.add_child(Control.new())
	_grid.add_child(Control.new())


func _enum_row(c: Dictionary) -> void:
	_grid.add_child(Control.new())
	var ob := OptionButton.new()
	var cur := str(c.get("item", c.get("value", "")))
	var items: Array = c.get("items") if c.get("items") is Array else []
	for it in items:
		var v := str(it.get("value", it.get("name", ""))) if it is Dictionary else str(it)
		ob.add_item(str(it.get("label", it.get("name", v))) if it is Dictionary else v)
		ob.set_item_metadata(ob.item_count - 1, v)
		if v == cur:
			ob.select(ob.item_count - 1)
	ob.item_selected.connect(func(i: int) -> void: _post(c, {"item": ob.get_item_metadata(i)}))
	_grid.add_child(ob)
	_grid.add_child(Control.new())


func _post(c: Dictionary, change: Dictionary) -> void:
	var r: Dictionary = await Api.post_json("/api/audio/alsa-mixer", M.body(_card, c, change))
	if not r.ok:
		_status.text = str(r.error)


func _launch() -> void:
	_status.text = "Launching alsamixer…"
	var res: Dictionary = await NuclearGate.post(self, "/api/system/gui-launch", {"action": "alsamixer"})
	var d: Dictionary = res.data if res.data is Dictionary else {}
	_status.text = SYSTEM.launch_note(d) if res.ok else str(d.get("error", res.error))
