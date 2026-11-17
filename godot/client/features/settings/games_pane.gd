extends VBoxContainer
## WO-1105 — Settings ▸ Games (owner 16.11: "the game hosting and game world hosting should be a global setting from
## settings. with a show qr etc."): the one place to host the browser games and the Game World from the operator
## client. Its own pane, not a System fold: it is used live during an event (pause everything, start a round, show the
## join code), not set once. One GET /api/games/hosting when shown + the WS `games:hosting` broadcast (the server
## looks once a second, so a change on a game's web host page shows here too); every press is one POST of the same
## route, which calls the game's own host function. Exotic options stay on each game's web host page ("Open host page").

const M := preload("res://features/settings/games_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const Row := preload("res://features/settings/games_row.gd")
const Q := preload("res://features/settings/games_qr.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const HOUSE_DEBOUNCE_S := 0.25

var state: Dictionary = {}
var _summary: Label
var _msg: Label
var _safe: Button
var _lights: CheckBox
var _wall: CheckBox
var _house: HSlider
var _house_val: Label
var _house_post: Timer  # WO-1106 A10: wheel / arrow keys / drag all post, once the value rests
var _house_want := 1.0
var _join: Label
var _join_qr: Button
var _warn: Label
var _rows: VBoxContainer
var _by_id: Dictionary = {}  # id → games_row
var _addr: OptionButton
var _addr_items: Array = []
var _auto: CheckBox
var _self: CheckBox
var _quiet := false
var _busy := 0


func _ready() -> void:
	add_theme_constant_override("separation", 10)
	Kit.heading(self, "Games")
	Kit.note(self, "Host the browser games and the Game World. Guests join on their phones; a game never reaches a "
		+ "screen by itself — the join card goes to PREVIEW only when you send it, and you TAKE it like any look.")
	_summary = Kit.note(self, "Loading…")
	_safe = Button.new()
	_safe.toggle_mode = true
	_safe.text = "PAUSE EVERYTHING — presenter safe"
	_safe.tooltip_text = "Pauses every open game at once (and the Game World's effects). Press again to resume."
	_safe.custom_minimum_size = Vector2(420, 48)
	_safe.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_safe.add_theme_font_size_override("font_size", 20)
	_safe.toggled.connect(func(on: bool) -> void: _post(M.body_global("safe", on)))
	add_child(_safe)
	var g := Kit.row(self)
	_lights = _check(g, "Live lights in the games", "lights")
	_wall = _check(g, "LED wall pictures", "wall")
	var hl := Label.new()
	hl.text = "House lights"
	g.add_child(hl)
	_house = HSlider.new()
	_house.min_value = 0
	_house.max_value = 100
	_house.step = 5
	_house.custom_minimum_size.x = 180
	_house.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_house_post = Timer.new()
	_house_post.one_shot = true
	_house_post.wait_time = HOUSE_DEBOUNCE_S
	_house_post.timeout.connect(func() -> void: _post(M.body_global("house", _house_want)))
	add_child(_house_post)
	_house.value_changed.connect(func(v: float) -> void:
		_house_val.text = "%d %%" % int(v)
		if not _quiet:
			_house_want = v / 100.0  # kept: a broadcast landing before the timer must not post the old value back
			_house_post.start())
	g.add_child(_house)
	_house_val = Label.new()
	g.add_child(_house_val)
	var j := Kit.row(self)
	_join = Label.new()
	j.add_child(_join)
	_join_qr = Kit.button(j, "Show QR", func() -> void: Q.open(self, _join_row()))
	_warn = Kit.note(self, "")
	_warn.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_msg = Kit.note(self, "")
	_rows = VBoxContainer.new()
	_rows.add_theme_constant_override("separation", 10)
	add_child(_rows)
	var box := Kit.fold(self, "Box defaults")
	var ar := Kit.row(box)
	var al := Label.new()
	al.text = "Join address"
	al.custom_minimum_size.x = 160
	ar.add_child(al)
	_addr = OptionButton.new()
	_addr.item_selected.connect(func(i: int) -> void:
		if not _quiet and i < _addr_items.size():
			Settings.patch({"games": {"joinAddress": str(_addr_items[i][0])}}))
	ar.add_child(_addr)
	# WO-1106 A31 (partial): the pick reaches only this pane's join code; the games' host pages build their own list
	Kit.note(box, "This choice sets the join code and QR shown here. The games' own host pages list every address of this box.")
	_auto = CheckBox.new()
	_auto.text = "Open the game sessions when the server starts (lobby only, never a round)"
	_auto.toggled.connect(func(on: bool) -> void:
		if not _quiet:
			Settings.patch({"games": {"autoOpen": on}}))
	box.add_child(_auto)
	# WO-1125: no host needed — lobbies stay open, players set bots and start rounds themselves
	_self = CheckBox.new()
	_self.text = "Players run the games (lobbies stay open; anyone seated can add bots and start a round)"
	_self.toggled.connect(func(on: bool) -> void:
		if not _quiet:
			Settings.patch({"games": {"selfService": on}}))
	box.add_child(_self)
	Kit.note(box, "Which games are on this box is remembered by their module switch. The defaults of each game are in its "
		+ "\"More\" fold; they apply when a session is opened here. The host pages need the API password like this client.")
	Ws.on("games:hosting", func(d: Variant) -> void:
		if d is Dictionary:
			show_state(d))
	Ws.connected.connect(func() -> void:
		if is_visible_in_tree():
			refresh())
	Settings.changed.connect(func() -> void:
		if not state.is_empty():
			show_state(state))
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func _check(parent: Node, text: String, action: String) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.toggled.connect(func(on: bool) -> void: _post(M.body_global(action, on)))
	parent.add_child(c)
	return c


func refresh() -> void:
	var r: Dictionary = await Api.get_json(M.PATH)
	if r.ok and r.data is Dictionary:
		show_state(r.data)
	else:
		_summary.text = "Game hosting state unavailable: %s" % M.error_text(r)


func _post(body: Dictionary) -> void:
	if _quiet:
		return
	_busy += 1
	_msg.text = ""
	var r: Dictionary = await Api.post_json(M.PATH, body)
	_busy -= 1
	if r.data is Dictionary and (r.data as Dictionary).get("state") is Dictionary:
		show_state(r.data.state)
	if not r.ok:
		_msg.text = M.error_text(r)
		_msg.add_theme_color_override("font_color", ThemeBuilder.ERROR)


## The world row while its module is on, else the first open game: the one address to show first.
func _join_row() -> Dictionary:
	var w: Variant = state.get("world")
	if w is Dictionary and (w as Dictionary).get("joinUrl") is String:
		return w
	for g in state.get("games", []):
		if g is Dictionary and g.get("open") == true:
			return g
	return {}


func show_state(st: Dictionary) -> void:
	state = st
	_quiet = true
	_summary.text = M.global_text(st)
	var gl: Dictionary = st.get("global", {}) if st.get("global") is Dictionary else {}
	_safe.set_pressed_no_signal(gl.get("safe") == true)
	for k in ["font_color", "font_pressed_color", "font_hover_pressed_color", "font_hover_color", "font_focus_color"]:
		_safe.add_theme_color_override(k, ThemeBuilder.ERROR if gl.get("safe") == true else ThemeBuilder.TEXT)
	_safe.text = "PAUSED — press to resume" if gl.get("safe") == true else "PAUSE EVERYTHING — presenter safe"
	var any_open := int(gl.get("open", 0)) > 0
	_safe.disabled = not any_open and gl.get("safe") != true
	for c in [_lights, _wall]:
		(c as CheckBox).disabled = not any_open
	_lights.set_pressed_no_signal(gl.get("lights") == true)
	_wall.set_pressed_no_signal(gl.get("wall") == true)
	_house.editable = any_open
	_house.set_value_no_signal(roundf(float(gl.get("house", 1.0)) * 100.0))
	_house_val.text = "%d %%" % int(_house.value)
	var ji := M.join_info(st)
	_join.text = ji.text + ((" · " + ji.url) if ji.url != "" else "")
	_join_qr.disabled = ji.url == ""
	_warn.text = ji.warn
	_warn.visible = ji.warn != ""
	var order: Array = []
	if st.get("world") is Dictionary:
		order.append([st.world, true])
	for g in st.get("games", []):
		if g is Dictionary:
			order.append([g, false])
	var defaults: Dictionary = {}
	var gs: Variant = Settings.get_setting("games", {})
	if gs is Dictionary and (gs as Dictionary).get("defaults") is Dictionary:
		defaults = gs.defaults
	for pair in order:
		var row: Dictionary = pair[0]
		var gid := str(row.get("id", ""))
		if not _by_id.has(gid):
			var r := Row.new(gid, pair[1], _post)
			_rows.add_child(r)
			_by_id[gid] = r
		(_by_id[gid] as Row).show_state(row, defaults.get(gid, {}) if defaults.get(gid) is Dictionary else {})
	for gid in M.gone_ids(_by_id.keys(), st):  # WO-1106 A28: an uninstalled game's row goes (frozen, its buttons 404)
		(_by_id[gid] as Node).queue_free()
		_by_id.erase(gid)
	var items := M.address_items(st)
	if items != _addr_items:  # rebuilt only when the box's addresses changed (an open list stays open)
		_addr_items = items
		_addr.clear()
		for it in items:
			_addr.add_item(str(it[1]))
	var want := str(Settings.get_setting("games.joinAddress", ""))
	for i in _addr_items.size():
		if str(_addr_items[i][0]) == want:
			_addr.select(i)
	_auto.set_pressed_no_signal(Settings.get_setting("games.autoOpen", false) == true)
	_self.set_pressed_no_signal(Settings.get_setting("games.selfService", true) == true)
	_quiet = false
