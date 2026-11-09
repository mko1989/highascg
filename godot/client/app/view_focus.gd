extends Node
## WO-1008 — a workspace view full screen (owner 09.11: "make the previs possible to fullscreen the view with only
## inspector from the main gui but floating with an option to hide it"). The page's toolbar button (or F11 while the
## page shows) hides the header, the Sources column and the tab strip; the shared Inspector (InspectorPanel.current —
## the one column, WO-608 R2) leaves its split and floats over `host` (the page's view area), without its footer
## (Playlists / Timers / audio). The float's title bar drags it sideways; "Hide" leaves a small "Inspector" button in the
## corner to bring it back. The button again, F11, Esc (unless something used it) or the page going away put everything
## back where it was. A page on the second operator window (WO-891) only hides that window's strip.

const InspectorPanel := preload("res://app/inspector_panel.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := 8.0  # px between the float and the view's edges

static var chrome: Array = []  # the shell's header row and Sources column (set by shell.gd)

var on := false
var shown := true  # the float (false: only the corner "Inspector" button)
var page: Control
var host: Control
var btn: Button
var _float: PanelContainer
var _box: VBoxContainer
var _reopen: Button
var _x := INF  # the float's left edge in the host (INF = against the right edge)
var _home: Node
var _home_at := 0
var _tc: TabContainer
var _hidden: Array = []  # chrome this full screen hid


## The toolbar button for `p` (this node joins it); `h` is the page's view area (a plain Control: the float is placed
## by hand in it).
func setup(p: Control, h: Control) -> Button:
	page = p
	p.add_child(self)
	host = h
	btn = Button.new()
	btn.text = "Full screen"
	btn.toggle_mode = true
	btn.focus_mode = Control.FOCUS_NONE
	btn.tooltip_text = "Only this view, with the Inspector floating on top (F11; Esc leaves)"
	btn.toggled.connect(set_on)
	page.visibility_changed.connect(func() -> void:
		if on and not page.is_visible_in_tree():
			set_on(false))
	host.resized.connect(_place)
	if Config.args.has("probe-fullscreen"):  # dev: --probe-fullscreen[=hidden] starts that way (screenshot checks)
		p.get_tree().create_timer(4.0).timeout.connect(func() -> void:
			shown = str(Config.args["probe-fullscreen"]) != "hidden"
			set_on(true))
	return btn


func set_on(v: bool) -> void:
	if v == on or (v and not page.is_visible_in_tree()):
		btn.set_pressed_no_signal(on)
		return
	on = v
	btn.set_pressed_no_signal(on)
	var insp := InspectorPanel.current as Control
	if on:
		_tc = page.get_parent() as TabContainer
		if _tc != null:
			_tc.tabs_visible = false
		_hidden = chrome.filter(func(c: Variant) -> bool:
			return is_instance_valid(c) and (c as Control).visible and (c as Control).get_window() == page.get_window())
		for c: Control in _hidden:
			c.visible = false
		if insp != null:
			_home = insp.get_parent()
			_home_at = insp.get_index()
			_home.remove_child(insp)
			_build()
			insp.size_flags_vertical = Control.SIZE_EXPAND_FILL
			_box.add_child(insp)
			insp.set_footer_shown(false)
		set_shown(shown)
	else:
		if _tc != null and is_instance_valid(_tc):
			_tc.tabs_visible = true
		for c: Control in _hidden:
			if is_instance_valid(c):
				c.visible = true
		_hidden = []
		if insp != null and is_instance_valid(_home) and insp.get_parent() == _box:
			_box.remove_child(insp)
			_home.add_child(insp)
			_home.move_child(insp, _home_at)
			insp.set_footer_shown(true)
		if _float != null:
			_float.visible = false
			_reopen.visible = false


## The float shown or tucked away (the corner button brings it back).
func set_shown(v: bool) -> void:
	shown = v
	if _float == null:
		return
	_float.visible = on and shown
	_reopen.visible = on and not shown
	_place()


func _build() -> void:
	if _float != null:
		return
	_float = PanelContainer.new()
	_float.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1, 6))
	_box = VBoxContainer.new()
	_float.add_child(_box)
	var bar := HBoxContainer.new()
	bar.mouse_filter = Control.MOUSE_FILTER_STOP
	bar.mouse_default_cursor_shape = Control.CURSOR_MOVE
	bar.tooltip_text = "Drag to move the Inspector"
	var title := Label.new()
	title.text = "Inspector"
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	bar.add_child(title)
	var hide := Button.new()
	hide.text = "Hide"
	hide.focus_mode = Control.FOCUS_NONE
	hide.tooltip_text = "Hide the Inspector (the Inspector button in the corner brings it back)"
	hide.pressed.connect(set_shown.bind(false))
	bar.add_child(hide)
	bar.gui_input.connect(func(e: InputEvent) -> void:
		var mm := e as InputEventMouseMotion
		if mm != null and mm.button_mask & MOUSE_BUTTON_MASK_LEFT:
			_x = _float.position.x + mm.relative.x
			_place())
	_box.add_child(bar)
	host.add_child(_float)
	_reopen = Button.new()
	_reopen.text = "Inspector"
	_reopen.focus_mode = Control.FOCUS_NONE
	_reopen.tooltip_text = "Show the Inspector"
	_reopen.pressed.connect(set_shown.bind(true))
	host.add_child(_reopen)


## The float spans the view's height, as wide as the Inspector wants, kept inside the view; the corner button sits
## top-right.
func _place() -> void:
	if _float == null or not on:
		return
	var w := _float.get_combined_minimum_size().x
	_float.size = Vector2(w, maxf(0.0, host.size.y - 2.0 * M))
	_float.position = Vector2(clampf(_x, M, maxf(M, host.size.x - w - M)), M)
	_reopen.size = _reopen.get_combined_minimum_size()
	_reopen.position = Vector2(host.size.x - _reopen.size.x - M, M)


## F11 toggles while the page shows; Esc leaves (only when nothing else took it: a dialog, a field, a drag).
func _shortcut_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k != null and k.pressed and not k.echo and k.keycode == KEY_F11 and page != null and page.is_visible_in_tree():
		set_on(not on)
		get_viewport().set_input_as_handled()


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if on and k != null and k.pressed and not k.echo and k.keycode == KEY_ESCAPE:
		set_on(false)
		get_viewport().set_input_as_handled()
