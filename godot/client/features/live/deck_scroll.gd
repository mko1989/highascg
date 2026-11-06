extends RefCounted
## WO-971 — a deck column's looks scroll (WO-905) must survive the deck's rebuilds: every deck action (PRV pick, take,
## rename, reorder, add / delete, thumbnail refresh) ends in a project / scene broadcast that rebuilds the columns, and
## a fresh ScrollContainer starts at 0 ("doing anything in the looks deck resets the deck to the top").
## free_columns() remembers each column's offset by screen index, setup() puts it back once the new layout is done.

const SETTLE_FRAMES := 3  # a ScrollContainer clamps to its content size until the layout pass has run

static var offsets := {}  # main -> scroll_vertical


## Replaces the deck's "free every column": remember the offsets first.
static func free_columns(columns: Control) -> void:
	for c in columns.get_children():
		for sc in c.find_children("*", "ScrollContainer", true, false):
			if sc.has_meta("deck_main"):
				offsets[int(sc.get_meta("deck_main"))] = (sc as ScrollContainer).scroll_vertical
		c.queue_free()


## A column's looks scroller: no horizontal scroll, and the remembered offset restored after layout.
static func setup(scroll: ScrollContainer, main: int) -> void:
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.set_meta("deck_main", main)
	if int(offsets.get(main, 0)) > 0:
		scroll.tree_entered.connect(_restore.bind(scroll, main), CONNECT_ONE_SHOT)


static func _restore(scroll: ScrollContainer, main: int) -> void:
	var want := int(offsets.get(main, 0))
	for i in SETTLE_FRAMES:
		await scroll.get_tree().process_frame
		if not is_instance_valid(scroll):
			return
		scroll.scroll_vertical = want
