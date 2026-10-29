extends RefCounted
## WO-813 — the look layer's clip Trim: time / frame maths, trim in / out clamping, the Ctrl+click / ↺ / right-click reset (owner 29.10)
## and the start drop-down without "Custom".

const T := preload("res://features/live/clip_trim_model.gd")
var t


func test_ms_frame_round_trip() -> void:
	t.eq(T.ms_to_frame(0.0, 25.0), 0, "0 ms")
	t.eq(T.ms_to_frame(1000.0, 25.0), 25, "1 s @ 25")
	t.eq(T.ms_to_frame(1039.0, 25.0), 25, "inside frame 25 floors")
	t.eq(T.ms_to_frame(1040.0, 25.0), 26, "frame 26 starts at 1040")
	t.eq(T.ms_to_frame(-50.0, 25.0), 0, "negative clamps")
	t.eq(T.ms_to_frame(1000.0, 0.0), 25, "fps 0 → 25")
	t.eq(T.frame_to_ms(30, 30.0), 1000.0, "30 @ 30")
	t.eq(T.ms_to_frame(T.frame_to_ms(7, 29.97), 29.97), 7, "29.97 round trip")
	t.eq(T.snap_ms(1039.0, 5000.0, 25.0), 1000.0, "snap to the frame start")
	t.eq(T.snap_ms(9000.0, 5000.0, 25.0), 5000.0, "snap clamps to the clip")
	t.eq(T.snap_ms(-3.0, 5000.0, 25.0), 0.0, "snap clamps at 0")


func test_shown_points() -> void:
	t.eq(T.in_ms({}), 0.0, "no in → 0")
	t.eq(T.out_ms({}, 8000.0), 8000.0, "no out → clip end")
	t.eq(T.out_ms({"trimOutMs": 9000}, 8000.0), 8000.0, "out past the end is shown at the end")
	t.ok(not T.has_trim({}) and T.has_trim({"trimOutMs": 100}), "has_trim")


func test_trim_in() -> void:
	var r := T.set_in({}, 2019.0, 10000.0, 25.0)
	t.ok(r.ok, "in accepted")
	t.eq(r.patch, {"trimInMs": 2000}, "in snapped to its frame")
	t.eq(T.set_in({}, 0.0, 10000.0, 25.0).patch, {"trimInMs": null}, "in at 0 clears")
	t.ok(not T.set_in({"trimOutMs": 4000}, 4000.0, 10000.0, 25.0).ok, "in at the out point refused")
	t.ok(not T.set_in({"trimOutMs": 4000}, 5000.0, 10000.0, 25.0).ok, "in after out refused")
	t.ok(T.set_in({"trimOutMs": 4000}, 3960.0, 10000.0, 25.0).ok, "in one frame before out")
	t.eq(T.set_in({}, 99999.0, 10000.0, 25.0).ok, false, "in past the end lands on the end = out → refused")
	t.eq(T.set_in({}, 1000.0, 0.0, 25.0).ok, false, "unknown length refused")


func test_trim_out() -> void:
	t.eq(T.set_out({}, 6020.0, 10000.0, 25.0).patch, {"trimOutMs": 6000}, "out snapped")
	t.eq(T.set_out({}, 10000.0, 10000.0, 25.0).patch, {"trimOutMs": null}, "out at the clip end clears")
	t.eq(T.set_out({}, 50000.0, 10000.0, 25.0).patch, {"trimOutMs": null}, "out past the end clamps → clears")
	t.ok(not T.set_out({"trimInMs": 3000}, 3000.0, 10000.0, 25.0).ok, "out at the in point refused")
	t.ok(not T.set_out({"trimInMs": 3000}, 1000.0, 10000.0, 25.0).ok, "out before in refused")
	t.ok(T.set_out({"trimInMs": 3000}, 3040.0, 10000.0, 25.0).ok, "out one frame after in")
	t.eq(T.set_out({}, 0.0, 10000.0, 25.0).ok, false, "out at 0 (no in) refused")


func test_scrub_note() -> void:
	t.ok(T.scrub_note({"onPrv": true, "channel": 2}).begins_with("Scrubbing PRV (channel 2)"), "on PRV")
	t.ok(T.scrub_note({"onPrv": false, "reason": "not_on_prv"}).contains("next take"), "off PRV says next take")
	t.ok(T.scrub_note({"onPrv": false, "reason": "pgm_only"}).contains("no PRV"), "pgm only")


func test_points_clamped() -> void:
	t.eq(T.points({}, 8000.0), Vector2(0.0, 8000.0), "no trim → whole clip")
	t.eq(T.points({"trimInMs": 1000, "trimOutMs": 6000}, 8000.0), Vector2(1000.0, 6000.0), "stored points")
	t.eq(T.points({"trimInMs": 9000}, 8000.0), Vector2(8000.0, 8000.0), "in from a longer clip stays inside")
	t.eq(T.points({"trimInMs": 5000, "trimOutMs": 3000}, 8000.0), Vector2(3000.0, 3000.0), "in never shows after out")
	t.eq(T.points({"trimOutMs": 12000}, 8000.0), Vector2(0.0, 8000.0), "out past the end shows at the end")
	t.eq(T.points({"trimInMs": 500}, 0.0), Vector2(500.0, -1.0), "length unknown, no out → the end")


func test_reset_in() -> void:
	t.eq(T.reset_in({"trimInMs": 2000, "trimOutMs": 6000}, 25.0).patch, {"trimInMs": null}, "in → the clip's start, out kept")
	t.eq(T.reset_in({}, 25.0).patch, {"trimInMs": null}, "nothing stored → still null")
	t.eq(T.reset_in({"trimInMs": 2000, "trimOutMs": 0}, 25.0).patch, {"trimInMs": null, "trimOutMs": null}, "an out at 0 would equal the in → cleared too")
	var after := {"trimInMs": 2000, "trimOutMs": 6000}
	after.merge(T.reset_in(after, 25.0).patch, true)
	var pt := T.points(after, 10000.0)
	t.ok(pt.x == 0.0 and pt.x < pt.y, "after the reset in = 0 < out")


func test_reset_out() -> void:
	t.eq(T.reset_out({"trimInMs": 2000, "trimOutMs": 6000}, 10000.0, 25.0).patch, {"trimOutMs": null}, "out → the clip's end, in kept")
	t.eq(T.reset_out({"trimInMs": 9000, "trimOutMs": 9500}, 8000.0, 25.0).patch, {"trimOutMs": null, "trimInMs": null}, "in past a shorter clip's end → cleared too")
	t.eq(T.reset_out({"trimInMs": 7980, "trimOutMs": 7990}, 8000.0, 25.0).patch, {"trimOutMs": null, "trimInMs": null}, "in on the last frame start → cleared (in < out by a frame)")
	t.eq(T.reset_out({"trimInMs": 7960}, 8000.0, 25.0).patch, {"trimOutMs": null}, "in one frame before the end stays")
	t.eq(T.reset_out({"trimOutMs": 3000}, 0.0, 25.0).patch, {"trimOutMs": null}, "length unknown → out cleared")
	for layer in [{"trimInMs": 2000, "trimOutMs": 6000}, {"trimInMs": 9000, "trimOutMs": 9500}, {"trimInMs": 7980}]:
		var l: Dictionary = layer.duplicate()
		l.merge(T.reset_out(l, 8000.0, 25.0).patch, true)
		var pt := T.points(l, 8000.0)
		t.ok(pt.x < pt.y, "after the reset in < out (%s)" % [layer])


func _click(button: MouseButton, pressed: bool, ctrl := false, meta := false) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = button
	e.pressed = pressed
	e.ctrl_pressed = ctrl
	e.meta_pressed = meta
	return e


## Owner 29.10: reset without right-click (the web has none) — Ctrl / Cmd+click; right-click stays.
func test_reset_click() -> void:
	t.ok(T.is_reset_click(_click(MOUSE_BUTTON_LEFT, true, true)), "Ctrl+click resets")
	t.ok(T.is_reset_click(_click(MOUSE_BUTTON_LEFT, true, false, true)), "Cmd+click (macOS) resets")
	t.ok(T.is_reset_click(_click(MOUSE_BUTTON_RIGHT, true)), "right-click still resets")
	t.ok(not T.is_reset_click(_click(MOUSE_BUTTON_LEFT, true)), "plain click sets the point, no reset")
	t.ok(not T.is_reset_click(_click(MOUSE_BUTTON_LEFT, false, true)), "the release is not a second reset")
	t.ok(not T.is_reset_click(_click(MOUSE_BUTTON_MIDDLE, true, true)), "middle button: nothing")
	var key := InputEventKey.new()
	key.ctrl_pressed = true
	key.pressed = true
	t.ok(not T.is_reset_click(key) and not T.is_reset_click(null), "a key or nothing: no reset")


## The section needs the app's autoloads (not loadable here), so its wiring is read as text: the Ctrl+click branch and
## the ↺ button call the one _reset, which patches reset_in / reset_out (tested above).
func test_ctrl_click_and_reset_button_share_one_reset() -> void:
	var src := FileAccess.get_file_as_string("res://features/live/clip_trim_section.gd")
	t.ok(src.contains("\t\tif T.is_reset_click(e):\n\t\t\tb.accept_event()"), "Trim in / out: Ctrl+click is accepted before the Button sets the point")
	t.eq(src.count("_reset(is_in))"), 2, "Ctrl+click and ↺ both call _reset(is_in)")
	t.ok(src.contains("b.text = \"↺\"") and src.contains("b.pressed.connect(func() -> void: _reset(is_in))"), "↺ → _reset")
	t.ok(src.contains("_apply(T.reset_in(_layer, _fps) if is_in else T.reset_out(_layer, _dur_ms, _fps))"), "_reset → the model reset")
	t.eq(src.count("_reset_btn(row, "), 2, "one ↺ per point")
	t.ok(src.contains("Ctrl+click or ↺ to reset to the clip's start") and src.contains("Ctrl+click or ↺ to reset to the clip's end"), "tooltips")


## Open, the row must fit the Inspector's value column (probe on the box: 291 px in a 293 px column; it was 352 → the
## column widened by 44 px and the editor's buttons moved).
func test_open_row_is_sized_to_fit_the_inspector() -> void:
	var src := FileAccess.get_file_as_string("res://features/live/clip_trim_section.gd")
	t.ok(not src.contains("custom_minimum_size.x = 72"), "no fixed 72 px fields")
	t.eq(src.count("_fit_field(e)"), 1, "both fields sized to the widest timecode")
	t.ok(src.contains("const FIELD_SAMPLE := \"00:00.00\""), "sample covers clips up to 99 min")
	t.ok(src.contains("row.add_theme_constant_override(\"separation\", 1)"), "tight row")
	t.ok(src.contains("b.add_theme_stylebox_override(s, StyleBoxEmpty.new())"), "↺ is just the glyph")


func test_parse_typed_point() -> void:
	t.eq(T.parse_tc("0:01.12", 25.0), 1480.0, "m:ss.ff — .12 is frames")
	t.eq(T.parse_tc("1:02.00", 25.0), 62000.0, "a minute")
	t.eq(T.parse_tc("1:00:00.00", 25.0), 3600000.0, "h:mm:ss.ff")
	t.eq(T.parse_tc(T.M.format_timecode(9.36, 25.0), 25.0), 9360.0, "reads what format_timecode writes")
	t.eq(T.parse_tc("1.5", 25.0), 1500.0, "plain number = seconds")
	t.eq(T.parse_tc("2*3", 25.0), 6000.0, "maths (RULES.md)")
	t.ok(is_nan(T.parse_tc("abc", 25.0)), "garbage → NAN")
	t.ok(is_nan(T.parse_tc("1:x", 25.0)), "bad timecode → NAN")
	t.ok(is_nan(T.parse_tc("", 25.0)), "empty → NAN")
	t.ok(is_nan(T.parse_tc("-1", 25.0)), "negative → NAN")


func test_summary() -> void:
	t.eq(T.summary({}, 10000.0, 25.0), "Full clip", "no trim")
	t.eq(T.summary({"trimInMs": 120, "trimOutMs": 9360}, 10000.0, 25.0), "0:00.03 – 0:09.09", "in – out")
	t.eq(T.summary({"trimInMs": 1000}, 0.0, 25.0), "0:01.00 – end", "length unknown")


func test_start_options_without_custom() -> void:
	var starts: Array = T.STARTS  # layer_inspector.gd's drop-down (const STARTS = this; pinned in smoke-wo813)
	t.eq(starts.size(), 2, "exactly two start options")
	t.eq(starts.map(func(o: Array) -> String: return o[0]), ["beginning", "relativeToPrevious"], "beginning + relativeToPrevious")
	t.ok(not str(starts).contains("ustom"), "no Custom option")
