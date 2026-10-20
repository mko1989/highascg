extends ConfirmationDialog
## WO-603 slice 3 — multi-rename with a live preview (web media-multi-rename-modal.js, WO-592 D): a new title and/or
## renumbering; numbers and extensions stay. Every edit asks node for the plan (POST /api/media/rename/plan — conflicts
## checked against the server's catalogue); Rename applies its `renames` (POST /api/media/rename, all-or-nothing,
## looks / playlists / timelines follow). Nothing is planned or renamed on the client.

signal files_renamed(count: int)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Ops := preload("res://features/live/media_ops.gd")
const BAD := Color("#f87171")

var ids: Array = []
var _title: LineEdit
var _renumber: CheckBox
var _start: SpinBox
var _step: SpinBox
var _pad: SpinBox
var _rows: VBoxContainer
var _err: Label
var _renames: Array = []
var _seq := 0
var _seeded := false


func _init(selected: Array) -> void:
	ids = selected
	title = "Rename %d file%s" % [ids.size(), "" if ids.size() == 1 else "s"]
	dialog_hide_on_ok = false
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(560, 420)
	_title = LineEdit.new()
	_title.placeholder_text = "New title — empty keeps each file's title"
	_title.text_changed.connect(func(_t: String) -> void: _plan())
	box.add_child(_title)
	var rn := HBoxContainer.new()
	_renumber = CheckBox.new()
	_renumber.text = "Renumber"
	_renumber.toggled.connect(func(_on: bool) -> void: _plan())
	rn.add_child(_renumber)
	_start = _spin(rn, "from", 1, 0, 99999)
	_step = _spin(rn, "step", 1, 1, 1000)
	_pad = _spin(rn, "digits", 2, 0, 6)
	box.add_child(rn)
	var hint := Label.new()
	hint.text = "Numbers and extensions stay. Looks, playlists and timelines follow the new names."
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	box.add_child(hint)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_rows = VBoxContainer.new()
	_rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_rows)
	box.add_child(scroll)
	_err = Label.new()
	_err.add_theme_color_override("font_color", BAD)
	_err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_err)
	add_child(box)
	register_text_enter(_title)
	confirmed.connect(_apply)
	canceled.connect(queue_free)


func _ready() -> void:
	_plan()


func _spin(row: HBoxContainer, label: String, v: float, lo: float, hi: float) -> SpinBox:
	var l := Label.new()
	l.text = label
	row.add_child(l)
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.value = v
	s.editable = false
	s.value_changed.connect(func(_v: float) -> void: _plan())
	row.add_child(s)
	return s


func _plan() -> void:
	for s in [_start, _step, _pad]:
		s.editable = _renumber.button_pressed
	_seq += 1
	var mine := _seq
	var res: Dictionary = await Api.post_json("/api/media/rename/plan", Ops.plan_body(ids, _title.text, _renumber.button_pressed, _start.value, _step.value, _pad.value))
	if mine != _seq or not is_inside_tree():
		return  # a newer edit is in flight
	if not res.ok or not (res.data is Dictionary):
		_err.text = "Preview failed: %s" % res.error
		get_ok_button().disabled = true
		return
	var d: Dictionary = res.data
	if not _seeded:
		_seeded = true
		if str(d.get("commonTitle", "")) != "" and _title.text == "":
			_title.text = str(d.commonTitle)
			_title.select_all()
			_title.grab_focus.call_deferred()
			_plan()
			return
		_title.grab_focus.call_deferred()
	_renames = d.get("renames", [])
	_err.text = ""
	_show(d.get("plan", []))
	get_ok_button().disabled = not d.get("ok", false)
	get_ok_button().text = "Rename %d file%s" % [_renames.size(), "" if _renames.size() == 1 else "s"]


func _show(plan: Array) -> void:
	for c in _rows.get_children():
		c.queue_free()
	for r in plan:
		var l := Label.new()
		var err := str(r.get("error", ""))
		var same: bool = r.get("from") == r.get("to")
		l.text = "%s  →  %s%s" % [str(r.from).get_file(), str(r.to).get_file(), ("   (%s)" % err) if err != "" else ""]
		l.clip_text = true
		if err != "":
			l.add_theme_color_override("font_color", BAD)
		elif same:
			l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_rows.add_child(l)


func _apply() -> void:
	if _renames.is_empty() or get_ok_button().disabled:
		return
	get_ok_button().disabled = true
	var res: Dictionary = await Api.post_json("/api/media/rename", {"renames": _renames})
	if not res.ok:
		_err.text = "%s — nothing was changed" % res.error
		get_ok_button().disabled = false
		return
	files_renamed.emit(_renames.size())
	queue_free()
