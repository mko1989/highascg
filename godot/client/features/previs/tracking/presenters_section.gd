extends VBoxContainer
## WO-675 — Presenters section of the tracking Inspector page (Presenters mode): the roster the audio tech fills from
## the phone (photo, name, mic, note — server src/tracking/presenters.js, kept in /tmp), the face / body suggestions,
## and the operator's binding. Recognition only SUGGESTS; nothing is bound until the operator confirms (owner D1).
## A bound presenter drives the hub marker "Name (mic N)"; a zone whose action is `presenter` fires the presenter's
## own On enter / On exit actions (look:<id>[@preview], companion:<page>/<row>/<col> — the mic, owner D4).
## Live data: WS `tracking:presenters`; the persons to bind come from the marker driver's last tracking:detections.
## WO-1036 — the second way in: "Take pictures" asks the tracking cameras for a picture of everyone on stage; the
## operator types a name under a picture and it becomes a presenter bound to that person (no crew photo needed).

const M := preload("res://features/previs/tracking/presenters_model.gd")
const BASE := "/api/tracking/presenters"
const THUMB := Vector2(60, 80)

var driver: Node  # marker_driver.gd: the last tracking:detections (persons to bind)
var _snap := {}  # {presenters, suggestions}
var _urls: Array = []
var _photos := {}  # "id:created" → ImageTexture (memory only, never user://), thumb-sized
var _photo_used := {}  # WO-1106 C4: the keys the last render shows; the rest leave _photos after it
var _photo_wait := {}  # key → [TextureRect] waiting for a photo already being fetched (one request per photo)
var _typed := {}  # WO-1106 C3: capture id → {name, mic} typed so far (a rebuild at the detections' ~15 Hz kept nothing)
var _take: Button
var _list: VBoxContainer
var _caps: VBoxContainer  # WO-1036: camera pictures waiting for a name
var _consent: CheckBox
var _cap_note: Label
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
	_note.text = "Face and body recognition only suggest: confirm each match. On stage, a zone with the action \"presenter\" fires that presenter's actions. Photos live in /tmp and are gone after a reboot."
	add_child(_note)
	_take = Button.new()
	_take.text = "Take pictures of the people on stage"
	_take.tooltip_text = "Grabs a picture of every person the tracking cameras see now. Name the ones you need; the rest are deleted after 20 minutes."
	_take.pressed.connect(_take_pictures)
	add_child(_take)
	_consent = CheckBox.new()
	_consent.text = "The people I name agreed to be recognised for show automation"
	add_child(_consent)
	_cap_note = Label.new()
	_cap_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_cap_note.modulate = Color(1, 1, 1, 0.7)
	_cap_note.visible = false
	add_child(_cap_note)
	_caps = VBoxContainer.new()
	_caps.add_theme_constant_override("separation", 8)
	add_child(_caps)
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
	return f is LineEdit and (_list.is_ancestor_of(f) or _caps.is_ancestor_of(f))


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
	_photo_used = {}
	for c in _caps.get_children():
		c.queue_free()
	var cids := {}
	for c in _snap.get("captures", []):
		if c is Dictionary:
			cids[str(c.id)] = true
			_caps.add_child(_capture_row(c, choices))
	for k in _typed.keys():  # a capture saved, discarded or expired: its typing goes with it
		if not cids.has(k):
			_typed.erase(k)
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
	for k in _photos.keys():  # WO-1106 C4: the cache never shrank (every capture added its pictures for good)
		if not _photo_used.has(k):
			_photos.erase(k)


func _row(p: Dictionary, suggestion: Dictionary, choices: Array) -> Control:
	var id := str(p.id)
	var box := VBoxContainer.new()
	var top := HBoxContainer.new()
	var pic := TextureRect.new()
	pic.custom_minimum_size = THUMB
	pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	top.add_child(pic)
	_photo(id, pic, "%s:%s" % [id, str(p.get("created", 0))]) # WO-835: a wiped + re-created p1 is a new photo
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


func _say(text: String) -> void:
	_cap_note.text = text
	_cap_note.visible = text != ""


func _take_pictures() -> void:
	if _take.disabled:
		return
	_take.disabled = true  # WO-1106 C6: a double click replaced the first run's pictures under the same ids
	_say("Taking pictures…")
	var r: Dictionary = await Api.post_json(BASE + "/capture", {})
	_take.disabled = false
	if not r.ok:
		var why := str(r.data.get("error", "")) if r.get("data") is Dictionary else ""
		_say(why if why != "" else "Could not take pictures.")
	else:
		var n: int = (r.data.get("taken", []) as Array).size() if r.data is Dictionary else 0
		_say("Nobody new on camera right now." if n == 0 else "%d picture(s) — type a name under the ones you need." % n)
	reload()


## A camera picture: thumbnail, who it shows, name + mic fields, Save (→ a bound presenter) and Discard.
func _capture_row(c: Dictionary, choices: Array) -> Control:
	var cid := str(c.id)
	var row := HBoxContainer.new()
	var pic := TextureRect.new()
	pic.custom_minimum_size = THUMB
	pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	row.add_child(pic)
	_photo("captures/" + cid, pic, "%s:%s" % [cid, str(c.get("at", 0))])
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var who := Label.new()
	who.text = M.capture_line(c, choices)
	who.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	who.modulate = Color(1, 1, 1, 0.75)
	col.add_child(who)
	var fields := HBoxContainer.new()
	var typed: Dictionary = _typed.get(cid, {})
	var name_e := LineEdit.new()
	name_e.placeholder_text = "Name"
	name_e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_e.text = str(typed.get("name", ""))  # WO-1106 C3: what was typed before this rebuild
	name_e.text_changed.connect(func(v: String) -> void: _keep_typed(cid, "name", v))
	fields.add_child(name_e)
	var mic_e := LineEdit.new()
	mic_e.placeholder_text = "Mic"
	mic_e.custom_minimum_size.x = 56
	mic_e.text = str(typed.get("mic", ""))
	mic_e.text_changed.connect(func(v: String) -> void: _keep_typed(cid, "mic", v))
	fields.add_child(mic_e)
	col.add_child(fields)
	var acts := HBoxContainer.new()
	var save := func() -> void:
		var problem := M.capture_problem(name_e.text, _consent.button_pressed)
		if problem != "":
			_say(problem)
			return
		var r: Dictionary = await Api.post_json("%s/captures/%s/name" % [BASE, cid], {"name": name_e.text.strip_edges(), "mic": mic_e.text.strip_edges(), "consent": true})
		_say("" if r.ok else "Could not save: " + (str(r.data.get("error", "")) if r.get("data") is Dictionary else "no answer"))
		if is_instance_valid(name_e):  # WO-1106 C3: a rebuild during the await freed this row
			name_e.release_focus()
		reload()
	name_e.text_submitted.connect(func(_t: String) -> void: save.call())
	acts.add_child(_button("Save as presenter", save))
	acts.add_child(_button("Discard", func() -> void:
		await Api.delete_json("%s/captures/%s" % [BASE, cid])
		reload()))
	col.add_child(acts)
	row.add_child(col)
	return row


func _keep_typed(cid: String, field: String, v: String) -> void:
	var d: Dictionary = _typed.get(cid, {})
	d[field] = v
	_typed[cid] = d


## WO-1106 C4: one request per photo (a rebuild while it loads waits for it), kept at twice the thumbnail size.
func _photo(id: String, into: TextureRect, key: String) -> void:
	_photo_used[key] = true
	if _photos.has(key):
		into.texture = _photos[key]
		return
	if _photo_wait.has(key):
		(_photo_wait[key] as Array).append(into)
		return
	_photo_wait[key] = [into]
	var r: Dictionary = await Api.get_bytes("%s/%s/photo" % [BASE, id])
	var waiting: Array = _photo_wait.get(key, [])
	_photo_wait.erase(key)
	if not r.ok:
		return
	var img := Image.new()
	if img.load_jpg_from_buffer(r.bytes) != OK:
		return
	var fit := thumb_size(img.get_size(), THUMB * 2.0)
	if fit != img.get_size():
		img.resize(fit.x, fit.y, Image.INTERPOLATE_BILINEAR)
	var tex := ImageTexture.create_from_image(img)
	if _photo_used.has(key):
		_photos[key] = tex
	for w in waiting:
		if is_instance_valid(w):
			(w as TextureRect).texture = tex


## The size `px` takes inside `box`, aspect kept, never larger than it is.
static func thumb_size(px: Vector2i, box: Vector2) -> Vector2i:
	if px.x <= 0 or px.y <= 0:
		return px
	var k := minf(1.0, minf(box.x / px.x, box.y / px.y))
	return Vector2i(maxi(1, roundi(px.x * k)), maxi(1, roundi(px.y * k)))


func _post(path: String, body: Dictionary) -> void:
	await Api.post_json(path, body)
	reload()


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
