extends Window
## WO-628 — the dock's ⋯ list: every other installed app, one row each (icon + name), above the dock's right end.
## Its own native, unfocusable window rather than a PopupMenu: a popup closes the moment it lacks focus, and the dock
## is unfocusable (so clicking it never steals focus from the app in front) — the PopupMenu never stayed open (20.10).
## Hovering it keeps the dock open; leaving both closes them together (the dock owns that timing).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const D := preload("res://app/operator_dock_model.gd")

signal picked(action: String)

var _list: VBoxContainer


func _init() -> void:
	title = "HighAsCG dock apps"
	visible = false
	force_native = true
	borderless = true
	always_on_top = true
	unfocusable = true
	transient = false
	wrap_controls = false


func _ready() -> void:
	var pc := PanelContainer.new()
	pc.set_anchors_preset(Control.PRESET_FULL_RECT)
	var sb := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1, 0)
	sb.set_content_margin_all(D.PAD)
	pc.add_theme_stylebox_override("panel", sb)
	add_child(pc)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	pc.add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 0)
	scroll.add_child(_list)


## `apps` = [{action, name, comment}] from GET /api/system/dock.
func fill(apps: Array) -> void:
	for c in _list.get_children():
		c.queue_free()
	if apps.is_empty():
		var none := Label.new()
		none.text = "No other applications installed"
		none.modulate = ThemeBuilder.TEXT_MUTED
		_list.add_child(none)
		return
	var blank := ImageTexture.create_from_image(Image.create(D.MENU_ICON, D.MENU_ICON, false, Image.FORMAT_RGBA8))
	for a in apps:
		var b := Button.new()
		b.icon = blank  # keeps the names aligned while (or when no) icon loads
		b.flat = true
		b.focus_mode = Control.FOCUS_NONE
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.custom_minimum_size = Vector2(0, D.MENU_ROW)
		b.text = str(a.get("name", a.action))
		b.tooltip_text = ""  # no Godot tooltips over the dock: they land under the pointer and eat the click
		b.add_theme_constant_override("icon_max_width", D.MENU_ICON)
		b.pressed.connect(func() -> void: picked.emit(str(a.action)))
		_list.add_child(b)
		_icon_into(b, str(a.action))


func _icon_into(b: Button, action: String) -> void:
	var r: Dictionary = await Api.get_bytes(D.icon_path(action))
	var img := D.decode_icon(r.bytes, D.MENU_ICON * 2) if r.ok else null
	if img != null and is_instance_valid(b):
		b.icon = ImageTexture.create_from_image(img)


## The rows' laid-out height (for sizing the window before it shows).
func content_height() -> int:
	return int(_list.get_combined_minimum_size().y) + 2
