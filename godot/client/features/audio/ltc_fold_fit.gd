extends RefCounted
## The LTC fold sits in the Audio tab's bottom pane, a ScrollContainer with horizontal scrolling off: its minimum width
## becomes the window's. Opened, the fold's pickers asked for their longest item ("plughw:CARD=Pro,DEV=0 (not
## connected)") and LTC out + LTC in stood side by side, so the window grew past the screen and pushed the Inspector and
## the header's connection eyes off the right edge (owner, 17.11.26). Here: pickers and text fields clip to a fixed
## minimum instead, and the two forms sit in a flow that puts LTC in under LTC out when the pane is narrow.
## Layout only (no autoloads), so tests/test_ltc_fold_fit.gd can build it headless.

const PICKER_MIN := 180.0
const FIELD_MIN := 140.0
const GAP := 32


## The fold's body: LTC out and LTC in side by side when they fit, else one under the other.
static func body() -> HFlowContainer:
	var b := HFlowContainer.new()
	b.add_theme_constant_override("h_separation", GAP)
	b.add_theme_constant_override("v_separation", 12)
	return b


## Every picker / text field under `root` stops asking for its content's width. Call it in the tree (or before the first
## minimum-size query): outside the tree Godot keeps a cached minimum size.
static func fit(root: Node) -> void:
	for c in root.get_children():
		if c is OptionButton:
			var ob := c as OptionButton
			ob.fit_to_longest_item = false
			ob.clip_text = true
			ob.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			ob.custom_minimum_size.x = PICKER_MIN
			ob.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		elif c is LineEdit and not (c.get_parent() is SpinBox):
			(c as LineEdit).custom_minimum_size.x = FIELD_MIN
		elif c is Label and (c as Label).autowrap_mode == TextServer.AUTOWRAP_OFF and (c as Label).custom_minimum_size.x == 0.0:
			(c as Label).clip_text = true  # a heading / status line never widens the pane
			(c as Label).text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		fit(c)


## The fold's one-line header: a long status line is clipped, never widens the pane.
static func head(b: Button) -> void:
	b.clip_text = true
	b.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
