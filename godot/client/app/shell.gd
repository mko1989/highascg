extends VBoxContainer
## WO-599/608 — app shell (web client/index.html): header (logo + title, project name, connection eyes) over three
## columns — Sources (full height, shared by every tab — R1), the workspace tabs, and the Inspector (always on the
## right, content follows the selection — R2). Tabs other than Live/Previs/Timeline are placeholders until their WOs land.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const LiveTab := preload("res://features/live/live_tab.gd")
const PrevisTab := preload("res://features/previs/previs_tab.gd")
const TimelineTab := preload("res://features/timeline/timeline_tab.gd")
const MediaPanel := preload("res://features/live/media_panel.gd")
const OscMirror := preload("res://features/live/osc_mirror.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const ConnectionEye := preload("res://app/connection_eye.gd")

var _eye: ConnectionEye
var _project: Label
var _status := ""
var tabs: TabContainer
var sources: MediaPanel
var inspector: InspectorPanel
var osc: OscMirror


func _ready() -> void:
	add_theme_constant_override("separation", 0)
	add_child(_build_header())
	osc = OscMirror.new()  # one OSC mirror for the whole client (deck timers, media preview position)
	add_child(osc)
	var cols := HSplitContainer.new()
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(cols)
	sources = MediaPanel.new()
	sources.custom_minimum_size.x = 280
	cols.add_child(sources)
	var right := HSplitContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(right)
	tabs = TabContainer.new()
	tabs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(tabs)
	inspector = InspectorPanel.new()
	inspector.custom_minimum_size.x = 400
	right.add_child(inspector)
	sources.inspector.osc_mirror = osc
	var live := LiveTab.new()
	live.name = "Live"
	live.osc = osc
	tabs.add_child(live)
	var previs := PrevisTab.new()
	previs.name = "Previs"
	tabs.add_child(previs)
	var timeline := TimelineTab.new()  # WO-602
	timeline.name = "Timeline"
	tabs.add_child(timeline)
	if Config.args.has("tab"):
		tabs.current_tab = clampi(int(Config.args["tab"]), 0, tabs.get_tab_count() - 1)
	for t in [["Audio", "WO-604"], ["Devices", "WO-605"], ["Settings", "WO-608"]]:  # Inspector = the right column, media = Sources (R1/R2)
		tabs.add_child(_placeholder(t[0], t[1]))
	Ws.connected.connect(_refresh_eye)
	Ws.disconnected.connect(_refresh_eye)
	Store.changed.connect(func(_p: String, _v: Variant) -> void: _refresh_eye())
	Store.project_changed.connect(func(p: Dictionary) -> void: _project.text = str(p.get("name", "—")))
	_refresh_eye()


## Boot/status lines go to the eyes' tooltip — the header carries no debug text (R4).
func set_status_line(text: String) -> void:
	_status = text
	_refresh_eye()


func _build_header() -> Control:
	var bar := PanelContainer.new()
	bar.custom_minimum_size.y = ThemeBuilder.HEADER_H
	bar.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 0, 0))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	bar.add_child(row)
	var logo := TextureRect.new()
	logo.texture = ConnectionEye.load_png("res://assets/ui/logo.png")
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.custom_minimum_size = Vector2(26, 32)
	row.add_child(logo)
	var title := Label.new()
	title.text = "HighAsCG"
	title.add_theme_font_size_override("font_size", 20)
	row.add_child(title)
	_project = Label.new()
	_project.text = "—"
	_project.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	row.add_child(_project)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	_eye = ConnectionEye.new()
	row.add_child(_eye)
	return bar


## Connection eye: WS + Caspar link (state.caspar.connection, like client/components/connection-eye.js).
func _refresh_eye() -> void:
	if _eye == null:
		return
	var caspar: Variant = Store.get_value("caspar.connection", Store.get_value("caspar", {}))
	var caspar_ok := false
	if caspar is Dictionary:
		caspar_ok = bool((caspar as Dictionary).get("connected", false))
	var state := "server offline" if not Ws.is_open else ("server ok · Caspar offline" if not caspar_ok else "connected")
	_eye.set_state(Ws.is_open and caspar_ok, Settings.get_setting("offline_mode", false) == true,
		"%s\n%s%s" % [state, Config.origin, ("\n" + _status) if _status != "" else ""])


func _placeholder(title: String, wo: String) -> Control:
	var c := CenterContainer.new()
	c.name = title
	var l := Label.new()
	l.text = "%s — not ported yet (%s)" % [title, wo]
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	c.add_child(l)
	return c
