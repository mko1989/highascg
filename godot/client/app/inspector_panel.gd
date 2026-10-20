extends PanelContainer
## WO-608 R2 — the one right-hand Inspector column (web aside.panel-inspector), always present; its content follows
## the selection. Features never open their own right-hand panels: they hand a page to `present()` (media file, look
## layer, screen timer, global border, later timeline clip/flag/layer…) and `release()` it when the selection goes.
## One page shows at a time; with none, "Select an item" (web empty state). Pages stay owned by their feature (the
## panel only re-parents them), so a page keeps its state while another is shown.

const ThemeBuilder := preload("res://app/theme_builder.gd")

static var current: Node  # the shell's instance — features reach it through InspectorPanel.current

var _body: VBoxContainer
var _footer: VBoxContainer
var _empty: Label
var _title: Label
var _covered: Control = null  # the page the last present() hid — shown again when that page is released
var _released := {}  # pages their owner released (never brought back by a release of another page)


func _init() -> void:
	current = self


func _ready() -> void:
	add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 0, 0))
	var col := VBoxContainer.new()
	add_child(col)
	_title = Label.new()
	_title.text = "Inspector"
	_title.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	col.add_child(_title)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(scroll)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_body)
	_empty = Label.new()
	_empty.text = "Select an item"
	_empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_empty.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_body.add_child(_empty)
	_footer = VBoxContainer.new()  # web inspector footer: compact always-there sections (Playlists, WO-603)
	col.add_child(_footer)


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
