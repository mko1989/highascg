extends VBoxContainer
## WO-757 (detachable, WO-741) — under the Programmer in VR: pick a look, Store the programmer into it or Recall it.
## The same as the look card's menu on the Live tab (look_fixtures_store.gd); a PGM TAKE of the look crossfades to it.

const LFS := preload("res://features/previs/fixtures/look_fixtures_store.gd")

var looks: OptionButton
var status: Label
var _ids: Array = []


func _ready() -> void:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = "Look"
	l.custom_minimum_size.x = 70
	row.add_child(l)
	looks = OptionButton.new()
	looks.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	looks.item_selected.connect(func(_i: int) -> void: _mark())
	row.add_child(looks)
	for spec in [["Store", func(id: String) -> Dictionary: return await LFS.store(id)],
			["Recall", func(id: String) -> Dictionary: return await LFS.recall(id)]]:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(_run.bind(spec[1]))
		row.add_child(b)
	add_child(row)
	status = Label.new()
	status.autowrap_mode = TextServer.AUTOWRAP_WORD
	add_child(status)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _fill())
	_fill()


func _fill() -> void:
	var keep := look_id()
	var scenes: Variant = Store.project.get("scenes", {}).get("scenes") if Store.project.get("scenes") is Dictionary else null
	looks.clear()
	_ids = []
	for s in (scenes if scenes is Array else []):
		if s is Dictionary and str(s.get("id", "")) != "":
			_ids.append(str(s.id))
			looks.add_item(str(s.get("name", s.id)))
	looks.select(maxi(_ids.find(keep), 0) if not _ids.is_empty() else -1)
	_mark()


func look_id() -> String:
	return str(_ids[looks.selected]) if looks != null and looks.selected >= 0 and looks.selected < _ids.size() else ""


func _mark() -> void:
	var n := LFS.count(look_id()) if look_id() != "" else 0
	status.text = "No looks in this project." if _ids.is_empty() else ("This look stores %d fixture(s)." % n if n > 0 else "")


func _run(action: Callable) -> void:
	if look_id() == "":
		return
	var r: Dictionary = await action.call(look_id())
	status.text = r.msg
