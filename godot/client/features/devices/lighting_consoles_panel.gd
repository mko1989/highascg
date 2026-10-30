extends VBoxContainer
## WO-837 — "Lighting consoles" in the Devices tab's right column (under the cables list): the consoles HighAsCG
## sends light cues to (timeline `light` flags). GET / POST / DELETE /api/lighting/consoles, POST …/:id/test (a
## harmless query or a go on a scratch list — the answer line says what was sent). "+" adds, a row's Edit opens the
## form (type, host, port; grandMA3: OSC prefix; generic OSC: one address + arguments per action), ✕ removes after asking.
## Requests go through DevicesTarget.api, so a linked server being edited shows and changes its own consoles.

const M := preload("res://features/devices/lighting_console_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const NF := preload("res://core/numeric_field.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

var _consoles: Array = []
var _list: VBoxContainer
var _status: Label
var _plus: Button
var _loading := false
# the open form
var _dlg: ConfirmationDialog
var _form_id := ""
var _name: LineEdit
var _kind: OptionButton
var _host: LineEdit
var _port: LineEdit
var _prefix: LineEdit
var _prefix_row: Array
var _tpl_box: VBoxContainer
var _tpl := {}  # template key → [address LineEdit, args LineEdit]
var _err: Label


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	head.add_child(_small("LIGHTING CONSOLES", ThemeBuilder.TEXT_MUTED))
	_plus = Button.new()
	_plus.text = "+"
	_plus.flat = true
	_plus.tooltip_text = "Add a lighting console (MagicQ, Eos, grandMA3 or generic OSC) the timeline's light cues can drive"
	_plus.pressed.connect(func() -> void: _open(M.to_form({"kind": "magicq"})))
	head.add_child(_plus)
	add_child(head)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	add_child(_list)
	_status = _small("", ThemeBuilder.TEXT_MUTED)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)
	_build_form()
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
	var r: Dictionary = await DevicesTarget.api.get_json("/api/lighting/consoles")
	_loading = false
	if r.ok and r.data is Dictionary and r.data.get("consoles") is Array:
		_consoles = r.data.consoles
	elif not r.ok:
		_status.text = "Could not load the consoles: %s" % str(r.get("error", "no answer"))
	_render()


func _render() -> void:
	for c in _list.get_children():
		c.queue_free()
	_plus.disabled = _consoles.size() >= M.MAX_CONSOLES
	if _consoles.is_empty():
		_list.add_child(_small("No consoles. Click + to add one; a timeline's Light cue flag picks from these.", ThemeBuilder.TEXT_MUTED))
	for c in _consoles:
		if c is Dictionary:
			_list.add_child(_row(c))


func _row(c: Dictionary) -> Control:
	var id := str(c.get("id", ""))
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1))
	var top := HBoxContainer.new()
	card.add_child(top)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(col)
	var name_l := Label.new()
	name_l.text = str(c.get("name", id))
	name_l.clip_text = true
	col.add_child(name_l)
	var sum := _small(M.summary(c), ThemeBuilder.TEXT_MUTED)
	sum.clip_text = true
	sum.tooltip_text = sum.text
	col.add_child(sum)
	var test := Button.new()
	test.text = "Test"
	test.tooltip_text = "Send a harmless message to this console (a query, or a go on a scratch list)"
	test.pressed.connect(func() -> void: _test(id, test))
	top.add_child(test)
	var ed := Button.new()
	ed.text = "Edit"
	ed.pressed.connect(func() -> void: _open(M.to_form(c)))
	top.add_child(ed)
	var x := Button.new()
	x.text = "✕"
	x.flat = true
	x.tooltip_text = "Remove this console (timeline light cues that use it will say so)"
	x.pressed.connect(func() -> void:
		Kit.confirm(self, "Remove the console \"%s\"?" % str(c.get("name", id)), func() -> void: _remove(id)))
	top.add_child(x)
	return card


func _test(id: String, b: Button) -> void:
	b.disabled = true
	b.text = "…"
	_status.text = "Testing…"
	var r: Dictionary = await DevicesTarget.api.post_json("/api/lighting/consoles/%s/test" % id.uri_encode(), {})
	if is_instance_valid(b):
		b.disabled = false
		b.text = "Test"
	_status.text = M.test_line(r)


func _remove(id: String) -> void:
	var r: Dictionary = await DevicesTarget.api.delete_json("/api/lighting/consoles/" + id.uri_encode())
	_status.text = "" if r.ok else "Could not remove: %s" % str(r.get("error", "no answer"))
	reload()


## ── the add / edit form ──

func _build_form() -> void:
	_dlg = ConfirmationDialog.new()
	_dlg.title = "Lighting console"
	_dlg.min_size = Vector2i(520, 0)
	_dlg.dialog_hide_on_ok = false
	_dlg.confirmed.connect(_save)
	add_child(_dlg)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	_dlg.add_child(v)
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 10)
	v.add_child(g)
	_name = LineEdit.new()
	_name.placeholder_text = "Front of house"
	_row2(g, "Name", _name)
	_kind = OptionButton.new()
	for k in M.KINDS:
		_kind.add_item(str(k.label))
	_kind.item_selected.connect(func(_i: int) -> void: _kind_changed())
	_row2(g, "Type", _kind)
	_host = LineEdit.new()
	_host.placeholder_text = "192.168.1.20"
	_row2(g, "Host", _host)
	_port = LineEdit.new()
	NF.math_line(_port, true, 1, 65535, Callable(), true)  # blank = the type's default port
	_row2(g, "OSC port", _port)
	_prefix = LineEdit.new()
	_prefix.placeholder_text = "optional, as set on the console's OSC line"
	_prefix_row = _row2(g, "OSC prefix", _prefix)
	_tpl_box = VBoxContainer.new()
	v.add_child(_tpl_box)
	var note := _small("Each action sends one OSC message: an address and arguments. In both you may use %s." % M.PLACEHOLDERS, ThemeBuilder.TEXT_MUTED)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_tpl_box.add_child(note)
	var tg := GridContainer.new()
	tg.columns = 3
	tg.add_theme_constant_override("h_separation", 8)
	_tpl_box.add_child(tg)
	for t in M.TEMPLATES:
		var l := Label.new()
		l.text = str(t[1])
		tg.add_child(l)
		var a := LineEdit.new()
		a.placeholder_text = str(t[2]).split("  ")[0]
		a.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		tg.add_child(a)
		var args := LineEdit.new()
		args.placeholder_text = "arguments" if str(t[2]).find("  ") < 0 else str(t[2]).split("  ")[1]
		args.custom_minimum_size.x = 130
		tg.add_child(args)
		_tpl[str(t[0])] = [a, args]
	_err = _small("", ThemeBuilder.ERROR)
	_err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_err)


func _row2(g: GridContainer, label: String, c: Control) -> Array:
	var l := Label.new()
	l.text = label
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)
	return [l, c]


func _kind_changed() -> void:
	var kind := _kind_id()
	for c in _prefix_row:
		(c as Control).visible = kind == "grandma3"
	_tpl_box.visible = kind == "osc"
	_port.placeholder_text = str(M.default_port(kind)) if M.default_port(kind) > 0 else "required"
	_dlg.reset_size()


func _kind_id() -> String:
	return str(M.KINDS[maxi(0, _kind.selected)].kind)


func _open(form: Dictionary) -> void:
	_form_id = str(form.get("id", ""))
	_name.text = str(form.name)
	for i in M.KINDS.size():
		if M.KINDS[i].kind == form.kind:
			_kind.select(i)
	_host.text = str(form.host)
	_port.text = str(form.port)
	_prefix.text = str(form.prefix)
	for k in _tpl:
		var t: Variant = form.templates.get(k)
		_tpl[k][0].text = str(t.address) if t is Dictionary else ""
		_tpl[k][1].text = str(t.args) if t is Dictionary else ""
	_err.text = ""
	_dlg.title = "Edit lighting console" if _form_id != "" else "Add lighting console"
	_kind_changed()
	_dlg.popup_centered()
	_name.grab_focus.call_deferred()


func _form() -> Dictionary:
	var tpl := {}
	for k in _tpl:
		tpl[k] = {"address": _tpl[k][0].text, "args": _tpl[k][1].text}
	return {"id": _form_id, "name": _name.text, "kind": _kind_id(), "host": _host.text, "port": _port.text, "prefix": _prefix.text, "templates": tpl}


func _save() -> void:
	var f := M.to_record(_form())
	if not f.ok:
		_err.text = str(f.error)
		return
	_dlg.get_ok_button().disabled = true
	var r: Dictionary = await DevicesTarget.api.post_json("/api/lighting/consoles", f.record)
	_dlg.get_ok_button().disabled = false
	if not r.ok:
		_err.text = "The server refused it: %s" % str(r.get("error", "no answer"))
		return
	_dlg.hide()
	_status.text = ""
	reload()


func _small(text: String, col: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", col)
	return l
