extends RefCounted
## Deck rules ported from the web client (deck_model.gd header cites the sources).

const DeckModel := preload("res://features/live/deck_model.gd")
var t  # runner

const A := "aaaa"
const B := "bbbb"
const C := "cccc"


func _scenes() -> Array:
	return [
		{"id": A, "name": "A", "mainScope": "0"},
		{"id": B, "name": "B", "mainScope": "1"},
		{"id": C, "name": "C", "mainScope": "all"},
	]


func _known() -> Dictionary:
	return {A: true, B: true, C: true}


func test_screen_count_minimum_one() -> void:
	t.eq(DeckModel.screen_count({}), 1)
	t.eq(DeckModel.screen_count({"screenCount": 0.0}), 1)
	t.eq(DeckModel.screen_count({"screenCount": 3.0}), 3)


func test_scenes_for_main_includes_global() -> void:
	var m0 := DeckModel.scenes_for_main(_scenes(), 0).map(func(s: Dictionary) -> String: return s.id)
	t.eq(m0, [A, C])
	var m1 := DeckModel.scenes_for_main(_scenes(), 1).map(func(s: Dictionary) -> String: return s.id)
	t.eq(m1, [B, C])


func test_bus_from_scene_live_channels() -> void:
	var cm := {"programChannels": [1.0, 3.0], "previewChannels": [2.0, 3.0]}
	var live := {"1": {"sceneId": A}, "2": {"sceneId": C}}
	var r := DeckModel.resolve_bus_look_ids(0, live, cm, _known(), {})
	t.eq(r.pgm, A, "pgm")
	t.eq(r.prv, C, "prv")


func test_bus_unknown_ids_ignored() -> void:
	var cm := {"programChannels": [1.0], "previewChannels": [2.0]}
	var live := {"1": {"sceneId": "deleted"}, "2": {"sceneId": "gone"}}
	var r := DeckModel.resolve_bus_look_ids(0, live, cm, _known(), {})
	t.eq(r.pgm, "", "pgm")
	t.eq(r.prv, "", "prv")


func test_bus_falls_back_to_project_when_no_channels() -> void:
	# The simulator case: channelMap has no program channels → project liveSceneIdByMain decides.
	var ps := {"liveSceneIdByMain": [C, B], "previewSceneIdByMain": [A, null]}
	var r := DeckModel.resolve_bus_look_ids(0, {}, {}, _known(), ps)
	t.eq(r.pgm, C, "pgm from project")
	t.eq(r.prv, A, "armed prv on PGM-only main")
	var r1 := DeckModel.resolve_bus_look_ids(1, {}, {}, _known(), ps)
	t.eq(r1.pgm, B)
	t.eq(r1.prv, "")


func test_prv_never_equals_pgm() -> void:
	var ps := {"liveSceneIdByMain": [A], "previewSceneIdByMain": [A]}
	var r := DeckModel.resolve_bus_look_ids(0, {}, {}, _known(), ps)
	t.eq(r.pgm, A)
	t.eq(r.prv, "")


func test_screen_label() -> void:
	t.eq(DeckModel.screen_label({"screenLabels": ["LED", ""]}, 0), "LED")
	t.eq(DeckModel.screen_label({"screenLabels": ["LED", ""]}, 1), "Main 2")
