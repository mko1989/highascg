extends RefCounted
## WO-799 — the Audio tab's vertical split: the CasparCG mixer (top) and the ALSA hardware mixer (bottom) in a
## VSplitContainer with a draggable divider; the top pane keeps its minimum height; the Audio tab wires it up.

const Split := preload("res://features/audio/audio_tab_split.gd")
var t


func test_vertical_split_has_both_panes() -> void:
	var top := Label.new()
	var bottom := Label.new()
	var s := Split.dock(top, bottom)
	t.ok(s is VSplitContainer, "the split is vertical (top / bottom)")
	t.eq(s.get_child_count(), 2, "two panes")
	t.ok(top.get_parent() is ScrollContainer and top.get_parent().get_parent() == s, "top pane is the first child")
	t.ok(bottom.get_parent() is ScrollContainer and bottom.get_parent().get_parent() == s, "bottom pane is the second child")
	t.eq(s.get_child(0).horizontal_scroll_mode, ScrollContainer.SCROLL_MODE_DISABLED, "top pane does not scroll sideways")
	s.free()


func test_top_pane_keeps_its_minimum_height() -> void:
	var s := Split.dock(Control.new(), Control.new())
	var top_pane: Control = s.get_child(0)
	t.eq(top_pane.custom_minimum_size.y, Split.TOP_MIN_HEIGHT, "top pane minimum height")
	t.ok(top_pane.get_combined_minimum_size().y >= Split.TOP_MIN_HEIGHT, "the split cannot squeeze the top below it")
	t.eq(s.get_child(1).custom_minimum_size.y, Split.BOTTOM_MIN_HEIGHT, "bottom pane minimum height")
	t.eq(s.get_theme_constant("separation"), Split.DIVIDER_PX, "a visible divider between the panes")
	s.free()


func test_audio_tab_docks_alsa_under_the_casparcg_mixer() -> void:
	var src := FileAccess.get_file_as_string("res://features/audio/audio_tab.gd")
	t.ok(src.contains("Split.dock(bays, _alsa)"), "audio_tab.gd docks the CasparCG body and the ALSA panel")
	t.ok(src.contains("AlsaMixer.new()"), "the ALSA panel is instantiated with AlsaMixer.new()")
	t.ok(src.contains("_alsa.load_mixer(false)"), "the ALSA panel loads on first show")
	t.ok(src.contains("add_child(foot)"), "the status line and + button stay below the split")
