extends RefCounted
## WO-810 — owner 29.10: "in timeline tab move all the controls to the middle between the timeline and preview".
## The Timeline tab stacks the preview, the controls row (transport + Dest) and the timeline canvas, in that order.

const Layout := preload("res://features/timeline/timeline_layout.gd")
var t


func test_controls_row_sits_between_preview_and_timeline() -> void:
	var preview := PanelContainer.new()
	var transport := HBoxContainer.new()
	var dest := HBoxContainer.new()
	var view := Control.new()
	var split := Layout.stack(preview, [transport, dest], view)
	t.ok(split is VSplitContainer, "the preview / timeline split is kept")
	t.eq(split.get_child_count(), 2, "two split panes")
	t.ok(split.get_child(0) == preview, "pane 1 is the preview (its divider offset = its height)")
	var lower: Node = split.get_child(1)
	t.eq(lower.get_child_count(), 2, "pane 2: the controls row, then the timeline")
	var row: Node = lower.get_child(0)
	t.ok(row is HFlowContainer, "the controls row wraps when narrow")
	t.ok(transport.get_parent() == row and dest.get_parent() == row, "transport and Dest are in the row")
	t.ok(transport.get_index() < dest.get_index(), "transport first, Dest after it")
	t.ok(lower.get_child(1) == view, "the timeline canvas is below the row")
	t.eq(view.size_flags_vertical, Control.SIZE_EXPAND_FILL, "the canvas takes the pane's height")
	split.free()


func test_timeline_tab_uses_the_middle_row() -> void:
	var src := FileAccess.get_file_as_string("res://features/timeline/timeline_tab.gd")
	t.ok(src.contains("TimelineLayout.stack(preview_slot, [transport, dest], view)"), "the tab stacks via timeline_layout.gd")
	t.ok(not src.contains("add_child(transport)") and not src.contains("add_child(dest)"), "no controls at the tab's top")
	t.ok(src.contains("LivePreview.current.host(preview_slot)"), "the WO-789 preview borrow is unchanged")
