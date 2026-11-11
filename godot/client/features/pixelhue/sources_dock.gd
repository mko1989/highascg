extends RefCounted
## WO-1039 (owner 11.11: "When in Pixelhue tab also use sources browser as pixelhue sources, add the tab to the
## browser only when in pixelhue tab") — a PixelHue panel's source list becomes a "PixelHue" tab of the app's
## left-hand Sources browser (features/live/media_panel.gd) while that panel is on screen: the tab is added and
## selected when the panel shows, and taken away (the browser goes back to the tab it was on) when it hides.
## Rows drag from there onto the panel's stage like from any other place in the window.
## Without the app shell (unit tests, a panel on its own) the list stays a column of the panel, as before.

const MediaPanel := preload("res://features/live/media_panel.gd")
const TITLE := "PixelHue"


## `panel`: the sub-tab's panel; `page`: its source list (built, not yet in the tree); `column_parent`: where the
## list sits when there is no Sources browser (added there now, so it keeps its place in the panel's layout).
static func dock(panel: Control, page: Control, column_parent: Node) -> void:
	var browser: Node = MediaPanel.current
	if browser == null or not is_instance_valid(browser) or not browser.has_method("browser_tabs"):
		column_parent.add_child(page)
		return
	column_parent.add_child(page)  # its _ready runs now, with the panel's, before the first refresh fills it
	column_parent.remove_child(page)
	page.custom_minimum_size.x = 0  # the browser column decides the width
	var before := [-1]  # the browser tab that was up before ours
	var sync := func() -> void:
		if not is_instance_valid(browser) or not is_instance_valid(page):
			return
		var tabs: TabContainer = browser.call("browser_tabs")
		var on := panel.is_visible_in_tree()
		if on and page.get_parent() != tabs:
			before[0] = tabs.current_tab
			page.name = TITLE
			tabs.add_child(page)
			tabs.current_tab = tabs.get_tab_idx_from_control(page)
		elif not on and page.get_parent() == tabs:
			var was_ours := tabs.get_current_tab_control() == page
			tabs.remove_child(page)
			if was_ours and tabs.get_tab_count() > 0:
				var back: int = before[0] if before[0] >= 0 and before[0] < tabs.get_tab_count() and not tabs.is_tab_hidden(before[0]) else 0
				tabs.current_tab = back
	panel.visibility_changed.connect(sync)
	panel.tree_exiting.connect(func() -> void:
		if is_instance_valid(page):
			if page.get_parent() != null:
				page.get_parent().remove_child(page)
			page.queue_free())
	sync.call_deferred()
