extends RefCounted
## WO-1039 — features/pixelhue/programming_model.gd: the Programming sub-tab's state helpers and the request bodies it
## POSTs to /api/pixelhue/studio/programming, checked against what Studio's public/*.js sends and
## lib/studio-programming.js accepts. Fixture = a trimmed copy of the owner's P20 answer (studio_programming.json).

const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
var t


static func state() -> Dictionary:
	var raw := {
		"session": "s", "roam": true,
		"screens": [
			{"id": 3.0, "type": 4.0, "name": "AUX Screen 1", "width": 1920.0, "height": 1080.0, "x": 0.0, "y": 0.0, "enabled": true, "pgmLocked": false,
				"outputs": [{"id": 34.0, "pos": {"x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0}}], "timing": {"frame": 59.94}},
			{"id": 4.0, "type": 4.0, "name": "AUX Screen 2", "width": 1920.0, "height": 1080.0, "x": 0.0, "y": 0.0, "enabled": false, "pgmLocked": false, "outputs": []},
			{"id": 1.0, "type": 2.0, "name": "Screen 1", "width": 3072.0, "height": 1024.0, "x": 0.0, "y": 0.0, "enabled": true, "pgmLocked": true,
				"outputs": [{"id": 5.0, "pos": {"x": 0.0, "y": 0.0, "width": 3072.0, "height": 1024.0}}]},
		],
		"layers": [
			{"id": 54657024.0, "screenId": 3.0, "scene": 2.0, "type": 4.0, "name": "Layer 1", "sourceType": 2.0, "sourceId": 25.0, "sourceName": "Input 1-DP 1.2",
				"window": {"x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0}, "zorder": 1.0, "aspectLocked": true, "aspectMode": 8.0},
			{"id": 100.0, "screenId": 1.0, "scene": 2.0, "type": 2.0, "name": "Layer 1", "sourceType": 2.0, "sourceId": 29.0, "sourceName": "Input 3-DP 1.2",
				"window": {"x": 0.0, "y": 0.0, "width": 3072.0, "height": 1024.0}, "zorder": 1.0, "aspectLocked": false, "aspectMode": 5.0},
			{"id": 101.0, "screenId": 1.0, "scene": 4.0, "type": 2.0, "name": "GRP1-H-A", "sourceType": 2.0, "sourceId": 25.0, "sourceName": "Input 1-DP 1.2",
				"window": {"x": 0.0, "y": 0.0, "width": 1000.0, "height": 500.0}, "zorder": 2.0},
			{"id": 102.0, "screenId": 1.0, "scene": 4.0, "type": 2.0, "name": "GRP1-H-B", "sourceType": 2.0, "sourceId": 4.0, "sourceName": "Input 8-HDMI 2.0",
				"window": {"x": 1000.0, "y": 0.0, "width": 1000.0, "height": 500.0}, "zorder": 3.0},
		],
		"sources": [
			{"id": 25.0, "type": 2.0, "mapping": "IN 1", "name": "Input 1-DP 1.2", "connected": true, "signalLabel": "Live", "signalHealth": "live", "width": 1920.0, "height": 1080.0, "connectorType": 8.0},
			{"id": 28.0, "type": 2.0, "mapping": "IN 2", "name": "Input 2-HDMI 2.0", "connected": false, "signalLabel": "No signal", "signalHealth": "off", "width": 0.0, "height": 0.0},
			{"id": 4.0, "type": 2.0, "mapping": "IN 8", "name": "Input 8-HDMI 2.0", "connected": true, "width": 1920.0, "height": 1080.0},
			{"id": 3.0, "type": 3.0, "name": "AUX Screen 1 PGM", "width": 1920.0, "height": 1080.0, "connected": true},
			{"id": 1.0, "type": 4.0, "name": "Screen 1 PVW", "width": 3072.0, "height": 1024.0, "connected": true},
		],
		"backgrounds": [{"screenId": 1.0, "scene": 2.0, "layerId": 9.0, "enabled": false, "pictureId": 15.0, "name": "bk"}],
		"groupSources": [{"id": "u-1", "name": "Pair", "orient": "H", "a": {"type": 2.0, "id": 25.0}, "b": {"type": 2.0, "id": 4.0}, "available": true},
			{"id": "u-2", "name": "Gone", "orient": "V", "a": {"type": 2.0, "id": 25.0}, "b": {"type": 2.0, "id": 999.0}, "available": false}],
	}
	return M.ints(raw)


func test_ints_normalises_json_numbers() -> void:
	var s := state()
	t.eq(typeof(s.layers[0].id), TYPE_INT, "ids become ints")
	t.eq(s.layers[0].id, 54657024, "large id exact")
	t.eq(typeof(s.screens[0].timing.frame), TYPE_FLOAT, "fractional floats stay")


func test_lookup_and_lock() -> void:
	var s := state()
	t.eq(M.screen_by_id(s, 1).name, "Screen 1", "screen")
	t.eq(M.layer_by_id(s, 101).name, "GRP1-H-A", "layer")
	t.eq(M.layer_by_id(s, null), {}, "no selection")
	t.eq(M.layers_of(s, 1, M.PVW).size(), 2, "PVW of Screen 1")
	t.ok(M.locked(s, M.layer_by_id(s, 100)), "PGM of a locked screen")
	t.ok(not M.locked(s, M.layer_by_id(s, 101)), "PVW is never locked")
	t.ok(not M.locked(s, M.layer_by_id(s, 54657024)), "unlocked screen")


func test_shown_screens() -> void:
	var s := state()
	t.eq(M.default_shown(s, []), [3, 1], "enabled screens with outputs")
	t.eq(M.default_shown(s, [4, 99]), [4], "remembered ones that still exist")
	t.eq(M.toggle_shown(s, [1], 3), [3, 1], "device order")
	t.eq(M.toggle_shown(s, [1], 1), [1], "never none")
	t.eq(M.active_screen(s, [3, 1], 101).id, 1, "selected layer's screen")
	t.eq(M.active_screen(s, [3], 101).id, 3, "else the first shown")


func test_source_keys_and_lists() -> void:
	var s := state()
	t.eq(M.parse_key("2:25"), {"kind": "source", "type": 2, "id": 25}, "input")
	t.eq(M.parse_key("g:u-1"), {"kind": "group", "id": "u-1"}, "group")
	t.eq(M.parse_key("b:15"), {"kind": "bkg", "id": 15}, "background")
	t.eq(M.parse_key("l:3"), {"kind": "logo", "id": 3}, "logo")
	t.eq(M.source_for(s, "4:1").name, "Screen 1 PVW", "screen source")
	t.eq(M.filter_sources(s.sources, "inputs", "").size(), 3, "inputs")
	t.eq(M.filter_sources(s.sources, "screens", "").size(), 2, "screens")
	t.eq(M.filter_sources(s.sources, "inputs", "in 8").size(), 1, "filter by mapping")
	t.eq(M.filter_sources(s.sources, "inputs", "HDMI").size(), 2, "filter by name, any case")
	t.eq(M.signal_health(s.sources[2]), "live", "no health → from connected")
	t.eq(M.signal_label(s.sources[1]), "No signal", "label")
	t.eq(M.size_text(s.sources[1]), "? × ?", "unknown size")
	var polled := [{"id": 25, "type": 2, "name": "renamed"}]
	var merged := M.merge_sources(s.sources, polled)
	t.eq(merged.size(), 3, "polled inputs + 2 screen sources")
	t.eq(merged[0].name, "renamed", "polled first")
	var off := M.sources_unavailable(s.sources)
	t.eq(off[0].signalLabel, "Status unavailable", "failed poll")
	t.eq(off[3].get("signalLabel"), null, "screens untouched")


func test_routing_options() -> void:
	var s := state()
	var opts := M.routing_options(s, M.layer_by_id(s, 101))
	var keys: Array = opts.map(func(o: Array) -> String: return o[0])
	t.ok("2:25" in keys and "3:3" in keys, "inputs and other screens")
	t.ok(not ("4:1" in keys), "not its own screen")
	var orphan := {"screenId": 1, "sourceType": 2, "sourceId": 77, "sourceName": "Old"}
	t.eq(M.routing_options(s, orphan)[0], ["2:77", "Old"], "current source kept first")


func test_drop_requests() -> void:
	var s := state()
	var scr := M.screen_by_id(s, 3)
	var r := M.drop_request(s, "2:25", scr, M.PVW, {"x": 960, "y": 540})
	t.eq(r.body, {"action": "create", "screenId": 3, "scene": 4, "source": {"id": 25, "type": 2}, "window": G.win(0, 0, 1920, 1080), "name": "Layer"}, "create at native size")
	t.eq(r.message, "Layer created.", "message")
	t.eq(M.drop_request(s, "2:28", scr, M.PGM).body.window, G.win(0, 0, 1920, 1080), "no point = centre; unknown size 1080p")
	t.eq(M.drop_request(s, "3:3", scr, M.PVW).error, "A screen cannot show its own PGM/PVW.", "own PGM refused")
	t.eq(M.drop_request(s, "2:25", {}, M.PVW).error, "Show a screen first.", "no screen")
	t.eq(M.drop_request(s, "2:555", scr, M.PVW).error, "Choose a source first.", "unknown source")
	var bk := M.drop_request(s, "b:15", scr, M.PGM)
	t.eq(bk.body, {"action": "bkg", "screenId": 3, "scene": 2, "pictureId": 15, "enable": true}, "background")
	var logo := M.drop_request(s, "l:3", scr, M.PVW, {"x": 100.4, "y": -20.5})
	t.eq(logo.body.point, {"x": 100, "y": -20}, "logo point rounded")
	var g := M.drop_request(s, "g:u-1", M.screen_by_id(s, 1), M.PVW, {"x": 1536, "y": 512})
	t.eq(g.body, {"action": "group-create", "screenId": 1, "scene": 4, "orientation": "H", "sources": [{"id": 25, "type": 2}, {"id": 4, "type": 2}],
		"window": G.win(-384, -28, 3840, 1080)}, "group create")
	t.eq(M.drop_request(s, "g:u-2", scr, M.PVW).error, "A source of this group is no longer available.", "unavailable group")


func test_replace_requests() -> void:
	var s := state()
	var l := M.layer_by_id(s, 100)
	var r := M.replace_request(s, "2:4", l)
	t.eq(r.body, {"action": "source", "screenId": 1, "id": 100, "source": {"id": 4, "type": 2}}, "route source")
	t.eq(r.message, "Layer 1 now shows Input 8-HDMI 2.0.", "message")
	t.eq(M.replace_request(s, "4:1", l).error, "A screen cannot show its own PGM/PVW.", "own screen")
	t.eq(M.replace_request(s, "l:2", l).body.point, {"x": 1536, "y": 512}, "logo placed at the layer centre")


func test_layer_bodies() -> void:
	var s := state()
	var l := M.layer_by_id(s, 100)
	var a := M.layer_by_id(s, 101)
	t.eq(M.window_change(s, l, G.win(1, 2, 300, 400)), {"action": "window", "screenId": 1, "id": 100, "window": G.win(1, 2, 300, 400)}, "window")
	t.eq(M.window_change(s, a, G.win(0, 0, 2000, 500)).action, "group-window", "a group member moves the pair")
	var asp := M.aspect_mode_body(l, 3)
	t.eq(asp, {"action": "aspect", "screenId": 1, "id": 100, "mode": 3, "locked": true, "window": G.win(0, 0, 3072, 1728)}, "16:9 resizes the height")
	t.eq(M.aspect_mode_body(l, 5), {"action": "aspect", "screenId": 1, "id": 100, "mode": 5, "locked": false}, "custom keeps the lock off")
	t.eq(M.aspect_mode_body(l, 8).has("window"), false, "source ratio: the device refits")
	t.eq(M.aspect_lock_body(l, true), {"action": "aspect", "screenId": 1, "id": 100, "locked": true}, "lock")
	t.eq(M.zorder_body(l, 3), {"action": "zorder", "screenId": 1, "id": 100, "to": 3}, "front")
	t.eq(M.copy_body(l, false), {"action": "copy", "screenId": 1, "id": 100}, "duplicate")
	t.eq(M.copy_body(l, true).mirror, true, "mirror")
	t.eq(M.clear_request(s, l).body, {"action": "delete", "screenId": 1, "id": 100}, "delete")
	t.eq(M.clear_request(s, a).body.action, "group-delete", "group clear")
	t.eq(M.clear_request(s, a).message, "Group 1 cleared.", "group clear message")
	t.ok(M.clear_question(s, l).begins_with("Clear Layer 1"), "confirmation text")
	t.eq(M.ungroup_body(a), {"action": "group-ungroup", "screenId": 1, "id": 101}, "ungroup")
	t.eq(M.keyframe_body(l, {"enable": 1}), {"action": "keyframe", "screenId": 1, "id": 100, "keyFrame": {"enable": 1}}, "keyframe")
	t.eq(M.percent_to_tenths(12.34, 0, 999), 123, "start %")
	t.eq(M.percent_to_tenths(100, 1, 1000), 1000, "duration max")
	t.eq(M.percent_to_tenths(0, 1, 1000), 1, "duration min")
	t.eq(M.effect_body(l, {"opacity": 50}), {"action": "effect", "screenId": 1, "id": 100, "effect": {"opacity": 50}}, "effect")
	t.eq(M.aspect_label(7), "5:4", "aspect label")


func test_transitions_and_screen_commands() -> void:
	var s := state()
	t.eq(M.take_body([3, 1], 500, true), {"action": "take", "screenIds": [3, 1], "time": 500, "swap": true}, "take")
	t.eq(M.take_body([3], 99999, false).time, 10000, "duration capped like the server")
	t.eq(M.cut_body([1], false), {"action": "cut", "screenIds": [1], "swap": false}, "cut")
	var lock := M.pgm_lock_request(M.screen_by_id(s, 1))
	t.eq(lock.body, {"action": "pgm-lock", "screenId": 1, "locked": false}, "unlock")
	t.eq(lock.message, "Screen 1 PGM unlocked.", "message")
	var bk := M.background_of(s, 1, M.PGM)
	t.eq(M.bkg_toggle_request(M.screen_by_id(s, 1), M.PGM, bk).body, {"action": "bkg", "screenId": 1, "scene": 2, "enable": true}, "bkg on")
	t.eq(M.refresh_delay({"action": "take", "time": 1000}), 1150, "after the take")
	t.eq(M.refresh_delay({"action": "cut"}), 150, "after a cut")
	t.eq(M.refresh_delay({"action": "preset-load"}), 600, "after a load")
	t.eq(M.refresh_delay({"action": "delete"}), -1, "no follow-up")
	t.eq(M.success_text({"skipped": ["AUX Screen 2"]}, "Preset 1 saved."), "Preset 1 saved. Skipped disabled AUX Screen 2.", "skipped screens")


func test_layer_list_and_answers() -> void:
	var s := state()
	var ls := M.layer_list(s, 1)
	t.eq(ls.map(func(l: Dictionary) -> int: return l.id), [100, 102, 101], "PGM first, then PVW front-most first")
	t.eq(M.layer_title(ls[0]), "PGM · Layer 1 · Input 3-DP 1.2", "title")
	t.eq(M.new_layer_id([100, 101], {"layers": [{"id": 100}, {"id": 7}]}), 7, "created layer")
	t.eq(M.accepted_ids(s, [{"action": "group-window", "id": 101}, {"action": "window", "id": 100}]), [101, 102, 100], "group answer covers both")
