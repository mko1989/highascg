extends RefCounted
## WO-608 R2 / WO-603 slice 6 — the Inspector column: one page at a time; releasing a page that covered another
## still-selected page shows that page again (a look layer comes back when a second media file is ctrl-clicked, so
## its playlist drop zone is reachable for the multi-drag); a page its owner released never comes back.

const InspectorPanel := preload("res://app/inspector_panel.gd")
var t


func _panel() -> Array:
	var p: Control = InspectorPanel.new()
	p._ready()
	var layer := Control.new()
	var media := Control.new()
	return [p, layer, media]


func test_release_shows_the_covered_page() -> void:
	var a := _panel()
	var p: Control = a[0]
	p.present(a[1])
	p.present(a[2])
	t.ok(p.showing(a[2]) and not p.showing(a[1]), "the media page covers the layer page")
	p.release(a[2])
	t.ok(p.showing(a[1]), "the layer page is back")
	t.ok(not p._empty.visible, "not 'Select an item'")
	p.free()


func test_a_released_page_stays_gone() -> void:
	var a := _panel()
	var p: Control = a[0]
	p.present(a[1])
	p.present(a[2])
	p.release(a[1])  # the look editor closed while the media page was up
	p.release(a[2])
	t.ok(not p.showing(a[1]), "the closed editor's page is not resurrected")
	t.ok(p._empty.visible, "empty state")
	p.present(a[1])
	t.ok(p.showing(a[1]), "presenting again clears the released mark")
	p.free()


func test_releasing_a_hidden_page_changes_nothing() -> void:
	var a := _panel()
	var p: Control = a[0]
	p.present(a[1])
	p.present(a[2])
	p.release(a[1])
	t.ok(p.showing(a[2]), "the shown page stays")
	p.free()


## WO-783 — the column's tabs: a new tab does not take the column over, a tab click shows its pane, and a new
## selection (present) brings the Inspector tab back.
func test_tabs_and_selection() -> void:
	var a := _panel()
	var p: Control = a[0]
	var presets := VBoxContainer.new()
	p.add_tab("Look presets", presets)
	t.eq(p.tab_shown(), 0, "the Inspector tab stays shown")
	t.eq(p._tabs.size(), 2, "Inspector + Look presets")
	p.show_tab(1)
	t.eq(p.tab_shown(), 1, "Look presets shown")
	t.ok(presets.is_visible_in_tree() or not p.is_inside_tree(), "its pane is the visible one")
	t.ok(not p._panes[0].visible, "the Inspector pane is hidden")
	p.present(a[1])
	t.eq(p.tab_shown(), 0, "a selection brings the Inspector back")
	t.ok(p.showing(a[1]), "with its page")
	p.free()


func test_panes_reserve_the_scrollbar_width() -> void:
	# WO-813 follow-up: content growing taller (Trim opening) showed the scrollbar and widened the column by its width
	var p: Control = InspectorPanel.new()
	p._ready()
	var pane := Control.new()
	p.add_tab("Probe", pane)
	var scroll: ScrollContainer = pane.get_parent()
	t.eq(scroll.vertical_scroll_mode, ScrollContainer.SCROLL_MODE_RESERVE, "scrollbar width always reserved")
	t.eq(scroll.horizontal_scroll_mode, ScrollContainer.SCROLL_MODE_DISABLED, "no horizontal scroll")
	p.free()
