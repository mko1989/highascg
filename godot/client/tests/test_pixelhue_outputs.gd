extends RefCounted
## WO-1039 — outputs_model.gd: pending changes, bulk fill, validation, capacity and advanced bodies.

const M := preload("res://features/pixelhue/outputs_model.gd")
var t


func _state() -> Dictionary:
	var presets := [
		{"width": 1920, "height": 1080, "frame": 60.0, "standardType": 6, "interlaced": 0, "key": "1920,1080,60,6,0", "label": "1920 × 1080p 60 Hz · CEA"},
		{"width": 3840, "height": 2160, "frame": 30.0, "standardType": 6, "interlaced": 0, "key": "3840,2160,30,6,0", "label": "3840 × 2160p 30 Hz · CEA"}]
	var limits := {"width": {"min": 800, "max": 4096, "step": 4}, "height": {"min": 600, "max": 4096, "step": 1}}
	return {"syncActive": false, "outputs": [
		{"id": 5.0, "number": 1.0, "name": "OUT 1", "screen": "Screen 1", "timingEditable": true, "timing": {"width": 3072.0, "height": 1024.0, "frame": 50.0, "standardType": 0.0, "interlaced": 0.0}, "timingMode": 3.0, "colorDepth": 8.0, "hdcp": 0.0, "testPattern": 0.0, "presets": presets, "limits": limits, "interlacedAllowed": false, "role": "Output", "connector": "HDMI 2.0", "port": 1.0, "slotId": 2.0, "copyFrom": null},
		{"id": 6.0, "number": 2.0, "name": "OUT 2", "screen": "", "timingEditable": false, "timing": {"width": 3072.0, "height": 1024.0, "frame": 50.0, "standardType": 0.0, "interlaced": 0.0}, "timingMode": 3.0, "colorDepth": null, "hdcp": null, "testPattern": null, "presets": presets, "limits": limits, "interlacedAllowed": false, "role": "Output", "connector": "HDMI 2.0", "port": 2.0, "slotId": 2.0, "copyFrom": 5.0}]}


func test_no_edit_no_changes() -> void:
	var s := _state()
	t.eq(M.pending(s.outputs, M.make_drafts(s.outputs)), [], "untouched drafts → nothing pending")


func test_name_and_preset_changes() -> void:
	var s := _state()
	var d := M.make_drafts(s.outputs)
	d[5]["name"] = "Left"
	M.set_preset(s.outputs[0], d[5], "1920,1080,60,6,0")
	var ch := M.pending(s.outputs, d)
	t.eq(ch.size(), 1, "one output changed")
	t.eq(ch[0].timingMode, 0, "preset → standard mode 0")
	t.eq(ch[0].timing, {"width": 1920, "height": 1080, "frame": 60.0, "standardType": 6, "interlaced": 0}, "preset timing sent whole")
	t.eq(ch[0].name, "Left", "name")
	t.eq(M.timing_label(s.outputs[0], d[5]), "1920 × 1080p 60 Hz · CEA", "label follows the preset")


func test_custom_dimension_resets_standard() -> void:
	var s := _state()
	var d := M.make_drafts(s.outputs)
	M.set_custom_dimension(d[5], "width", 2000.0)
	var ch := M.pending(s.outputs, d)
	t.eq(ch[0].timingMode, 3, "custom → mode 3")
	t.eq(ch[0].timing.width, 2000, "width")
	t.eq(M.validate(s, ch), "", "2000 is on the 4-step grid")
	M.set_custom_dimension(d[5], "width", 2001.0)
	t.ok(M.validate(s, M.pending(s.outputs, d)).contains("limits"), "off-step width refused")


func test_confirm_flags_and_body() -> void:
	var s := _state()
	var d := M.make_drafts(s.outputs)
	M.set_custom_dimension(d[5], "frame", 60.0)
	d[5]["colorDepth"] = 10
	var ch := M.pending(s.outputs, d)
	t.ok(M.interrupts_signal(ch), "timing change interrupts")
	t.eq(M.outputs_body(s, ch).changes[0].confirmTimingReset, true, "screen on output → reset flag")
	t.ok(not M.interrupts_signal([{"id": 5, "name": "x"}]), "rename does not")


func test_fixed_output_refused() -> void:
	var s := _state()
	var ch := [{"id": 6, "timing": {"width": 1920, "height": 1080, "frame": 60.0, "standardType": 6, "interlaced": 0}, "timingMode": 0}]
	t.ok(M.validate(s, ch).contains("fixed/copy"), "copy port timing refused")
	t.ok(M.validate(s, [{"id": 5, "name": ""}]).contains("1–32"), "empty name refused")


func test_bulk_fill() -> void:
	var s := _state()
	var d := M.make_drafts(s.outputs)
	var skipped := M.bulk_fill(s.outputs, d, {5: true, 6: true}, "Port {n}", "1920,1080,60,6,0", 10, 1)
	t.eq(skipped, 1, "the fixed output cannot take timing")
	t.eq(d[5].name, "Port 1", "pattern")
	t.eq(d[5].timingMode, 0, "preset applied")
	t.eq(d[6].colorDepth, null, "no depth on a connector without it")
	t.eq(M.bulk_presets(s.outputs).size(), 2, "union of editable presets")


func test_capacity() -> void:
	var g := {"slotId": 2.0, "capacity": 1.0, "options": [{"value": 1.0, "label": "DL", "independent": [1.0, 3.0]}, {"value": 2.0, "label": "4K", "independent": [1.0]}]}
	t.eq(M.capacity_body(g, 2), {"slotId": 2, "capacity": 2, "confirmReset": true}, "body")
	t.eq(M.capacity_block(g, 1, 0), "Nothing to change.", "same capacity")
	t.ok(M.capacity_block(g, 2, 1).contains("pending"), "pending edits block")
	t.eq(M.capacity_block(g, 2, 0), "", "ok")
	t.eq(M.capacity_options(g)[0].text, "DL · 2 independent outputs", "option label")


func test_advanced() -> void:
	var f1 := {"key": "colorSpace.preset", "label": "Sampling", "section": "Format", "options": [[0.0, "RGB"], [1.0, "422"]]}
	var f2 := {"key": "colorGamut.preset", "label": "Gamut", "section": "Format", "options": [[1.0, "709"], [2.0, "P3"]]}
	var f3 := {"key": "imageQuality.brightness.R", "label": "R", "section": "Colour correction", "min": 0.0, "max": 200.0, "step": 1.0, "default": 100.0}
	var a := {"id": 5.0, "name": "A", "role": "Output", "connector": "HDMI", "fields": [f1, f2, f3], "values": {"colorSpace.preset": 0.0, "colorGamut.preset": 1.0, "imageQuality.brightness.R": 100.0}}
	var b := a.duplicate(true)
	b["id"] = 6.0
	var vals := {"colorSpace.preset": 0.0, "colorGamut.preset": 1.0, "imageQuality.brightness.R": 120.0}
	t.eq(M.adv_pending(a, vals), {"imageQuality.brightness.R": 120.0}, "only the changed key")
	t.eq(M.adv_sections(a), ["Format", "Colour correction"], "sections in order")
	t.eq(M.adv_copy_changes([a, b], a, vals).size(), 2, "copy reaches the peer")
	t.eq(M.adv_quality_defaults(a), {"imageQuality.brightness.R": 100.0}, "reset values")
	t.ok(M.adv_validate(a, {"imageQuality.brightness.R": 300.0}).contains("supported"), "range")
	t.ok(M.adv_validate(a, {"colorSpace.preset": 1.0, "colorGamut.preset": 2.0}).contains("DCI-P3"), "P3 needs RGB")
	t.ok(M.adv_is_format({"colorRange.preset": 1.0}), "format key")
	t.ok(not M.adv_is_format({"imageQuality.brightness.R": 1.0}), "colour key is not format")
