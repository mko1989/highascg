extends Window
## WO-628 — the operator dock (owner 20.10: "an extremely small … autohide, middle bottom, macOS dock style, with the
## most important apps and more which shows a menu list"; then "way too small … it can be bigger, just needs to auto
## hide and not be too triggery"). A native, borderless, always-on-top window on this client's screen, so it stays
## reachable over any app it opened. Collapsed it is a 4 px line at the bottom centre; RESTING the pointer on it
## (D.REVEAL_S — sweeping past does nothing) grows it into the dock: HighAsCG (bring this window back to the front),
## the five pinned tools, and ⋯ (every other installed app). A click = POST /api/system/dock/launch {action}: the
## server launches it, or focuses its window when it is already running. Replaces the web header's "Open window ▾"
## taskbar (WO-283), which is not ported.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const ConnectionEye := preload("res://app/connection_eye.gd")
const D := preload("res://app/operator_dock_model.gd")
const DockMenu := preload("res://app/operator_dock_menu.gd")
const NuclearGate := preload("res://app/nuclear_gate.gd")

signal notice(n: Dictionary)

var row: HBoxContainer
var more_menu: Window  # DockMenu
var expanded := false
var _apps: Array = []
var _n_buttons := 0
var _reveal: Timer
var _collapse: Timer
var _handle: ColorRect
var _panel: PanelContainer
var _bubble: Window  # the hovered app's name above its icon (macOS dock style)
var _bubble_label: Label
var _dots := {}  # action → the running dot under its button
var _loaded := false  # WO-705: the app list is in the dock (once)
var _loading := false


func _init() -> void:
	title = "HighAsCG dock"
	visible = false  # force_native can only change while hidden
	force_native = true
	borderless = true
	always_on_top = true
	unfocusable = true
	transient = false
	wrap_controls = false


func _ready() -> void:
	_handle = ColorRect.new()
	_handle.color = ThemeBuilder.ACCENT.darkened(0.2)
	_handle.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_handle)
	_panel = PanelContainer.new()
	_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	var sb := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1, 0)
	sb.set_content_margin_all(D.PAD)
	_panel.add_theme_stylebox_override("panel", sb)
	add_child(_panel)
	row = HBoxContainer.new()
	row.add_theme_constant_override("separation", D.GAP)
	_panel.add_child(row)
	more_menu = DockMenu.new()
	more_menu.picked.connect(func(action: String) -> void:
		more_menu.hide()
		launch(action, null))
	more_menu.mouse_entered.connect(_hold)
	more_menu.mouse_exited.connect(_release)
	add_child(more_menu)
	_reveal = Timer.new()
	_reveal.one_shot = true
	_reveal.timeout.connect(set_expanded.bind(true))
	add_child(_reveal)
	_collapse = Timer.new()
	_collapse.one_shot = true
	_collapse.timeout.connect(func() -> void:
		more_menu.hide()
		set_expanded(false))
	add_child(_collapse)
	mouse_entered.connect(func() -> void:
		if expanded:
			_hold()
		else:
			_reveal.start(D.REVEAL_S))
	mouse_exited.connect(func() -> void:
		_reveal.stop()
		if expanded:
			_release())
	_build_bubble()
	_add_self_button()
	set_expanded(false)
	show()
	_load()
	Ws.connected.connect(_load)  # WO-705: the GUI can be up minutes before the server (live ISO boot) — load once it is


## The pointer is over the dock or its list: stay open.
func _hold() -> void:
	_collapse.stop()


## The pointer left the dock or its list: close after a grace period, unless it comes back to either.
func _release() -> void:
	_collapse.start(D.HIDE_S)


func _load() -> void:
	if _loaded or _loading:
		return
	_loading = true
	var res: Dictionary = await DevicesTarget.box_api.get_json("/api/system/dock")
	_loading = false
	if _loaded:
		return
	if not res.ok or not (res.data is Dictionary):
		notice.emit({"text": "Dock: could not load the app list — " + str(res.error), "tone": "error"})
		return
	_loaded = true
	var sep := VSeparator.new()
	row.add_child(sep)
	for p in res.data.get("pinned", []):
		var b := _button(str(p.name))
		b.pressed.connect(launch.bind(str(p.action), b))
		row.add_child(b)
		_icon_into(b, str(p.action))
		_add_dot(b, str(p.action))
	_apps = res.data.get("apps", []) if res.data.get("apps") is Array else []
	more_menu.fill(_apps)
	_show_running(res.data)
	var more := _button("More apps")
	more.text = "⋯"
	more.add_theme_font_size_override("font_size", 28)
	more.pressed.connect(_open_more)
	row.add_child(more)
	set_expanded(expanded)


func _add_self_button() -> void:
	var b := _button("HighAsCG")
	b.icon = ConnectionEye.load_png("res://assets/ui/logo.png")
	b.pressed.connect(func() -> void:
		var main := get_tree().root
		if main.mode == Window.MODE_MINIMIZED:
			main.mode = Window.MODE_MAXIMIZED
		launch("highascg", b))  # the server activates it — Openbox refuses a window raising itself
	row.add_child(b)
	_add_dot(b, "highascg")


## WO-628 running dots: a small dot under each app with an open window (GET /api/system/dock `running`).
func _add_dot(b: Button, action: String) -> void:
	var dot := ColorRect.new()
	dot.color = ThemeBuilder.TEXT_MUTED
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dot.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	dot.offset_left = -D.DOT / 2.0
	dot.offset_right = D.DOT / 2.0
	dot.offset_top = -D.DOT - 1
	dot.offset_bottom = -1
	dot.visible = action == "highascg"
	b.add_child(dot)
	_dots[action] = dot


func _show_running(data: Variant) -> void:
	var on := D.running_set(data)
	for a in _dots:
		(_dots[a] as ColorRect).visible = on.has(a)


func _refresh_running() -> void:
	var res: Dictionary = await DevicesTarget.box_api.get_json("/api/system/dock")
	if res.ok:
		_show_running(res.data)


## A name bubble instead of tooltips: a Godot tooltip is clamped to the screen bottom, which puts it ON the dock under
## the pointer — it swallowed the click (box 20.10). The bubble is its own click-through window above the dock.
func _build_bubble() -> void:
	_bubble = Window.new()
	_bubble.visible = false
	_bubble.force_native = true
	_bubble.borderless = true
	_bubble.always_on_top = true
	_bubble.unfocusable = true
	_bubble.mouse_passthrough = true
	_bubble.transient = false
	var pc := PanelContainer.new()
	var sb := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1, 4)
	sb.content_margin_left = 8
	sb.content_margin_right = 8
	sb.content_margin_top = 2
	sb.content_margin_bottom = 2
	pc.add_theme_stylebox_override("panel", sb)
	_bubble_label = Label.new()
	_bubble_label.add_theme_font_size_override("font_size", 14)
	pc.add_child(_bubble_label)
	_bubble.add_child(pc)
	add_child(_bubble)


func _show_bubble(b: Button) -> void:
	if more_menu.visible:
		return  # it would sit on the list
	_bubble_label.text = str(b.get_meta("name", ""))
	var pc: Control = _bubble.get_child(0)
	var sz := Vector2i(pc.get_combined_minimum_size())
	_bubble.size = sz
	var cx := position.x + int(b.global_position.x + b.size.x / 2.0)  # global = within this dock window
	_bubble.position = Vector2i(cx - sz.x / 2, position.y - sz.y - 4)
	_bubble.show()


func _button(tip: String) -> Button:
	_n_buttons += 1
	var b := Button.new()
	b.flat = true
	b.set_meta("name", tip)
	b.mouse_entered.connect(_show_bubble.bind(b))
	b.mouse_exited.connect(func() -> void: _bubble.hide())
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(D.CELL, D.CELL)
	b.expand_icon = true
	b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	b.add_theme_constant_override("icon_max_width", D.ICON)
	return b


func _icon_into(b: Button, action: String) -> void:
	var r: Dictionary = await DevicesTarget.box_api.get_bytes(D.icon_path(action))
	var img := D.decode_icon(r.bytes, D.ICON * 2) if r.ok else null
	if img != null and is_instance_valid(b):
		b.icon = ImageTexture.create_from_image(img)
	elif is_instance_valid(b):
		b.text = str(b.get_meta("name", "?")).substr(0, 1)


func _open_more() -> void:
	if more_menu.visible:
		more_menu.hide()
		return
	var r := D.menu_rect(Rect2i(position, size), more_menu.content_height(), _usable_rect())
	more_menu.size = r.size
	more_menu.position = r.position
	_bubble.hide()
	more_menu.show()


func launch(action: String, b: Button) -> void:
	if b != null:
		b.modulate = Color(1, 1, 1, 0.45)  # pressed feedback until the server answers
	var res: Dictionary = await NuclearGate.post(self, "/api/system/dock/launch", {"action": action}, DevicesTarget.box_api)
	if b != null and is_instance_valid(b):
		b.modulate = Color.WHITE
	print("[client] dock %s → %s %s" % [action, res.status, res.error])
	get_tree().create_timer(2.0).timeout.connect(_refresh_running)  # a launched app maps its window a moment later
	if not res.ok:
		var d: Dictionary = res.data if res.data is Dictionary else {}
		notice.emit({"text": "Could not open %s: %s" % [action, str(d.get("error", res.error))], "tone": "error"})


func set_expanded(on: bool) -> void:
	if on and not expanded and not _dots.is_empty():
		_refresh_running()
	expanded = on
	if not on and _bubble != null:
		_bubble.hide()
	_handle.visible = not on
	_panel.visible = on
	var sz := D.expanded_size(_n_buttons, 1) if on else D.HANDLE
	var r := D.place(_usable_rect(), sz)
	size = r.size
	position = r.position


func _usable_rect() -> Rect2i:
	var scr := DisplayServer.window_get_current_screen(get_tree().root.get_window_id())
	return DisplayServer.screen_get_usable_rect(scr)
