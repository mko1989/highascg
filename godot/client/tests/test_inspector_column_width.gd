extends RefCounted
## WO-977 — a long clip name in the Inspector footer's Playlists dropdowns must not pin the Inspector's minimum width
## (it was 622 px, over the 400 px column; with the Devices tab's 1088 px the shell overflowed 1920 px).
## The panel needs the Api autoload (absent in this runner), so: the behaviour on a real OptionButton + the source pin.
var t


func test_clipped_dropdown_stays_inside_the_inspector_column() -> void:
	var long_name := "abstract-falling-neon-lines-background-animation-2026-10-03-07-51-44-utc · L11 · not live and more"
	var plain := OptionButton.new()
	plain.fit_to_longest_item = false
	plain.add_item(long_name)
	var clipped := OptionButton.new()
	clipped.fit_to_longest_item = false
	clipped.clip_text = true
	clipped.add_item(long_name)
	t.ok(plain.get_combined_minimum_size().x > 400, "unclipped dropdown pins a wide minimum (the bug)")
	t.ok(clipped.get_combined_minimum_size().x <= 400, "clipped dropdown fits the 400 px column (got %d)" % clipped.get_combined_minimum_size().x)
	plain.free()
	clipped.free()


func test_playlists_panel_clips_both_dropdowns() -> void:
	var src := FileAccess.get_file_as_string("res://features/live/playlists_panel.gd")
	t.ok(src.contains("_list.clip_text = true") and src.contains("_items.clip_text = true"), "playlists panel dropdowns clip their text")
