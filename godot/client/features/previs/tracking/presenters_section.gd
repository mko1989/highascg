extends VBoxContainer
## WO-675 — Presenters section of the tracking Inspector page (Presenters mode): the roster the audio tech fills from
## the phone (photo, name, mic, note — server src/tracking/presenters.js, kept in /tmp), the face suggestions, and
## the operator's binding. The faces only SUGGEST; nothing is bound until the operator confirms (owner D1).
## A bound presenter drives the hub marker "Name (mic N)"; a zone whose action is `presenter` fires the presenter's
## own On enter / On exit actions (look:<id>[@preview], companion:<page>/<row>/<col> — the mic, owner D4).
## Live data: WS `tracking:presenters`; the persons to bind come from the marker driver's last tracking:detections.

const M := preload("res://features/previs/tracking/presenters_model.gd")
const BASE := "/api/tracking/presenters"
const THUMB := Vector2(60, 80)

var driver: Node  # marker_driver.gd: the last tracking:detections (persons to bind)
var _snap := {}  # {presenters, suggestions}
var _urls: Array = []
var _photos := {}  # presenter id → ImageTexture
var _list: VBoxContainer
var _url_box: VBoxContainer
var _note: Label
var _confirm_clear: ConfirmationDialog
var _sig := ""


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	var intro := Label.new()
	intro.text = "The audio tech opens this page on the phone (same network), takes the photo, enters name + mic and ticks consent:"
	intro.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(intro)
	_url_box = VBoxContainer.new()
	add_child(_url_box)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.modulate = Color(1, 1, 1, 0.7)
	_note.text = "Faces only suggest: confirm each match. On stage, a zone with the action \"presenter\" fires that presenter's actions. Photos live in /tmp and are gone after a reboot."
	add_child(_note)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 10)
	add_child(_list)
	var clear := Button.new()
	clear.text = "Clear all presenters"
	clear.tooltip_text = "End of show: deletes every photo, name and match now."
	clear.pressed.connect(func() -> void: _confirm_clear.popup_centered())
	add_child(clear)
	_confirm_clear = ConfirmationDialog.new()
	_confirm_clear.dialog_text = "Delete every presenter, photo and match?"
	_confirm_clear.confirmed.connect(func() -> void:
		await Api.delete_json(BASE)
		reload())
	add_child(_confirm_clear)
	Ws.message.connect(_on_ws)
	Ws.connected.connect(reload)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			reload())


func reload() -> void:
	var r: Dictionary = await Api.get_json(BASE)
	if not r.ok or not r.data is Dictionary:
		_snap = {}
		_urls = []
	else:
		_snap = r.data
		_urls = r.data.get("intake_urls", [])
	_render()


func _on_ws(type: String, data: Variant) -> void:
	if type == "tracking:presenters" and data is Dictionary:
		_snap = data
	elif type != "tracking:detections":  # new persons to bind → the pickers refresh (_render skips when unchanged)
		return
	if is_visible_in_tree() and not _editing():
		_render()


## A rebuild would drop the operator's half-typed actions: wait until the field loses focus (it saves, then reloads).
func _editing() -> bool:
	var f := get_viewport().gui_get_focus_owner()
	return f is LineEdit and _list.is_ancestor_of(f)


func _render() -> void:
	var dets: Dictionary = driver.detections if driver != null and driver.get("detections") is Dictionary else {}
	var choices := M.persons(dets)
	var sig := JSON.stringify([_snap, _urls, choices])
	if sig == _sig:
		return
	_sig = sig
	for c in _url_box.get_children():
		c.queue_free()
	for u in (_urls if not _urls.is_empty() else ["(no network address — check the box's LAN)"]):
		var e := LineEdit.new()
		e.text = str(u)
		e.editable = false
		e.select_all_on_focus = true
		_url_box.add_child(e)
	for c in _list.get_children():
		c.queue_free()
	var best := {}
	for s in _snap.get("suggestions", []):
		if s is Dictionary and not best.has(str(s.presenter)):
			best[str(s.presenter)] = s
	var roster: Array = _snap.get("presenters", [])
	if roster.is_empty():
		var none := Label.new()
		none.text = "No presenters yet."
		_list.add_child(none)
	for p in roster:
		if p is Dictionary:
			_list.add_child(_row(p, best.get(str(p.id), {}), choices))


func _row(p: Dictionary, suggestion: Dictionary, choices: Array) -> Control:
	var id := str(p.id)
	var box := VBoxContainer.new()
	var top := HBoxContainer.new()
	var pic := TextureRect.new()
	pic.custom_minimum_size = THUMB
	pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	top.add_child(pic)
	_photo(id, pic)
	var info := VBoxContainer.new()
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var name_l := Label.new()
	name_l.text = str(p.name) + (" · mic " + str(p.mic) if str(p.get("mic", "")) != "" else "")
	info.add_child(name_l)
	for line in [str(p.get("note", "")), M.status_of(p, suggestion)]:
		if line != "":
			var l := Label.new()
			l.text = line
			l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			l.modulate = Color(1, 1, 1, 0.75)
			info.add_child(l)
	top.add_child(info)
	box.add_child(top)
	var acts := HFlowContainer.new()
	if not suggestion.is_empty():
		acts.add_child(_button("Confirm %s" % M.label_of(str(suggestion.key)), func() -> void: _post("%s/%s/assign" % [BASE, id], {"key": suggestion.key})))
	var pick := OptionButton.new()
	pick.add_item("Person…")
	for c in choices:
		pick.add_item(str(c.label))
		pick.set_item_metadata(pick.item_count - 1, c.key)
	pick.disabled = choices.is_empty()
	pick.tooltip_text = "Bind by hand: the persons detected right now" if not choices.is_empty() else "Nobody detected right now (Detect mode)"
	pick.item_selected.connect(func(i: int) -> void:
		if i > 0:
			_post("%s/%s/assign" % [BASE, id], {"key": pick.get_item_metadata(i)}))
	acts.add_child(pick)
	if p.get("person") != null and str(p.person) != "":
		acts.add_child(_button("Release", func() -> void: _post("%s/%s/release" % [BASE, id], {})))
	acts.add_child(_button("Delete", func() -> void:
		await Api.delete_json("%s/%s" % [BASE, id])
		reload()))
	box.add_child(acts)
	box.add_child(_actions_field("On enter", "on_enter", p, id))
	box.add_child(_actions_field("On exit", "on_exit", p, id))
	return box


## Comma-separated look:<id>[@preview] / companion:<page>/<row>/<col>; saved on Enter or leaving the field.
func _actions_field(title: String, key: String, p: Dictionary, id: String) -> Control:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = title
	l.custom_minimum_size.x = 64
	row.add_child(l)
	var e := LineEdit.new()
	e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	e.placeholder_text = "companion:1/2/3, look:<id>"
	e.text = ", ".join(PackedStringArray(p.get(key, [])))
	var save := func() -> void:
		if e.text != ", ".join(PackedStringArray(p.get(key, []))):
			_post("%s/%s" % [BASE, id], {key: e.text})
	e.text_submitted.connect(func(_t: String) -> void: save.call())
	e.focus_exited.connect(save)
	row.add_child(e)
	return row


func _photo(id: String, into: TextureRect) -> void:
	if _photos.has(id):
		into.texture = _photos[id]
		return
	var r: Dictionary = await Api.get_bytes("%s/%s/photo" % [BASE, id])
	if not r.ok:
		return
	var img := Image.new()
	if img.load_jpg_from_buffer(r.bytes) != OK:
		return
	_photos[id] = ImageTexture.create_from_image(img)
	if is_instance_valid(into):
		into.texture = _photos[id]


func _post(path: String, body: Dictionary) -> void:
	await Api.post_json(path, body)
	reload()


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
