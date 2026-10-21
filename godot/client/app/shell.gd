extends VBoxContainer
## WO-599/608 — app shell (web client/index.html): header (logo + title, project name, connection eyes) over three
## columns — Sources (full height, shared by every tab — R1), the workspace tabs, and the Inspector (always on the
## right, content follows the selection — R2).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const LiveTab := preload("res://features/live/live_tab.gd")
const PrevisTab := preload("res://features/previs/previs_tab.gd")
const TimelineTab := preload("res://features/timeline/timeline_tab.gd")
const SettingsTab := preload("res://features/settings/settings_tab.gd")
const DevicesTab := preload("res://features/devices/devices_tab.gd")
const AudioTab := preload("res://features/audio/audio_tab.gd")
const MultiviewTab := preload("res://features/multiview/multiview_tab.gd")
const MediaPanel := preload("res://features/live/media_panel.gd")
const OscMirror := preload("res://features/live/osc_mirror.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const PlaylistsPanel := preload("res://features/live/playlists_panel.gd")
const ConnectionEye := preload("res://app/connection_eye.gd")
const ConnectionMenu := preload("res://app/connection_menu.gd")
const Profiles := preload("res://core/connection_profiles_model.gd")
const LogsDialog := preload("res://app/logs_dialog.gd")
const PerfOverlay := preload("res://app/perf_overlay.gd")
const UiIcons := preload("res://app/ui_icons.gd")
const HeaderProject := preload("res://app/header_project.gd")
const HeaderTools := preload("res://app/header_tools.gd")
const HeaderStatus := preload("res://app/header_status.gd")
const OperatorDock := preload("res://app/operator_dock.gd")
const DockModel := preload("res://app/operator_dock_model.gd")

var _eye: ConnectionEye
var _logs: LogsDialog
var header_project: HeaderProject
var header_tools: HeaderTools
var header_status: HeaderStatus
var _status := ""
var tabs: TabContainer
var sources: MediaPanel
var inspector: InspectorPanel
var osc: OscMirror
var perf: PerfOverlay
var _perf_btn: Button


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
	inspector.add_footer(PlaylistsPanel.new())  # WO-603: web Playlists footer panel
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
	var audio := AudioTab.new()  # WO-604
	audio.name = "Audio"
	audio.osc = osc
	tabs.add_child(audio)
	var devices := DevicesTab.new()  # WO-605
	devices.name = "Devices"
	tabs.add_child(devices)
	sources.caspar_changed.connect(devices.mark_restart_dirty)  # WO-605 slice 12: a DeckLink dropped on Sources
	sources.connector_dropped.connect(devices.refresh)
	var multiview := MultiviewTab.new()  # WO-600 M
	multiview.name = "Multiview"
	tabs.add_child(multiview)
	sources.tab_requested.connect(func(n: String) -> void: tabs.current_tab = tabs.get_tab_idx_from_control(tabs.get_node(n.capitalize())))
	var settings := SettingsTab.new()  # WO-608
	settings.name = "Settings"
	settings.logs_requested.connect(_open_logs)
	tabs.add_child(settings)
	if Config.args.has("tab"):
		tabs.current_tab = clampi(int(Config.args["tab"]), 0, tabs.get_tab_count() - 1)
	Ws.connected.connect(_refresh_eye)
	Ws.disconnected.connect(_refresh_eye)
	Store.changed.connect(func(_p: String, _v: Variant) -> void: _refresh_eye())
	header_tools.settings_requested.connect(func() -> void: tabs.current_tab = tabs.get_tab_idx_from_control(settings))
	header_tools.notice.connect(header_project.say)
	header_tools.badges.devices_requested.connect(func() -> void: tabs.current_tab = tabs.get_tab_idx_from_control(devices))
	header_status.notice.connect(header_project.say)
	header_status.setup(osc)
	_refresh_eye()
	perf = PerfOverlay.new()  # WO-623 — after the header button exists so its state syncs on boot
	perf.toggled.connect(func(on: bool) -> void: _perf_btn.set_pressed_no_signal(on))
	add_child(perf)
	if DockModel.wanted(Config.origin, Config.args):  # WO-628 — bottom-centre app dock on the box's own screen
		var dock := OperatorDock.new()
		dock.notice.connect(header_project.say)
		add_child(dock)


## WO-623 — F3 toggles the performance overlay from anywhere (the header pulse button does the same).
func _shortcut_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k and k.pressed and not k.echo and k.keycode == KEY_F3:
		perf.set_on(not perf.is_on())
		get_viewport().set_input_as_handled()


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
	logo.tooltip_text = "Shader Live"
	logo.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	logo.gui_input.connect(func(e: InputEvent) -> void:  # WO-606: web mascot click → Shader Live
		var mb := e as InputEventMouseButton
		if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			var live: Node = tabs.get_node("Live")
			tabs.current_tab = live.get_index()
			live.toggle_shader_live())
	row.add_child(logo)
	var title := Label.new()
	title.text = "HighAsCG"
	title.add_theme_font_size_override("font_size", 20)
	row.add_child(title)
	header_project = HeaderProject.new()  # WO-608 header: name · save · load · new · notice line
	header_project.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(header_project)
	header_tools = HeaderTools.new()  # ⚙ · FTB
	header_tools.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(header_tools)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	header_status = HeaderStatus.new()  # PGM timer · wall clock · headphones
	header_status.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(header_status)
	_perf_btn = UiIcons.button("pulse", "Performance overlay — CPU / GPU / RAM of this client and the box (F3)")
	_perf_btn.toggle_mode = true
	_perf_btn.flat = true
	_perf_btn.add_theme_color_override("icon_pressed_color", ThemeBuilder.ACCENT)
	_perf_btn.add_theme_color_override("icon_hover_pressed_color", ThemeBuilder.ACCENT_HOVER)
	_perf_btn.toggled.connect(func(on: bool) -> void: perf.set_on(on))
	row.add_child(_perf_btn)
	_eye = ConnectionEye.new()
	_eye.clicked.connect(_open_logs)
	_eye.context_requested.connect(func() -> void: ConnectionMenu.show_menu(_eye))
	row.add_child(_eye)
	return bar


## Eye click → server logs (the web's connection-eye click); a second click closes them.
func _open_logs() -> void:
	if _logs == null:
		_logs = LogsDialog.new()
		add_child(_logs)
	if _logs.visible:
		_logs.hide()
	else:
		_logs.open()


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
		"%s\n%s%s%s" % [state, Config.origin, ("\n" + _status) if _status != "" else "",
			("\n" + Profiles.label(Config.profiles()) + " · right-click for A/B hosts") if Profiles.has_dual(Config.profiles()) else "\nRight-click: A/B hosts"])

