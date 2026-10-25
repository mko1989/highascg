extends RefCounted
## WO-615 T8 / WO-757 — the programmer stored into a look, recalled from it, cleared: one copy for the look card's menu
## (deck_view.gd) and the Programmer panel in VR (xr_looks_row.gd). Each returns {ok, msg} for the caller's status.

const LF := preload("res://features/previs/fixtures/look_fixtures_model.gd")
const FM := preload("res://features/previs/tracking/follow_model.gd")


static func count(scene_id: String) -> int:
	return LF.count(_fixtures().looks, scene_id)


## The programmer (GET /api/fixtures/program) → this look's fixture state (a PGM TAKE of the look crossfades the rig to it).
static func store(scene_id: String) -> Dictionary:
	var res: Dictionary = await Api.get_json("/api/fixtures/program")
	var data: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	var values: Dictionary = data.get("values") if data.get("values") is Dictionary else {}
	if values.is_empty():
		return {"ok": false, "msg": "Programmer is empty — set fixtures in Previs → Programmer first"}
	_set_looks(LF.store(_fixtures().looks, scene_id, values))
	return {"ok": true, "msg": "Stored %d fixture(s) in the look" % values.size()}


static func recall(scene_id: String) -> Dictionary:
	var res: Dictionary = await Api.post_json("/api/fixtures/looks/recall", {"lookId": scene_id})
	return {"ok": res.ok, "msg": "Fixtures recalled" if res.ok else "Recall fixtures: %s" % res.error}


static func clear(scene_id: String) -> Dictionary:
	_set_looks(LF.clear(_fixtures().looks, scene_id))
	return {"ok": true, "msg": "Fixtures cleared from the look"}


static func _fixtures() -> Dictionary:
	return FM.normalize(Store.project.get("fixtures"))


static func _set_looks(looks: Dictionary) -> void:
	var s := _fixtures()
	s.looks = looks
	Store.project["fixtures"] = s
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)
