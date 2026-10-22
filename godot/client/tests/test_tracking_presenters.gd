extends RefCounted
## WO-675 — presenters_model.gd: the persons the operator can bind and the status line under each presenter.

const M := preload("res://features/previs/tracking/presenters_model.gd")
var t


func test_persons_fused_lists_live_world_persons_only() -> void:
	var det := {"world": {"fused": true, "persons": [{"id": 3, "age_s": 0}, {"id": 4, "age_s": 0.4}]},
		"cameras": [{"id": "cam_1", "persons": [{"tid": 9, "age_s": 0}]}]}
	t.eq(M.persons(det), [{"key": "w:3", "label": "P3"}], "fused: P-tags only, coasting ones left out")


func test_persons_unfused_lists_each_cameras_live_tracks() -> void:
	var det := {"cameras": [{"id": "cam_1", "persons": [{"tid": 2, "age_s": 0}, {"tid": 5, "age_s": 1.2}]},
		{"id": "cam_2", "stale": true, "persons": [{"tid": 1, "age_s": 0}]}]}
	t.eq(M.persons(det), [{"key": "cam_1:2", "label": "cam_1 #2"}], "live tracks of fresh cameras")
	t.eq(M.persons({}), [], "no detections → nobody")


func test_status_line() -> void:
	t.eq(M.status_of({"person": "w:3", "marker": 65001}, {}), "On stage as P3 — marker 65001", "bound")
	t.eq(M.status_of({"person": null}, {"key": "cam_1:2", "score": 0.814}), "Looks like cam_1 #2 (81 %) — confirm?", "suggested")
	t.eq(M.status_of({"person": null, "face": "none"}, {}), "No face found in the photo: bind by hand", "no face")
	t.eq(M.status_of({"person": null, "face": "ok"}, {}), "Not on stage", "waiting")
