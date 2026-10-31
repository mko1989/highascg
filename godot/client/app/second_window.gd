extends Window
## WO-891 — the second operator window (owner 31.10: "a secondary gui for the secondary monitor … empty gray at first
## with only the logo title in top left"). A native OS window (force_native: the root embeds its dialogs) holding its
## own tab strip; app/tab_undock.gd moves workspace tabs into it and back. Its corner button (arrow + "1", app/tab_undock.gd)
## sends the current tab back; the monitor button picks the screen or closes the window, and closing returns every tab.
## While the main window is locked (WO-838) a cover hides this one and swallows its input.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const UiIcons := preload("res://app/ui_icons.gd")

const CLOSE_ID := 1000
const AUTO_ID := 1001

signal send_back(page: Control)
signal menu_opening(menu: PopupMenu)  # the controller fills the screen list
signal menu_chosen(id: int)  # a screen index, AUTO_ID or CLOSE_ID
signal key_unhandled(event: InputEvent)  # a key no control here used (undo, F3 … live on the main window)
signal geometry_changed  # moved or resized (the controller saves the plain window's rect)
signal key_seen(event: InputEvent)  # every key, before anything here sees it (the lock chord, WO-838)

var tabs: TabContainer
var screen_btn: MenuButton
var _cover: _Cover
var _logo_img := Image.new()
var _hidden: Array[Window] = []  # dialogs the lock hid, shown again on unlock


## Swallows every input event while the main window is locked (_input runs before the GUI; this is the last child),
## and shows every key to the lock first: the main window's _input never sees keys typed here.
class _Cover:
	extends ColorRect
	signal key(event: InputEvent)
	var on := false

	func _input(e: InputEvent) -> void:
		if e is InputEventKey:
			key.emit(e)
		if on:
			get_viewport().set_input_as_handled()


## Keys nothing in this window handled go to the controller, which hands the global ones to the main window.
class _Keys:
	extends Node
	signal key(event: InputEvent)

	func _unhandled_key_input(e: InputEvent) -> void:
		key.emit(e)


func _init() -> void:
	visible = false
	force_native = true  # a real OS window: the main window embeds its subwindows (dialogs, popups)
	title = "HighAsCG — 2"
	min_size = Vector2i(480, 320)
	_build()


func _build() -> void:
	var bg := ColorRect.new()
	bg.color = ThemeBuilder.BG_DARK
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var col := VBoxContainer.new()
	col.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	col.add_theme_constant_override("separation", 0)
	add_child(col)
	col.add_child(_header())
	tabs = TabContainer.new()
	tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(tabs)
	var keys := _Keys.new()
	keys.key.connect(key_unhandled.emit)
	add_child(keys)
	_cover = _Cover.new()
	_cover.key.connect(key_seen.emit)
	_cover.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_cover.mouse_filter = Control.MOUSE_FILTER_STOP
	_cover.visible = false
	add_child(_cover)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_POSITION_CHANGED:
		geometry_changed.emit()


## The main header's left end only: logo + "HighAsCG"; the monitor button sits at the right end.
func _header() -> Control:
	var bar := PanelContainer.new()
	bar.custom_minimum_size.y = ThemeBuilder.HEADER_H
	bar.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 0, 0))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	bar.add_child(row)
	var logo := TextureRect.new()
	_logo_img.load_png_from_buffer(FileAccess.get_file_as_bytes("res://assets/ui/logo.png"))
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.custom_minimum_size = Vector2(26, 32)
	var fit := func() -> void: logo.texture = ThemeBuilder.sized_logo(_logo_img, logo.size, self)
	logo.resized.connect(fit)
	size_changed.connect(fit)
	size_changed.connect(geometry_changed.emit)
	row.add_child(logo)
	var name_l := Label.new()
	name_l.text = "HighAsCG"
	name_l.add_theme_font_size_override("font_size", 20)
	row.add_child(name_l)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	screen_btn = MenuButton.new()
	screen_btn.icon = UiIcons.texture("screen")
	screen_btn.flat = true
	screen_btn.tooltip_text = "Which screen this window is on — or close it (its tabs go back to the main window)"
	screen_btn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	screen_btn.about_to_popup.connect(func() -> void: menu_opening.emit(screen_btn.get_popup()))
	screen_btn.get_popup().id_pressed.connect(menu_chosen.emit)
	row.add_child(screen_btn)
	return bar


## The screen menu: one radio row per screen ([label, enabled]), Automatic, Close.
static func fill_menu(pm: PopupMenu, rows: Array, picked: int) -> void:
	pm.clear()
	for i in rows.size():
		pm.add_radio_check_item(str(rows[i][0]), i)
		pm.set_item_checked(pm.get_item_index(i), i == picked)
		pm.set_item_disabled(pm.get_item_index(i), not bool(rows[i][1]))
	pm.add_radio_check_item("Automatic (a screen with no Caspar output)", AUTO_ID)
	pm.set_item_checked(pm.get_item_index(AUTO_ID), picked < 0)
	pm.add_separator()
	pm.add_item("Close — tabs go back to the main window", CLOSE_ID)


## Tab names in strip order.
func tab_names() -> Array:
	return tabs.get_children().map(func(c: Node) -> String: return str(c.name))


func set_locked(on: bool, color: Color) -> void:
	if on == _cover.on:
		return
	_cover.on = on
	_cover.color = color
	_cover.visible = on
	if on:
		var f := gui_get_focus_owner()
		if f:
			f.release_focus()
		gui_cancel_drag()
		for w: Window in find_children("*", "Window", true, false):  # menus / dialogs of tabs living here
			if w.visible:
				w.hide()
				if not (w is Popup):
					_hidden.append(w)
	else:
		for w in _hidden:
			if is_instance_valid(w):
				w.show()
		_hidden.clear()
