extends RefCounted
## WO-857 — the console's own selection set (console_selection.gd): parsing the server payload, the follow toggle, and
## that it never touches the Programmer's selection (fixture_selection.gd) except through the explicit Take button.

const Con := preload("res://features/previs/fixtures/console_selection.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const Row := preload("res://features/previs/fixtures/console_row.gd")
const FM := preload("res://features/previs/tracking/follow_model.gd")
var t

const PAYLOAD := {"source": "gma3", "heads": [101, 102, 103], "ids": ["mvr-a", "mvr-b"], "unmatched": [103], "ts": 5}


func _model() -> RefCounted:
	var m: RefCounted = Con.new()
	m.persist = false
	return m


func test_parse_keeps_types_and_rejects_non_selections() -> void:
	t.eq(Con.parse(PAYLOAD), {"source": "gma3", "heads": [101, 102, 103], "ids": ["mvr-a", "mvr-b"], "unmatched": [103], "ts": 5.0})
	t.eq(Con.parse({"ids": [1, 2], "heads": [1.0, "x", 2]}).heads, [1, 2], "head numbers are whole numbers, text is dropped")
	t.eq(Con.parse({"ids": [1, 2]}).ids, ["1", "2"], "ids are strings")
	t.eq(Con.parse("nope"), {})
	t.eq(Con.parse({"heads": [1]}), {}, "no ids list = not a selection")


func test_apply_emits_only_on_a_change() -> void:
	var m := _model()
	var hits := [0]
	m.changed.connect(func() -> void: hits[0] += 1)
	m.apply(PAYLOAD)
	m.apply(PAYLOAD.duplicate(true))
	t.eq(hits[0], 1, "the same set again is silent")
	t.eq([m.source, m.heads, m.ids, m.unmatched], ["gma3", [101, 102, 103], ["mvr-a", "mvr-b"], [103]])
	m.apply({"source": "gma3", "heads": [], "ids": [], "unmatched": []})
	t.eq(hits[0], 2)
	t.eq(m.ids, [])
	m.apply("garbage")
	t.eq(hits[0], 2, "a bad payload changes nothing")


func test_follow_decides_what_is_shown() -> void:
	var m := _model()
	m.apply(PAYLOAD)
	t.eq(m.follow, false, "off by default")
	t.eq(m.shown(), [], "not following: nothing is drawn")
	var hits := [0]
	m.changed.connect(func() -> void: hits[0] += 1)
	m.set_follow(true)
	t.eq(m.shown(), ["mvr-a", "mvr-b"])
	t.eq(hits[0], 1, "the previs redraws when the toggle flips")
	m.set_follow(true)
	t.eq(hits[0], 1)
	m.set_follow(false)
	t.eq(m.shown(), [])


func test_summary_and_detail() -> void:
	var m := _model()
	t.eq(m.summary(), "no console selection yet")
	m.apply(PAYLOAD)
	t.eq(m.summary(), "gma3: 3 heads")
	t.ok(m.detail().contains("103"), "the tooltip names the head numbers without a fixture")
	m.apply({"source": "gma3", "heads": [5], "ids": ["x"], "unmatched": []})
	t.eq(m.summary(), "gma3: 1 head")
	t.ok(m.detail().begins_with("Heads the console"))


func test_the_console_set_never_writes_the_programmer_selection() -> void:
	var own: RefCounted = Sel.new()
	own.set_ids(["mine"])
	var m := _model()
	m.set_follow(true)
	m.apply(PAYLOAD)
	t.eq(own.ids, ["mine"], "following does not touch the operator's own selection")
	t.ok(Sel.shared().ids != m.ids or Sel.shared().ids.is_empty(), "nor the shared one")
	# the Take button is the one explicit write
	var row: VBoxContainer = Row.new()
	row._con = m
	var shared_before: Array = Sel.shared().ids.duplicate()
	row._ready()
	t.eq(Sel.shared().ids, shared_before, "building the row does not select")
	row._take.pressed.emit()
	t.eq(Sel.shared().ids, ["mvr-a", "mvr-b"], "Take copies the console set once")
	Sel.shared().set_ids(shared_before)
	row.free()


func test_row_follows_the_model() -> void:
	var m := _model()
	var row: VBoxContainer = Row.new()
	row._con = m
	row._ready()
	t.eq(row._count.text, "no console selection yet")
	t.ok(row._take.disabled, "nothing to take yet")
	m.apply(PAYLOAD)
	t.eq(row._count.text, "gma3: 3 heads")
	t.ok(not row._take.disabled)
	row._check.button_pressed = true  # the operator ticks the box
	t.eq(m.follow, true)
	m.set_follow(false)
	t.eq(row._check.button_pressed, false, "the box follows the model")
	row.free()


func test_patch_fid_survives_the_slice_normalizer() -> void:
	t.eq(FM.normalize_fixture({"id": "a", "fid": 101.0}, 0).get("fid"), 101, "an explicit console head number is kept")
	t.ok(not FM.normalize_fixture({"id": "a"}, 0).has("fid"), "and absent when not set")
	t.ok(not FM.normalize_fixture({"id": "a", "fid": 0}, 0).has("fid"), "zero is not a head number")
	t.ok(not FM.normalize_fixture({"id": "a", "fid": "x"}, 0).has("fid"))
