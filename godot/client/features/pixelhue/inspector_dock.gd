extends RefCounted
## WO-1039 (owner 11.11: "Use the main inspector for Pixelhue studio when in that tab") — a PixelHue panel's
## properties column lives in the app's one right-hand Inspector (app/inspector_panel.gd) while that panel is on
## screen, and leaves it when the operator goes to another sub-tab or another main tab.
## Without the app shell (unit tests, a panel on its own) the page stays a column of the panel, as before.

const InspectorPanel := preload("res://app/inspector_panel.gd")


## `panel`: the sub-tab's panel; `page`: its properties column (built, not yet in the tree); `column_parent`: where
## the column sits when there is no main Inspector.
static func dock(panel: Control, page: Control, column_parent: Node, min_width := 0) -> void:
	var main: Node = InspectorPanel.current
	if main == null or not is_instance_valid(main):
		var scroll := ScrollContainer.new()
		scroll.custom_minimum_size.x = min_width
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(page)
		column_parent.add_child(scroll)
		return
	column_parent.add_child(page)  # its _ready runs now, with the panel's, before the first refresh fills it
	column_parent.remove_child(page)
	var sync := func() -> void:
		if not is_instance_valid(main) or not is_instance_valid(page):
			return
		if panel.is_visible_in_tree():
			main.call("present", page)
		else:
			main.call("release", page)
	panel.visibility_changed.connect(sync)
	panel.tree_exiting.connect(func() -> void:
		if is_instance_valid(page):
			if is_instance_valid(main):
				main.call("release", page)
			page.queue_free())
	sync.call_deferred()
