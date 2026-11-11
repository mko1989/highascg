extends RefCounted
## WO-1039 — studio_api.gd: Studio's answers and errors in one shape. (That the tab and its panels compile is
## `run-client.sh --check`'s job: the unit runner has no autoloads.)

const S := preload("res://features/pixelhue/studio_api.gd")
var t


func test_shape() -> void:
	t.eq(S.shape({"ok": true, "status": 200, "data": {"screens": []}}), {"ok": true, "data": {"screens": []}, "error": ""}, "a read")
	t.eq(S.shape({"ok": false, "status": 409, "data": {"error": "PGM of Screen 1 is locked."}, "error": "HTTP 409"}),
		{"ok": false, "data": {"error": "PGM of Screen 1 is locked."}, "error": "PGM of Screen 1 is locked."}, "Studio's own sentence wins")
	t.eq(S.shape({"ok": false, "status": 0, "data": null, "error": "request failed"}).error, "request failed", "transport error")
	t.eq(S.shape({"ok": false, "data": null}).error, "The server did not answer.", "nothing at all")
