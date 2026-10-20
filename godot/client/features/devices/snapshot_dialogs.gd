extends Node
## WO-605 slice 8 — the Save / Load device snapshot dialogs (web device-view-snapshot-modals.js, WO-49) over
## snapshot_flow.gd. Save is the Devices header's download-arrow button (WO-445 re-wiring); Load has no Devices
## entry (WO-435 removed it — snapshots ride in the project file) and is opened by the hardware-reconcile dialog
## (WO-608) through open_load().
## The rear-panel PNG is the window's pixels under the rear panel, grabbed when Save is opened with the cables hidden
## (the web's html-to-image renders the element alone, at 2×; this is 1× and would include a dialog drawn over it).
## The file goes through a save dialog (default ~/Downloads/<slug>.json) instead of a browser download.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/devices/snapshot_model.gd")
const Flow := preload("res://features/devices/snapshot_flow.gd")
const FilePick := preload("res://features/devices/file_pick.gd")

signal status(text: String, ok: bool)
signal applied  ## settings + device view changed (the web's highascg-settings-applied + onApplied)
signal _decided(ok: bool)

var _shot: Variant = null  # the rear-panel visual grabbed at open (null = capture failed)
var _save: ConfirmationDialog
var _name: LineEdit
var _file: Label
var _embed: CheckBox
var _load: AcceptDialog
var _load_flow: Flow
var _picked_name: Label
var _mode: OptionButton
var _preview: Label
var _apply_btn: Button
var _busy := false


class _Io:
	extends RefCounted
	var c

	func _init(owner: Node) -> void:
		c = owner

	static func _web(r: Dictionary) -> Dictionary:
		var err := ""
		if not r.ok:
			err = "HTTP %d: %s" % [r.status, r.error] if int(r.get("status", 0)) > 0 else str(r.error)
		return {"ok": r.ok, "data": r.data, "error": err}

	func get_json(path: String) -> Dictionary:
		return _web(await Api.get_json(path))

	func post_json(path: String, body: Variant) -> Dictionary:
		return _web(await Api.post_json(path, body))

	func status(text: String, ok: bool) -> void:
		c.status.emit(text, ok)

	func confirm(text: String) -> bool:
		return await c._confirm(text)

	func capture() -> Variant:
		return c._shot

	func download(file_name: String, text: String) -> String:
		return await c._write(file_name, text)

	func applied() -> void:
		await Settings.load_from_server()
		c.applied.emit()


## Any of the dialogs is up (the Devices tab's click capture stands down).
func is_open() -> bool:
	for w in get_children():
		if w is Window and w.visible:
			return true
	return false


## The header button: a download arrow (the web's icon), tooltip = the web's title.
static func save_button(on_press: Callable) -> Button:
	var b := Button.new()
	b.custom_minimum_size = Vector2(30, 0)
	b.tooltip_text = M.SAVE_TIP
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(on_press)
	b.draw.connect(func() -> void:
		var c := b.size / 2.0
		var col: Color = ThemeBuilder.TEXT
		b.draw_line(c + Vector2(0, -8), c + Vector2(0, 3), col, 1.75, true)
		b.draw_polyline([c + Vector2(-4, -1), c + Vector2(0, 3), c + Vector2(4, -1)], col, 1.75, true)
		b.draw_polyline([c + Vector2(-8, 5), c + Vector2(-8, 8), c + Vector2(8, 8), c + Vector2(8, 5)], col, 1.75, true))
	return b


## Header button: grab the rear panel (cables hidden for one frame), then open the dialog.
func open_save(rear: Control, cables: CanvasItem) -> void:
	if _busy:
		return
	_shot = await _capture(rear, cables)
	if _save == null:
		_build_save()
	_name.text = ""  # the web builds a fresh modal per open
	_embed.button_pressed = true
	_file.text = M.file_label("")
	_save.popup_centered(Vector2i(460, 0))
	_name.grab_focus()


func _capture(rear: Control, cables: CanvasItem) -> Variant:
	if rear == null or not rear.is_visible_in_tree():
		return null
	var was := cables != null and cables.visible
	if was:
		cables.visible = false
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if was:
		cables.visible = true
	if img == null:
		return null
	var k := Vector2(img.get_size()) / get_viewport().get_visible_rect().size
	var r := Rect2i(Rect2(rear.get_global_rect().position * k, rear.get_global_rect().size * k)).intersection(Rect2i(Vector2i.ZERO, img.get_size()))
	if r.size.x <= 0 or r.size.y <= 0:
		return null
	var png := img.get_region(r).save_png_to_buffer()
	return {"mimeType": "image/png", "encoding": "base64", "width": r.size.x, "height": r.size.y,
		"data": Marshalls.raw_to_base64(png)}


func _build_save() -> void:
	_save = ConfirmationDialog.new()
	_save.title = M.SAVE_TITLE
	_save.ok_button_text = "Save…"
	_save.dialog_hide_on_ok = false
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.add_child(_text("Device name", ThemeBuilder.TEXT, 12))
	_name = LineEdit.new()
	_name.placeholder_text = M.NAME_HINT
	_name.text_changed.connect(func(t: String) -> void: _file.text = M.file_label(t))
	_name.text_submitted.connect(func(_t: String) -> void: _do_save())
	v.add_child(_name)
	_file = _text(M.file_label(""), ThemeBuilder.TEXT_MUTED, 11)
	v.add_child(_file)
	_embed = CheckBox.new()
	_embed.text = M.CAPTURE
	_embed.button_pressed = true
	v.add_child(_embed)
	var note := _text(M.SAVE_NOTE, ThemeBuilder.TEXT_MUTED, 11)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size.x = 420  # an autowrapped label without a width asks for a line per word
	v.add_child(note)
	_save.add_child(v)
	_save.confirmed.connect(_do_save)
	add_child(_save)


func _do_save() -> void:
	if _busy:
		return
	_busy = true
	_save.get_ok_button().disabled = true
	var done: bool = await Flow.new(_Io.new(self)).save(_name.text, _embed.button_pressed)
	_save.get_ok_button().disabled = false
	_busy = false
	if done:
		_save.hide()


## The file dialog for the saved JSON → the written file's name ("" = cancelled / not written).
func _write(file_name: String, text: String) -> String:
	var path: String = await FilePick.save_path(self, "Save device snapshot", file_name)
	if path == "":
		return ""
	var err := FilePick.write_text(path, text)
	if err != "":
		status.emit("Save failed: " + err, false)
		return ""
	return path.get_file()


## The Load dialog: pick a .json, pick the mode, Preview (server dry run), Apply.
func open_load() -> void:
	if _load == null:
		_build_load()
	_load_flow = Flow.new(_Io.new(self))
	_picked_name.text = ""
	_mode.select(0)
	_render_load()
	_load.popup_centered(Vector2i(520, 0))


func _build_load() -> void:
	_load = AcceptDialog.new()
	_load.title = M.LOAD_TITLE
	_load.ok_button_text = "Cancel"
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	var intro := _text(M.LOAD_INTRO, ThemeBuilder.TEXT_MUTED, 12)
	intro.custom_minimum_size.x = 480
	intro.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(intro)
	var row := HBoxContainer.new()
	var pick := Button.new()
	pick.text = "Choose file…"
	pick.pressed.connect(_pick_file)
	row.add_child(pick)
	_picked_name = _text("", ThemeBuilder.TEXT_MUTED, 11)
	row.add_child(_picked_name)
	v.add_child(row)
	_mode = OptionButton.new()
	for m in M.MODES:
		_mode.add_item(m[1])
	v.add_child(_mode)
	_preview = _text("", ThemeBuilder.TEXT, 11)
	_preview.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_preview.custom_minimum_size = Vector2(480, 120)
	v.add_child(_preview)
	_load.add_child(v)
	_load.add_button("Preview", true, "preview")
	_apply_btn = _load.add_button("Apply", true, "apply")
	_load.custom_action.connect(func(a: StringName) -> void:
		if _busy:
			return
		_busy = true
		var m: String = M.MODES[_mode.selected][0]
		if a == &"preview":
			_preview.text = M.CHECKING
			await _load_flow.dry_run(m)
		elif a == &"apply" and await _load_flow.apply(m):
			_load.hide()
		_busy = false
		_render_load())
	add_child(_load)


func _render_load() -> void:
	_preview.text = _load_flow.preview
	_apply_btn.disabled = not _load_flow.can_apply


func _pick_file() -> void:
	var path: String = await FilePick.open_path(self, "Open a File")
	if path == "":
		return
	_picked_name.text = path.get_file()
	var text := FileAccess.get_file_as_string(path)
	_load_flow.on_file(text if FileAccess.get_open_error() == OK else null)
	_render_load()


func _confirm(text: String) -> bool:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = text
	dlg.title = "Confirm"
	add_child(dlg)
	dlg.confirmed.connect(func() -> void: _decided.emit(true))
	dlg.canceled.connect(func() -> void: _decided.emit(false))
	dlg.popup_centered()
	var ok: bool = await _decided
	dlg.queue_free()
	return ok


func _text(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
