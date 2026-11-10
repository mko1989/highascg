extends RefCounted
## WO-1029 — dest_scope.gd: the deck groups looks by destination, not by screen number (box B, 10.11: the wall moved
## from index 2 to 1 after two deletes; its looks still said "2").

const DS := preload("res://core/dest_scope.gd")
const Reorder := preload("res://features/live/deck_reorder.gd")
const NoScreen := preload("res://features/live/deck_no_screen.gd")
var t


## Box B today: LED at 0, the wall at 1 (cluster map: screenHosts carry the ids).
func _cm() -> Dictionary:
	return {"screenCount": 2, "programChannels": [2, 4],
		"screenHosts": [{"idx": 0, "destId": "dst_led"}, {"idx": 1, "destId": "dst_wall"}], "channelsWhereCabled": true}


func _looks() -> Array:
	return [
		{"id": "led", "mainScope": "0", "destScope": "dst_led"},
		{"id": "wall", "mainScope": "2", "destScope": "dst_wall"},  # stale index, right id
		{"id": "zoom", "mainScope": "1", "destScope": "dst_zoom"},  # destination deleted
		{"id": "old2", "mainScope": "2"},  # old data, index past the list
		{"id": "old1", "mainScope": "1"},  # old data, index of today
		{"id": "glob", "mainScope": "all"},
	]


func _ids_of(a: Array) -> Array:
	return a.map(func(s: Dictionary) -> String: return str(s.id))


func test_ids_from_screen_hosts_or_destination_list() -> void:
	t.eq(DS.ids(_cm()), ["dst_led", "dst_wall"])
	var sd := {"destinations": [{"id": "gui", "mode": "operator_gui", "mainScreenIndex": 0},
		{"id": "a", "mode": "pgm_prv", "mainScreenIndex": 0}, {"id": "b", "mode": "pgm_only", "mainScreenIndex": 1}]}
	t.eq(DS.ids({"screenCount": 2}, sd), ["a", "b"], "flag off: from state.screenDestinations, operator GUI skipped")
	t.eq(DS.ids({"screenCount": 2}), ["", ""], "nothing known")


func test_grouping_by_destination() -> void:
	var ids := DS.ids(_cm())
	t.eq(_ids_of(DS.looks_for_main(_looks(), 0, ids, 2)), ["led", "glob"])
	t.eq(_ids_of(DS.looks_for_main(_looks(), 1, ids, 2)), ["wall", "old1", "glob"], "the wall look follows the wall, not '2'")
	t.eq(_ids_of(DS.no_screen(_looks(), ids, 2)), ["zoom", "old2"])


func test_no_ids_known_is_the_old_index_rule() -> void:
	var ids := DS.ids({"screenCount": 3})
	t.eq(_ids_of(DS.looks_for_main([{"id": "a", "mainScope": "2"}, {"id": "b", "mainScope": "1"}], 2, ids, 3)), ["a"])


func test_no_screen_group_repair_lines() -> void:
	var lost := DS.no_screen(_looks(), DS.ids(_cm()), 2)
	var g := DS.repair_groups(lost)
	t.eq(g, {"dst_zoom": 1, "2": 1})
	t.ok(NoScreen.group_text("2", 5).begins_with("5 looks of screen 3"), "old index shown 1-based")
	t.ok(NoScreen.group_text("dst_zoom", 1).contains("deleted destination"))


func test_attach_and_rescope_group() -> void:
	var looks := _looks()
	var ids := DS.ids(_cm())
	t.eq(DS.rescope(looks, "2", 1, ids, 2), 1, "only the unscoped '2' look")
	t.eq(looks[3].destScope, "dst_wall")
	t.eq(looks[3].mainScope, "1")
	t.eq(_ids_of(DS.no_screen(looks, ids, 2)), ["zoom"])


func test_stamping_on_a_list_change() -> void:
	var looks := [{"id": "a", "mainScope": "0"}, {"id": "w", "mainScope": "2"}, {"id": "z", "mainScope": "1"}]
	var prev := ["dst_led", "dst_zoom", "dst_wall"]
	var now := ["dst_led", "dst_wall"]  # zoom deleted in the middle
	t.ok(DS.reconcile(looks, prev, now) > 0)
	t.eq([looks[1].destScope, looks[1].mainScope], ["dst_wall", "1"], "the wall look moved with the wall")
	t.eq(looks[2].destScope, "dst_zoom")
	t.eq(DS.screen_of(looks[2], now, 2), DS.NO_SCREEN, "never attached to the wall now at index 1")
	t.eq(DS.reconcile(looks, now, now), 0, "idempotent")


func test_drag_between_columns_rescopes() -> void:
	var data := Reorder.payload("zoom", DS.NO_SCREEN)
	t.ok(Reorder.is_rescope(data, 1))
	t.ok(not Reorder.is_reorder(data, 1))
	t.ok(not Reorder.is_rescope(Reorder.payload("x", 1), 1), "same column = reorder")
	var look := {"id": "zoom", "mainScope": "1", "destScope": "dst_zoom"}
	DS.attach(look, 0, DS.ids(_cm()))
	t.eq([look.mainScope, look.destScope], ["0", "dst_led"])
	DS.attach(look, 1, ["", ""])
	t.ok(not look.has("destScope"), "no id known: index only")


func test_list_changed_memory() -> void:
	DS.list_changed(["a", "b", "c"])
	t.eq(DS.list_changed(["a", "c"]), ["a", "b", "c"])
	t.eq(DS.list_changed(["a", "c"]), [], "unchanged")
