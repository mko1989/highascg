extends RefCounted
## WO-923 — page_item_reuse.gd: which nodes of the Caspar server page survive an item-list change.

const R := preload("res://features/devices/page_item_reuse.gd")
var t

const CHECK := {"t": "check", "key": "operator_first", "text": "Operator GUI first", "checked": false, "disabled": false}
const ROWS_A := {"t": "table", "rows": [["Commands sent", "12"]]}
const ROWS_B := {"t": "table", "rows": [["Commands sent", "13"]]}
const LINE := {"t": "small", "text": "Role: leader · show synced 3s ago"}


func test_a_poll_that_changes_one_row_keeps_every_other_node() -> void:
	var old := [CHECK, ROWS_A, LINE]
	t.eq(Array(R.plan(old, [CHECK, ROWS_B, LINE])), [0, -1, 2], "only the changed table is rebuilt")
	t.eq(Array(R.plan(old, old.duplicate(true))), [0, 1, 2], "equal items (not the same dictionaries) are kept")


func test_an_item_appearing_or_vanishing_above_does_not_rebuild_the_rest() -> void:
	var pair := {"t": "small", "text": "Paired with box-b"}
	t.eq(Array(R.plan([LINE, CHECK, ROWS_A], [pair, LINE, CHECK, ROWS_A])), [-1, 0, 1, 2], "an inserted line shifts the rest")
	t.eq(Array(R.plan([pair, LINE, CHECK], [LINE, CHECK])), [1, 2], "a removed line shifts the rest back")


func test_each_old_node_is_used_once() -> void:
	var h := {"t": "heading", "text": "X"}
	t.eq(Array(R.plan([h], [h, h])), [0, -1], "two equal items need two nodes")
	t.eq(Array(R.plan([h, CHECK, h], [h, h])), [0, 2], "the second equal item takes the next free equal one")


func test_a_changed_control_is_rebuilt() -> void:
	var on := CHECK.duplicate()
	on.checked = true
	t.eq(Array(R.plan([CHECK], [on])), [-1], "a check whose state changed gets a new node")
	t.eq(Array(R.plan([], [CHECK])), [-1], "nothing shown yet: everything is built")
