extends RefCounted
## Audio strip route / Screens buttons: the PGM screen label (web client/lib/screen-label.js rule, mv_layout.gd
## screen_label) via audio_rows.gd screen_label / screen_labels / short_label.

const AR := preload("res://features/audio/audio_rows.gd")
var t


func test_custom_label_and_fallbacks() -> void:
	var cm := {"programChannels": [1, 2, 3], "screenLabels": ["Main", "", null]}
	t.eq(AR.screen_label(cm, 1), "Main", "custom label for the first PGM screen")
	t.eq(AR.screen_label(cm, 2), "S2", "empty label falls back to S<n>")
	t.eq(AR.screen_label(cm, 3), "S3", "null label falls back to S<n>")
	t.eq(AR.screen_label(cm, 7), "7", "channel not in programChannels falls back to its number")
	t.eq(AR.screen_label({"programChannels": [4, 5]}, 5), "S2", "no screenLabels: S<n> by position")
	t.eq(AR.screen_labels(cm), {1: "Main", 2: "S2", 3: "S3"}, "labels dictionary keyed by program channel")
	t.eq(AR.short_label("Main"), "Main", "short label kept")
	t.eq(AR.short_label("Front of house"), "Front o…", "long label truncated to 8 characters with an ellipsis")
