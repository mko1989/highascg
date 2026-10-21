extends RefCounted
## WO-642 — project_undo_model.gd: the app-wide Ctrl+Z history.

const Model := preload("res://core/project_undo_model.gd")
var t


func test_undo_redo_steps() -> void:
	var h := Model.new()
	h.rebase("A")
	t.eq(h.record("A", 0), false, "no change, no step")
	h.record("B", 1000)
	h.record("C", 2000)
	t.eq(h.undo(), "B")
	t.eq(h.undo(), "A")
	t.eq([h.undo(), h.can_undo()], ["", false], "nothing older")
	t.eq(h.redo(), "B")
	h.record("D", 5000)
	t.eq([h.can_redo(), h.redo()], [false, ""], "a new edit drops the redo branch")
	t.eq(h.undo(), "B")


func test_quick_edits_are_one_step() -> void:
	var h := Model.new()
	h.rebase("A")
	h.record("B", 1000)
	h.record("C", 1200)  # a drag / held arrows
	h.record("D", 1500)
	t.eq([h.undo(), h.can_undo()], ["A", false], "one step back to before the drag")
	h.record("E", 1600)
	t.eq(h.undo(), "A", "the first edit after an undo is its own step")


func test_rebase_and_cap() -> void:
	var h := Model.new()
	h.rebase("A")
	h.record("B", 1000)
	h.rebase("R")  # a remote sync
	t.eq(h.undo(), "A", "older steps stay; the remote state is the new base")
	var c := Model.new()
	c.rebase("0")
	for i in Model.MAX + 20:
		c.record(str(i + 1), (i + 1) * 1000)
	var n := 0
	while c.undo() != "":
		n += 1
	t.eq(n, Model.MAX, "at most MAX steps")


func test_snapshot_drops_bookkeeping_and_document_keeps_rev() -> void:
	var a := Model.snapshot({"name": "x", "rev": 5, "savedAt": "t1", "previs": {"a": 1}})
	var b := Model.snapshot({"name": "x", "rev": 6, "savedAt": "t2", "previs": {"a": 1}})
	t.eq(a, b, "a save alone is not an edit")
	var d: Dictionary = Model.document(a, {"rev": 9, "savedAt": "t3"})
	t.eq([d.rev, d.savedAt, int(d.previs.a)], [9, "t3", 1], "restored content, the live rev")
	t.eq(Model.document("not json", {}), null)


func test_ints_and_restored_floats_are_the_same_document() -> void:
	var local := Model.snapshot({"previs": {"stage": {"objects": [{"panels": [4, 2]}]}}})
	var restored: Dictionary = Model.document(local, {})
	t.eq(Model.snapshot(restored), local, "no phantom edit after a restore")
