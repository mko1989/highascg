extends HBoxContainer
## WO-713 R3 — tracking camera calibration: "Person is on <mark>". Someone stands on a stage mark (Lighting →
## Calibrate heads, project.fixtures.marks); with exactly one person detected in this camera, their feet (the box's
## bottom centre, person_mark_model.gd) ↔ the mark becomes one more calibration point, then Solve runs as for
## clicked points. Every mark the person visits adds a point where people actually stand.

const F := preload("res://features/previs/tracking/follow_model.gd")
const PM := preload("res://features/previs/tracking/person_mark_model.gd")

var page: Node  # tracking_page.gd: entry(), driver (the last tracking:detections), _edit, solve(), its status line
var _marks: OptionButton
var _go: Button
var _key := ""


func _init(p: Node) -> void:
	page = p


func _ready() -> void:
	_marks = OptionButton.new()
	_marks.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_marks.item_selected.connect(func(_i: int) -> void: _label())
	add_child(_marks)
	_go = Button.new()
	_go.tooltip_text = "Someone stands on the mark, alone in this camera's picture: their feet become a calibration point, then Solve."
	_go.pressed.connect(_take)
	add_child(_go)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _fill())
	_fill()


func _list() -> Array:
	return F.normalize(Store.project.get("fixtures")).marks


func _mark() -> Dictionary:
	var id: Variant = _marks.get_item_metadata(_marks.selected) if _marks.selected >= 0 else null
	for m in _list():
		if id != null and int(m.id) == int(id):
			return m
	return {}


func _fill() -> void:
	var marks := _list()
	var key := JSON.stringify(marks)
	if key == _key:
		return
	_key = key
	var was: Variant = _marks.get_item_metadata(_marks.selected) if _marks.selected >= 0 else null
	_marks.clear()
	for m in marks:
		_marks.add_item(str(m.name))
		_marks.set_item_metadata(_marks.item_count - 1, int(m.id))
		if was != null and int(m.id) == int(was):
			_marks.select(_marks.item_count - 1)
	if _marks.selected < 0 and _marks.item_count > 0:
		_marks.select(0)
	_label()


func _label() -> void:
	var m := _mark()
	_go.disabled = m.is_empty()
	_go.text = "Person is on %s" % m.name if not m.is_empty() else "Person is on … (no stage marks: Lighting → Calibrate heads)"


func _take() -> void:
	var snap: Variant = page.driver.detections if page.driver != null else {}
	var r := PM.person_point(snap if snap is Dictionary else {}, page.entry(), _mark())
	if r.ok != true:
		page._status.text = r.error
		return
	page._edit(func(c: Dictionary) -> void: c.points = PM.with_point(c.points, r.point))
	page.solve()
