extends HBoxContainer
## WO-608 header — the web header-bar.js middle group: ⚙ (the Settings tab here; the web opens a modal) and FTB
## (POST /api/ftb {} — the server fades every PGM + PRV layer to black, then clears).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const UiIcons := preload("res://app/ui_icons.gd")

signal settings_requested
signal notice(n: Dictionary)

var settings_btn: Button
var ftb_btn: Button


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	settings_btn = UiIcons.button("cog", "Application settings")
	settings_btn.flat = true
	settings_btn.pressed.connect(func() -> void: settings_requested.emit())
	add_child(settings_btn)
	ftb_btn = Button.new()
	ftb_btn.text = "FTB"
	ftb_btn.focus_mode = Control.FOCUS_NONE
	ftb_btn.tooltip_text = "Fade to black: fade out all program and preview layers, then clear"
	var red := ThemeBuilder.box(ThemeBuilder.ACCENT_RED.darkened(0.25), ThemeBuilder.ACCENT_RED, 1)
	ftb_btn.add_theme_stylebox_override("normal", red)
	ftb_btn.add_theme_stylebox_override("hover", ThemeBuilder.box(ThemeBuilder.ACCENT_RED, ThemeBuilder.ACCENT_RED, 1))
	ftb_btn.add_theme_color_override("font_color", Color.WHITE)
	ftb_btn.pressed.connect(ftb)
	add_child(ftb_btn)


func ftb() -> void:
	if ftb_btn.disabled:
		return
	ftb_btn.disabled = true
	var res: Dictionary = await Api.post_json("/api/ftb", {})
	ftb_btn.disabled = false
	if not res.ok:
		notice.emit({"text": "FTB: " + str(res.error), "tone": "error"})
