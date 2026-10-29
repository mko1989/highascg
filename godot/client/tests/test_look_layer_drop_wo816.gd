extends RefCounted
## WO-816 — a Sources drop on a look layer (compose-frame box / layer-list row) exchanges that layer's media; the drag
## data is built exactly as the Sources panels build it (media_ops.gd drag_payload, live_sources_model.gd drag_payload).

const D := preload("res://features/live/look_layer_drop.gd")
const O := preload("res://features/live/look_layer_ops.gd")
const Audio := preload("res://features/live/look_layer_audio.gd")
const MediaOps := preload("res://features/live/media_ops.gd")
const LiveModel := preload("res://features/live/live_sources_model.gd")
var t


class FakePusher:
	extends RefCounted
	var n := 0

	func schedule(_s: String, _m: int) -> void:
		n += 1


## The look editor's surface the drop flow uses; _apply_layer records the write (look_editor.gd: merge into the
## selected layer + PRV push — the write the inspector's fields make through `patch`).
class FakeEditor:
	extends RefCounted
	var scene_id := "look_test"
	var main := 0
	var pusher := FakePusher.new()
	var lk := {"id": "look_test", "layers": []}
	var sel := -1
	var writes := []
	var status := ""

	func look() -> Dictionary:
		return lk

	func _layers() -> Array:
		return lk.layers

	func _select(i: int, _show := true) -> void:
		sel = i

	func _apply_layer(p: Dictionary) -> void:
		writes.append([sel, p.duplicate(true)])
		(lk.layers[sel] as Dictionary).merge(p, true)
		pusher.schedule(scene_id, main)

	func _refresh_list() -> void:
		pass

	func show_status(s: String) -> void:
		status = s


class FakeApi:
	extends RefCounted
	var posts := []
	var reply := {}

	func post_json(path: String, body: Variant) -> Dictionary:
		posts.append([path, body.duplicate(true)])
		if not reply.is_empty():
			return reply
		var src: Dictionary = body.source.duplicate()
		src["label"] = src.get("label", src.value)
		return {"ok": true, "error": "", "data": {"ok": true, "contentResolution": {"w": 1280, "h": 720},
			"layer": {"layerNumber": body.get("layerNumber", 13), "source": src, "fill": {"x": 0.1, "y": 0.1, "scaleX": 0.8, "scaleY": 0.8}, "trimInMs": 999}}}


func _ed() -> FakeEditor:
	var ed := FakeEditor.new()
	ed.lk.layers = [
		{"layerNumber": 10, "source": {"type": "media", "value": "CLIPS/old.mov", "label": "CLIPS/old.mov"}, "fill": {"x": 0.5, "y": 0.0, "scaleX": 0.5, "scaleY": 0.5},
			"rotation": 12.0, "trimInMs": 2000, "trimOutMs": 9000, "loop": true, "startBehaviour": "relativeToPrevious", "audioRoute": "1+2"},
		{"layerNumber": 11, "source": {"type": "media", "value": ""}, "fill": {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}},
	]
	return ed


## The media panel's drag: a Sources media row (media_panel.gd set_metadata) through MediaOps.drag_payload.
func _media_drag(id: String) -> Dictionary:
	return MediaOps.drag_payload({"type": "media", "value": id, "label": id, "row": {"id": id}}, [])


func test_media_drag_is_droppable_on_a_layer() -> void:
	var data := _media_drag("CLIPS/new.mov")
	t.eq(O.drop_sources(data), [{"type": "media", "value": "CLIPS/new.mov", "label": "CLIPS/new.mov"}], "look_editor _can_drop accepts the Sources media drag")
	var live := LiveModel.drag_payload({"type": "route", "value": "route://5-2", "label": "DeckLink 2", "routeType": "decklink"})
	t.eq(O.drop_sources(live).size(), 1, "a Live-tab row is droppable too")


func test_drop_on_a_layer_exchanges_its_media_only() -> void:
	var ed := _ed()
	var api := FakeApi.new()
	D.drop(ed, api, 0, O.drop_sources(_media_drag("CLIPS/new.mov")))
	t.eq(api.posts, [["/api/scene/new-layer", {"sceneId": "look_test", "mainIdx": 0, "source": {"type": "media", "value": "CLIPS/new.mov", "label": "CLIPS/new.mov"}, "layerNumber": 10}]],
		"one build for the exchanged layer number (route rule checked for it)")
	t.eq(ed.writes, [[0, {"source": {"type": "media", "value": "CLIPS/new.mov", "label": "CLIPS/new.mov"}}]], "the layer is selected and gets the source only")
	var l: Dictionary = ed.lk.layers[0]
	t.eq([l.fill.x, l.rotation, l.trimInMs, l.trimOutMs, l.loop, l.startBehaviour, l.audioRoute], [0.5, 12.0, 2000, 9000, true, "relativeToPrevious", "1+2"],
		"position, rotation, trim, loop, start, audio route unchanged")
	t.eq(ed.lk.layers.size(), 2, "no layer added")
	t.eq(ed.pusher.n, 1, "pushed to PRV / autosave once")
	t.eq(ed.status, "L10: old.mov → new.mov", "status names the exchange")


func test_drop_on_an_empty_layer_puts_the_media_there() -> void:
	var ed := _ed()
	D.drop(ed, FakeApi.new(), 1, O.drop_sources(_media_drag("STILLS/logo.png")))
	t.eq(ed.writes[0][0], 1, "the empty row")
	t.eq(ed.writes[0][1], {"source": {"type": "media", "value": "STILLS/logo.png", "label": "STILLS/logo.png"}, "loop": false,
		"fill": {"x": 0.1, "y": 0.1, "scaleX": 0.8, "scaleY": 0.8}}, "source + content-fit fill (size known), a still never loops")
	t.eq(ed.status, "L11: logo.png added", "status")
	var api := FakeApi.new()
	api.reply = {"ok": true, "error": "", "data": {"contentResolution": null, "layer": {"source": {"type": "media", "value": "X", "label": "X"}, "fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}}}}
	var ed2 := _ed()
	D.drop(ed2, api, 1, [{"type": "media", "value": "X"}])
	t.ok(not ed2.writes[0][1].has("fill"), "unknown media size → the empty layer keeps its own box")


func test_multi_drop_exchanges_first_adds_rest_and_blank_adds() -> void:
	var ed := _ed()
	var api := FakeApi.new()
	var a := {"type": "media", "value": "A.mov", "label": "A.mov", "row": {}}
	var b := {"type": "media", "value": "B.mov", "label": "B.mov", "row": {}}
	D.drop(ed, api, 0, O.drop_sources(MediaOps.drag_payload(a, [a, b])))
	t.eq([api.posts.size(), api.posts[0][1].get("layerNumber"), api.posts[1][1].has("layerNumber")], [2, 10, false], "first → exchange, second → new layer")
	t.eq([ed.lk.layers[0].source.value, ed.lk.layers.size(), ed.lk.layers[2].source.value], ["A.mov", 3, "B.mov"], "L10 = A, B appended")
	var ed2 := _ed()
	D.drop(ed2, FakeApi.new(), -1, [{"type": "media", "value": "C.mov"}])
	t.eq([ed2.writes.size(), ed2.lk.layers.size()], [0, 3], "no layer under the pointer → add (WO-600 K unchanged)")


func test_refused_exchange_changes_nothing() -> void:
	var ed := _ed()
	var api := FakeApi.new()
	api.reply = {"ok": false, "data": null, "error": "HTTP 400: A layer cannot play a route to itself (same channel and layer)."}
	D.drop(ed, api, 0, [{"type": "route", "value": "route://2-10"}, {"type": "media", "value": "B.mov"}])
	t.eq([ed.writes.size(), ed.lk.layers[0].source.value, api.posts.size()], [0, "CLIPS/old.mov", 1], "refused → layer kept, the rest not added")
	t.ok(ed.status.begins_with("Exchange refused"), "status says why")


func test_layer_at_topmost_box_with_media() -> void:
	var layers := [{"source": {"value": "a"}, "fill": {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}},
		{"source": {"value": "b"}, "fill": {"x": 0.5, "y": 0.5, "scaleX": 0.5, "scaleY": 0.5}},
		{"source": {"value": ""}, "fill": {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}}]
	var rect := func(l: Dictionary) -> Rect2: return Rect2(Vector2(l.fill.x, l.fill.y) * 100.0, Vector2(l.fill.scaleX, l.fill.scaleY) * 100.0)
	t.eq(O.layer_at(layers, rect, Vector2(75, 75)), 1, "the top box wins, an empty layer is no target")
	t.eq(O.layer_at(layers, rect, Vector2(10, 10)), 0, "under it")
	t.eq(O.layer_at(layers, rect, Vector2(150, 10)), -1, "outside every box")


## The viewer drop's target (look_editor _layer_at = Audio.pick): a point over an audio-only layer's box never targets it.
func test_viewer_drop_over_audio_only_layer_targets_video_beneath() -> void:
	var layers := [{"layerNumber": 10, "source": {"type": "media", "value": "CLIPS/video.mov"}, "fill": {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}},
		{"layerNumber": 11, "source": {"type": "media", "value": "MUSIC/song.wav"}, "fill": {"x": 0.5, "y": 0.5, "scaleX": 0.5, "scaleY": 0.5}}]
	var rect := func(l: Dictionary) -> Rect2: return Rect2(Vector2(l.fill.x, l.fill.y) * 100.0, Vector2(l.fill.scaleX, l.fill.scaleY) * 100.0)
	t.eq(Audio.pick(layers, {}, rect, Vector2(75, 75)), 0, "over the audio-only box → the video layer underneath, never the audio layer")
	t.eq(Audio.pick(layers, {}, rect, Vector2(10, 10)), 0, "video-only point unchanged")
	layers.pop_at(0)
	t.eq(Audio.pick(layers, {}, rect, Vector2(75, 75)), -1, "no video under it → none (the drop adds a layer)")


## Found in the WO-816 e2e: after Remove layer the Inspector kept the removed layer's values (stale page). Both places
## that drop the selection must go through _select(-1), which releases the page and clears the fields.
func test_deselect_releases_the_inspector_page() -> void:
	var src := FileAccess.get_file_as_string("res://features/live/look_editor.gd")
	var rm := src.substr(src.find("func _remove_layer()"), 260)
	t.ok(rm.contains("_refresh_list()\n\t_select(-1)"), "Remove layer releases the Inspector page")
	var op := src.substr(src.find("\t_hold(true)\n\t_sel = -1"), 120)
	t.ok(op.contains("_refresh_list()\n\t_select(-1)"), "opening a look drops the previous look's layer page")
