extends RefCounted
## WO-1097 — the desk feed settings twin (desk_feed_model.gd normalize = src/fixtures/desk-feed-layout.js normalizeFeed,
## same answers as node), the status line, follow_model keeping the slice (a Godot save that dropped it would switch the
## feed off) and the Follow → Output section showing / editing it.

const M := preload("res://features/previs/tracking/desk_feed_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const S := preload("res://features/previs/tracking/desk_feed_section.gd")
var t


func _same(actual: Variant, expected: Dictionary, what: String) -> void:
	t.eq(actual is Dictionary and (actual as Dictionary).size() == expected.size(), true, what + " keys")
	for k in expected:
		t.eq(actual.get(k) if actual is Dictionary else null, expected[k], "%s.%s" % [what, k])


func test_normalize_matches_node() -> void:
	# node -e "normalizeFeed(…)" on the box, 16.11.26
	_same(M.normalize(null), {"enabled": false, "protocol": "artnet", "universe": 200, "dest": "", "priority": 100,
		"layout": "mirror", "address": 1}, "defaults")
	_same(M.normalize({"enabled": true, "protocol": "sacn", "universe": 0, "dest": "  239.255.0.200  ", "priority": 999,
		"layout": "compact", "address": 600}), {"enabled": true, "protocol": "sacn", "universe": 1, "dest": "239.255.0.200",
		"priority": 200, "layout": "compact", "address": 512}, "sACN clamped")
	_same(M.normalize({"enabled": "yes", "protocol": "x", "universe": 99999, "dest": 7, "priority": 0, "layout": "zig",
		"address": -3}), {"enabled": false, "protocol": "artnet", "universe": 32767, "dest": "", "priority": 1,
		"layout": "mirror", "address": 1}, "junk")
	t.eq(M.normalize({"universe": 12.6}).universe, 13, "universe rounded like node")


func test_status_text() -> void:
	t.ok(M.status_text(null).begins_with("Server not reporting"), "no server")
	t.eq(M.status_text({"enabled": false, "heads": 8}), "Off — would carry 8 heads (Auto / marker heads).", "off")
	t.eq(M.status_text({"enabled": true, "heads": 8, "problems": ["U0: universe 0 is a rig output universe (FP 1)"]}),
		"Not sending: U0: universe 0 is a rig output universe (FP 1)", "refused says why")
	t.eq(M.status_text({"enabled": true, "heads": 8, "problems": [], "universes": [{"universe": 200, "dest": "192.168.0.15:6454"}],
		"active": ["Focus Profile 3", "Focus Profile 4"], "pps": 30.5}),
		"Live: 8 heads · U200 → 192.168.0.15:6454 · aimed now: Focus Profile 3, Focus Profile 4 · 30.5 packets/s", "live")
	t.ok(M.status_text({"enabled": true, "heads": 0, "problems": []}).contains("no head follows"), "nothing to carry")


func test_follow_model_keeps_the_slice() -> void:
	var d := F.normalize({"feed": {"enabled": true, "universe": 201, "dest": "10.0.0.5"}})
	t.eq([d.feed.enabled, d.feed.universe, d.feed.dest], [true, 201, "10.0.0.5"], "a Godot save keeps the feed")
	t.eq(F.normalize({}).feed.enabled, false, "off by default")


func test_section_shows_and_edits() -> void:
	var s: VBoxContainer = S.new()
	s._ready()
	var got := []
	s.edited.connect(func(f: Dictionary) -> void: got.append(f))
	s.show_feed({"enabled": true, "protocol": "sacn", "universe": 300, "priority": 150})
	t.eq([s._on.button_pressed, s._proto.selected, s._uni.value, s._prio.value], [true, 1, 300.0, 150.0], "fields ← project")
	t.eq([s._prio.visible, s._addr.visible], [true, false], "priority shown for sACN, first channel only for compact")
	t.eq(got.size(), 0, "showing never emits")
	s._on.button_pressed = false
	t.eq(got.size(), 1, "toggle emits")
	t.eq(got[0].enabled, false, "off")
	s.show_status({"enabled": false, "heads": 3})
	t.eq(s._status.text, "Off — would carry 3 heads (Auto / marker heads).", "status line")
	s.free()
