extends RefCounted
## Timeline routing — web timeline-state-model.js normalizeSendTo / previewBusAvailableForSendTo /
## coerceTimelineSendTo, timeline-transport.js Dest list / projectFps / Take body, getDefaultTransitionFromEditor.

const S := preload("res://features/timeline/timeline_send_to.gd")
var t


func test_normalize_and_coerce() -> void:
	t.eq(S.normalize(null), {"preview": true, "program": false, "screenIdx": 0})
	t.eq(S.normalize({"preview": false, "program": 1, "screenIdx": "all"}), {"preview": false, "program": true, "screenIdx": null}, "!!program; 'all' → null")
	t.eq(S.normalize({"preview": 0, "program": 0}).preview, true, "only a literal false turns PRV off")
	t.eq(S.normalize({"screenIdx": "1"}).screenIdx, 1)
	var both := {"screenCount": 2, "programChannels": [1, 3], "previewChannels": [2, 0]}
	t.ok(S.prv_available(both, {"screenIdx": 0}))
	t.ok(not S.prv_available(both, {"screenIdx": 1}), "screen 2 is PGM-only")
	t.ok(S.prv_available(both, {"screenIdx": null}), "all screens: any with a PRV bus")
	t.ok(not S.prv_available({"programChannels": [1], "previewChannels": [2], "previewEnabledByMain": [false]}, {"screenIdx": 0}))
	t.eq(S.coerce(both, {"preview": true, "program": false, "screenIdx": 1}), {"preview": false, "program": false, "screenIdx": 1},
		"PGM-only drops PRV and leaves PGM off (todos06.08)")
	t.eq(S.default_for({"programChannels": [1], "previewChannels": [2]}).preview, true)


func test_screens_fps_take() -> void:
	t.eq(S.screen_options({}), [["S1", 0]])
	t.eq(S.screen_options({"screenCount": 2, "screenLabels": ["Main", ""], "virtualMainChannels": [{}, {"name": "LED"}]}),
		[["All screens", null], ["Main", 0], ["LED", 1]])
	t.eq(S.project_fps({"fps": 25}, {}), 25.0)
	t.eq(S.project_fps({}, {"programResolutions": [{"fps": 30}]}), 30.0)
	t.eq(S.project_fps({}, {}), 50.0)
	t.eq(S.take_default({}, 50.0), {"type": "MIX", "duration": 25, "tween": "linear"}, "auto → half the rate")
	t.eq(S.take_default({"type": "WIPE + ANIMATE", "duration": 8, "tween": "easein"}, 25.0), {"type": "WIPE + ANIMATE", "duration": 8, "tween": "easein"})
	t.eq(S.take_body({"type": "PUSH", "duration": 400, "tween": "easeout"}, 25.0, null),
		{"transition": "PUSH", "duration": 120, "tween": "easeout", "screenIdx": null}, "frames clamp to 120")
	t.eq(S.take_body({"type": "", "duration": 12, "tween": ""}, 25.0, 1),
		{"transition": "MIX", "duration": 13, "tween": "linear", "screenIdx": 1}, "12 = auto")
