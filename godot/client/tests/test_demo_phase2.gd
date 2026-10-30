extends RefCounted
## WO-815 phase 2 — the simulated server's pictures (core/demo/demo_video.gd: thumbnails from demo/thumbs.json, a still
## per look on the PGM / PRV readers), its timeline engine on an injected clock (core/demo/demo_timeline.gd: play /
## pause / seek / loop / stop / take, timeline.playback + throttled timeline.tick), the read-only Devices view
## (demo/device_view.json) and the "Reset demo" restart path.

const Demo := preload("res://core/demo/demo_server.gd")
const Video := preload("res://core/demo/demo_video.gd")
const Profiles := preload("res://core/connection_profiles_model.gd")
const POST := HTTPClient.METHOD_POST
const GET := HTTPClient.METHOD_GET
const PUT := HTTPClient.METHOD_PUT
var t
var _now := [1000000.0]


func _server() -> RefCounted:
	var s: RefCounted = Demo.new(Demo.load_dir(Demo.DATA_DIR))
	_now[0] = 1000000.0
	s.now_ms = func() -> float: return _now[0]
	return s


func _jpeg(b: PackedByteArray) -> Image:
	var img := Image.new()
	return img if b.size() > 3 and b[0] == 0xFF and b[1] == 0xD8 and img.load_jpg_from_buffer(b) == OK else null


func _px(img: Image, x: int, y: int) -> Color:
	return img.get_pixel(clampi(x, 0, img.get_width() - 1), clampi(y, 0, img.get_height() - 1))


func test_thumbnails_answer_from_the_data_set() -> void:
	var s := _server()
	for m in s.state.media:
		var r: Dictionary = s.get_bytes("/api/thumbnail/%s?hq=1&w=960&t=0" % str(m.id).uri_encode())
		if str(m.type) in ["MOVIE", "STILL"]:
			t.ok(r.ok and int(r.status) == 200 and _jpeg(r.bytes) != null, "%s → a JPEG still" % m.id)
		else:
			t.eq(int(r.status), 501, "%s (audio) has no still" % m.id)
	t.eq(int(s.get_bytes("/api/thumbnail/live/6").status), 501, "live-input frames are not in the demo")
	t.ok(s.unsupported.has("GET /api/thumbnail/live/6"), "logged as not in demo")
	var th: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://demo/thumbs.json"))
	t.eq(str(th.type), "image/jpeg", "thumbs.json type")
	for k in (th.thumbs as Dictionary):
		t.ok(str(k).begins_with("demo/") and _jpeg(Marshalls.base64_to_raw(th.thumbs[k])) != null, "%s payload is a JPEG" % k)


func test_look_still_composites_the_layers() -> void:
	var s := _server()
	var opener: Dictionary = {}
	var black_wall: Dictionary = {}
	for l in s.project.scenes.scenes:
		if str(l.id) == "look-opener":
			opener = l
		elif str(l.id) == "look-black-wall":
			black_wall = l
	var img := Video.look_still(opener, 960, 448)
	t.eq(img.get_size(), Vector2i(960, 448), "still size")
	var src := Video.thumb_image("demo/opener.mov")
	var a := _px(img, 480, 224)
	var b := _px(src, src.get_width() >> 1, src.get_height() >> 1)
	t.ok(absf(a.r - b.r) < 0.08 and absf(a.g - b.g) < 0.08 and absf(a.b - b.b) < 0.08, "full-frame layer = its still (%s vs %s)" % [a, b])
	t.ok(a.get_luminance() > 0.05, "not black")
	var bw := Video.look_still(black_wall, 960, 448)
	t.eq(_px(bw, 480, 224), Color.BLACK, "the black look is black")
	t.eq(_px(Video.look_still({"layers": []}, 64, 32), 10, 10), Color.BLACK, "an empty look is black")
	var audio_only := {"layers": [{"layerNumber": 10, "source": {"type": "media", "value": "demo/click.wav"}}]}
	t.eq(_px(Video.look_still(audio_only, 64, 32), 32, 16), Color.BLACK, "audio draws nothing")


func test_role_channels_and_sizes() -> void:
	var cm := {"programChannels": [1, 3], "previewChannels": [2, 3], "channelResolutionsByChannel": {"1": {"w": 3840, "h": 1792}}}
	t.eq(Video.role_channel("pgm1", cm), 1, "pgm1")
	t.eq(Video.role_channel("pgm2", cm), 3, "pgm2")
	t.eq(Video.role_channel("prv1", cm), 2, "prv1")
	t.eq(Video.role_channel("prv2", cm), 0, "a PGM-only main has no PRV")
	t.eq(Video.role_channel("pgm3", cm), 0, "no third main")
	t.eq(Video.role_channel("ch7", cm), 7, "chN")
	t.eq(Video.role_channel("in1", cm), 0, "inputs have no demo picture")
	t.eq(Video.role_channel("opgui", cm), 0, "nor the operator surface")
	t.eq(Video.still_size(cm, 1), Vector2i(960, 448), "3840×1792 → 960 wide")
	t.eq(Video.still_size(cm, 9), Vector2i(960, 540), "unknown → 16:9")


func test_reader_follows_the_bus() -> void:
	var s := _server()
	var pgm: RefCounted = Video.new("pgm1", s)
	t.ok(pgm.poll(), "first poll draws")
	t.eq([pgm.width, pgm.height], [960, 448], "LED wall still size")
	t.eq(pgm.frame.size(), 960 * 448 * 4, "RGBA8 frame")
	t.eq(pgm.signal_lost, false, "a bus has signal")
	t.eq(pgm.poll(), false, "nothing new")
	var before: PackedByteArray = pgm.frame
	_now[0] += 10.0
	s.handle(POST, "/api/scene/take-look", {"sceneId": "look-song-1", "mainIdx": 0, "target": "program"})
	t.ok(pgm.poll(), "a take redraws")
	_now[0] += 5000.0  # the fade (WO-865) has run out
	t.ok(pgm.poll(), "…and again when the fade is done")
	t.ok(pgm.frame != before, "with the new look")
	s.handle(POST, "/api/ftb", {"screenIdx": 0})
	t.ok(pgm.poll(), "FTB redraws")
	_now[0] += 5000.0
	t.ok(pgm.poll(), "…to black")
	var img := Image.create_from_data(pgm.width, pgm.height, false, Image.FORMAT_RGBA8, pgm.frame)
	t.eq(_px(img, 480, 224), Color.BLACK, "an empty bus is black")
	var prv: RefCounted = Video.new("prv2", s)
	t.ok(prv.poll() and prv.width == 960 and prv.height == 540, "Projection PRV (1080p) still")
	var inp: RefCounted = Video.new("in1", s)
	t.ok(not inp.poll() and inp.signal_lost, "an input role has no picture")


func test_operator_surface_draws_the_windows() -> void:
	var s := _server()
	var op: RefCounted = Video.new("opgui", s)
	t.ok(op.poll() and [op.width, op.height] == [1920, 1080], "the operator canvas (operator GUI destination size)")
	t.eq(op.signal_lost, false, "has signal")
	var img := Image.create_from_data(op.width, op.height, false, Image.FORMAT_RGBA8, op.frame)
	t.eq(_px(img, 960, 540), Color.BLACK, "no windows: black")
	var cell := {"id": "pgm_1", "role": "pgm", "mainIndex": 0, "rect": {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.4}, "surface": "compose"}
	t.ok(s.handle(POST, "/api/operator-gui/layout", {"cells": [cell], "atlas": true}).ok, "layout POST answered")
	t.eq(s.handle(GET, "/api/operator-gui/layout", null).data.cells.size(), 1, "GET returns the windows")
	t.eq(s.handle(GET, "/api/operator-gui/layout", null).data.atlas, null, "never atlas mode")
	t.ok(op.poll(), "a layout change redraws")
	img = Image.create_from_data(op.width, op.height, false, Image.FORMAT_RGBA8, op.frame)
	t.ok(_px(img, 576, 324).get_luminance() > 0.05, "PGM 1's still inside its window")
	t.eq(_px(img, 1700, 1000), Color.BLACK, "black outside it")
	t.eq(op.poll(), false, "nothing new")
	_now[0] += 10.0
	s.handle(POST, "/api/scene/take-look", {"sceneId": "look-black-wall", "mainIdx": 0, "target": "program"})
	t.ok(op.poll(), "a take on a window's bus redraws")


func test_timeline_plays_on_the_client_clock() -> void:
	var s := _server()
	var sent := []
	s.broadcast.connect(func(type: String, d: Variant) -> void: sent.append([type, d]))
	var list: Array = s.handle(GET, "/api/timelines", null).data
	t.eq(list.size(), 1, "one timeline")
	var id := str(list[0].id)
	var dur := float(list[0].duration)
	t.ok(s.handle(PUT, "/api/timelines/" + id, list[0]).ok, "PUT (the client's sync before play)")
	var r: Dictionary = s.handle(POST, "/api/timelines/%s/play" % id, {"from": 0, "sendTo": {"preview": true}})
	t.ok(r.ok, "play ok")
	t.eq(sent.back()[0], "timeline.playback", "play broadcasts timeline.playback")
	t.eq(sent.back()[1].playing, true, "playing")
	t.eq(str(sent.back()[1].timelineId), id, "its id")
	sent.clear()
	s.tick()
	t.eq(sent.size(), 1, "first tick goes out at once")
	_now[0] += 1000.0
	s.tick()
	t.eq(sent.back()[0], "timeline.tick", "timeline.tick")
	t.eq(float(sent.back()[1].position), 1000.0, "position follows the clock")
	var n := sent.size()
	_now[0] += 100.0
	s.tick()
	t.eq(sent.size(), n, "ticks are throttled to 165 ms")
	_now[0] += 100.0
	s.tick()
	t.eq(sent.size(), n + 1, "then the next one")
	s.handle(POST, "/api/timelines/%s/pause" % id, {})
	_now[0] += 5000.0
	var st: Dictionary = s.handle(GET, "/api/timelines/%s/state" % id, null).data
	t.eq([st.playing, float(st.position)], [false, 1200.0], "pause freezes the position")
	s.handle(POST, "/api/timelines/%s/seek" % id, {"ms": 5000})
	t.eq(float(s.handle(GET, "/api/timelines/%s/state" % id, null).data.position), 5000.0, "seek")
	t.eq(int(s.handle(POST, "/api/timelines/%s/seek" % id, {}).status), 400, "seek needs ms")
	s.handle(POST, "/api/timelines/%s/play" % id, {"from": 0})
	t.eq(float(s.handle(GET, "/api/timelines/%s/state" % id, null).data.position), 5000.0, "play of a paused timeline resumes")
	s.handle(POST, "/api/timelines/%s/loop" % id, {"loop": true})
	_now[0] += dur
	s.tick()
	st = s.handle(GET, "/api/timelines/%s/state" % id, null).data
	t.eq([st.playing, float(st.position), st.loop], [true, 0.0, true], "past the end a looping timeline starts over")
	s.handle(POST, "/api/timelines/%s/loop" % id, {"loop": false})
	_now[0] += dur + 1.0
	s.tick()
	st = s.handle(GET, "/api/timelines/%s/state" % id, null).data
	t.eq([st.playing, float(st.position)], [false, 0.0], "past the end it stops")
	t.eq(s.state.timeline.playback.playing, false, "the state snapshot carries the playback")


func test_timeline_take_stop_and_create() -> void:
	var s := _server()
	var id := str(s.tl_list[0].id)
	var r: Dictionary = s.handle(POST, "/api/timelines/%s/take" % id, {"transition": "MIX", "duration": 12, "screenIdx": 0})
	t.ok(r.ok, "take ok")
	var st: Dictionary = s.handle(GET, "/api/timelines/%s/state" % id, null).data
	t.eq([st.playing, st.sendTo.program, st.sendTo.preview], [true, true, false], "take: playing on PGM only")
	s.handle(POST, "/api/timelines/%s/stop" % id, {"force": true})
	st = s.handle(GET, "/api/timelines/%s/state" % id, null).data
	t.eq([st.playing, st.sendTo.program, st.sendTo.preview], [false, false, true], "stop leaves PGM (PRV-only again)")
	t.eq(int(s.handle(POST, "/api/timelines/nope/play", {}).status), 404, "unknown timeline")
	var made: Dictionary = s.handle(POST, "/api/timelines", {"name": "New one"}).data
	t.ok(str(made.id) != "" and float(made.duration) == 30000.0, "POST creates with the engine's defaults")
	t.eq((s.handle(GET, "/api/timelines", null).data as Array).size(), 2, "listed")
	s.handle(PUT, "/api/timelines/tl-x", {"name": "Put-created"})
	t.eq(str(s.handle(GET, "/api/timelines/tl-x", null).data.name), "Put-created", "PUT creates a missing one")
	s.handle(HTTPClient.METHOD_DELETE, "/api/timelines/tl-x", null)
	t.eq(int(s.handle(GET, "/api/timelines/tl-x", null).status), 404, "DELETE")


func test_devices_view_is_read_only() -> void:
	var s := _server()
	var said := []
	s.notice.connect(func(text: String) -> void: said.append(text))
	var r: Dictionary = s.handle(GET, "/api/device-view?_ts=1", null)
	t.ok(r.ok and r.data is Dictionary and r.data.get("graph") is Dictionary, "GET /api/device-view")
	t.ok((r.data.graph.connectors as Array).size() > 0, "connectors")
	var ids := (s.state.screenDestinations.destinations as Array).map(func(d: Dictionary) -> String: return str(d.id))
	t.eq((r.data.screenDestinations.destinations as Array).map(func(d: Dictionary) -> String: return str(d.id)), ids, "the demo's destinations")
	for c in r.data.graph.connectors:
		if str(c.kind) == "destination_in" and str(c.get("externalRef", "")).begins_with("dst_"):
			t.ok(ids.has(str(c.externalRef)), "destination connector %s is a demo destination" % c.externalRef)
	t.eq(r.data.live.caspar.channelMap.programChannels, s.state.channelMap.programChannels, "the demo's channel map")
	t.eq(str(r.data.live.host.hostname), "demo", "no host name")
	t.eq(int(s.handle(POST, "/api/device-view", {"graph": {}}).status), 501, "a cable / destination write is not in demo")
	t.eq(said.size(), 1, "and says so")


func test_reset_and_hooks() -> void:
	t.eq(Profiles.restart_user_args(PackedStringArray(["--demo", "--tab=4", "--server=http://x"])),
		PackedStringArray(["--demo", "--tab=4"]), "a reset restart keeps --demo")
	var panes := FileAccess.get_file_as_string("res://features/settings/settings_panes.gd")
	t.ok(panes.contains("reset.text = \"Reset demo\"") and panes.contains("ConnectionMenu.restart(host)"), "Reset demo restarts the client")
	t.ok(panes.contains("JavaScriptBridge.eval(\"window.location.reload()\")"), "on the Web it reloads the page")
	t.ok(FileAccess.get_file_as_string("res://core/ws.gd").contains("Demo.shared().tick()"), "Ws runs the demo clock")
	t.ok(FileAccess.get_file_as_string("res://core/api.gd").contains("return Demo.shared().get_bytes(path)"), "Api bytes from the demo")
	t.ok(FileAccess.get_file_as_string("res://video/video_surfaces.gd").contains("r = DemoVideo.new(role, Demo.shared())"), "stills on the readers")
