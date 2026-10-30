extends RefCounted
## WO-860 — a look card's ▶ turns ■ while its overlay look is on air on the main's PGM (scene.liveOverlay); ■ posts
## the play-out for that look.

const DeckOverlay := preload("res://features/live/deck_overlay.gd")
var t

const CM := {"programChannels": [1, 3], "previewChannels": [2, 4]}


func test_on_air_reads_scene_live_overlay_by_the_mains_pgm_channel() -> void:
	var lo := {"3": [{"sceneId": "lt", "hosts": [700], "until": null}]}
	t.ok(DeckOverlay.on_air(lo, CM, 1, "lt"), "main 2 = PGM ch 3: on air")
	t.ok(not DeckOverlay.on_air(lo, CM, 0, "lt"), "main 1 (ch 1) has no overlay")
	t.ok(not DeckOverlay.on_air(lo, CM, 1, "other"), "another look on main 2 keeps ▶")
	t.ok(not DeckOverlay.on_air({}, CM, 1, "lt"), "played out: ▶ again")
	t.ok(not DeckOverlay.on_air(null, CM, 1, "lt"), "no state yet")
	t.ok(not DeckOverlay.on_air(lo, CM, 5, "lt"), "main without a PGM channel")
	t.ok(not DeckOverlay.on_air(lo, {}, 1, "lt"), "no channel map yet")
	t.ok(not DeckOverlay.on_air(lo, CM, 1, ""), "unsaved look")


func test_stop_body_names_the_main_and_look() -> void:
	t.eq(DeckOverlay.stop_body(1, "lt"), {"mainIdx": 1, "sceneId": "lt"}, "POST /api/scene/overlay/stop body")
	t.eq(DeckOverlay.PATH, "scene.liveOverlay", "the server's broadcast path")
