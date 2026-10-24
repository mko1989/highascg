extends RefCounted
## POST behind the nuclear password (dock launches, update install, reboot, Caspar stop …): when the server answers
## that a password is needed, ask for it in a small dialog and retry with body.password. A password that worked is
## kept in memory for this client session (the web keeps it in the Settings → Nuclear field).

const N := preload("res://app/nuclear_model.gd")
const ApiScript := preload("res://core/api.gd")

static var _password := ""


class _Ask:
	extends RefCounted
	signal done(pw: String)


## `api`: the server to ask (WO-735: the box's own one for the dock and updates); default the connected server.
static func post(host: Node, path: String, body: Dictionary, api: ApiScript = null) -> Dictionary:
	var to: ApiScript = api if api else Api
	var b := body.duplicate()
	if _password != "":
		b["password"] = _password
	var res: Dictionary = await to.post_json(path, b)
	while N.needs_password(res):
		var pw: String = await _ask(host, b.has("password"))
		if pw == "":
			return res
		b["password"] = pw
		res = await to.post_json(path, b)
		if not N.needs_password(res):
			_password = pw
	return res


static func _ask(host: Node, wrong: bool) -> String:
	var dlg := ConfirmationDialog.new()
	dlg.title = "Nuclear password"
	dlg.ok_button_text = "Continue"
	var v := VBoxContainer.new()
	var l := Label.new()
	l.text = ("Wrong password — try again." if wrong else "This action is protected (Settings → Nuclear).")
	v.add_child(l)
	var e := LineEdit.new()
	e.secret = true
	e.custom_minimum_size = Vector2(320, 0)
	v.add_child(e)
	dlg.add_child(v)
	var w := _Ask.new()
	dlg.confirmed.connect(func() -> void: w.done.emit(e.text))
	dlg.canceled.connect(func() -> void: w.done.emit(""))
	e.text_submitted.connect(func(_t: String) -> void:
		dlg.hide()
		w.done.emit(e.text))
	host.get_tree().root.add_child(dlg)
	dlg.popup_centered()
	e.grab_focus()
	var pw: String = await w.done
	dlg.queue_free()
	return pw
