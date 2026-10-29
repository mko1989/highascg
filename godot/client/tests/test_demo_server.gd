extends RefCounted
## WO-815 — the simulated server (core/demo/demo_server.gd, demo_scene.gd, demo_extras.gd) and its data set
## (godot/client/demo/*.json): a take moves scene.live, a fader moves the console mixer, timers run on the given clock,
## a pixel-map save replaces the list, anything else answers "not in demo"; the data set stays small and public-safe.

const Demo := preload("res://core/demo/demo_server.gd")
const ConfigScript := preload("res://core/config.gd")
const POST := HTTPClient.METHOD_POST
const GET := HTTPClient.METHOD_GET
var t


func _server() -> RefCounted:
	var s: RefCounted = Demo.new(Demo.load_dir(Demo.DATA_DIR))
	s.now_ms = func() -> float: return 1000000.0
	return s


func _live_id(s: RefCounted, ch: String) -> String:
	return str(((s.state.scene.live as Dictionary).get(ch, {}) as Dictionary).get("sceneId", ""))


func test_data_set_loads() -> void:
	var s := _server()
	t.ok((s.project.scenes.scenes as Array).size() >= 6, "demo looks")
	t.eq((s.state.channelMap.programChannels as Array).size(), 2, "2 PGM screens")
	t.eq((s.state.channelMap.previewChannels as Array).size(), 2, "2 PRV screens")
	t.ok((s.project.fixtures.patch as Array).size() > 0 and not s.pixelmap.is_empty(), "PixelLine fixtures + mappings")
	t.ok((s.project.previs.stage.objects as Array).any(func(o: Dictionary) -> bool: return o.type == "led_wall"), "an LED wall")
	t.eq((s.project.timelines.timelines as Array).size(), 1, "one timeline")
	var r: Dictionary = s.handle(GET, "/api/state", null)
	t.ok(r.ok and r.data is Dictionary and r.data.has("scene"), "GET /api/state answers the demo state")


func test_take_changes_demo_state() -> void:
	var s := _server()
	var sent := []
	s.broadcast.connect(func(type: String, d: Variant) -> void: sent.append([type, d]))
	t.eq(_live_id(s, "1"), "look-opener", "PGM 1 before")
	var r: Dictionary = s.handle(POST, "/api/scene/take-look", {"sceneId": "look-loop-b", "mainIdx": 0, "target": "program"})
	t.ok(r.ok, "take ok")
	t.eq(_live_id(s, "1"), "look-loop-b", "take → PGM channel 1 holds the look")
	t.eq(sent.size(), 1, "one broadcast")
	t.eq(sent[0][0], "change", "change message")
	t.eq(sent[0][1].path, "scene.live", "scene.live path")
	t.eq(str(sent[0][1].value["1"].sceneId), "look-loop-b", "the broadcast carries the new bus")
	t.eq(int(sent[0][1].seq), 1, "seq like ws-server.js")
	r = s.handle(POST, "/api/scene/preview-push", {"sceneId": "look-song-1", "mainIdx": 0})
	t.ok(r.ok and str(r.data.mode) == "take", "PRV push ok")
	t.eq(_live_id(s, "2"), "look-song-1", "PRV push → PRV channel 2")
	t.eq(int(s.handle(GET, "/api/state", null).data.scene.live["2"].scene.layers.size()), 1, "GET /api/state sees the push")
	t.eq(int(s.handle(POST, "/api/scene/take-look", {"sceneId": "nope"}, ).status), 404, "unknown look refused")
	s.handle(POST, "/api/ftb", {"screenIdx": 1})
	t.eq(_live_id(s, "3"), "", "FTB clears PGM 2")


func test_fader_and_mute_change_mixer() -> void:
	var s := _server()
	var r: Dictionary = s.handle(POST, "/api/audio/volume", {"channel": 1, "volume": 0.5, "volumeDb": -6.02, "key": "pgm:1"})
	t.ok(r.ok, "volume ok")
	t.eq(float(s.handle(GET, "/api/audio/mixer", null).data.gains["pgm:1"]), 0.5, "fader → mixer gain")
	s.handle(POST, "/api/audio/mute", {"channel": 1, "layer": 10, "muted": true, "volume": 0.5, "key": "pgm:1:layer:10"})
	t.eq(s.handle(GET, "/api/audio/mixer", null).data.muted.get("pgm:1:layer:10"), true, "mute → mixer muted")
	s.handle(POST, "/api/audio/mute", {"channel": 1, "layer": 10, "muted": false, "volume": 1, "key": "pgm:1:layer:10"})
	t.eq(s.handle(GET, "/api/audio/mixer", null).data.muted.has("pgm:1:layer:10"), false, "unmute")
	s.handle(POST, "/api/audio/solo", {"keys": ["pgm:1", "bogus"]})
	t.eq(s.mixer.solos, ["pgm:1"], "solos keep mixer keys only")
	r = s.handle(POST, "/api/audio/volume", {"channel": 1, "layer": 10, "volume": 0.3})
	t.ok(r.ok and not (s.mixer.gains as Dictionary).has(""), "a look layer's fader (no key) is ok, mixer untouched")


func test_unknown_endpoint_is_not_in_demo() -> void:
	var s := _server()
	var said := []
	s.notice.connect(func(text: String) -> void: said.append(text))
	var r: Dictionary = s.handle(POST, "/api/system/reboot", {})
	t.eq(r.ok, false, "refused")
	t.eq(int(r.status), 501, "501")
	t.ok(str(r.error).begins_with(Demo.NOT_IN_DEMO), "error says not in demo: " + str(r.error))
	t.eq(str(r.reason), "not_in_demo", "reason")
	t.eq(said.size(), 1, "a write says so in the notice line")
	s.handle(GET, "/api/vr/status", null)
	t.eq(said.size(), 1, "a GET poll stays quiet")
	s.handle(POST, "/api/client-prefs", {})
	t.eq(said.size(), 1, "the client's own boot-time writes stay quiet")
	t.ok(s.unsupported.has("GET /api/vr/status"), "logged")


func test_timers_run_on_client_clock() -> void:
	var s := _server()
	var now := [1000000.0]
	s.now_ms = func() -> float: return now[0]
	t.eq(float(s.handle(GET, "/api/timers/list", null).data.serverNowMs), 1000000.0, "serverNowMs is the client clock")
	s.handle(POST, "/api/timers/cmd", {"timerId": "timer-show", "cmd": "start"})
	now[0] += 10000.0
	s.handle(POST, "/api/timers/cmd", {"timerId": "timer-show", "cmd": "pause"})
	var rec: Dictionary = s.handle(GET, "/api/timers/list", null).data.timers[0]
	t.eq(float(rec.remainingSec), 290.0, "10 s of a 300 s timer")
	t.eq(str(rec.lastCmd), "pause", "paused")
	s.handle(POST, "/api/timers/cmd", {"timerId": "timer-show", "cmd": "reset"})
	t.eq(s.handle(GET, "/api/timers/list", null).data.timers[0].remainingSec, null, "reset clears it")
	s.handle(POST, "/api/timers/assign", {"timerId": "t2", "name": "Two", "config": {"durationSec": 60}, "screenIdx": 1})
	t.eq((s.timers as Array).size(), 2, "assign adds a timer")
	s.handle(POST, "/api/timers/unassign", {"timerId": "t2", "screenIdx": 1})
	t.eq((s.timers as Array).size(), 1, "unassign from its last screen removes it")


func test_pixel_map_save_changes_list() -> void:
	var s := _server()
	var one: Dictionary = (s.pixelmap[0] as Dictionary).duplicate(true)
	var r: Dictionary = s.handle(POST, "/api/fixtures/pixelmap", {"mappings": [one]})
	t.ok(r.ok, "save ok")
	t.eq((s.handle(GET, "/api/fixtures/pixelmap", null).data.mappings as Array).size(), 1, "GET returns the saved list")
	r = s.handle(POST, "/api/fixtures/pixelmap", {"mappings": [{"id": "x"}]})
	t.eq(int(r.status), 400, "a mapping without fixture / rect is refused")


func test_deck_sync_and_autosave() -> void:
	var s := _server()
	var looks: Array = (s.project.scenes.scenes as Array).duplicate(true)
	looks[0]["name"] = "Renamed"
	s.on_ws({"type": "scene_deck_sync", "data": {"looks": [], "sceneSnapshots": looks}})
	t.eq(str(s.handle(GET, "/api/project", null).data.scenes.scenes[0].name), "Renamed", "scene_deck_sync renames")
	var rev := int(s.project.rev)
	var r: Dictionary = s.handle(POST, "/api/project/autosave", {"project": s.project.duplicate(true)})
	t.eq(int(r.data.rev), rev + 1, "autosave bumps rev")
	t.eq(r.data.changed, false, "no project_sync echo to skip")


func test_demo_switch() -> void:
	t.eq(ConfigScript.demo_wanted({"demo": "1"}, false, false), true, "--demo")
	t.eq(ConfigScript.demo_wanted({"demo": "0"}, true, false), false, "--demo=0 beats the saved switch")
	t.eq(ConfigScript.demo_wanted({}, true, false), true, "Settings switch")
	t.eq(ConfigScript.demo_wanted({}, false, false), false, "default off")
	t.eq(ConfigScript.demo_wanted({"demo": "0"}, false, true), true, "the web build is always a demo")
	var api := FileAccess.get_file_as_string("res://core/api.gd")
	t.ok(api.contains("return Demo.shared().handle(method, path, body)"), "Api answers from the demo")
	var ws := FileAccess.get_file_as_string("res://core/ws.gd")
	t.ok(ws.contains("return Demo.shared().on_ws(obj)"), "Ws sends to the demo")


## Public-safe: no other machine's address, home path, show / client name or secret; small.
func test_data_set_is_public_safe() -> void:
	var total := 0
	var ip := RegEx.create_from_string("\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b")
	for f in DirAccess.get_files_at(Demo.DATA_DIR):
		if not f.ends_with(".json"):
			continue
		var text := FileAccess.get_file_as_string(Demo.DATA_DIR + "/" + f)
		total += text.to_utf8_buffer().size()
		if f == "thumbs.json":  # WO-815 phase 2: base64 image data — its keys are scanned (test_demo_phase2: JPEG payloads)
			var th: Variant = JSON.parse_string(text)
			text = ",".join(PackedStringArray((th.get("thumbs", {}) as Dictionary).keys())) if th is Dictionary else ""
		for m in ip.search_all(text):
			t.ok(m.get_string() in ["127.0.0.1", "0.0.0.0", "255.255.255.255", "236.10.10.10"], "%s: address %s" % [f, m.get_string()])
		for w in ["/home/", "mhp", "VISUALE", "projekcja", "dioda", "/dev/", "Bearer"]:
			t.ok(not text.contains(w), "%s contains %s" % [f, w])
	t.ok(total > 0 and total < 1024 * 1024, "demo data under 1 MB (%d bytes)" % total)
