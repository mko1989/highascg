extends RefCounted
## WO-640 — fold_section.gd: the previs Inspector page's collapsible sections.

const Fold := preload("res://features/previs/fold_section.gd")
var t


func test_fold_toggles_its_content() -> void:
	var a := Label.new()
	var b := Label.new()
	var f := Fold.new("Test fold %d" % Time.get_ticks_usec(), [a, b])  # unique title: nothing saved → open
	t.eq([f.is_open(), f.content.get_children().size(), a.get_parent() == f.content], [true, 2, true], "open, holds its parts")
	var toggle: Button = f.get_child(0)
	t.ok(toggle.text.begins_with("▾ "), "open arrow")
	f.set_open(false)
	t.eq([f.content.visible, toggle.text.begins_with("▸ ")], [false, true], "folded")
	f.free()
