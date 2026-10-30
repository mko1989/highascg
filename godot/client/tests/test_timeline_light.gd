extends RefCounted
## WO-837 — the light flag's model: action fields, summaries, parsing, problems; the control-flag split in flags.gd.

const LF := preload("res://features/timeline/timeline_light.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
var t

const CONSOLES := [{"id": "mq", "name": "MagicQ", "kind": "magicq"}, {"id": "ma", "name": "MA3", "kind": "grandma3"}]


func test_flag_type_is_known_and_control() -> void:
	t.ok("light" in F.TYPES and F.TYPE_LABELS[F.TYPES.find("light")] == "Light cue", "light type + label")
	t.ok(F.is_control({"type": "light"}) and F.is_control({"type": "companion_press"}), "control flags")
	t.ok(not F.is_control({"type": "pause"}) and not F.is_control({"type": "jump"}) and not F.is_control({}), "standard flags")
	var tl := {"duration": 5000, "layers": []}
	var f := F.add(tl, 1000, "light")
	t.eq(f.type, "light", "kept by the type guard")
	F.update(tl, f, {"type": "bogus"})
	t.eq(f.type, "pause", "unknown still falls back")
	t.ok(F.hit({"flags": [{"id": "l", "timeMs": 1000, "type": "light"}]}, Vector2(212, 10), func(ms: float) -> float: return 112.0 + ms * 0.1).is_empty(),
		"a control flag is not hit in the ruler")


func test_action_patch_keeps_only_the_action_fields() -> void:
	var f := {"type": "light", "action": "go", "list": 2, "cue": 5}
	t.eq(LF.action_patch(f, "fader"), {"action": "fader", "list": null, "cue": null, "command": null, "fader": 1, "level": 100}, "go → fader")
	t.eq(LF.action_patch(f, "release"), {"action": "release", "cue": null, "fader": null, "level": null, "command": null}, "list survives go → release")
	var c := LF.action_patch(f, "command")
	t.eq([c.command, c.list, c.cue], ["", null, null], "command")
	var tl := {"duration": 9000}
	var fl := F.add(tl, 0, "light")
	F.update(tl, fl, LF.action_patch(fl, "go"))
	t.eq([fl.action, fl.list, fl.has("cue")], ["go", 1, false], "a fresh flag gets list 1")


func test_parsing_follows_the_server_rules() -> void:
	t.eq(LF.parse_num("12"), 12, "int")
	t.eq(LF.parse_num("2.5"), 2.5, "cue with a decimal")
	t.eq(LF.parse_num("2.5555"), null, "more than three decimals")
	t.eq([LF.parse_num("-1"), LF.parse_num("12abc"), LF.parse_num(""), LF.parse_num("100000")], [null, null, null, null], "gibberish reverts")
	t.eq(LF.parse_fader("4"), 4, "fader number")
	t.eq(LF.parse_fader("2.10"), "2.10", "page.fader keeps its zero")
	t.eq(LF.parse_fader("2."), null, "incomplete")
	t.eq(LF.parse_level(104.0), 100.0, "level clamps")
	t.eq(LF.parse_level(-3.0), 0.0, "level clamps low")
	t.eq(LF.parse_level(33.33), 33.3, "one decimal")
	t.eq(LF.clean_command("  Go+ Sequence 1 "), "Go+ Sequence 1", "trimmed")
	t.eq(LF.clean_command("a\nb"), "", "one line only")
	t.eq(LF.clean_command("x".repeat(401)), "", "400 at most")


func test_summaries() -> void:
	t.eq(LF.summary({"action": "go", "list": 1}), "Go 1", "go")
	t.eq(LF.summary({"action": "go", "list": 1, "cue": 3.0}), "Go 1 / cue 3", "go to cue")
	t.eq(LF.summary({"action": "fader", "fader": "2.10", "level": 80.0}), "Fader 2.10 to 80%", "fader")
	t.eq(LF.summary({"action": "release", "list": 4}), "Release 4", "release")
	t.eq(LF.summary({"action": "command", "command": "Go+ Seq 1"}), "Cmd: Go+ Seq 1", "command")
	t.eq(LF.summary({}), "Go ?", "an empty flag")


func test_chip_text_names_the_console() -> void:
	t.eq(LF.chip_text({"consoleId": "mq", "action": "go", "list": 1, "cue": 3}, CONSOLES), "MagicQ · Go 1 / cue 3", "console · action")
	t.eq(LF.chip_text({"consoleId": "gone", "action": "release", "list": 2}, CONSOLES), "? gone · Release 2", "a removed console")
	t.eq(LF.chip_text({"action": "release", "list": 2}, CONSOLES), "No console · Release 2", "none chosen")


func test_problem() -> void:
	t.eq(LF.problem({"action": "go", "list": 1}, CONSOLES), "Choose a console.", "no console")
	t.ok(LF.problem({"consoleId": "x", "action": "go", "list": 1}, CONSOLES).contains("no longer exists"), "missing console")
	t.eq(LF.problem({"consoleId": "mq", "action": "go", "list": 1}, CONSOLES), "", "valid go")
	t.eq(LF.problem({"consoleId": "mq", "action": "fader", "fader": 1}, CONSOLES), "Needs a fader and a level.", "level missing")
	t.eq(LF.problem({"consoleId": "mq", "action": "command", "command": " "}, CONSOLES), "Type a command.", "empty command")
	t.eq(LF.problem({"consoleId": "ma", "action": "command", "command": "Go+"}, CONSOLES), "", "valid command")
