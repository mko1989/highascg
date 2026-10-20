extends RefCounted
## WO-629 — LED test card helpers.

const M := preload("res://app/led_test_model.gd")
var t


func test_channel_label() -> void:
	t.eq(M.channel_label({"index": 1.0, "program": true, "outputs": "Screen", "videoMode": "1080p5000"}), "ch 1 · PGM · Screen · 1080p5000", "program channel")
	t.eq(M.channel_label({"index": 4, "outputs": "", "videoMode": ""}), "ch 4", "bare")


func test_patterns() -> void:
	var p := [{"id": "grid-white", "name": "Grid (White)"}, {"id": "led-builder", "name": "Animated: Bunny builds the wall"}]
	t.eq(M.pattern_rows(p, false)[1].disabled, true, "builder needs a full-grid channel")
	t.eq(M.pattern_rows(p, false)[1].name, "Animated: Bunny builds the wall (needs Full LED grid)", "says why")
	t.eq(M.pattern_rows(p, true)[1].disabled, false, "offered with a grid channel")
	t.eq(M.any_on({"2": true}), true, "on")
	t.eq(M.any_on({"2": false}), false, "off")
	t.eq(M.any_on(null), false, "none")
	t.eq(M.extras("led-builder"), {"chars": true, "speed": true, "chars_label": "Builder bunnies"}, "builder")
	t.eq(M.extras("bouncing-element").chars, true, "bouncing")
	t.eq(M.extras("grid-white"), {"chars": false, "speed": false, "chars_label": "Bouncing HighAsCG characters"}, "plain")


func test_switch_notice() -> void:
	t.eq(M.switch_notice({"ok": true, "data": {"targets": [1], "failures": []}}, true), {}, "all good: quiet")
	var part := M.switch_notice({"ok": true, "data": {"targets": [1, 3], "failures": [{"channel": 3.0, "error": "boom"}]}}, true)
	t.eq(part, {"text": "Test card on 1 of 2 channels — ch 3: boom", "tone": "warn"}, "partial")
	var all := M.switch_notice({"ok": false, "data": {"targets": [1], "failures": [{"channel": 1, "error": "no"}]}}, true)
	t.eq(all, {"text": "Test card on failed — ch 1: no", "tone": "error"}, "all failed")
	t.eq(M.switch_notice({"ok": false, "error": "HTTP 503", "data": {"error": "Caspar not connected"}}, false).text, "Test card off failed — Caspar not connected", "server error")
