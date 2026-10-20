extends VBoxContainer
## WO-608 — Settings → Updates (web settings-modal-system-updates.js, WO-66): the running build stamp, the USB /
## bridge drop-update stamps, the GitHub release check (Refresh / Check now) and Install latest release
## (POST /api/system/update/apply behind a confirm + the nuclear password), with the apply log polled every 1.5 s.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const U := preload("res://features/settings/updates_model.gd")
const NuclearGate := preload("res://app/nuclear_gate.gd")

var _stamp: Label
var _volumes: Label
var _check: Label
var _apply: Button
var _log: TextEdit
var _poll: Timer
var _confirm: ConfirmationDialog


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	_heading("Server version")
	_note("Build stamp (UTC). On live USB sticks the canonical copy lives in drop-update/ on exFAT — it is re-applied every boot.")
	_stamp = Label.new()
	_stamp.add_theme_font_size_override("font_size", 18)
	add_child(_stamp)
	_volumes = _note("")
	_heading("GitHub releases")
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	for spec in [["Refresh", func() -> void: refresh(false)], ["Check now", func() -> void: refresh(true)]]:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(spec[1])
		row.add_child(b)
	_apply = Button.new()
	_apply.text = "Install latest release"
	_apply.disabled = true
	_apply.pressed.connect(func() -> void: _confirm.popup_centered())
	row.add_child(_apply)
	add_child(row)
	_check = _note("")
	_log = TextEdit.new()
	_log.editable = false
	_log.custom_minimum_size = Vector2(0, 220)
	_log.visible = false
	add_child(_log)
	_confirm = ConfirmationDialog.new()
	_confirm.dialog_text = ("Install the latest server release? HighAsCG will stop briefly, apply the update, stage "
		+ "drop-update/ on USB / bridge if mounted, then restart.")
	_confirm.confirmed.connect(_install)
	add_child(_confirm)
	_poll = Timer.new()
	_poll.wait_time = 1.5
	_poll.timeout.connect(_poll_status)
	add_child(_poll)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh(false))


func refresh(force: bool) -> void:
	_check.text = "Loading…"
	var ver: Dictionary = await Api.get_json("/api/system/version")
	var chk: Dictionary = await Api.get_json("/api/system/update/check" + ("?force=1" if force else ""))
	var v: Dictionary = ver.data if ver.ok and ver.data is Dictionary else {}
	_stamp.text = U.stamp(v) if ver.ok else "(version unavailable: %s)" % str(ver.error)
	_volumes.text = U.volumes(v)
	var c: Dictionary = chk.data if chk.ok and chk.data is Dictionary else {"error": chk.error}
	_check.text = U.check_line(c)
	_check.tooltip_text = str(c.get("releaseUrl", ""))
	_apply.disabled = not U.can_apply(c) or not _poll.is_stopped()
	var st: Dictionary = await Api.get_json("/api/system/update/status")
	if st.ok and st.data is Dictionary and (st.data.get("active") == true or (st.data.get("done") == true and st.data.get("log") is Array)):
		_show_log(st.data)
		if st.data.get("active") == true:
			_poll.start()


func _install() -> void:
	_apply.disabled = true
	_log.visible = true
	_log.text = "Starting update…"
	var res: Dictionary = await NuclearGate.post(self, "/api/system/update/apply", {"confirm": true})
	if not res.ok:
		_log.text = "Update not started: %s" % str(res.error)
		_apply.disabled = false
		return
	_poll.start()


func _poll_status() -> void:
	var st: Dictionary = await Api.get_json("/api/system/update/status")
	if not st.ok or not (st.data is Dictionary):
		_log.text += "\n" + str(st.error)  # the server restarts at the end of an install; keep polling
		return
	_show_log(st.data)
	if st.data.get("active") != true:
		_poll.stop()
		if st.data.get("ok") == true:
			refresh(true)
		else:
			_apply.disabled = false


func _show_log(st: Dictionary) -> void:
	_log.visible = true
	_log.text = U.status_log(st)
	_log.set_deferred("scroll_vertical", 1e9)


func _heading(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	l.add_theme_font_size_override("font_size", 18)
	add_child(l)


func _note(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(l)
	return l
