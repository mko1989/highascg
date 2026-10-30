extends RefCounted
## WO-865 — the demo display engine: fades on take / PRV push / clear / FTB (core/demo/demo_bus.gd + demo_transition.gd),
## layer opacity / rotation in the composed frame, live PRV edits, motion of video layers, the two playable Ogg Theora
## placeholders, the GPU views (core/demo/demo_bus_view.gd, demo_stage.gd) and the per-frame cost.

const Demo := preload("res://core/demo/demo_server.gd")
const Video := preload("res://core/demo/demo_video.gd")
const Bus := preload("res://core/demo/demo_bus.gd")
const Tr := preload("res://core/demo/demo_transition.gd")
const Media := preload("res://core/demo/demo_media.gd")
const BusView := preload("res://core/demo/demo_bus_view.gd")
const Stage := preload("res://core/demo/demo_stage.gd")
const POST := HTTPClient.METHOD_POST
const GET := HTTPClient.METHOD_GET
var t
var _now := [1000000.0]  # ms


func _server() -> RefCounted:
	var s: RefCounted = Demo.new(Demo.load_dir(Demo.DATA_DIR))
	_now[0] = 1000000.0
	s.now_ms = func() -> float: return _now[0]
	return s


func _take(s: RefCounted, id: String, target := "program", extra := {}) -> void:
	var body := {"sceneId": id, "mainIdx": 0, "target": target}
	body.merge(extra)
	t.ok(s.handle(POST, "/api/scene/take-look", body).ok, "take %s → %s" % [id, target])


func _alpha(items: Array, media: String) -> float:
	for it in items:
		if str(it.media) == media:
			return float(it.alpha)
	return -1.0


func _px(img: Image, x: int, y: int) -> Color:
	return img.get_pixel(clampi(x, 0, img.get_width() - 1), clampi(y, 0, img.get_height() - 1))


func test_transition_math() -> void:
	t.eq(Tr.base_type({"type": "MIX + ANIMATE"}), "MIX", "+ ANIMATE is the base type")
	t.eq(Tr.base_type({}), "CUT", "no type = the deck default CUT")
	t.eq(Tr.base_type({"type": "wobble"}), "MIX", "unknown → MIX")
	t.eq(Tr.seconds({"type": "CUT", "duration": 25}, 50.0), 0.0, "CUT has no length")
	t.eq(Tr.seconds({"type": "MIX", "duration": 100}, 50.0), 2.0, "100 frames at 50 fps")
	t.eq(Tr.seconds({"type": "MIX", "duration": 12}, 50.0), Tr.MIN_SECONDS, "12 frames at 50 fps is 0.24 s → the demo's visible minimum")
	t.eq(Tr.ease("linear", 0.5), 0.5, "linear")
	t.ok(Tr.ease("easeinquad", 0.5) < 0.5 and Tr.ease("easeoutquad", 0.5) > 0.5, "ease in is slow at first, ease out fast")
	t.eq(Tr.ease("easeinoutcubic", 0.5), 0.5, "in-out passes the middle")
	var sz := Vector2(960, 540)
	t.eq(Tr.incoming("MIX", 0.25, sz).alpha, 0.25, "a MIX fades the incoming look in")
	t.eq(Tr.incoming("SLIDE", 0.25, sz).offset, Vector2(720, 0), "a SLIDE enters from the right")
	t.eq(Tr.outgoing("PUSH", 0.25, sz, true).offset, Vector2(-240, 0), "a PUSH moves the old look out")
	t.eq(Tr.incoming("WIPE", 0.5, sz).clip, Rect2(0, 0, 480, 540), "a WIPE reveals from the left")
	t.eq(Tr.incoming("WIPE", 0.0, sz).clip.size.x > 0.0, true, "a wipe at 0 still has a (tiny) clip, never 'no clip'")
	t.eq(Tr.outgoing("MIX", 0.4, sz, false).alpha, 0.6, "an uncovered layer fades out")
	t.eq(Tr.outgoing("MIX", 0.4, sz, true).alpha, 1.0, "a covered layer stays under the incoming one")


func test_take_fades_over_time() -> void:
	var s := _server()
	var bus: RefCounted = s.bus(1, s.clock())  # Opener on PGM 1
	t.eq(bus.frame(s.clock()).size(), 1, "Opener: one picture layer (its two wavs draw nothing)")
	t.eq(_alpha(bus.frame(s.clock()), "demo/opener.mov"), 1.0, "settled at the start: no fade of the show as it stands")
	_now[0] += 1000.0
	_take(s, "look-loop-b")
	var t0: float = s.clock()
	bus = s.bus(1, t0)
	t.eq(bus.progress(t0), 0.0, "a take starts a fade")
	t.ok(bus.in_transition(t0), "in transition")
	var items: Array = bus.frame(t0)
	t.eq(items.size(), 1, "at 0 % only the old look has pixels")
	t.eq(_alpha(items, "demo/opener.mov"), 1.0, "the old look is still there at 0 %")
	t.eq(_alpha(items, "demo/loop_b.mov"), -1.0, "the new look has no pixels at 0 % (alpha 0 is not drawn)")
	var seen := []
	for k in [0.1, 0.25, 0.5, 0.75]:
		var now: float = t0 + Tr.MIN_SECONDS * k
		bus = s.bus(1, now)
		seen.append(_alpha(bus.frame(now), "demo/loop_b.mov"))
		t.ok(absf(bus.progress(now) - k) < 0.001, "progress %.2f at %.0f%% of the time" % [bus.progress(now), k * 100.0])
	for i in 4:
		t.ok(absf(float(seen[i]) - [0.1, 0.25, 0.5, 0.75][i]) < 0.001, "the incoming layer's alpha follows the clock (linear MIX): %.3f" % float(seen[i]))
	t.eq(bus.frame(t0 + Tr.MIN_SECONDS * 0.5).size(), 2, "mid-fade both looks are on the screen")
	var done: float = t0 + Tr.MIN_SECONDS + 0.01
	bus = s.bus(1, done)
	items = bus.frame(done)
	t.eq(items.size(), 1, "after the fade only the new look")
	t.eq([_alpha(items, "demo/loop_b.mov"), bus.in_transition(done)], [1.0, false], "fully in, no longer in transition")
	t.ok(s.handle(POST, "/api/ftb", {"screenIdx": 0}).ok, "FTB")
	var f0: float = s.clock() + 0.3  # the fade started now; look at 0.3 s of 0.6 s
	bus = s.bus(1, f0)
	t.eq(bus.frame(f0).size() > 0, true, "FTB: the picture is still there mid-way")
	var mid: float = _alpha(bus.frame(f0), "demo/loop_b.mov")
	t.ok(mid > 0.0 and mid < 1.0, "…and fading out (%.2f)" % mid)
	t.eq(bus.frame(f0 + 2.0).size(), 0, "…then black")


func test_cut_and_overrides() -> void:
	var s := _server()
	s.bus(1, s.clock())
	_now[0] += 1000.0
	_take(s, "look-loop-b", "program", {"forceCut": true})
	var bus: RefCounted = s.bus(1, s.clock())
	t.eq([bus.in_transition(s.clock()), _alpha(bus.frame(s.clock()), "demo/loop_b.mov")], [false, 1.0], "forceCut: at once")
	_now[0] += 1000.0
	_take(s, "look-loop-a", "program", {"transitionOverride": {"type": "WIPE", "duration": 100, "tween": "linear"}})
	var now: float = s.clock() + 1.0  # 100 frames at 50 fps = 2 s → halfway
	bus = s.bus(1, now)
	var wiped: Array = bus.frame(now)
	t.eq(wiped.size(), 2, "a wipe: both looks")
	t.ok(absf(float(wiped[1].clip.size.x) - 480.0) < 1.0, "the incoming look is clipped to the wiped half (%s)" % str(wiped[1].clip))
	var s2 := _server()
	s2.bus(1, s2.clock())
	_now[0] += 1000.0
	_take(s2, "look-loop-a", "program", {"transitionOverride": {"type": "SLIDE", "duration": 100, "tween": "linear"}})
	var b2: RefCounted = s2.bus(1, s2.clock() + 1.0)
	var slid: Array = b2.frame(s2.clock() + 1.0)
	t.ok(absf(float(slid[1].dst.position.x) - 480.0) < 1.0, "a slide: the incoming look is halfway in (x %.0f)" % float(slid[1].dst.position.x))


func test_same_layer_same_source_is_left_alone() -> void:
	var s := _server()
	_take(s, "look-loop-b", "preview")  # PRV 1 (ch 2): Loop B
	s.bus(2, s.clock())
	_now[0] += 1000.0
	_take(s, "look-bumper", "preview")  # Bumper: layer 10 = loop_b.mov again, layer 11 = bumper.mov
	var now: float = s.clock() + 0.1
	var items: Array = s.bus(2, now).frame(now)
	t.eq(_alpha(items, "demo/loop_b.mov"), 1.0, "the unchanged layer neither fades nor restarts")
	var lb := items.filter(func(i: Dictionary) -> bool: return i.media == "demo/loop_b.mov")
	t.eq(lb.size(), 1, "drawn once")
	t.ok(float(lb[0].t) > 1.0, "…and it kept playing (t %.1f s)" % float(lb[0].t))
	t.ok(_alpha(items, "demo/bumper.mov") > 0.0 and _alpha(items, "demo/bumper.mov") < 1.0, "the new layer fades in")


func test_layer_opacity_in_the_composed_frame() -> void:
	var s := _server()
	var look: Dictionary = (Demo.new(Demo.load_dir(Demo.DATA_DIR)) as RefCounted).project.scenes.scenes[1].duplicate(true)  # Loop A, layer 10 opacity 1
	var full: Image = Video.look_still(look, 96, 54)
	look.layers[0]["opacity"] = 0.5
	var half: Image = Video.look_still(look, 96, 54)
	var a := _px(full, 48, 27)
	var b := _px(half, 48, 27)
	t.ok(a.get_luminance() > 0.1, "the full-opacity frame has the still")
	t.ok(absf(b.r - a.r * 0.5) < 0.04 and absf(b.g - a.g * 0.5) < 0.04 and absf(b.b - a.b * 0.5) < 0.04, "half opacity = half the still over black (%s vs %s)" % [b, a])
	look.layers[0]["opacity"] = 0.0
	t.eq(_px(Video.look_still(look, 96, 54), 48, 27), Color.BLACK, "opacity 0: nothing")
	look.layers[0]["opacity"] = 1
	look.layers[0]["rotation"] = 15
	var items: Array = Bus.settled_items(look, Vector2i(960, 540))
	t.eq(float(items[0].rotation), 15.0, "rotation travels to the GPU view")
	var s2 := _server()
	t.ok(s2 != null and s != null, "servers")


func test_prv_edit_changes_the_frame_live() -> void:
	var s := _server()
	var now: float = s.clock()
	var before: Array = s.bus(2, now).frame(now)  # PRV 1: Loop A
	t.eq(_alpha(before, "demo/loop_a.mov"), 1.0, "PRV shows Loop A at full opacity")
	_now[0] += 5000.0
	# what the Inspector does: the look in the deck is edited, then deck sync + preview-push
	var looks: Array = s.handle(GET, "/api/project", null).data.scenes.scenes
	for l in looks:
		if l.id == "look-loop-a":
			l.layers[0]["opacity"] = 0.4
			l.layers[0]["fill"] = {"x": 0.25, "y": 0.25, "scaleX": 0.5, "scaleY": 0.5}
	s.on_ws({"type": "scene_deck_sync", "data": {"looks": [], "sceneSnapshots": looks}})
	t.ok(s.handle(POST, "/api/scene/preview-push", {"sceneId": "look-loop-a", "mainIdx": 0}).ok, "preview-push")
	now = s.clock()
	var bus: RefCounted = s.bus(2, now)
	var after: Array = bus.frame(now)
	t.eq([bus.in_transition(now), after.size()], [false, 1], "an edit of the look on PRV applies at once (no fade)")
	t.ok(absf(float(after[0].alpha) - 0.4) < 0.001, "opacity edit shows (%.2f)" % float(after[0].alpha))
	var dst: Rect2 = after[0].dst
	t.ok(absf(dst.position.x - 240.0) < 2.0 and absf(dst.position.y - 112.0) < 2.0 and absf(dst.size.y - 224.0) < 2.0, "position / scale edit shows (%s)" % str(dst))
	t.ok(float(after[0].t) > 4.0, "the clip kept running through the edit")
	var img: Image = Video.raster(after, 96, 54, bus.size)
	t.eq(_px(img, 5, 5), Color.BLACK, "outside the shrunk layer: black")
	t.ok(_px(img, 48, 27).get_luminance() > 0.02, "inside it: the (dimmed) still")


func test_prv_push_of_another_look_fades() -> void:
	var s := _server()
	s.bus(2, s.clock())
	_now[0] += 1000.0
	_take(s, "look-song-1", "preview")
	var now: float = s.clock() + 0.25
	var bus: RefCounted = s.bus(2, now)
	t.ok(bus.in_transition(now), "PRV push fades")
	var items: Array = bus.frame(now)
	t.ok(_alpha(items, "demo/song_1_wall.mov") > 0.3 and _alpha(items, "demo/song_1_wall.mov") < 0.7, "mid-fade (%.2f)" % _alpha(items, "demo/song_1_wall.mov"))
	s.handle(POST, "/api/scene/live/preview/clear", {"mainIdx": 0})
	var later: float = now + 0.2
	var b2: RefCounted = s.bus(2, later)
	t.ok(b2.in_transition(later), "PRV clear fades out")
	t.eq(b2.frame(later + 3.0).size(), 0, "…to black")


func test_motion_of_video_layers() -> void:
	var s := _server()
	var now: float = s.clock()
	var bus: RefCounted = s.bus(1, now)
	var f1: Array = bus.frame(now)
	var f2: Array = bus.frame(now + 1.0)
	t.eq(f1[0].kind, "video", "the synthetic clips are video layers")
	t.ok(float(f2[0].t) - float(f1[0].t) > 0.99, "their clock runs")
	var v := BusView.new()
	v.size = Vector2(960, 448)
	v.apply(f1)
	var m1: ShaderMaterial = v.node_at(0).material
	var t1: float = float(m1.get_shader_parameter("t"))
	var zoom_a: Variant = m1.get_shader_parameter("motion")
	v.apply(f2)
	t.eq(zoom_a, 1.0, "motion is switched on in the shader")
	t.ok(float(m1.get_shader_parameter("t")) - t1 > 0.99, "two frames differ: the shader time moved")
	t.ok(str(m1.shader.code).contains("sin(t * 0.45"), "the shader zooms / pans / sweeps by that time")
	var still := {"layers": [{"layerNumber": 10, "source": {"type": "media", "value": "demo/black.png"}, "fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}}]}
	var si: Array = Bus.settled_items(still, Vector2i(96, 54), func(id: String) -> Dictionary: return Media.info(s.state, id))
	t.eq(si[0].kind, "still", "a still stays a still")
	v.apply(si)
	t.eq(v.node_at(0).material.get_shader_parameter("motion"), 0.0, "…no motion")
	v.free()


func test_placeholder_videos_are_in_the_data_set() -> void:
	var s := _server()
	var ids := {}
	for m in s.state.media:
		ids[m.id] = m
	for spec in [["demo/placeholder_loop.ogv", 10000], ["demo/placeholder_clip.ogv", 30000]]:
		t.ok(ids.has(spec[0]), "%s is in the media list" % spec[0])
		t.eq([str(ids[spec[0]].type), int(ids[spec[0]].durationMs), int(ids[spec[0]].fps)], ["MOVIE", spec[1], 25], "%s: a 25 fps movie of %d ms" % [spec[0], spec[1]])
		t.ok(Media.stream_for(spec[0]) != "", "%s ships as a res:// file" % spec[0])
		var stream: Variant = load(Media.stream_for(spec[0]))
		t.ok(stream is VideoStreamTheora, "%s loads as an Ogg Theora stream" % spec[0])
		t.ok(Media.thumb_image(spec[0]) != null, "%s has its thumbnail" % spec[0])
	t.eq(Media.stream_for("demo/opener.mov"), "", "the synthetic stand-ins keep their motion shader")
	var lk := {}
	for l in s.project.scenes.scenes:
		lk[l.id] = l
	t.ok(lk.has("look-video-loop") and lk["look-video-loop"].layers[0].loop == true, "a look with the loop on")
	t.ok(lk.has("look-video-clip") and lk["look-video-clip"].layers[0].loop == false, "a look with the clip, loop off")
	var deck := []
	for d in s.state.scene.deck.looks:
		deck.append(d.id)
	t.ok(deck.has("look-video-loop") and deck.has("look-video-clip"), "the deck lists both")
	t.ok(FileAccess.get_file_as_string("res://export_presets.cfg").count("demo/*.ogv") >= 5, "every export preset ships the .ogv files")


func test_loop_wraps_and_clip_ends() -> void:
	var s := _server()
	_take(s, "look-video-loop", "preview")
	_take(s, "look-video-clip", "program")
	var t0: float = s.clock()
	s.bus(2, t0)
	s.bus(1, t0)
	var lp: Dictionary = s.bus(2, t0 + 12.5).frame(t0 + 12.5)[0]
	t.eq(lp.kind, "stream", "the loop is a real stream")
	t.ok(absf(float(lp.pos) - 2.5) < 0.01 and not bool(lp.ended) and bool(lp.loop), "loop on: 12.5 s into a 10 s clip is at 2.5 s, never ended (pos %.2f)" % float(lp.pos))
	var cl: Dictionary = s.bus(1, t0 + 10.0).frame(t0 + 10.0)[0]
	t.ok(absf(float(cl.pos) - 10.0) < 0.01 and not bool(cl.ended), "clip: 10 s in, playing")
	var ended: Dictionary = s.bus(1, t0 + 31.0).frame(t0 + 31.0)[0]
	t.ok(bool(ended.ended) and absf(float(ended.pos) - 30.0) < 0.01, "clip: 31 s in, ended, held on its last frame")
	t.ok(str(cl.key) == str(ended.key), "same layer instance (one player) throughout")


func test_stage_builds_surfaces_and_views() -> void:
	var s := _server()
	var stage: Node = Stage.new(s)
	t.root.add_child(stage)
	var tex: Texture2D = stage.texture("pgm1")
	t.ok(tex != null, "a role texture (the SubViewport's)")
	stage.refresh("pgm1", s.clock())
	t.eq(stage.surface_size("pgm1"), Vector2i(960, 448), "the LED wall bus at 960 wide")
	t.eq(stage.surface_size("prv2"), Vector2i(960, 540), "1080p projection PRV")
	stage.refresh("prv2", s.clock())
	stage.refresh("in1", s.clock())  # no bus: black, no crash
	var cells := [{"id": "pgm_1", "role": "pgm", "mainIndex": 0, "rect": {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.4}}, {"id": "prv_1", "role": "prv", "mainIndex": 0, "rect": {"x": 0.55, "y": 0.1, "w": 0.4, "h": 0.4}}]
	s.handle(POST, "/api/operator-gui/layout", {"cells": cells, "atlas": true})
	stage.refresh("opgui", s.clock())
	t.eq(stage.surface_size("opgui"), Vector2i(1920, 1080), "the operator canvas")
	t.eq(stage._surfaces["opgui"].views.size(), 2, "one scaled view per window")
	var w0: Dictionary = stage._surfaces["opgui"].views[0]
	t.ok(w0.clipper.clip_contents and absf(w0.view.scale.x - w0.clipper.size.x / 960.0) < 0.001, "a window clips and scales its bus")
	t.eq(w0.view.shown, 1, "PGM 1 shows the Opener")
	# a real clip plays through VideoStreamPlayer
	_take(s, "look-video-clip", "program")
	stage.step(["pgm1"], s.clock())
	if stage.is_inside_tree():  # (the headless runner builds its tree in _init: VideoStreamPlayer.play() needs a live one)
		t.eq(stage.player_count(), 1, "one player for the clip")
		stage.step(["pgm1"], s.clock() + 0.5)
		t.eq(stage.player_count(), 1, "still one")
		stage.step([], s.clock() + 5.0)
		t.eq(stage.player_count(), 0, "retired when nobody shows it")
	stage.free()


## The cost of a frame at the demo's sizes: the model + the view update (the GPU does the pixels).
func test_cost_per_frame() -> void:
	var s := _server()
	_take(s, "look-bumper")
	var stage: Node = Stage.new(s)
	t.root.add_child(stage)
	var cells := [{"id": "a", "role": "pgm", "mainIndex": 0, "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}}, {"id": "b", "role": "prv", "mainIndex": 0, "rect": {"x": 0.5, "y": 0.0, "w": 0.5, "h": 0.5}},
		{"id": "c", "role": "pgm", "mainIndex": 1, "rect": {"x": 0.0, "y": 0.5, "w": 0.5, "h": 0.5}}, {"id": "d", "role": "prv", "mainIndex": 1, "rect": {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}}]
	s.handle(POST, "/api/operator-gui/layout", {"cells": cells, "atlas": true})
	var n := 200
	var t0 := Time.get_ticks_usec()
	for i in n:
		var now: float = s.clock() + 0.01 * i
		stage.refresh("opgui", now)
		stage.refresh("pgm1", now)
		stage.refresh("prv1", now)
	var ms := float(Time.get_ticks_usec() - t0) / 1000.0 / n
	print("[wo865] stage refresh opgui (4 windows) + pgm1 + prv1: %.3f ms per frame" % ms)
	t.ok(ms < 5.0, "model + views for the operator surface and two buses under 5 ms a frame (%.2f ms)" % ms)
	stage.free()


func test_a_playing_timeline_drives_the_picture() -> void:
	var s := _server()
	var t0: float = s.clock()
	var prv: RefCounted = s.bus(2, t0)  # PRV 1: Loop A
	t.eq(_alpha(prv.frame(t0), "demo/loop_a.mov"), 1.0, "before: the look on PRV")
	_now[0] += 1000.0
	t.ok(s.handle(POST, "/api/timelines/tl-opener/play", {"from": 0}).ok, "play the Opener timeline (sendTo PRV)")
	var now: float = s.clock()
	s.tick()
	prv = s.bus(2, now)
	t.ok(prv.in_transition(now), "the timeline fades in on PRV")
	var later: float = now + 1.0
	prv = s.bus(2, later)
	var items: Array = prv.frame(later)
	t.eq(items.size(), 1, "after the fade only the timeline's clip")
	t.eq(items[0].media, "demo/opener.mov", "its first clip is on the picture")
	t.ok(float(items[0].t) > 0.9, "…and it runs")
	var pgm: RefCounted = s.bus(1, later)
	t.eq(_alpha(pgm.frame(later), "demo/opener.mov"), 1.0, "PGM keeps its look (Opener was on air): sendTo PRV only")
	t.ok(s.handle(POST, "/api/timelines/tl-opener/take", {"screenIdx": 0}).ok, "Take: on PGM")
	var at: float = s.clock() + 0.0
	pgm = s.bus(1, at)
	t.eq(String(pgm.look_id), "timeline:tl-opener", "PGM 1 shows the timeline now")
	t.ok(s.handle(POST, "/api/timelines/tl-opener/stop", {}).ok, "stop")
	var st: float = s.clock() + 0.1
	prv = s.bus(2, st)
	t.eq(prv.look_id, "look-loop-a", "stopped: the PRV look is back")
	t.ok(prv.in_transition(st), "…faded")
