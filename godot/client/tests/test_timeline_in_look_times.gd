extends RefCounted
## WO-998 — a look holding a timeline: the card picture (first clip's thumbnail), the on-air clock behind the deck
## timer bar, and the compose window row of the timeline layer.

const Clock := preload("res://features/live/timeline_clock.gd")
const CT := preload("res://features/live/compose_times_model.gd")
const TM := preload("res://features/live/look_thumb_math.gd")
var t

const TLS := [{"id": "tl1", "name": "Intro", "duration": 45000, "layers": [
	{"id": "a", "clips": [{"source": {"type": "template", "value": "lower_third"}, "startTime": 0},
		{"source": {"type": "media", "value": "INTRO/late.mp4"}, "startTime": 9000}]},
	{"id": "b", "clips": [{"source": {"type": "media", "value": "INTRO/wss-szufnara.mp4"}, "startTime": 2000}]},
]}]


func _pb(extra := {}) -> Dictionary:
	var pb := {"timelineId": "tl1", "position": 10000, "playing": true, "loop": false, "endHeld": false,
		"sendTo": {"preview": false, "program": true, "screenIdx": 0}}
	pb.merge(extra, true)
	return pb


func test_on_air_needs_bus_screen_and_play_or_hold() -> void:
	Clock.reset()
	var a := Clock.on_air(_pb(), TLS, true, 0, 0.0)
	t.eq(a.get("id"), "tl1", "on PGM of main 0")
	t.eq(a.get("name"), "Intro")
	t.eq(a.get("elapsed"), 10.0, "snapshot position before any tick")
	t.eq(a.get("duration"), 45.0)
	t.eq(Clock.on_air(_pb(), TLS, false, 0, 0.0), {}, "not on PRV")
	t.eq(Clock.on_air(_pb(), TLS, true, 1, 0.0), {}, "not on main 1")
	t.eq(Clock.on_air(_pb({"playing": false}), TLS, true, 0, 0.0), {}, "stopped: no times")
	var held := Clock.on_air(_pb({"playing": false, "endHeld": true, "position": 44993}), TLS, true, 0, 0.0)
	t.eq(snappedf(held.get("elapsed", -1.0), 0.001), 44.993, "end hold keeps the full bar")
	t.eq(held.get("playing"), false)
	t.eq(Clock.on_air(_pb({"timelineId": "gone"}), TLS, true, 0, 0.0), {}, "unknown timeline")
	t.eq(Clock.on_air(null, TLS, true, 0, 0.0), {}, "no playback yet")


func test_ticks_run_on_between_updates() -> void:
	Clock.reset()
	Clock.note({"timelineId": "tl1", "position": 20000}, 1000.0)
	t.eq(Clock.on_air(_pb(), TLS, true, 0, 1500.0).elapsed, 20.5, "extrapolated 500 ms past the tick")
	t.eq(Clock.on_air(_pb(), TLS, true, 0, 99000.0).elapsed, 45.0, "clamped at the end")
	t.eq(Clock.on_air(_pb({"loop": true}), TLS, true, 0, 31000.0).elapsed, 5.0, "a looping timeline wraps")
	Clock.note({"timelineId": "tl1", "position": 30000, "playing": false}, 2000.0)  # a pause (timeline.playback)
	t.eq(Clock.on_air(_pb({"playing": false, "endHeld": true}), TLS, true, 0, 9000.0).elapsed, 30.0, "not playing: no run-on")
	Clock.note({"timelineId": "other", "position": 1}, 3000.0)
	t.eq(Clock.on_air(_pb(), TLS, true, 0, 3000.0).elapsed, 10.0, "a tick of another timeline is ignored")
	Clock.note({"position": 5}, 4000.0)
	Clock.note("junk")
	t.eq(Clock.on_air(_pb(), TLS, true, 0, 3000.0).elapsed, 10.0, "malformed ticks are ignored")
	Clock.reset()


func test_compose_row_times_the_timeline_layer() -> void:
	var look := {"layers": [{"layerNumber": 10, "source": {"type": "timeline", "value": "tl1", "label": "Timeline"}},
		{"layerNumber": 20, "source": {"type": "media", "value": "a.mp4"}}]}
	var on := {"id": "tl1", "name": "Intro", "elapsed": 12.0, "duration": 45.0, "playing": true}
	var rows := CT.rows(look, {"layers": {}}, null, true, 0.0, on)
	var tl: Dictionary = rows.filter(func(r: Dictionary) -> bool: return r.num == 10)[0]
	t.eq(tl.label, "L10  Intro")
	t.ok(tl.running, "timed")
	t.eq(CT.time_text(tl), "0:12 / 0:45  (−0:33)")
	t.eq(snappedf(CT.progress(tl), 0.001), 0.267)
	t.ok(tl.top, "the topmost running row (layer 20 has no OSC)")
	var off: Dictionary = CT.rows(look, {"layers": {}}, null, true, 0.0, {})[1]
	t.eq(off.label, "L10  Timeline", "not on air: its label, no time")
	t.ok(not off.running)
	var other: Dictionary = CT.rows(look, {"layers": {}}, null, true, 0.0, {"id": "x", "name": "X", "elapsed": 1.0, "duration": 2.0})[1]
	t.ok(not other.running, "another timeline on air does not time this layer")


func test_card_cover_is_the_earliest_clip_with_a_picture() -> void:
	var src := {"type": "timeline", "value": "tl1", "label": "Timeline"}
	var cover := TM.timeline_cover(src, TLS, {})
	t.eq(cover.get("value"), "INTRO/wss-szufnara.mp4", "the template at 0 has no thumbnail; the clip at 2 s wins")
	t.ok(TM.thumb_path(cover, {}).begins_with("/api/thumbnail/INTRO%2Fwss-szufnara.mp4"), "fetched like any media layer")
	t.eq(TM.timeline_cover({"type": "timeline", "value": "nope"}, TLS, {}), {}, "unknown timeline")
	t.eq(TM.timeline_cover({"type": "media", "value": "a.mp4"}, TLS, {}), {}, "only timeline sources")
	t.eq(TM.timeline_cover(src, [{"id": "tl1", "layers": [{"clips": []}]}], {}), {}, "empty timeline keeps the label box")
