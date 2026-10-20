extends RefCounted
## WO-603 — playlists_model.gd = the text and request bodies of the web playlist-control-panel.js (the rules —
## timeless, missing, timelessSecs — come from the server's /api/playlist/state).

const M := preload("res://features/live/playlists_model.gd")
var t

const LIVE := {"live": true, "channel": 1, "previewChannel": null, "sceneId": "s1", "sceneName": "Show", "layerNumber": 10, "activeIndex": 1, "startIndex": 0}
const PRV := {"live": false, "channel": null, "previewChannel": 2, "sceneId": "s2", "sceneName": "Promo", "layerNumber": 11, "activeIndex": 0, "startIndex": 2}
const IDLE := {"live": false, "channel": null, "previewChannel": null, "sceneId": "s3", "sceneName": "Idle", "layerNumber": 12, "activeIndex": 0, "startIndex": 0}


func test_list_labels() -> void:
	t.eq(M.list_label(LIVE), "● Show · L10 · ch1")
	t.eq(M.list_label(PRV), "Promo · L11 · PRV ch2", "a PRV recall is not live (WO-581)")
	t.eq(M.list_label(IDLE), "Idle · L12 · not live")
	t.eq(M.key_of(LIVE), "s1:10")


func test_item_labels() -> void:
	var still := {"label": "stills\\sub/logo.png", "value": "stills/sub/logo.png", "duration": 7, "timeless": true, "missing": false}
	var clip := {"label": "clips/intro.mov", "duration": 12, "timeless": false, "missing": true}
	t.eq(M.item_label(LIVE, still, 1), "● 2. logo.png (7s)", "playing item, basename, timeless length")
	t.eq(M.item_label(LIVE, clip, 0), "⚠ 1. intro.mov", "timed media carries its own length — no (Ns)")
	t.eq(M.item_label(PRV, still, 2), "▸ 3. logo.png (7s)", "not live: the start item")
	t.eq(M.item_label(IDLE, {"label": "a.png", "duration": 2.5, "timeless": true}, 3), "4. a.png (2.5s)")
	t.eq(M.current_index(LIVE), 1)
	t.eq(M.current_index(PRV), 2)


func test_bodies() -> void:
	t.eq(M.pick_body(LIVE, 3), {"action": "goto", "channel": 1, "layerNumber": 10, "index": 3})
	t.eq(M.pick_body(PRV, 1), {"action": "set_start", "sceneId": "s2", "layerNumber": 11, "index": 1})
	t.eq(M.step_body(LIVE, "prev"), {"action": "prev", "channel": 1, "layerNumber": 10})
	t.eq(M.step_body(IDLE, "next"), {"action": "step_preview", "sceneId": "s3", "layerNumber": 12, "direction": "next"})
	t.eq(M.timeless_body(LIVE, 9.0), {"action": "set_timeless", "sceneId": "s1", "layerNumber": 10, "secs": 9.0})


func test_store_playlist() -> void:
	var project := {"scenes": {"scenes": [{"id": "s1", "layers": [{"layerNumber": 10, "playlist": []}, {"layerNumber": 11}]}]}}
	var pl := [{"value": "a.png", "duration": 9}]
	t.ok(M.store_playlist(project, "s1", 10, pl))
	t.eq(project.scenes.scenes[0].layers[0].playlist, pl)
	pl[0]["duration"] = 1
	t.eq(project.scenes.scenes[0].layers[0].playlist[0].duration, 9, "stored a copy")
	t.ok(not M.store_playlist(project, "s1", 99, pl))
	t.ok(not M.store_playlist({}, "s1", 10, pl))
