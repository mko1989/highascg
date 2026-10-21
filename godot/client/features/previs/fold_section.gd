extends VBoxContainer
## WO-640 — one collapsible section of the previs Inspector page: a "▾ Title" row folds its content. The open state
## is remembered per title in user://ui.cfg [previs_folds] (a per-viewer convenience; nothing saved = open).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const UI_CFG := "user://ui.cfg"

var title := ""
var content := VBoxContainer.new()
var _toggle := Button.new()


func _init(t: String = "", parts: Array = []) -> void:
	title = t
	_toggle.flat = true
	_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_toggle.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_toggle.pressed.connect(func() -> void: set_open(not content.visible, true))
	add_child(_toggle)
	content.add_theme_constant_override("separation", 6)
	add_child(content)
	for p in parts:
		content.add_child(p)
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	set_open(cfg.get_value("previs_folds", t, true) == true)


func is_open() -> bool:
	return content.visible


func set_open(open: bool, save := false) -> void:
	content.visible = open
	_toggle.text = ("▾ " if open else "▸ ") + title
	if save:
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		cfg.set_value("previs_folds", title, open)
		cfg.save(UI_CFG)
