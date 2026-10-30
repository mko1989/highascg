extends RefCounted
## WO-840 — timer visibility is per SCREEN, so a look preset item carries it (owner 30.10, RULES.md "Timers"):
## the save stamps each item with { timerId: bool } for the timers on that item's screen; empty destinations and
## screens without timers get none (a recall then leaves the timers alone); overwrite re-captures.

const M := preload("res://features/live/look_preset_model.gd")
var t

const BUSES := {0: {"prv": "A", "pgm": "B"}, 1: {"prv": "", "pgm": "C"}}
## /api/timers/list records: "clock" is on screens 0 (visible) and 1 (hidden); "count" only on screen 1 (visible).
const TIMERS := [
	{"timerId": "clock", "screens": {"0": {"channel": 1, "layer": 980, "visible": true}, "1": {"channel": 3, "layer": 980, "visible": false}}},
	{"timerId": "count", "screens": {"1": {"channel": 3, "layer": 981, "visible": true}}},
	{"timerId": "loose"},
]


func test_each_item_gets_its_own_screens_map() -> void:
	var items := M.with_timers(M.capture_items("pgm", [0, 1], BUSES, ""), TIMERS)
	t.eq(items[0].timersVisibility, {"clock": true}, "screen 1: only the timer assigned there, its visible flag")
	t.eq(items[1].timersVisibility, {"clock": false, "count": true}, "screen 2: per-screen flags, not one shared map")


func test_no_timers_no_map_and_empty_destinations_skipped() -> void:
	var items := M.with_timers(M.capture_items("prv", [0, 1], BUSES, "", true), [])
	t.ok(not items[0].has("timersVisibility"), "no timers → recall leaves them alone")
	var only1 := M.with_timers(M.capture_items("prv", [0, 1], BUSES, "", true), [TIMERS[1]])
	t.ok(not only1[0].has("timersVisibility"), "screen 1 has no timer assigned")
	t.eq(only1[1], {"mainIdx": 1, "sceneId": "", "sourceKind": "prv", "empty": true}, "an empty destination has no take to apply it on")


func test_make_preset_and_overwrite_keep_and_refresh_the_map() -> void:
	var p := M.make_preset([], "T", M.with_timers(M.capture_items("pgm", [0], BUSES, ""), TIMERS), "id1", 1)
	t.eq(p.items[0].timersVisibility, {"clock": true}, "stored in the preset item")
	var flipped := [{"timerId": "clock", "screens": {"0": {"visible": false}}}]
	t.ok(M.overwrite(p, M.with_timers(M.capture_items("pgm", [0], BUSES, ""), flipped), 2), "overwrite")
	t.eq(p.items[0].timersVisibility, {"clock": false}, "overwrite re-captures the current visibility")
	t.ok(M.overwrite(p, M.with_timers(M.capture_items("pgm", [0], BUSES, ""), []), 3), "overwrite with no timers")
	t.ok(not p.items[0].has("timersVisibility"), "a screen that lost its timers drops the stale map")
