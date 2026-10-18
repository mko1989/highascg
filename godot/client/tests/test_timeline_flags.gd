extends RefCounted
## Timeline flags — web lib/timeline-state.js add / update / removeFlag, duplicateFlag, hitFlag, parseHmsInput and
## lib/companion-location-parse.js.

const F := preload("res://features/timeline/timeline_flags.gd")
var t


func test_mutations() -> void:
	var tl := {"duration": 10000, "layers": []}
	var a := F.add(tl, 4000)
	var b := F.add(tl, 1000, "jump")
	var c := F.add(tl, 4000, "bogus")
	t.eq([a.type, b.type, c.type], ["pause", "jump", "pause"], "type guard")
	t.ok(str(a.id).begins_with("f") and a.id != c.id, "flag ids")
	t.ok(is_same(tl.flags[0], b) and is_same(tl.flags[1], a) and is_same(tl.flags[2], c), "sorted, equal times keep insertion order")
	F.update(tl, b, {"timeMs": 12000, "type": "nope", "label": "end"})
	t.eq([b.timeMs, b.type, b.label], [12000, "pause", "end"], "assign + guard")
	t.ok(is_same(tl.flags[2], b), "re-sorted")
	t.eq(tl.duration, 14000.0, "duration grows to the content + 2 s")
	F.update(tl, b, {"jumpTimeMs": 500})
	F.update(tl, b, {"jumpTimeMs": null})
	t.ok(not b.has("jumpTimeMs"), "null drops the key (undefined)")
	F.update(tl, a, {"jumpFlagId": b.id, "companionPage": 2})
	var d := F.duplicate_at(tl, a, -50)
	t.eq([d.timeMs, d.companionPage, d.has("jumpFlagId"), d.id != a.id], [0.0, 2, false, true], "paste: deep copy, new id, no flag ref")
	t.ok(is_same(tl.flags[0], d), "sorted in")
	F.remove(tl, str(a.id))
	t.eq(tl.flags.size(), 3, "removed")
	t.ok(F.find(tl, str(a.id)).is_empty() and is_same(F.find(tl, str(c.id)), c), "find")


func test_hit() -> void:
	var tl := {"flags": [{"id": "a", "timeMs": 1000}, {"id": "b", "timeMs": 1100}]}
	var x_at := func(ms: float) -> float: return 112.0 + ms * 0.1  # HEADER_W 112
	t.eq(F.hit(tl, Vector2(217, 10), x_at).get("id"), "a", "first within ±10 px wins")
	t.eq(F.hit(tl, Vector2(232, 10), x_at).get("id"), "b")
	t.ok(F.hit(tl, Vector2(233, 10), x_at).is_empty(), "outside")
	t.ok(F.hit(tl, Vector2(222, 40), x_at).is_empty(), "below the ruler")
	t.ok(F.hit({"flags": [{"id": "z", "timeMs": 0}]}, Vector2(108, 10), x_at).is_empty(), "not over the headers")


func test_parse() -> void:
	t.eq(F.parse_hms("00:01:02:345", 0, null), 62345.0, "HH:MM:SS:mmm")
	t.eq(F.parse_hms("1:02:005", 0, null), 62005.0, "M:SS:mmm")
	t.eq(F.parse_hms("3:250", 0, null), 3250.0, "SS:mmm")
	t.eq(F.parse_hms("750", 0, 500), 500.0, "plain ms, clamped")
	t.eq(F.parse_hms("--900", 400, null), 0.0, "offset")
	t.eq(F.parse_hms("++100", 400, null), 500.0)
	t.eq(F.parse_hms("1:x", 0, null), null, "invalid")
	t.eq(F.parse_hms(" ", 0, null), null)
	t.eq(F.parse_location("1 2 1"), Vector3i(1, 2, 1))
	t.eq(F.parse_location("12-0-15"), Vector3i(12, 0, 15))
	t.eq(F.parse_location("3/4/5"), Vector3i(3, 4, 5))
	t.eq(F.parse_location("0 1 1"), null, "page ≥ 1")
	t.eq(F.parse_location("1 2"), null, "three parts")
	t.eq(F.coords({}), Vector3i(1, 0, 0), "defaults")
	t.eq(F.option_text({"type": "jump", "timeMs": 61001}), "jump - 00:01:01:001")
	t.eq(F.option_text({"label": "Top", "timeMs": 0}), "Top - 00:00:00:000")
