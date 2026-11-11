extends HBoxContainer
## WO-1039 MVR — the canvas toolbar of Studio's MVR tab (index.html .canvas-toolbar): "Layout W × H", the device
## layouts menu (hidden when the switcher has none), Fix aspect ratios, Undo, Redo and the drag Snap menu.

signal template_chosen(key: String)
signal fix_requested
signal undo_requested(redo: bool)

const Kit := preload("res://features/settings/pane_kit.gd")
const SNAPS := [1, 8, 16, 32]

var _resolution: Label
var _templates: OptionButton
var _fix: Button
var _undo: Button
var _redo: Button
var _snap: OptionButton


func _init() -> void:
	add_theme_constant_override("separation", 8)
	_resolution = Label.new()
	_resolution.text = "Layout —"
	_resolution.clip_text = true
	_resolution.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(_resolution)
	_templates = OptionButton.new()
	_templates.tooltip_text = "Device MVR layouts: applying one replaces every window on this MVR output"
	_templates.visible = false
	_templates.item_selected.connect(func(i: int) -> void:
		var key := str(_templates.get_item_metadata(i))
		_templates.select(0)
		if key != "":
			template_chosen.emit(key))
	add_child(_templates)
	_fix = Kit.button(self, "Fix aspect ratios", func() -> void: fix_requested.emit())
	_fix.tooltip_text = "Fit input and PGM/PVW screen content to its source ratio, accounting for UMD and avoiding overlaps"
	_undo = Kit.button(self, "Undo", func() -> void: undo_requested.emit(false))
	_undo.tooltip_text = "Undo (Ctrl+Z)"
	_redo = Kit.button(self, "Redo", func() -> void: undo_requested.emit(true))
	_redo.tooltip_text = "Redo (Ctrl+Shift+Z)"
	var l := Label.new()
	l.text = "Snap"
	add_child(l)
	_snap = OptionButton.new()
	for s in SNAPS:
		_snap.add_item("Off" if s == 1 else "%d px" % s)
	_snap.tooltip_text = "Drag snapping"
	add_child(_snap)


## Drag snap in output pixels (1 = off).
func snap() -> int:
	return int(SNAPS[maxi(_snap.selected, 0)])


func set_resolution(text: String) -> void:
	_resolution.text = text


## [[label, "type:id"]…] from mvr_model.gd template_items.
func set_templates(items: Array) -> void:
	_templates.clear()
	_templates.add_item("Apply layout…" if not items.is_empty() else "No device layouts")
	_templates.set_item_metadata(0, "")
	for i in items.size():
		_templates.add_item(str(items[i][0]))
		_templates.set_item_metadata(i + 1, str(items[i][1]))
	_templates.select(0)
	_templates.visible = not items.is_empty()


func set_enabled(busy: bool, has_windows: bool, can_undo: bool, can_redo: bool) -> void:
	_templates.disabled = busy
	_fix.disabled = busy or not has_windows
	_undo.disabled = busy or not can_undo
	_redo.disabled = busy or not can_redo
