extends VBoxContainer
## WO-1105 — one row of Settings ▸ Games: a game (module, session, state, Start / Stop, bots, Show QR) with a fold for
## the rest (its main number, bot level, "others can affect it", host / spectator pages, the box's defaults), or the
## Game World (module, state, Show QR, pages). Built once per id and updated in place from the server state (a rebuild
## under the pointer eats the click). Every press is one POST /api/games/hosting through `post` (the pane's).

const M := preload("res://features/settings/games_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const Q := preload("res://features/settings/games_qr.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var id := ""
var world := false
var post: Callable  # (body: Dictionary) -> void
var data: Dictionary = {}

var _title: Label
var _module: CheckBox
var _session: Button
var _status: Label
var _start: Button
var _stop: Button
var _bots: SpinBox
var _qr: Button
var _main_row: HBoxContainer
var _main_label: Label
var _main: SpinBox
var _level: OptionButton
var _affect: OptionButton
var _affect_row: HBoxContainer
var _defaults: VBoxContainer
var _levels: Array = []
var _quiet := false  # show_state(): a bound or value set by the state never posts back


func _init(p_id: String, p_world: bool, p_post: Callable) -> void:
	id = p_id
	world = p_world
	post = p_post
	add_theme_constant_override("separation", 4)


func _ready() -> void:
	var line := Kit.row(self)
	_title = Label.new()
	_title.custom_minimum_size.x = 190
	_title.add_theme_font_size_override("font_size", 16)
	line.add_child(_title)
	_module = CheckBox.new()
	_module.text = "On this box"
	_module.tooltip_text = "The module: off unloads the game (and ends its session). Remembered across restarts."
	_module.toggled.connect(func(on: bool) -> void: _post(M.body_module(id, on)))
	line.add_child(_module)
	if not world:
		_session = Kit.button(line, "Open session", func() -> void: _post(M.body_session(id, data.get("open") != true)))
		_session.custom_minimum_size.x = 130
	_status = Label.new()
	_status.custom_minimum_size.x = 250
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	line.add_child(_status)
	if not world:
		_start = Kit.button(line, "Start", func() -> void: _post(M.body_start(id, true)))
		_stop = Kit.button(line, "Stop", func() -> void: _post(M.body_start(id, false)))
		var bl := Label.new()
		bl.text = "Bots"
		line.add_child(bl)
		_bots = SpinBox.new()
		_bots.rounded = true
		_bots.value_changed.connect(func(v: float) -> void: _post(M.body_bots(id, int(v))))
		line.add_child(_bots)
	_qr = Kit.button(line, "Show QR", func() -> void: Q.open(self, data))
	var more := Kit.fold(self, "More", false)
	more.add_theme_constant_override("separation", 6)
	if not world:
		_main_row = Kit.row(more)
		_main_label = Label.new()
		_main_label.custom_minimum_size.x = 120
		_main_row.add_child(_main_label)
		_main = SpinBox.new()
		_main.rounded = true
		_main.value_changed.connect(func(v: float) -> void: _post(M.body_main(id, int(v))))
		_main_row.add_child(_main)
		var ll := Label.new()
		ll.text = "Bot level"
		_main_row.add_child(ll)
		_level = OptionButton.new()
		_level.item_selected.connect(func(i: int) -> void:
			if i < _levels.size():
				_post(M.body_bots(id, int(_bots.value), str(_levels[i]))))
		_main_row.add_child(_level)
		_affect_row = Kit.row(more)
		var al := Label.new()
		al.text = "In the Game World"
		al.custom_minimum_size.x = 120
		_affect_row.add_child(al)
		_affect = OptionButton.new()
		for a in M.AFFECT:
			_affect.add_item(str(a[1]))
		_affect.item_selected.connect(func(i: int) -> void: _post(M.body_affect(id, str(M.AFFECT[i][0]))))
		_affect_row.add_child(_affect)
	var pages := Kit.row(more)
	Kit.button(pages, "Open host page", func() -> void: _open("host"))
	Kit.button(pages, "Open spectator", func() -> void: _open("spectate"))
	var src := Kit.button(pages, "Spectator as a live source", _add_spectator)
	src.tooltip_text = ("Adds the spectator page as a web-page live source (Devices ▸ live inputs, the same as adding a URL there): "
		+ "then drag it onto a look. Needs a host channel — the answer says when CasparCG must restart — and CEF GPU for the 3D view.")
	_defaults = VBoxContainer.new()
	more.add_child(_defaults)
	if not world:
		_build_defaults()


## The box's defaults applied when a session is opened here (Settings games.defaults.<id>, POST /api/settings).
func _build_defaults() -> void:
	var h := Kit.row(_defaults)
	var t := Label.new()
	t.text = "When a session opens"
	t.custom_minimum_size.x = 120
	t.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	h.add_child(t)
	for spec in [["bots", "Bots", 0, 32], ["main", "Main", 0, 600]]:
		var l := Label.new()
		l.text = str(spec[1])
		l.name = "dl_" + str(spec[0])
		h.add_child(l)
		var sb := SpinBox.new()
		sb.name = "d_" + str(spec[0])
		sb.min_value = spec[2]
		sb.max_value = spec[3]
		sb.rounded = true
		var key := str(spec[0])
		sb.value_changed.connect(func(v: float) -> void: _patch_default(key, int(v)))
		h.add_child(sb)
	var lv := OptionButton.new()
	lv.name = "d_botLevel"
	lv.item_selected.connect(func(i: int) -> void: _patch_default("botLevel", lv.get_item_text(i)))
	h.add_child(lv)
	var af := OptionButton.new()
	af.name = "d_affect"
	for a in M.AFFECT:
		af.add_item(str(a[1]))
	af.item_selected.connect(func(i: int) -> void: _patch_default("affect", str(M.AFFECT[i][0])))
	h.add_child(af)


func _post(body: Dictionary) -> void:
	if not _quiet:
		post.call(body)


func _patch_default(key: String, v: Variant) -> void:
	if _quiet:
		return
	Settings.patch({"games": {"defaults": {id: {key: v}}}})


func _open(kind: String) -> void:
	var p: Dictionary = data.get("paths", {}) if data.get("paths") is Dictionary else {}
	OS.shell_open(Config.origin + str(p.get(kind, "/game/%s/" % id)))


func _add_spectator() -> void:
	var p: Dictionary = data.get("paths", {}) if data.get("paths") is Dictionary else {}
	var url := "http://127.0.0.1:%d%s" % [_port(), str(p.get("spectate", "/game/%s/?spectate=1" % id))]
	var item := {"type": "browser", "value": url, "templateOrUrl": url, "label": "Spectator — %s" % str(data.get("title", id))}
	var r: Dictionary = await Api.post_json("/api/device-view", {"addExtraLiveSource": item})
	var restart: bool = r.ok and r.data is Dictionary and r.data.get("casparRestartRecommended") == true
	_status.text = (("Added as a live source%s." % (" — CasparCG must restart for it (Devices)" if restart else "")) if r.ok
		else "Not added: %s" % M.error_text(r))


func _port() -> int:
	var j: Variant = data.get("joinUrl")
	if j is String:
		var m := RegEx.create_from_string(":(\\d+)/").search(str(j))
		if m:
			return int(m.get_string(1))
	return 4200


## Update every control from the row's state (never while the operator is typing in a field).
func show_state(row: Dictionary, defaults: Dictionary) -> void:
	_quiet = true
	_show(row, defaults)
	_quiet = false


func _show(row: Dictionary, defaults: Dictionary) -> void:
	data = row
	_title.text = str(row.get("title", id))
	_module.set_pressed_no_signal(row.get("moduleOn") == true)
	var e := M.enabled(row)
	_qr.disabled = not e.qr
	if world:
		var on: bool = row.get("on") == true
		_status.text = ("on — %s" % ("PAUSED" if row.get("safe") == true else "every open game is in it")) if on else ("module off" if row.get("moduleOn") != true else "on — no game session open")
		return
	_status.text = M.status_text(row)
	if row.get("error") is String and str(row.error) != "":
		_status.text += " — " + str(row.error)
	_session.disabled = not e.session
	_session.text = "Close session" if row.get("open") == true else "Open session"
	_start.disabled = not e.start
	_stop.disabled = not e.stop
	var b: Variant = row.get("bots")
	_bots.editable = e.bots
	if b is Dictionary:
		_bots.max_value = maxf(1, float(b.get("max", 0)))
		if not _bots.get_line_edit().has_focus():
			_bots.set_value_no_signal(float(b.get("n", 0)))
		if _levels != b.get("levels", []):
			_levels = (b.get("levels", []) as Array).duplicate()
			_level.clear()
			for lv in _levels:
				_level.add_item(str(lv))
		_level.select(maxi(0, _levels.find(str(b.get("level", "normal")))))
	_level.disabled = not e.bots
	var m: Variant = row.get("main")
	_main_row.visible = m is Dictionary or b is Dictionary
	_main.visible = m is Dictionary
	_main_label.visible = m is Dictionary
	if m is Dictionary:
		_main_label.text = str(m.get("label", ""))
		_main.min_value = float(m.get("min", 0))
		_main.max_value = float(m.get("max", 1))
		_main.editable = e.main
		if not _main.get_line_edit().has_focus() and m.get("value") != null:
			_main.set_value_no_signal(float(m.value))
	_affect_row.visible = row.get("affect") is String
	if row.get("affect") is String:
		_affect.select(maxi(0, M.AFFECT.map(func(a: Array) -> String: return str(a[0])).find(str(row.affect))))
	_show_defaults(row, defaults)


func _show_defaults(row: Dictionary, d: Dictionary) -> void:
	var b: Variant = row.get("bots")
	var m: Variant = row.get("main")
	var bots := _defaults.find_child("d_bots", true, false) as SpinBox
	var main := _defaults.find_child("d_main", true, false) as SpinBox
	var lv := _defaults.find_child("d_botLevel", true, false) as OptionButton
	var af := _defaults.find_child("d_affect", true, false) as OptionButton
	(_defaults.find_child("dl_main", true, false) as Label).text = str(m.get("label", "Main")) if m is Dictionary else "Main"
	main.visible = m is Dictionary
	if m is Dictionary:
		main.min_value = float(m.get("min", 0))
		main.max_value = float(m.get("max", 600))
	if b is Dictionary:
		bots.max_value = maxf(1, float(b.get("max", 0)))
	if not bots.get_line_edit().has_focus():
		bots.set_value_no_signal(float(d.get("bots", 0)))
	if not main.get_line_edit().has_focus():
		main.set_value_no_signal(float(d.get("main", m.get("value", 0) if m is Dictionary and m.get("value") != null else 0)))
	if lv.item_count == 0 and b is Dictionary:
		for x in b.get("levels", []):
			lv.add_item(str(x))
	for i in lv.item_count:
		if lv.get_item_text(i) == str(d.get("botLevel", "normal")):
			lv.select(i)
	af.select(maxi(0, M.AFFECT.map(func(a: Array) -> String: return str(a[0])).find(str(d.get("affect", "on")))))
