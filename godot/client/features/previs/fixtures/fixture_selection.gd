extends RefCounted
## WO-615 T6 — the programmer's fixture selection, one per client (`shared()`): the previs 3D view picks into it
## (click a fixture, shift-click adds / removes) and, while "Point at" is on, turns a floor click into `aim_at`;
## the Programmer section lists, edits and sends for it.

signal changed
signal aim_at(psn: Array)  # [x, y, z] metres, PSN frame (x stage left, y upstage, z up)
signal aimed  # WO-679: a right-drag aim ended (aim_drag.gd)

static var _one: RefCounted = null

var ids: Array = []  # fixture ids, in pick order
var point_at := false


static func shared() -> RefCounted:
	if _one == null:
		_one = new()
	return _one


func set_ids(list: Array) -> void:
	var clean: Array = []
	for id in list:
		if not clean.has(str(id)):
			clean.append(str(id))
	if clean == ids:
		return
	ids = clean
	changed.emit()


## A click on fixture `id`: alone selects only it; `add` toggles it in the selection.
func pick(id: String, add: bool) -> void:
	var next := ids.duplicate() if add else []
	if add and next.has(id):
		next.erase(id)
	else:
		next.append(id)
	set_ids(next)


func set_point_at(on: bool) -> void:
	if on == point_at:
		return
	point_at = on
	changed.emit()
