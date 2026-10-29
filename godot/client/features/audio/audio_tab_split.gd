extends RefCounted
## WO-799 — the Audio tab's vertical split: the CasparCG mixer (top) and the ALSA hardware mixer (bottom) with a
## draggable divider. Both panes scroll, so a long control list never pushes the other pane off screen; the top
## pane keeps TOP_MIN_HEIGHT when the divider is dragged down. Layout only: no autoload reference, so the headless
## test runner can build it (tests/test_audio_tab_split.gd). The divider position lives in memory (per session).

const TOP_MIN_HEIGHT := 240.0
const BOTTOM_MIN_HEIGHT := 160.0
const DIVIDER_PX := 8


## `top` fills the upper pane, `bottom` the lower one; each is wrapped in a ScrollContainer.
static func dock(top: Control, bottom: Control) -> VSplitContainer:
	var split := VSplitContainer.new()
	split.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.add_theme_constant_override("separation", DIVIDER_PX)
	split.add_child(_pane(top, TOP_MIN_HEIGHT))
	split.add_child(_pane(bottom, BOTTOM_MIN_HEIGHT))
	return split


static func _pane(content: Control, min_h: float) -> ScrollContainer:
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size.y = min_h
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(content)
	return scroll
