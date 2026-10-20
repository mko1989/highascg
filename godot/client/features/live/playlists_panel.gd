extends VBoxContainer
## WO-603 — Playlists footer (web playlist-control-panel.js, owner 26.07 "similar to timers and audio mixer compact"),
## collapsible at the bottom of the Inspector on every tab. A list of every playlist in the looks (live ones first,
## GET /api/playlist/state, polled every 2 s while open), its items (picking one = goto when live, else the start
## item, WO-347), ⏮ ▶ ⏭ (POST /api/playlist/control) and "Set all" for timeless items — planned in node
## (action set_timeless), the client only stores the returned playlist on the look.

const M := preload("res://features/live/playlists_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const UI_CFG := "user://ui.cfg"
const POLL_S := 2.0

var playlists: Array = []
var _sel_key := ""
var _applied := {}  # key → secs set here, shown until the server reports it (the look store lags the deck sync)
var _toggle: Button
var _count: Label
var _content: VBoxContainer
var _list: OptionButton
var _items: OptionButton
var _secs: SpinBox
var _set_all: Button
var _btn := {}
var _status: Label
var _status_key := ""  # the playlist the status line is about — it clears when that one is no longer shown
var _poll: Timer


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var head := HBoxContainer.new()
	_toggle = Button.new()
	_toggle.flat = true
	_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_toggle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_toggle.pressed.connect(func() -> void: set_open(not _content.visible))
	head.add_child(_toggle)
	_count = Label.new()
	_count.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	head.add_child(_count)
	add_child(head)
	_content = VBoxContainer.new()
	add_child(_content)
	_list = OptionButton.new()
	_list.tooltip_text = "Playlists in the looks (look · layer · channel) — ● playing on program"
	_list.fit_to_longest_item = false
	_list.item_selected.connect(func(i: int) -> void:
		_sel_key = str(_list.get_item_metadata(i))
		_render())
	_content.add_child(_list)
	_items = OptionButton.new()
	_items.tooltip_text = "Items — selecting one jumps to it (live) or sets where playout starts (not live)"
	_items.fit_to_longest_item = false
	_items.item_selected.connect(_on_item)
	_content.add_child(_items)
	var tl := HBoxContainer.new()
	var l := Label.new()
	l.text = "Timeless (s)"
	l.tooltip_text = "Graphics, templates and shaders have no length of their own — they advance after this many seconds"
	tl.add_child(l)
	_secs = SpinBox.new()
	_secs.min_value = 1
	_secs.max_value = 86400
	_secs.step = 1
	_secs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tl.add_child(_secs)
	_set_all = Button.new()
	_set_all.text = "Set all"
	_set_all.tooltip_text = "Set the duration of every image / template / shader item in this playlist"
	_set_all.pressed.connect(_on_set_all)
	tl.add_child(_set_all)
	_content.add_child(tl)
	var tr := HBoxContainer.new()
	tr.alignment = BoxContainer.ALIGNMENT_CENTER
	for spec in [["prev", "prev", "Previous item"], ["play", "play", "Restage the selected item (live playlists)"], ["next", "next", "Next item"]]:
		var b := Icons.button(spec[1], spec[2])
		b.custom_minimum_size = Vector2(48, 0)
		var id: String = spec[0]
		b.pressed.connect(func() -> void: _on_transport(id))
		tr.add_child(b)
		_btn[id] = b
	_content.add_child(tr)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size.x = 200
	_status.visible = false
	_content.add_child(_status)
	_poll = Timer.new()
	_poll.wait_time = POLL_S
	_poll.timeout.connect(refresh)
	add_child(_poll)
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	set_open(bool(cfg.get_value("playlists", "open", false)), false)


func set_open(open: bool, save := true) -> void:
	_content.visible = open
	_toggle.text = ("▾ " if open else "▸ ") + "Playlists"
	if open:
		_poll.start()
		refresh()
	else:
		_poll.stop()
	if save:
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		cfg.set_value("playlists", "open", open)
		cfg.save(UI_CFG)


func refresh() -> void:
	var res: Dictionary = await Api.get_json("/api/playlist/state")
	var d: Variant = res.get("data")
	playlists = (d as Dictionary).get("playlists", []) if res.get("ok", false) and d is Dictionary else []
	_render()


func selected() -> Dictionary:
	for p in playlists:
		if p is Dictionary and M.key_of(p) == _sel_key:
			return p
	return {}


func _render() -> void:
	_count.text = str(playlists.size()) if not playlists.is_empty() else ""
	if selected().is_empty() and not playlists.is_empty():
		_sel_key = M.key_of(playlists[0])
	_list.clear()
	_items.clear()
	if playlists.is_empty():
		_list.add_item("— no playlists in the looks —")
		_list.disabled = true
	else:
		_list.disabled = false
		for p in playlists:
			_list.add_item(M.list_label(p))
			_list.set_item_metadata(_list.item_count - 1, M.key_of(p))
			if M.key_of(p) == _sel_key:
				_list.select(_list.item_count - 1)
	var p := selected()
	if _status.visible and (p.is_empty() or M.key_of(p) != _status_key):
		_say("", true)
	var items: Array = p.get("items", [])
	for i in items.size():
		_items.add_item(M.item_label(p, items[i], i))
	if not items.is_empty():
		_items.select(clampi(M.current_index(p), 0, items.size() - 1))
	_items.disabled = items.is_empty()
	(_btn.prev as Button).disabled = p.is_empty()
	(_btn.next as Button).disabled = p.is_empty()
	(_btn.play as Button).disabled = not p.get("live", false)  # ▶ restage only means something while live
	_set_all.disabled = p.is_empty()
	if not _secs.get_line_edit().has_focus():  # never clobber the field while the operator types
		var server_secs := float(p.get("timelessSecs", 20))
		var key := M.key_of(p) if not p.is_empty() else ""
		if _applied.has(key) and is_equal_approx(float(_applied[key]), server_secs):
			_applied.erase(key)
		_secs.set_value_no_signal(float(_applied.get(key, server_secs)))


func _on_item(i: int) -> void:
	var p := selected()
	if p.is_empty():
		return
	await _post(M.pick_body(p, i))


func _on_transport(id: String) -> void:
	var p := selected()
	if p.is_empty():
		return
	if id == "play":
		await _post(M.pick_body(p, maxi(_items.selected, 0)))
	else:
		await _post(M.step_body(p, id))


func _on_set_all() -> void:
	var p := selected()
	if p.is_empty():
		return
	var res: Dictionary = await _post(M.timeless_body(p, _secs.value))
	var d: Variant = res.get("data")
	if not (res.get("ok", false) and d is Dictionary and d.get("playlist") is Array):
		return
	if int(d.get("touched", 0)) == 0:
		_say("No timeless items in this playlist", false)
		return
	if M.store_playlist(Store.project, str(p.sceneId), int(p.layerNumber), d.playlist):
		ProjectSync.deck_changed()
		ProjectSync.mark_dirty()
	_applied[M.key_of(p)] = float(d.get("secs", _secs.value))
	_say("✓ %d timeless item%s → %ss" % [int(d.touched), "" if int(d.touched) == 1 else "s", M._num(d.get("secs", _secs.value))], true)
	_render()


func _post(body: Dictionary) -> Dictionary:
	var res: Dictionary = await Api.post_json("/api/playlist/control", body)
	if not res.get("ok", false):
		var d: Variant = res.get("data")
		_say("✗ %s" % (str((d as Dictionary).get("error", res.get("error", "failed"))) if d is Dictionary else str(res.get("error", "failed"))), false)
	elif str(body.get("action", "")) != "set_timeless":
		_say("", true)
	await refresh()
	return res


func _say(text: String, ok: bool) -> void:
	_status_key = M.key_of(selected()) if not selected().is_empty() else ""
	_status.text = text
	_status.visible = text != ""
	_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)
