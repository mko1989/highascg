extends PanelContainer
## WO-608 R2 — the one right-hand Inspector column (web aside.panel-inspector), always present; its content follows
## the selection. Features never open their own right-hand panels: they hand a page to `present()` (media file, look
## layer, screen timer, global border, later timeline clip/flag/layer…) and `release()` it when the selection goes.
## One page shows at a time; with none, "Select an item" (web empty state). Pages stay owned by their feature (the
## panel only re-parents them), so a page keeps its state while another is shown.

const ThemeBuilder := preload("res://app/theme_builder.gd")

static var current: Node  # the shell's instance — features reach it through InspectorPanel.current

var _body: VBoxContainer
var _empty: Label
var _title: Label


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


## Show `page` (re-parented here on first use), hiding whatever was shown.
func present(page: Control) -> void:
	if page.get_parent() != _body:
		if page.get_parent() != null:
			page.get_parent().remove_child(page)
		page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_body.add_child(page)
		page.visibility_changed.connect(_sync_empty)
	for c in _body.get_children():
		if c != page and c != _empty:
			(c as Control).visible = false
	page.visible = true
	_sync_empty()


## The selection that owned `page` went away.
func release(page: Control) -> void:
	if page.get_parent() == _body:
		page.visible = false
	_sync_empty()


func showing(page: Control) -> bool:
	return page.get_parent() == _body and page.visible


func _sync_empty() -> void:
	var any := false
	for c in _body.get_children():
		if c != _empty and (c as Control).visible:
			any = true
	_empty.visible = not any
