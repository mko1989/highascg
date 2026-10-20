extends HBoxContainer
## WO-608 header — the web header-bar.js middle group: Server ▾ (running Caspar config vs the app's channel layout,
## state.configComparison — header-bar-config-strip.js), ⚙ (the Settings tab here; the web opens a modal), FTB
## (POST /api/ftb {} — the server fades every PGM + PRV layer to black, then clears) and the status badges.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const UiIcons := preload("res://app/ui_icons.gd")
const M := preload("res://app/header_badges_model.gd")
const Badges := preload("res://app/header_badges.gd")

signal settings_requested
signal notice(n: Dictionary)

var server_btn: Button
var settings_btn: Button
var ftb_btn: Button
var badges: Badges
var _strip: PopupPanel
var _strip_box: VBoxContainer


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	server_btn = Button.new()
	server_btn.text = "Server ▾"
	server_btn.focus_mode = Control.FOCUS_NONE
	server_btn.tooltip_text = "Compare running CasparCG config with module screen settings"
	server_btn.pressed.connect(_toggle_strip)
	add_child(server_btn)
	_strip = PopupPanel.new()
	_strip.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1))
	_strip.popup_hide.connect(func() -> void: server_btn.text = "Server ▾")
	_strip_box = VBoxContainer.new()
	_strip.add_child(_strip_box)
	add_child(_strip)
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
	badges = Badges.new()
	add_child(badges)
	Store.changed.connect(func(p: String, _v: Variant) -> void:
		if p == "configComparison" or p == "*":
			_tint_server())
	_tint_server()


## A mismatch shows on the button itself (the web only shows it once the strip is open).
func _tint_server() -> void:
	var strip := M.config_strip(Store.get_value("configComparison"))
	server_btn.add_theme_color_override("font_color", ThemeBuilder.TEXT if strip.ok else ThemeBuilder.WARN)
	server_btn.tooltip_text = "Compare running CasparCG config with module screen settings\n" + str(strip.summary)
	if _strip.visible:
		_fill_strip(strip)


func _toggle_strip() -> void:
	if _strip.visible:
		_strip.hide()
		return
	_fill_strip(M.config_strip(Store.get_value("configComparison")))
	server_btn.text = "Server ▴"
	_strip.position = Vector2i(server_btn.global_position + Vector2(0, server_btn.size.y + 4))  # embedded: window coords
	_strip.reset_size()
	_strip.popup()


func _fill_strip(strip: Dictionary) -> void:
	for c in _strip_box.get_children():
		c.queue_free()
	var sum := Label.new()
	sum.text = str(strip.summary)
	sum.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sum.custom_minimum_size.x = 460
	sum.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if strip.ok else ThemeBuilder.WARN)
	_strip_box.add_child(sum)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 18)
	for cell in ["#", "Module expects", "Server"]:
		var h := Label.new()
		h.text = cell
		h.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		grid.add_child(h)
	for row in strip.rows:
		for cell in row:
			var l := Label.new()
			l.text = str(cell)
			grid.add_child(l)
	_strip_box.add_child(grid)
	for msg in strip.issues:
		var l := Label.new()
		l.text = "• " + str(msg)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size.x = 460
		_strip_box.add_child(l)
	if str(strip.hint) != "":
		var l := Label.new()
		l.text = str(strip.hint)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size.x = 460
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_strip_box.add_child(l)


func ftb() -> void:
	if ftb_btn.disabled:
		return
	ftb_btn.disabled = true
	var res: Dictionary = await Api.post_json("/api/ftb", {})
	ftb_btn.disabled = false
	if not res.ok:
		notice.emit({"text": "FTB: " + str(res.error), "tone": "error"})
