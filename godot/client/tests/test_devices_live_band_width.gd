extends RefCounted
## WO-1134 — a webpage live input's row in Devices → "Add live input" shows its whole URL; the row button must not pin
## the Devices tab's minimum width to that URL (the tab grew past 1920 px and pushed the Inspector off the screen).
## The panel needs the DevicesTarget / Api autoloads (absent in this runner), so: the behaviour on a real Button + the
## source pin.
var t

const URL := "https://wall.sli.do/event/666NHNXvJHSGbsRCRiSpEK?section=ec28917a-06f6-49ff-b70c-f0ed29828001" \
	+ "&integration=shared-present-mode&utm_source=slidoadmin (CG)"


func test_clipped_band_button_has_a_narrow_minimum() -> void:
	var plain := Button.new()
	plain.text = "%s\n%s" % [URL, "Webpage"]
	var clipped := Button.new()
	clipped.text = plain.text
	clipped.clip_text = true
	clipped.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	t.ok(plain.get_combined_minimum_size().x > 600, "unclipped URL button pins a wide minimum (the bug, got %d)" % plain.get_combined_minimum_size().x)
	t.ok(clipped.get_combined_minimum_size().x < 100, "clipped URL button stays narrow (got %d)" % clipped.get_combined_minimum_size().x)
	plain.free()
	clipped.free()


func test_band_rows_clip_and_keep_the_text_in_the_tooltip() -> void:
	var src := FileAccess.get_file_as_string("res://features/devices/destinations_panel.gd")
	t.ok(src.contains("b.clip_text = true"), "live-input band buttons clip their text")
	t.ok(src.contains("b.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS"), "…with an ellipsis")
	t.ok(src.contains("b.tooltip_text = \"%s\\n%s\" % [r.label, r.detail]"), "the tooltip carries the full label + detail")
