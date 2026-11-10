extends RefCounted
## WO-1029 C15 — core/screen_notice.gd: NOT_HERE and via answers.

const N := preload("res://core/screen_notice.gd")
var t

const CM := {"screenCount": 4, "channelsWhereCabled": true, "programChannels": [2, null, null, null], "previewChannels": [3, null, null, null]}
const CL := {"peers": [{"id": "highascg5867", "name": "highascg5867"}]}


func test_not_here() -> void:
	var res := {"ok": false, "status": 409, "error": "Screen 3 is not on this server", "data": {"code": "NOT_HERE", "screen": 2, "destId": "d", "owners": ["highascg5867"]}}
	t.eq(N.is_not_here(res), true, "typed")
	t.eq(N.reason(res, CM, CL), "Screen 3 is on highascg5867 — not reachable from here", "plain 409")
	var res2 := res.duplicate(true)
	res2.data["via"] = [{"id": "highascg5867", "name": "highascg5867", "ok": false, "status": 0, "error": "timeout"}]
	t.eq(N.reason(res2, CM, CL), "Screen 3 is on highascg5867 — not reachable from here: highascg5867: timeout", "with reason")
	t.eq(N.reason({"ok": false, "status": 409, "data": {"code": "NOT_HERE", "screen": 1, "owners": ["x"]}}, CM, null), "Screen 2 is on x — not reachable from here", "owner id fallback")
	t.eq(N.reason({"ok": false, "status": 500, "error": "boom", "data": null}, CM, CL), "boom", "other error untouched")


func test_via() -> void:
	var ok := {"ok": true, "status": 200, "data": {"via": [{"id": "b", "name": "highascg5867", "ok": true, "status": 200}]}}
	t.eq(N.summary("TAKE", ok, CM, CL), {"ok": true, "text": "TAKE ok (on highascg5867)", "tone": "ok"}, "relayed ok")
	var part := {"ok": true, "status": 200, "data": {"via": [{"id": "b", "name": "B", "ok": false, "error": "refused"}]}}
	t.eq(N.summary("FTB", part).tone, "warn", "per-server failure warns")
	t.eq(N.summary("FTB", {"ok": true, "data": {}}).text, "FTB ok", "local")
	t.eq(N.summary("FTB", {"ok": false, "error": "x", "data": null}).text, "FTB refused: x", "plain failure")


func test_not_done_list() -> void:
	var res := {"ok": true, "status": 200, "data": {"notHere": [{"screen": 1, "owners": ["highascg5867"]}, {"screen": 2}]}}
	t.eq(N.summary("FTB", res, CM, CL), {"ok": true, "text": "FTB ok here — Screens 2, 3 are on highascg5867: not done", "tone": "warn"}, "all-screens answer names the rest")
	res.data["via"] = [{"id": "highascg5867", "name": "highascg5867", "ok": true}]
	t.eq(N.summary("FTB", res, CM, CL).text, "FTB ok (on highascg5867)", "relayed: the rest was done")
