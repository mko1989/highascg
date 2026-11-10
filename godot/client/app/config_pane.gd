extends VBoxContainer
## The "casparcg.config" pane of the logs window (owner 10.11). Read-only by default: "On disk" is the file Caspar
## runs (GET /api/caspar-config/current), "Generated" is what the node would write now (/generate); differing lines are
## marked and can be jumped to. "Edit" turns On disk into an editor; "Apply edited config" sends it as the one-shot
## `xml` of POST /api/caspar-config/apply (the server snapshots what is on air and puts it back after the restart).
## Talks only to this client's own node. Rules and wording live in config_view_model.gd.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://app/config_view_model.gd")
const Plan := preload("res://features/devices/apply_plan_model.gd")
const Platform := preload("res://core/platform.gd")

const MARK_DISK := Color(0.82, 0.36, 0.30, 0.28)
const MARK_GEN := Color(0.25, 0.60, 0.95, 0.25)

var _head: Label
var _disk_btn: Button
var _gen_btn: Button
var _edit: CheckButton
var _note: Label
var _prev: Button
var _next: Button
var _text: TextEdit
var _keep: CheckBox
var _apply: Button
var _revert: Button
var _result: Label
var _confirm: ConfirmationDialog
var _disk := ""
var _generated := ""
var _have_disk := false
var _path := ""
var _mtime: Variant = null
var _dirty: Variant = null
var _override := ""
var _server := ""
var _diff := {}
var _showing_generated := false
var _loading := false
var _busy := false


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	var title := Label.new()
	title.text = "casparcg.config"
	title.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(title)
	_head = Label.new()
	_head.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_head.custom_minimum_size.x = 300
	_head.add_theme_font_size_override("font_size", 12)
	add_child(_head)
	add_child(_toolbar())
	_text = TextEdit.new()
	_text.editable = false
	_text.draw_tabs = true
	_text.gutters_draw_line_numbers = true
	_text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var mono := SystemFont.new()
	mono.font_names = PackedStringArray(["DejaVu Sans Mono", "Liberation Mono", "monospace"])
	_text.add_theme_font_override("font", mono)
	_text.add_theme_font_size_override("font_size", 12)
	_text.text_changed.connect(_on_edited)
	add_child(_text)
	add_child(_edit_row())
	_result = Label.new()
	_result.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_result.custom_minimum_size.x = 300
	add_child(_result)
	_confirm = ConfirmationDialog.new()
	_confirm.title = "Apply edited casparcg.config"
	_confirm.ok_button_text = "Apply and restart Caspar"
	_confirm.dialog_autowrap = true
	_confirm.min_size = Vector2i(560, 0)
	_confirm.confirmed.connect(_send)
	add_child(_confirm)
	_sync()


## True while the editor holds changes that were not applied: the logs window asks before closing on it.
func has_unsaved() -> bool:
	return _edit.button_pressed and _text.text != _disk


## Drops the edit without asking (the caller has asked).
func discard() -> void:
	_do_revert()


func load_all() -> void:
	if _loading:
		return
	_loading = true
	_head.text = "(loading…)"
	var cur: Dictionary = await Api.get_json("/api/caspar-config/current")
	var gen: Dictionary = await Api.get_bytes("/api/caspar-config/generate")
	var dirty: Dictionary = await Api.get_json("/api/caspar-config/dirty")
	var ovr: Dictionary = await Api.get_json("/api/caspar-config/override")
	var plan: Dictionary = await Api.get_json("/api/cluster/apply-plan")
	_loading = false
	var d: Variant = cur.data if cur.ok else null
	_have_disk = d is Dictionary and d.get("exists") == true
	_disk = str((d as Dictionary).get("xml", "")) if d is Dictionary else ""
	_path = str((d as Dictionary).get("path", "")) if d is Dictionary else ""
	_mtime = (d as Dictionary).get("mtimeMs") if d is Dictionary else null
	_generated = (gen.bytes as PackedByteArray).get_string_from_utf8() if gen.ok else ""
	_dirty = dirty.data if dirty.ok else null
	_override = str((ovr.data as Dictionary).get("override", "")) if ovr.ok and ovr.data is Dictionary else ""
	var me: Dictionary = Plan.self_entry(plan.data) if plan.ok else {}
	_server = Plan.name_of(me) if not me.is_empty() else Platform.host_of(Config.origin)
	if not cur.ok:
		_result.text = "Could not read the file on disk (%s). A server older than this client has no /api/caspar-config/current." % str(cur.error)
	_diff = M.diff(_disk, _generated)
	_edit.button_pressed = false
	_show_text()
	_sync()


func _toolbar() -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 6)
	var group := ButtonGroup.new()
	_disk_btn = _tab_button("On disk", group, false)
	_gen_btn = _tab_button("Generated", group, true)
	_disk_btn.button_pressed = true
	row.add_child(_disk_btn)
	row.add_child(_gen_btn)
	_edit = CheckButton.new()
	_edit.text = "Edit"
	_edit.toggled.connect(_on_edit_toggled)
	row.add_child(_edit)
	_prev = Button.new()
	_prev.text = "◀ prev diff"
	_prev.pressed.connect(func() -> void: _jump(false))
	row.add_child(_prev)
	_next = Button.new()
	_next.text = "next diff ▶"
	_next.pressed.connect(func() -> void: _jump(true))
	row.add_child(_next)
	_note = Label.new()
	_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	row.add_child(_note)
	return row


func _tab_button(label: String, group: ButtonGroup, generated: bool) -> Button:
	var b := Button.new()
	b.text = label
	b.toggle_mode = true
	b.button_group = group
	b.pressed.connect(func() -> void:
		if _showing_generated == generated:
			return
		if has_unsaved() and generated:  # keep the edit: switching view must not eat it
			_result.text = "Switch back with Revert or Apply first: the edit is not saved."
			_disk_btn.button_pressed = true
			return
		_showing_generated = generated
		_show_text()
		_sync())
	return b


func _edit_row() -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 8)
	_keep = CheckBox.new()
	_keep.text = "Keep as manual override"
	_keep.tooltip_text = "Also save this text on the server: Apply from Devices then writes it, and the generator is bypassed until the override is cleared."
	row.add_child(_keep)
	_apply = Button.new()
	_apply.text = "Apply edited config (restart Caspar)"
	_apply.pressed.connect(_ask)
	row.add_child(_apply)
	_revert = Button.new()
	_revert.text = "Revert"
	_revert.pressed.connect(_do_revert)
	row.add_child(_revert)
	return row


func _show_text() -> void:
	_text.editable = false
	_text.text = _generated if _showing_generated else _disk
	if not _have_disk and not _showing_generated:
		_text.text = "(no casparcg.config on disk yet)"
	_mark()


## Colour the differing lines of what is shown; Godot keeps these per line, so they are reset on every text swap.
func _mark() -> void:
	for i in _text.get_line_count():
		_text.set_line_background_color(i, Color(0, 0, 0, 0))
	if not _diff.get("ok", true) or not _have_disk or _edit.button_pressed:  # an edit moves every line below it
		return
	var marks: Array = _diff.b if _showing_generated else _diff.a
	for i in marks:
		if int(i) < _text.get_line_count():
			_text.set_line_background_color(int(i), MARK_GEN if _showing_generated else MARK_DISK)


func _marks_now() -> Array:
	return (_diff.get("b", []) if _showing_generated else _diff.get("a", [])) as Array


func _jump(forward: bool) -> void:
	var at := M.jump(_marks_now(), _text.get_caret_line(), forward)
	if at >= 0:
		_text.set_caret_line(at)
		_text.center_viewport_to_caret()


func _on_edit_toggled(on: bool) -> void:
	if on:
		_showing_generated = false
		_disk_btn.button_pressed = true
		_show_text()
		_text.editable = _have_disk
		_mark()
	else:
		if has_unsaved():
			_edit.set_pressed_no_signal(true)  # leaving the edit mode would drop the text: Revert says so explicitly
			_result.text = "There are unsaved edits: use Revert to discard them."
			return
		_show_text()
	_sync()


func _on_edited() -> void:
	_diff = M.diff(_text.text, _generated) if _edit.button_pressed else _diff
	_sync()


func _do_revert() -> void:
	_edit.set_pressed_no_signal(false)
	_diff = M.diff(_disk, _generated)
	_show_text()
	_result.text = ""
	_sync()


func _sync() -> void:
	var editing := _edit.button_pressed
	var edited := has_unsaved()
	var shown := _text.text if editing else (_generated if _showing_generated else _disk)
	var other := _disk if _showing_generated else _generated
	var other_name := "On disk" if _showing_generated else "Generated"
	if editing:
		other_name = "Generated"
	var dd := M.diff(shown, other) if _have_disk and (_diff.get("ok", true)) else {"ok": false}
	_head.text = "%s · %s%s · %s" % [_server, _path if _path != "" else "(no path)",
		(" · written " + M.written_text(_mtime)) if M.written_text(_mtime) != "" else "", M.state_text(_dirty, _override, edited)]
	_note.text = M.diff_note(dd, other_name) if _have_disk else ""
	var has_marks := not _marks_now().is_empty() and not editing
	_prev.disabled = not has_marks
	_next.disabled = not has_marks
	_keep.visible = editing
	_apply.visible = editing
	_revert.visible = editing
	_apply.disabled = _busy or not edited
	_revert.disabled = _busy or not edited
	_edit.disabled = _busy or not _have_disk


func _ask() -> void:
	var s := M.sanity(_text.text)
	if not s.ok:
		_result.text = "Not sent - %s" % s.error
		if s.line > 0:
			_text.set_caret_line(s.line - 1)
			_text.center_viewport_to_caret()
		return
	_confirm.dialog_text = M.confirm_text(_server, _keep.button_pressed, _override.strip_edges() != "")
	_confirm.popup_centered()


func _send() -> void:
	var xml := _text.text
	_busy = true
	_result.text = "Applying: saving what is on air, writing the file, restarting Caspar…"
	_sync()
	var ok_override := true
	if _keep.button_pressed:
		var ro: Dictionary = await Api.post_json("/api/caspar-config/override", {"override": xml})
		ok_override = ro.ok
	var res: Dictionary = {}
	if ok_override:
		res = await Api.post_json("/api/caspar-config/apply", {"xml": xml}, Api.APPLY_TIMEOUT_S)
	else:
		res = {"ok": false, "error": "could not save the manual override", "data": null}
	_busy = false
	var text := M.result_text(res)
	await load_all()
	_result.text = text
	_sync()
