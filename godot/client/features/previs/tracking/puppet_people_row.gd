extends VBoxContainer
## WO-1087 — test puppet PEOPLE in the Markers section (markers_section.gd, under the WO-978 marker puppet): on / off,
## how many (1–3), "New look", and their state. Owner 15.11: "show me an avatar with random look. make it a test
## puppet. make sure the test puppet doesnt leave the stage". The server walks them inside the tracking stage
## (src/tracking/puppet-people.js) as world persons: the previs draws them as avatars (People: avatars) labelled
## "TEST puppet n", and the Auto director / spot handover follow them like detected people. Off at every server start.
## WO-1103: Look — Cartoon (the pebble avatar, default) / Woman / Man / Mixed (realistic Rocketbox bodies, for previs
## only) — and Walk (off: they stop where they are and stand, still turning to look round). Below the four, one
## "Own: <name>" per character in this machine's ~/.local/share/highascg/puppets (human_own.gd; never shipped), with
## its import report under the row once the previs has loaded it.

const PM := preload("res://features/previs/tracking/puppet_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Own := preload("res://features/previs/tracking/human_own.gd")
const HelpDialog := preload("res://app/help_dialog.gd")
const PATH := "/api/tracking/puppet/people"
const LOOKS := ["Cartoon", "Woman", "Man", "Mixed"]  # WO-1103 → body cartoon / woman / man / mixed

var _on: CheckButton
var _count: OptionButton
var _state: Label
var _look: OptionButton
var _walk: CheckBox
var _bodies := []  # the Look items' body names
var _own_note: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var row := HBoxContainer.new()
	_on = CheckButton.new()
	_on.text = "Test people"
	_on.tooltip_text = "Simulated people with a random look walking the tracking stage (never off it) — no camera needed.\nThe previs shows them as avatars labelled TEST; Auto follow treats them as people. Off at every server start."
	_on.toggled.connect(func(v: bool) -> void: _post({"enabled": v, "count": _count.selected + 1}))
	row.add_child(_on)
	_count = OptionButton.new()
	for n in [1, 2, 3]:
		_count.add_item(str(n))
	_count.tooltip_text = "How many test people"
	_count.item_selected.connect(func(i: int) -> void:
		if _on.button_pressed:
			_post({"count": i + 1}))
	row.add_child(_count)
	var look := Button.new()
	look.text = "New look"
	look.tooltip_text = "Give the test people new random clothes, hair and height"
	look.pressed.connect(func() -> void: _post({"new_look": true}))
	row.add_child(look)
	add_child(row)
	var row2 := HBoxContainer.new()  # WO-1103
	var ll := Label.new()
	ll.text = "Look"
	row2.add_child(ll)
	_look = OptionButton.new()
	_fill_looks("")
	_look.tooltip_text = "What the previs draws for the test people: the cartoon figure, or a realistic woman / man (Mixed: woman, man, woman),\nor your own character (Own: … — a model in ~/.local/share/highascg/puppets on this machine; see the help page).\nPrevis only — a puppet's look, never a tracked person's."
	_look.item_selected.connect(func(i: int) -> void: _post({"body": _bodies[i]}))
	row2.add_child(_look)
	_walk = CheckBox.new()
	_walk.text = "Walk"
	_walk.button_pressed = true
	_walk.tooltip_text = "Off: the test people stop where they are and stand (they still turn to look round)"
	_walk.toggled.connect(func(v: bool) -> void: _post({"walk": v}))
	row2.add_child(_walk)
	row2.add_child(HelpDialog.button("own-test-puppet"))  # your own character / MetaHuman
	add_child(row2)
	_own_note = Label.new()
	_own_note.autowrap_mode = TextServer.AUTOWRAP_WORD
	_own_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_own_note.visible = false
	add_child(_own_note)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	var t := Timer.new()
	t.wait_time = 2.0
	t.timeout.connect(func() -> void:
		if is_visible_in_tree():
			_poll())
	add_child(t)
	t.start()
	_poll()


func _poll() -> void:
	var res: Dictionary = await Api.get_json(PATH)
	_adopt(res.data if res.ok else null)


func _post(body: Dictionary) -> void:
	var res: Dictionary = await Api.post_json(PATH, body)
	_adopt(res.data if res.data is Dictionary else null)


func _adopt(d: Variant) -> void:
	_state.text = PM.people_summary(d)
	if d is Dictionary:
		_on.set_pressed_no_signal(d.get("enabled") == true)
		_count.select(clampi(int(d.get("count", 1)) - 1, 0, 2))
		var body := str(d.get("body", "cartoon"))
		_fill_looks(body)
		_look.select(maxi(_bodies.find(body), 0))
		_note(body)
		_walk.set_pressed_no_signal(d.get("walk") != false)


## The Look items: the four, then this machine's own characters (+ the server's own body if this machine lacks it).
func _fill_looks(current: String) -> void:
	var want := LOOKS.map(func(n: String) -> String: return n.to_lower())
	var names := LOOKS.duplicate()
	for e: Dictionary in Own.list():
		want.append("own:" + str(e.slug))
		names.append("Own: " + str(e.name))
	if current.begins_with("own:") and not want.has(current):
		want.append(current)
		names.append("Own: %s (not on this machine)" % current.substr(4))
	if want == _bodies:
		return
	_bodies = want
	_look.clear()
	for n in names:
		_look.add_item(n)


## An own character's import report (human_own.gd), once the previs has loaded it.
func _note(body: String) -> void:
	var r: Dictionary = Own.report(body.substr(4)) if body.begins_with("own:") else {}
	_own_note.visible = not r.is_empty()
	if r.is_empty():
		return
	if r.get("loading", false):  # WO-1106 A39: importing in the background
		_own_note.text = "Own model: loading %s…" % str(r.get("file", "")).get_file()
		return
	if not r.get("ok", false):
		_own_note.text = "Own model not used: %s" % r.get("error", "?")
		return
	_own_note.text = "Own model: %s — %d triangles, %d / %d bones mapped, %.2f m, moves of the %s%s" % [str(r.file).get_file(), int(r.tris),
		(r.mapped as Array).size(), int(r.bones), float(r.height), r.moves, ("\n" + "\n".join(r.warnings)) if not (r.warnings as Array).is_empty() else ""]
