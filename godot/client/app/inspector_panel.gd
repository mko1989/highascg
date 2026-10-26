extends PanelContainer
## WO-608 R2 — the one right-hand Inspector column (web aside.panel-inspector), always present; its content follows
## the selection. Features never open their own right-hand panels: they hand a page to `present()` (media file, look
## layer, screen timer, global border, later timeline clip/flag/layer…) and `release()` it when the selection goes.
## One page shows at a time; with none, "Select an item" (web empty state). Pages stay owned by their feature (the
## panel only re-parents them), so a page keeps its state while another is shown.
## WO-783: the column has tabs — "Inspector" (the selection pages) plus panes features add with `add_tab()` (Look
## presets), which stay at hand whatever is selected. A new selection (`present()`) brings the Inspector tab back.

const ThemeBuilder := preload("res://app/theme_builder.gd")

static var current: Node  # the shell's instance — features reach it through InspectorPanel.current

var _body: VBoxContainer
var _footer: VBoxContainer
var _empty: Label
var _col: VBoxContainer
var _tab_row: HBoxContainer
var _tabs: Array[Button] = []
var _panes: Array[Control] = []
var _covered: Control = null  # the page the last present() hid — shown again when that page is released
var _released := {}  # pages their owner released (never brought back by a release of another page)


func _init() -> void:
	current = self


func _ready() -> void:
	add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 0, 0))
	_col = VBoxContainer.new()
	add_child(_col)
	_tab_row = HBoxContainer.new()
	_tab_row.add_theme_constant_override("separation", 2)
	_col.add_child(_tab_row)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_tab("Inspector", _body)
	_empty = Label.new()
	_empty.text = "Select an item"
	_empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_empty.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_body.add_child(_empty)
	_footer = VBoxContainer.new()  # web inspector footer: compact always-there sections (Playlists, WO-603)
	_col.add_child(_footer)


## WO-783: a tab of the right-hand column (scrolled). Its pane stays owned by the feature, like a page.
func add_tab(title: String, pane: Control) -> void:
	var b := Button.new()
	b.text = title
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	var i := _tabs.size()
	b.pressed.connect(func() -> void: show_tab(i))
	_tab_row.add_child(b)
	_tabs.append(b)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if pane.get_parent() != null:
		pane.get_parent().remove_child(pane)
	pane.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pane.visible = true
	scroll.add_child(pane)
	_col.add_child(scroll)
	if _footer != null:
		_col.move_child(_footer, -1)
	_panes.append(scroll)
	scroll.visible = i == 0  # a new tab does not take the column over
	show_tab(tab_shown())


func show_tab(i: int) -> void:
	for k in _panes.size():
		_panes[k].visible = k == i
		var on := k == i  # WO-668: the active title is white (blue read as a link), the others muted
		_tabs[k].add_theme_color_override("font_color", ThemeBuilder.TEXT if on else ThemeBuilder.TEXT_MUTED)
		_tabs[k].add_theme_color_override("font_hover_color", ThemeBuilder.TEXT)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0, 0, 0, 0)
		sb.border_color = ThemeBuilder.ACCENT
		sb.border_width_bottom = 2 if on else 0
		sb.set_content_margin_all(4)
		for st in ["normal", "hover", "pressed", "hover_pressed"]:
			_tabs[k].add_theme_stylebox_override(st, sb)


func tab_shown() -> int:
	for k in _panes.size():
		if _panes[k].visible:
			return k
	return 0


## Show `page` (re-parented here on first use), hiding whatever was shown.
func present(page: Control) -> void:
	if page.get_parent() != _body:
		if page.get_parent() != null:
			page.get_parent().remove_child(page)
		page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_body.add_child(page)
		page.visibility_changed.connect(_sync_empty)
	_released.erase(page)
	for c in _body.get_children():
		if c != page and c != _empty:
			if (c as Control).visible:
				_covered = c
			(c as Control).visible = false
	page.visible = true
	show_tab(0)
	_sync_empty()


## A compact section under the pages (web inspector footer), present on every tab, outside the scroll.
func add_footer(section: Control) -> void:
	var sep := HSeparator.new()
	_footer.add_child(sep)
	_footer.add_child(section)


## The selection that owned `page` went away. When `page` was covering another page that is still selected (a look
## layer under a media file — WO-603: ctrl-clicking a second file gives the layer's playlist drop zone back), that
## page shows again.
func release(page: Control) -> void:
	_released[page] = true
	if page.get_parent() == _body:
		var was := page.visible
		page.visible = false
		if was and is_instance_valid(_covered) and _covered != page and _covered.get_parent() == _body and not _released.has(_covered):
			_covered.visible = true
	_sync_empty()


func showing(page: Control) -> bool:
	return page.get_parent() == _body and page.visible


func _sync_empty() -> void:
	var any := false
	for c in _body.get_children():
		if c != _empty and (c as Control).visible:
			any = true
	_empty.visible = not any
