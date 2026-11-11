extends VBoxContainer
## WO-1035 — "PixelHue" in the Devices tab's right column (with the lighting consoles and the linked servers): the
## switcher HighAsCG reads layer positions from. One switcher per server; its address is kept on that server only
## (POST /api/pixelhue/config → ~/.highascg/pixelhue.json), not in the show — another venue has another switcher.
## "+" adds it, the row shows whether it answers, Test asks again, Edit changes the address, ✕ removes it after asking.
## HighAsCG only READS the switcher (Sources ▸ Live ▸ PixelHue layers, the layer inspector's "Match PixelHue layer").
## Requests go through DevicesTarget.api, so a linked server being edited shows and changes its own switcher.

const M := preload("res://features/live/pixelhue_match_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

var _host := ""
var _drive := false  # WO-1038: looks move the switcher's layers on a program take
var _list: VBoxContainer
var _status: Label
var _plus: Button
var _loading := false


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	head.add_child(_small("PIXELHUE", ThemeBuilder.TEXT_MUTED))
	_plus = Button.new()
	_plus.text = "+"
	_plus.flat = true
	_plus.tooltip_text = "Add the PixelHue switcher: HighAsCG reads its layers and where they are (it never changes the switcher)"
	_plus.pressed.connect(_edit)
	head.add_child(_plus)
	add_child(head)
	_list = VBoxContainer.new()
	add_child(_list)
	_status = _small("", ThemeBuilder.TEXT_MUTED)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)
	DevicesTarget.target_changed.connect(reload)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			reload())
	if is_visible_in_tree():
		reload()


func reload() -> void:
	if _loading:
		return
	_loading = true
	var r: Dictionary = await DevicesTarget.api.get_json("/api/pixelhue/config")
	_loading = false
	_host = str(r.data.get("host", "")) if r.ok and r.data is Dictionary else ""
	_drive = r.ok and r.data is Dictionary and r.data.get("drive") == true
	_render()
	if _host != "":
		_test()
	else:
		_status.text = ""


func _render() -> void:
	for c in _list.get_children():
		c.queue_free()
	_plus.visible = _host == ""
	if _host == "":
		_list.add_child(_small("No switcher. Click + to add one; its layers then appear under Sources ▸ Live.", ThemeBuilder.TEXT_MUTED))
		return
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1))
	var top := HBoxContainer.new()
	card.add_child(top)
	var name_l := Label.new()
	name_l.text = "PixelHue · " + _host
	name_l.clip_text = true
	name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(name_l)
	var test := Button.new()
	test.text = "Test"
	test.tooltip_text = "Read the switcher's layers now (nothing is changed on it)"
	test.pressed.connect(_test)
	top.add_child(test)
	var ed := Button.new()
	ed.text = "Edit"
	ed.pressed.connect(_edit)
	top.add_child(ed)
	var x := Button.new()
	x.text = "✕"
	x.flat = true
	x.tooltip_text = "Remove the switcher (its layers leave Sources ▸ Live; layers already in looks stay where they are)"
	x.pressed.connect(func() -> void: Kit.confirm(self, "Remove the PixelHue switcher at %s?" % _host, func() -> void: _store("")))
	top.add_child(x)
	_list.add_child(card)
	var drive := CheckBox.new()  # WO-1038 — the only thing that lets HighAsCG write to the switcher
	drive.text = "Looks drive the switcher"
	drive.tooltip_text = "On: taking a look to program moves the switcher layers its PixelHue placeholders came from onto their rectangles in the look.\nOff (default): HighAsCG only reads the switcher."
	drive.button_pressed = _drive
	drive.toggled.connect(func(on: bool) -> void: _set_drive(on))
	_list.add_child(drive)


func _edit() -> void:
	Kit.prompt(self, "PixelHue address (the switcher, or the PC running its control software)", _host, func(text: String) -> void: _store(text.strip_edges()))


func _store(host: String) -> void:
	_status.text = "Saving…"
	var r: Dictionary = await DevicesTarget.api.post_json("/api/pixelhue/config", {"host": host})
	if not r.ok:
		_status.text = "The server refused it: %s" % (str(r.data.get("error", "")) if r.get("data") is Dictionary else str(r.get("error", "no answer")))
		return
	reload()


func _set_drive(on: bool) -> void:
	var r: Dictionary = await DevicesTarget.api.post_json("/api/pixelhue/config", {"drive": on})
	_status.text = ("Looks now move the switcher's layers on a program take." if on else "HighAsCG only reads the switcher.") if r.ok else "The server refused it."
	_drive = r.ok and r.data is Dictionary and r.data.get("drive") == true


func _test() -> void:
	_status.text = "Testing…"
	var r: Dictionary = await DevicesTarget.api.get_json("/api/pixelhue/layers?scene=pgm")
	_status.text = M.status_line(r.ok, r.get("data"))


func _small(text: String, col: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", col)
	return l
