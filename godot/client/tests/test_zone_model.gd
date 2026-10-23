extends RefCounted
## WO-616 T7 — trigger zones (zone_model.gd, client mirror of src/tracking/zone-engine.js normalizeZones and
## zone-actions.js parseAction). Pure.

const Z := preload("res://features/previs/tracking/zone_model.gd")
var t


func test_normalize_defaults_and_sanitising() -> void:
	var d := Z.normalize(null)
	t.eq(d.enabled, false, "master starts off")
	t.eq(d.debounce_ms, 200.0, "debounce default")
	t.eq(d.hysteresis, 0.05, "hysteresis default")
	t.eq(d.list, [], "no zones")
	var n := Z.normalize({"enabled": true, "list": [
		{"id": "a", "vertices": [[0, 0], ["x", 1], [1, 1], [0, 1]], "triggered_by": [3, 3, 0, 1], "color": "nope"},
		{"id": "a", "color": "#ffffff", "actions": {"first_entry": "look:look-1"}},
	]})
	t.eq(n.enabled, true)
	t.eq(n.list[0].vertices.size(), 3, "bad vertex dropped")
	t.eq(n.list[0].triggered_by, [1, 3], "ids sorted, unique, 1..65535")
	t.eq(n.list[0].color, Z.COLORS[0], "bad colour falls back to the palette")
	t.eq(n.list[1].id, "a_", "duplicate id gets a suffix")
	t.eq(n.list[0].actions, {"first_entry": "", "additional_entry": "", "partial_exit": "", "final_exit": ""},
		"missing actions are blank for all four kinds")


func test_new_zone_picks_the_lowest_free_id() -> void:
	var a := Z.new_zone([])
	t.eq([a.id, a.name, a.vertices, a.enabled], ["zone1", "Zone 1", [], true], "first zone")
	var b := Z.new_zone([{"id": "zone1"}])
	t.eq(b.id, "zone2", "skips a used id")


func test_action_error_grammar() -> void:
	t.eq(Z.action_error(""), "", "blank is valid")
	t.eq(Z.action_error("look:look-1"), "", "look:<id>")
	t.eq(Z.action_error("look:look-1@preview"), "", "look:<id>@preview")
	t.eq(Z.action_error("companion:1/2/3"), "", "companion:<page>/<row>/<col>")
	t.ok(Z.action_error("/osc/addr") != "", "osc path is not an action")
	t.ok(Z.action_error("look:") != "", "look needs an id")
	t.ok(Z.action_error("companion:1/2") != "", "companion needs three parts")
	t.eq(Z.action_error("presenter"), "", "WO-675 presenter on a zone")
	t.eq(Z.action_error("auto:home"), "", "WO-712 R4 auto:home")
	t.eq(Z.action_error("fixtures:look-2"), "", "WO-712 R4 fixtures:<look id>")
	t.ok(Z.action_error("fixtures:") != "", "fixtures needs a look id")
	t.ok(Z.action_error("auto:away") != "", "only auto:home")


## WO-712 R4 — "on air" rules, as src/tracking/air-rules.js normalizeAirRules.
func test_on_air_rules_normalize_and_grammar() -> void:
	t.eq(Z.normalize(null).on_air, [], "no rules")
	var n := Z.normalize({"on_air": [{"id": "x", "when": " Intro ", "do": "auto:home"}, "junk",
		{"id": "x", "when": "look-3", "do": "", "enabled": false}, {"when": "a"}]})
	t.eq(n.on_air.map(func(r: Dictionary) -> String: return r.id), ["x", "air2", "air3"], "taken / blank id → airN")
	t.eq([n.on_air[0].when, n.on_air[0].do, n.on_air[0].enabled], ["Intro", "auto:home", true], "trimmed, on by default")
	t.eq(n.on_air[1].enabled, false, "kept off")
	var many := []
	for i in 70:
		many.append({"when": "l%d" % i})
	t.eq(Z.normalize_air(many).size(), Z.MAX_AIR_RULES, "64 rules at most")
	t.eq(Z.new_air_rule([{"id": "air1"}]), {"id": "air2", "when": "", "do": "", "enabled": true}, "lowest free id")
	t.ok(Z.action_error("presenter", true) != "", "a rule has no crossing marker")
	t.eq(Z.action_error("fixtures:look-2", true), "", "fixtures in a rule")


func test_parse_ids_and_loop3() -> void:
	t.eq(Z.parse_ids("1, 3 3;7 x 0"), [1, 3, 7], "separators, dedupe, drop junk and 0")
	var l := Z.loop3([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]], 0.5)
	t.eq(l.size(), 4, "triangle closes into 4 points")
	t.eq(l[3], [0.0, 0.0, 0.5], "last point is the first")
	t.eq(l[0], [0.0, 0.0, 0.5], "first point is at height z")
