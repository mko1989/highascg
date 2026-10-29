extends RefCounted
## WO-806 G5 — the Audio tab's dense strips (web WO-227: > 4 strips per group → narrow strips + horizontal scroll).
## The 64 px minimum used to be dead: meter + 20 px scale labels + fader cap + 8 px panel padding held every strip at
## 86 px. Dense now draws the scale marks without labels, S / M, font 10 and 3 px side padding. Measured on real strips.

const Strip := preload("res://features/audio/audio_strip.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const ROWS := [
	{"label": "L10 KV LOOP projekcja", "v": 0.5},
	{"label": "DeckLink 1", "v": 1.0, "isLiveInput": true, "liveAudioSlot": 1, "audioSend": "afv"},
	{"label": "Song", "v": 1.0, "isAudioOnlyLook": true},
]
var t


func _width(r: Dictionary, dense: bool, host: Control) -> float:
	var s := Strip.new()
	host.add_child(s)
	s.setup(r, 2, dense, [1, 3], {})
	return s.get_combined_minimum_size().x


func test_dense_strips_are_really_narrower() -> void:
	var host := Control.new()
	host.theme = ThemeBuilder.build()
	t.root.add_child(host)
	for r in ROWS:
		var normal := _width(r, false, host)
		var dense := _width(r, true, host)
		t.ok(dense < normal, "%s: dense %d < normal %d" % [r.label, dense, normal])
		t.ok(dense <= 64.0, "%s: dense %d ≤ 64 px (its custom minimum, not the content)" % [r.label, dense])
	host.queue_free()


func test_dense_strip_labels() -> void:
	var host := Control.new()
	host.theme = ThemeBuilder.build()
	t.root.add_child(host)
	var s := Strip.new()
	host.add_child(s)
	s.setup(ROWS[0], 2, true, [], {})
	t.eq([s._solo.text, s._mute.text], ["S", "M"], "S / M as on the web dock")
	t.eq(s._solo.tooltip_text.begins_with("Solo"), true, "the tooltip keeps the full word")
	var m := Strip.new()
	host.add_child(m)
	m.setup({"label": "PGM 1", "v": 1.0, "isMaster": true}, 2, true, [], {})
	t.eq(m._solo.text, "SOLO", "masters never go dense")
	host.queue_free()
