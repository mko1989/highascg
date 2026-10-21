extends RefCounted
## WO-615 T6 — programmer_model.gd (merged features, colour → values per fixture, wheel owners, groups),
## fixture_selection.gd (pick / shift-pick) and fixtures_3d_model.gd floor_hit (Point at).

const P := preload("res://features/previs/fixtures/programmer_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const F3 := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const FM := preload("res://features/previs/tracking/follow_model.gd")
var t

const SPOT := {"dimmer": true, "add": [], "sub": [], "pan": {"from": -270, "to": 270}, "tilt": {"from": 135, "to": -135},
	"colors": [{"attr": "Color1", "name": "Open", "rgb": [1, 1, 1]}, {"attr": "Color1", "name": "Red", "rgb": [1, 0, 0]},
		{"attr": "Color1", "name": "Blue", "rgb": [0, 0, 1]}],
	"gobos": [{"attr": "Gobo1", "name": "Dots", "media": "123"}]}
const LED := {"dimmer": true, "add": ["ColorAdd_R", "ColorAdd_G", "ColorAdd_B", "ColorAdd_W"], "sub": [], "colors": [],
	"gobos": [], "zoom": {"from": 4, "to": 50}}
const CMY := {"dimmer": false, "add": [], "sub": ["ColorSub_C", "ColorSub_M", "ColorSub_Y"], "colors": [], "gobos": []}


func test_merge_shows_what_any_selected_fixture_has() -> void:
	var m := P.merge({"a": SPOT, "b": LED}, ["a", "b", "gone"], {"a": "t1", "b": "t2"})
	t.eq(m.count, 2, "unknown ids are skipped")
	t.eq([m.dimmer, m.mix], [true, true])
	t.eq(m.pan, {"from": -270, "to": 270}, "pan range from the spot")
	t.eq(m.zoom, {"from": 4, "to": 50}, "zoom from the LED")
	t.eq(m.gobos, [{"attr": "Gobo1", "name": "Dots", "media": "123", "type": "t1"}], "gobo keeps its owner's type")
	t.eq(P.merge({}, ["a"], {}).count, 0)
	t.eq(P.can_mix({"add": ["ColorAdd_W"], "sub": [], "colors": []}), false, "a white-only emitter takes no colour")


func test_color_values_per_fixture() -> void:
	var c := Color(1.0, 0.5, 0.0)
	t.eq(P.color_values(LED, c), {"ColorAdd_R": {"norm": 1.0}, "ColorAdd_G": {"norm": 0.5}, "ColorAdd_B": {"norm": 0.0},
		"ColorAdd_W": {"norm": 0.0}}, "RGB mixing: the pick, other emitters off")
	t.eq(P.color_values(CMY, c), {"ColorSub_C": {"norm": 0.0}, "ColorSub_M": {"norm": 0.5}, "ColorSub_Y": {"norm": 1.0}},
		"CMY = 1 − RGB")
	t.eq(P.color_values(SPOT, Color(0.9, 0.1, 0.1)), {"Color1": {"set": "Red"}}, "wheel only: the nearest slot")
	var both := CMY.duplicate(true)
	both.colors = SPOT.colors
	t.eq(P.color_values(both, c), {"ColorSub_C": {"norm": 0.0}, "ColorSub_M": {"norm": 0.5}, "ColorSub_Y": {"norm": 1.0},
		"Color1": {"set": "Open"}}, "CMY + a wheel: the mix, wheel opened (first slot)")
	t.eq(P.color_values({"add": [], "sub": [], "colors": []}, c), {}, "nothing to colour")


func test_wheel_owners_and_groups() -> void:
	t.eq(P.owners({"a": SPOT, "b": LED}, ["a", "b"], "gobos", "Gobo1", "Dots"), ["a"], "a gobo pick skips fixtures without it")
	var g := P.save_group([], " Front ", ["a", "b", "a"])
	t.eq(g, [{"name": "Front", "ids": ["a", "b"]}], "trimmed, ids deduplicated")
	g = P.save_group(g, "Front", ["c"])
	t.eq(g, [{"name": "Front", "ids": ["c"]}], "same name replaces")
	t.eq(P.drop_group(g, "Front"), [])
	t.eq(P.normalize_groups([{"name": ""}, 5, {"name": "x", "ids": "nope"}]), [{"name": "x", "ids": []}])
	var slice := FM.normalize({"groups": [{"name": "Back", "ids": ["fx1"]}]})
	t.eq(slice.groups, [{"name": "Back", "ids": ["fx1"]}], "the fixtures slice keeps its groups")
	t.eq(FM.normalize(slice), slice, "and stays idempotent")


func test_selection_pick_and_floor_hit() -> void:
	var s: RefCounted = Sel.new()
	var hits := [0]
	s.changed.connect(func() -> void: hits[0] += 1)
	s.pick("a", false)
	s.pick("b", true)
	t.eq(s.ids, ["a", "b"], "shift adds")
	s.pick("a", true)
	t.eq(s.ids, ["b"], "shift on a selected one removes it")
	s.pick("c", false)
	t.eq(s.ids, ["c"], "a plain click selects only it")
	s.set_ids(["c"])
	t.eq(hits[0], 4, "four changes; none when nothing changed")
	t.eq(Sel.shared(), Sel.shared(), "one shared selection per client")
	t.eq(F3.floor_hit(Vector3(0, 10, 0), Vector3(0, -1, -1).normalized()), Vector3(0, 0, -10), "ray meets y = 0")
	t.eq(F3.floor_hit(Vector3(0, 10, 0), Vector3(0, 1, 0)), null, "looking up: no floor")
	t.eq(F3.floor_hit(Vector3(0, 10, 0), Vector3(1, 0, 0)), null, "level ray: no floor")
