extends RefCounted
## WO-971 — a deck rebuild remembers each column's scroll offset by screen index.

const S := preload("res://features/live/deck_scroll.gd")
var t


func test_free_columns_remembers_offsets() -> void:
	S.offsets.clear()
	var cols := HBoxContainer.new()
	for main in [0, 2]:
		var col := VBoxContainer.new()
		var sc := ScrollContainer.new()
		S.setup(sc, main)
		sc.add_child(Control.new())
		col.add_child(sc)
		cols.add_child(col)
	var scs := cols.find_children("*", "ScrollContainer", true, false)
	t.eq(scs.size(), 2, "two column scrollers")
	t.eq((scs[0] as ScrollContainer).horizontal_scroll_mode, ScrollContainer.SCROLL_MODE_DISABLED, "setup keeps horizontal scroll off")
	# unlaid-out scrollers clamp to 0; the remembered value is what free_columns read, keyed by main
	S.free_columns(cols)
	t.eq(S.offsets.keys(), [0, 2], "offsets keyed by screen index")
	for c in cols.get_children():
		c.free()
	cols.free()
	S.offsets.clear()
