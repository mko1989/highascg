extends RefCounted
## WO-810 — the Timeline tab's stack (owner 29.10: "move all the controls to the middle between the timeline and
## preview"): preview on top, then the controls row (transport + Dest, wrapping when narrow), then the timeline canvas.
## The split keeps two panes; the row heads the bottom pane, so the stored divider offset is still the preview height.


## preview_slot → split pane 1; [controls row, view] → split pane 2. Returns the split (not yet in the tree).
static func stack(preview_slot: Control, controls: Array, view: Control) -> VSplitContainer:
	var split := VSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.add_child(preview_slot)
	var lower := VBoxContainer.new()
	lower.name = "TimelinePane"
	lower.add_theme_constant_override("separation", 6)
	var row := HFlowContainer.new()
	row.name = "ControlsRow"
	row.add_theme_constant_override("h_separation", 12)
	row.add_theme_constant_override("v_separation", 4)
	for c in controls:
		row.add_child(c)
	if not controls.is_empty():
		(controls[-1] as Control).size_flags_horizontal = Control.SIZE_EXPAND_FILL  # Dest's status text reads at the right
	lower.add_child(row)
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	lower.add_child(view)
	split.add_child(lower)
	return split
