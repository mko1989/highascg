extends RefCounted
## WO-811 — the "server password" prompt after a 401 (only ever seen while the server enforces auth). Same loop as
## app/nuclear_gate.gd: a small dialog, the answer goes back to the caller (core/api.gd), which stores it
## (Config.set_password → ui.cfg) and retries. Off the box it is asked once per server; on the box the node's own file
## is adopted first (Config.adopt_local_password), so the prompt only shows when that file is missing or wrong.
## Many requests fail at once on a 401 — they all wait on the one open dialog. A cancel quiets the prompt for a minute
## so the pollers do not reopen it every second.

const QUIET_AFTER_CANCEL_MS := 60000

static var _pending: _Ask = null
static var _quiet_until_ms := 0


class _Ask:
	extends RefCounted
	signal done(pw: String)


## → the password typed, or "" (cancelled / quiet).
static func ask(host: Node, wrong: bool, server: String) -> String:
	if _pending != null:
		return await _pending.done
	if Time.get_ticks_msec() < _quiet_until_ms or not host.is_inside_tree():
		return ""
	_pending = _Ask.new()
	var w := _pending
	var dlg := ConfirmationDialog.new()
	dlg.title = "Server password"
	dlg.ok_button_text = "Sign in"
	var v := VBoxContainer.new()
	var l := Label.new()
	l.text = ("Wrong password — try again." if wrong else "%s asks for its password." % server)
	v.add_child(l)
	var e := LineEdit.new()
	e.secret = true
	e.custom_minimum_size = Vector2(320, 0)
	v.add_child(e)
	dlg.add_child(v)
	var answer := func(pw: String) -> void:
		if _pending == w:
			_pending = null
			if pw == "":
				_quiet_until_ms = Time.get_ticks_msec() + QUIET_AFTER_CANCEL_MS
			w.done.emit(pw)
	dlg.confirmed.connect(func() -> void: answer.call(e.text.strip_edges()))
	dlg.canceled.connect(func() -> void: answer.call(""))
	e.text_submitted.connect(func(_t: String) -> void:
		dlg.hide()
		answer.call(e.text.strip_edges()))
	host.get_tree().root.add_child(dlg)
	dlg.popup_centered()
	e.grab_focus()
	var pw: String = await w.done
	dlg.queue_free()
	return pw
