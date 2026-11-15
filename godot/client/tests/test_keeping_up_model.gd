extends RefCounted
## WO-1088 — this client's fps check (target-relative, debounced), the merge with the server's checks (worst offender,
## own report left out), incident lines; the render pacer's cap (2× the fed channel only while publishing, monitor
## rate otherwise, never below it; --max-fps is the operator's).

const M := preload("res://app/keeping_up_model.gd")
const P := preload("res://app/render_pacer.gd")
var t


func test_fps_level_relative_to_target() -> void:
	t.eq(M.fps_level(100, 100, true, 50), M.OK, "publishing at the 2× cap")
	t.eq(M.fps_level(80, 100, true, 50), M.BEHIND, "publishing under 85 % of the cap")
	t.eq(M.fps_level(46, 100, true, 50), M.FAILING, "publishing below the channel rate: Caspar repeats frames")
	t.eq(M.fps_level(50, 50, false, 0), M.OK, "the GUI at the monitor rate")
	t.eq(M.fps_level(39, 50, false, 0), M.BEHIND, "under 80 % of the cap")
	t.eq(M.fps_level(24, 50, false, 0), M.FAILING, "under half")
	t.eq(M.fps_level(30, 30, false, 0), M.OK, "a client capped low on purpose (--max-fps 30) is not an alarm")
	t.eq(M.fps_level(-1, 50, false, 0), M.OK, "no reading yet")


func test_hysteresis_rise_three_fall_five() -> void:
	var s := {"status": M.OK}
	s = M.step(s, M.BEHIND)
	s = M.step(s, M.BEHIND)
	t.eq(s.status, M.OK, "two slow seconds (a cap being raised) are not an alarm")
	s = M.step(s, M.BEHIND)
	t.eq(s.status, M.BEHIND, "three are")
	for i in 4:
		s = M.step(s, M.OK)
	t.eq(s.status, M.BEHIND, "held through 4 calm seconds")
	s = M.step(s, M.OK)
	t.eq(s.status, M.OK, "released on the 5th")


func test_fps_check_row() -> void:
	var c := M.fps_check(61.4, 100, "2× the 50 fps show, feeding Caspar", M.BEHIND, true)
	t.eq(c.text, "61 / 100 fps · 2× the 50 fps show, feeding Caspar", "target vs measured + why")
	t.eq(c.label, "This client at 61 of 100 fps", "plain words for the header")
	t.ok(str(c.hint).contains("judder on air"), "publishing: the hint names the on-air consequence")
	t.eq(M.fps_check(50, 50, "the 50 Hz monitor", M.OK, false).label, "", "ok → no label")


func test_merge_worst_offender_and_own_report() -> void:
	var server := {"checks": [
		{"key": "gpu", "group": "box", "name": "GPU", "level": 1, "label": "GPU saturated (97 %)"},
		{"key": "out:2:600", "group": "output", "name": "Dioda output", "level": 1, "label": "Dioda output dropping frames"},
		{"key": "client:me:fps", "group": "client", "name": "Operator client", "level": 2, "label": "Operator client at 20 of 100 fps"},
		{"key": "cpu", "group": "box", "name": "CPU", "level": 0, "label": ""}],
		"incidents": [{"label": "Visuals at 38 of 50 fps", "worst": "31 / 50 fps", "startedAt": 0, "durationS": 12, "level": 1}]}
	var own := M.fps_check(100, 100, "x", M.OK, true)
	var sm := M.merge(server, [own], "me")
	t.eq(sm.label, "Dioda output dropping frames", "same level: the output beats the box")
	t.eq(sm.status, "behind", "amber")
	t.eq(sm.checks.size(), 4, "own server copy left out, local one in")
	t.eq(sm.checks.map(func(c: Dictionary) -> String: return str(c.key)), ["out:2:600", "gpu", "client-fps", "cpu"], "offenders first (output before box), then ok by group")
	t.eq(sm.incidents.size(), 1, "incidents come from the server")
	t.eq(M.incident_line(sm.incidents[0]), "12 s · Visuals at 38 of 50 fps — worst 31 / 50 fps", "what, how long, worst")
	t.eq(M.merge({}, [own], "me").level, M.OK, "server gone: own check only")
	t.eq(M.merge({}, [M.fps_check(20, 100, "x", M.FAILING, true)], "me").label, "This client at 20 of 100 fps", "own failing")


func test_pacer_targets() -> void:
	t.eq(P.target_fps(50.0, 50.0, []), 50, "nothing published: the 50 Hz monitor")
	t.eq(P.target_fps(50.0, 50.0, [50.0]), 100, "Visuals into a 50 fps channel: 100")
	t.eq(P.target_fps(60.0, 60.0, [60.0]), 120, "a 60 fps show: 120, not a hard-coded 100")
	t.eq(P.target_fps(60.0, 25.0, [25.0]), 60, "a 25 fps show: 2× = 50 is below the 60 Hz monitor → 60")
	t.eq(P.target_fps(50.0, 50.0, [25.0, 50.0]), 100, "the fastest fed channel wins")
	t.eq(P.target_fps(-1.0, 25.0, []), 25, "monitor unknown: the show's rate")
	t.eq(P.target_fps(-1.0, 0.0, []), 60, "nothing known: 60")
	t.eq(P.cap_from_args(PackedStringArray(["--path", "x", "--max-fps", "30"])), 30, "--max-fps N")
	t.eq(P.cap_from_args(PackedStringArray(["--max-fps=24"])), 24, "--max-fps=N")
	t.eq(P.cap_from_args(PackedStringArray(["--path", "x"])), 0, "none")


func test_pacer_raises_at_once_and_lowers_after_hold() -> void:
	if P.operator_cap() > 0:
		t.ok(true, "the runner was started with --max-fps: the pacer leaves it alone")
		return
	var keep := Engine.max_fps
	P.publish_started(4242, 50.0)
	t.eq(Engine.max_fps, P.target_fps(P.monitor_hz(), P.channel_fps, [50.0]), "raised in start(), before the first frame")
	t.ok(P.publishing(), "publishing")
	P.publish_stopped(4242)
	t.eq(Engine.max_fps, P.target_fps(P.monitor_hz(), P.channel_fps, [50.0]), "not lowered at once (hold)")
	P.publish_started(4243, 50.0)
	P.publish_stopped(4243)
	t.ok(not P.publishing(), "stopped")
	Engine.max_fps = keep
