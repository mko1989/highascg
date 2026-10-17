extends VBoxContainer
## WO-599/608 — app shell: header bar (connection eye, project name, server, status line) + workspace
## tabs. Tabs other than Live are placeholders until their port WOs (601–608) land.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const LiveTab := preload("res://features/live/live_tab.gd")
const PrevisTab := preload("res://features/previs/previs_tab.gd")

var _eye: Label
var _project: Label
var _status: Label
var tabs: TabContainer


func _ready() -> void:
	add_theme_constant_override("separation", 0)
	add_child(_build_header())
	tabs = TabContainer.new()
	tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(tabs)
	var live := LiveTab.new()
	live.name = "Live"
	tabs.add_child(live)
	var previs := PrevisTab.new()
	previs.name = "Previs"
	tabs.add_child(previs)
	if Config.args.has("tab"):
		tabs.current_tab = clampi(int(Config.args["tab"]), 0, tabs.get_tab_count() - 1)
	for t in [["Inspector", "WO-601"], ["Timeline", "WO-602"], ["Media", "WO-603"], ["Audio", "WO-604"],
			["Devices", "WO-605"], ["Settings", "WO-608"]]:
		tabs.add_child(_placeholder(t[0], t[1]))
	Ws.connected.connect(_refresh_eye)
	Ws.disconnected.connect(_refresh_eye)
	Store.changed.connect(func(_p: String, _v: Variant) -> void: _refresh_eye())
	Store.project_changed.connect(func(p: Dictionary) -> void: _project.text = str(p.get("name", "—")))
	_refresh_eye()


func set_status_line(text: String) -> void:
	if _status != null:
		_status.text = text


func _build_header() -> Control:
	var bar := PanelContainer.new()
	bar.custom_minimum_size.y = ThemeBuilder.HEADER_H
	bar.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 0, 0))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	bar.add_child(row)
	var title := Label.new()
	title.text = "HighAsCG"
	title.add_theme_font_size_override("font_size", 20)
	row.add_child(title)
	_eye = Label.new()
	row.add_child(_eye)
	_project = Label.new()
	_project.text = "—"
	_project.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	row.add_child(_project)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	row.add_child(_status)
	var server := Label.new()
	server.text = Config.origin
	server.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	row.add_child(server)
	return bar


## Connection eye: WS + Caspar link (state.caspar.connection, like client/components/connection-eye.js).
func _refresh_eye() -> void:
	if _eye == null:
		return
	var caspar: Variant = Store.get_value("caspar.connection", Store.get_value("caspar", {}))
	var caspar_ok := false
	if caspar is Dictionary:
		caspar_ok = bool((caspar as Dictionary).get("connected", false))
	if not Ws.is_open:
		_eye.text = "● server offline"
		_eye.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	elif not caspar_ok:
		_eye.text = "● server ok · Caspar offline"
		_eye.add_theme_color_override("font_color", ThemeBuilder.WARN)
	else:
		_eye.text = "● connected"
		_eye.add_theme_color_override("font_color", ThemeBuilder.SUCCESS)


func _placeholder(title: String, wo: String) -> Control:
	var c := CenterContainer.new()
	c.name = title
	var l := Label.new()
	l.text = "%s — not ported yet (%s)" % [title, wo]
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	c.add_child(l)
	return c
