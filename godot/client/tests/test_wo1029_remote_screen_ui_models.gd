extends RefCounted
## WO-1029 C15 — deck / cue / destinations / pixel-map / audio / live-sources models on the two boxes' hole maps.

const DM := preload("res://features/live/deck_model.gd")
const RC := preload("res://features/live/remote_cue.gd")
const DD := preload("res://features/devices/destinations_model.gd")
const PM := preload("res://features/previs/fixtures/pixel_map_model.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const CTL := preload("res://features/audio/audio_console_ctl.gd")
const LS := preload("res://features/live/live_sources_model.gd")
const VM := preload("res://features/visuals/visuals_model.gd")
const TS := preload("res://features/timeline/timeline_send_to.gd")
const PT := preload("res://features/live/pgm_timer_model.gd")
var t

const A := {"screenCount": 4, "channelsWhereCabled": true, "programChannels": [2, null, null, null], "previewChannels": [3, null, null, null],
	"screenLabels": ["PGM/PRV 1", "to zoom", "PGM/PRV 3", "Stream PGM"], "previewEnabledByMain": [true, false, true, true],
	"programResolutions": [{"w": 3072, "h": 1024, "fps": 50}, null, null, null], "channelResolutionsByChannel": {"2": {"w": 3072, "h": 1024}}}
const B := {"screenCount": 4, "channelsWhereCabled": true, "programChannels": [null, null, 2, 4], "previewChannels": [null, null, 3, 5], "screenLabels": ["PGM/PRV 1", "to zoom", "PGM/PRV 3", "Stream PGM"]}
const CL := {"peers": [{"id": "highascg5867", "name": "highascg5867"}]}
const LOOKS := {"a": true, "b": true}


func test_deck_buses_remote_screen_never_uses_saved_slots() -> void:
	var ps := {"liveSceneIdByMain": ["a", "a", "a", "a"], "previewSceneIdByMain": ["b", "b", "b", "b"]}
	var live := {"2": {"sceneId": "a"}}
	t.eq(DM.resolve_bus_look_ids(0, live, A, LOOKS, ps).pgm, "a", "local screen reads scene.live")
	t.eq(DM.resolve_bus_look_ids(2, live, A, LOOKS, ps), {"pgm": "", "prv": ""}, "remote without remoteLive: unknown, not the saved slot")
	var rl := [null, null, {"unknown": false, "pgm": {"sceneId": "b", "name": "B"}, "prv": {"sceneId": "a"}}, null]
	t.eq(DM.resolve_bus_look_ids(2, live, A, LOOKS, ps, rl), {"pgm": "b", "prv": "a"}, "remote with remoteLive")
	t.eq(DM.resolve_bus_look_ids(0, {"3": {"sceneId": "b"}}, B, LOOKS, ps, [null, null, null, null]), {"pgm": "", "prv": ""}, "B screen 1 remote, nothing known")
	t.eq(DM.resolve_bus_look_ids(2, {"2": {"sceneId": "a"}, "3": {"sceneId": "b"}}, B, LOOKS, ps), {"pgm": "a", "prv": "b"}, "B local screen 3")
	t.ok(DM.preview_bus_available(A, 2), "remote: the owner's setting (previewEnabledByMain) decides")
	t.ok(not DM.preview_bus_available(A, 1), "remote with preview disabled")


func test_remote_cue_lines() -> void:
	t.eq(RC.lines(A, CL, {}, 0), [], "local screen: no cue")
	t.eq(RC.lines(A, CL, {}, 2), ["on highascg5867"], "older server: only the cue")
	var sc := {"remoteLive": [null, null, {"server": {"id": "x", "name": "Z"}, "unknown": false, "pgm": {"sceneId": "a", "name": "Loop"}, "prv": null, "timeline": {"state": "playing", "position_ms": 61000, "age_ms": 0}}, null]}
	t.eq(RC.lines(A, CL, sc, 2, 1000.0), ["on Z", "PGM Loop · PRV —", "1:02"], "look and extrapolated time")
	t.eq(RC.lines(A, CL, sc, 3), ["on highascg5867", "unknown on highascg5867"], "unknown stays unknown")


func test_destination_card_cue() -> void:
	var cm := A.duplicate(true)
	cm["screenHosts"] = [{"idx": 0, "destId": "d0", "here": true}, {"idx": 1, "destId": "d1", "here": false}, {"idx": 2, "destId": "d2", "here": false}, {"idx": 3, "destId": "d3", "here": false}]
	t.eq(DD.remote_cue({"id": "d2", "mode": "pgm_prv", "mainScreenIndex": 2}, cm, CL), "on highascg5867", "remote card")
	t.eq(DD.remote_cue({"id": "d0", "mode": "pgm_prv", "mainScreenIndex": 0}, cm, CL), "", "local card")
	t.eq(DD.remote_cue({"id": "mv", "mode": "multiview", "mainScreenIndex": 2}, cm, CL), "", "multiview is never a screen")


func test_pixel_map_role_for_holes() -> void:
	t.eq(PM.role_for(2, A), "pgm1", "A pgm")
	t.eq(PM.role_for(3, A), "prv1", "A prv")
	t.eq(PM.role_for(2, B), "pgm3", "B: screen 3 is pgm3, not pgm1")
	t.eq(PM.role_for(0, B), "ch0", "channel 0 never matches a hole")


func test_audio_rows_holes() -> void:
	t.eq(CTL.programs(A), [2], "A local program channels")
	t.eq(CTL.programs(B), [2, 4], "B")
	t.eq(AR.screen_idx(B, 4), 3, "channel to real screen index")
	t.eq(AR.screen_labels(B), {2: "PGM/PRV 3", 4: "Stream PGM"}, "labels skip holes")
	var rows := AR.program_rows({"channelMap": B, "mixer": {}})
	t.eq(rows.filter(func(r: Dictionary) -> bool: return r.get("isMaster", false)).map(func(r: Dictionary) -> String: return r.key), ["pgm:2", "prv:3", "pgm:4", "prv:5"], "no strip for a remote screen")


func test_live_sources_and_visuals_skip_holes() -> void:
	var src := LS.build(B, [], null, null)
	t.eq(src.filter(func(s: Dictionary) -> bool: return str(s.value).contains("null")).size(), 0, "no route://null")
	t.eq(VM.screens(B).map(func(s: Dictionary) -> int: return s.channel), [2, 4], "Send targets local screens only")


func test_timeline_dest_and_timer() -> void:
	var o := TS.screen_options(A, CL)
	t.eq(o.map(func(x: Array) -> String: return x[0]), ["All screens", "PGM/PRV 1", "to zoom · on highascg5867", "PGM/PRV 3 · on highascg5867", "Stream PGM · on highascg5867"], "remote targets are marked")
	t.eq(PT.resolve_pgm(B, {}, 0).channel, 0, "timer of a remote screen: no channel")
	t.eq(PT.resolve_pgm(B, {}, 2).channel, 2, "timer of a local screen")


func test_clip_position_and_unknown_wording() -> void:
	const RA := preload("res://features/live/remote_air_model.gd")
	t.eq(RA.clip_pos_s({"position_s": 10.0, "paused": false, "age_ms": 500, "length_s": 100.0}, 500.0), 11.0, "playing: + age + waited")
	t.eq(RA.clip_pos_s({"position_s": 10.0, "paused": true, "age_ms": 5000}, 5000.0), 10.0, "paused: fixed")
	t.eq(RA.clip_pos_s({"position_s": 9.0, "age_ms": 3000, "length_s": 10.0, "loop": true}), 2.0, "loop wraps")
	t.eq(RA.clip_pos_s({"position_s": 9.0, "age_ms": 3000, "length_s": 10.0, "loop": false}), 10.0, "no loop: clamped")
	var sc := {"remoteLive": [null, null, {"server": {"id": "b", "name": "B"}, "unknown": false, "pgm": {"sceneId": "a", "name": "L"}, "prv": null, "timeline": {"state": "held", "position_ms": 1000, "age_ms": 9000},
		"clips": [{"bus": "pgm", "clip": "m/x.mp4", "position_s": 3.0, "paused": false, "age_ms": 0, "length_s": null}]}, {"server": {"id": "b", "name": "B"}, "unknown": true, "last_seen_age_ms": 20000, "pgm": null, "prv": null, "timeline": null, "clips": []}]}
	t.eq(RA.timer_ms(RA.entry(sc, 2), 5000.0), 1000.0, "held does not run")
	t.eq(RC.lines(A, CL, sc, 2)[2], "PGM clip x.mp4 0:03", "clip line")
	t.eq(RC.lines(A, CL, sc, 3), ["on B", "unknown on B"], "unknown entry: no content")


func test_atlas_slot_of_box_b_own_screen() -> void:
	# the Live tile of box B's own screen 3 finds its slot by id (not by position)
	const TM := preload("res://features/live/compose_tile_math.gd")
	var atlas := {"slots": {"pgm_3": {"x": 0.62, "y": 0.0, "w": 0.19, "h": 0.094}, "prv_3": {"x": 0.38, "y": 0.0, "w": 0.23, "h": 0.117}}}
	t.ok(TM.slot_px(atlas, "pgm_3", Vector2(1920, 1080)).size.x > 0.0, "pgm_3 has its slot")
	t.eq(TM.source_aspect({"role": "pgm", "mainIndex": 2}, B), 16.0 / 9.0, "B pgm aspect without resolutions")
