extends RefCounted
## WO-919 — F2 (Server ▾ compares the running Caspar with the LOADED project's layout) and F26 (the OS layout
## watchdog's give-up reaches the Devices toolbar).

const Badges := preload("res://app/header_badges_model.gd")
const Follow := preload("res://features/devices/devices_follow_model.gd")
var t


func test_config_strip_reports_a_same_count_mismatch() -> void:
	# project-expected channels (config-compare.js) vs the running ones: same count, one mode and one screen differ
	var c := {"aligned": false, "serverChannelCount": 2, "moduleChannelCount": 2, "screensCountMismatch": true,
		"issues": ["Ch 1: server \"1080p5000\" ≠ project \"3840x1792\"", "Ch 2: Caspar screen output is off, the project expects on"],
		"serverChannels": [{"index": 1, "videoMode": "1080p5000", "hasScreen": false}, {"index": 2, "videoMode": "1080p5000", "hasScreen": false}],
		"moduleChannels": [{"index": 1, "role": "Channel 1", "videoMode": "3840x1792", "hasScreen": false}, {"index": 2, "role": "Channel 2", "videoMode": "1080p5000", "hasScreen": true}]}
	var s := Badges.config_strip(c)
	t.eq(s.ok, false, "a mismatch is not ok")
	t.eq(s.summary, "Mismatch: the running server differs from the loaded project (2 differences).", "same count -> says what differs")
	t.eq(s.rows, [["1", "Channel 1: 3840x1792", "1080p5000"], ["2", "Channel 2: 1080p5000 (screen)", "1080p5000"]], "the project's screen outputs show in the expects column")
	var one := c.duplicate(true)
	one.issues = ["x"]
	t.eq(Badges.config_strip(one).summary, "Mismatch: the running server differs from the loaded project (1 difference).", "singular")
	var al := c.duplicate(true)
	al.aligned = true
	t.eq(Badges.config_strip(al).ok, true, "aligned stays ok")


func test_os_layout_warning() -> void:
	t.eq(Follow.os_layout_warning(null), "", "no issue in the state")
	t.eq(Follow.os_layout_warning({"ok": true, "at": 1}), "", "cleared by an Apply")
	var w := Follow.os_layout_warning({"ok": false, "attempts": 12, "mismatches": [
		{"sysId": "DP-6", "field": "x", "expected": "0", "actual": "1920"},
		{"sysId": "DP-0", "field": "resolution", "expected": "3840x1728", "actual": "1920x1080"},
		{"sysId": "DP-2", "field": "connected", "expected": "connected", "actual": ""}]})
	t.ok(w.begins_with("Display layout is still wrong after the restart (DP-6 x: want 0, has 1920; DP-0 resolution: want 3840x1728, has 1920x1080; +1 more)"), "first two mismatches + the rest counted")
	t.ok(w.ends_with("press Apply Caspar config to re-apply it."), "says what to do")
	t.eq(Follow.os_layout_warning({"ok": false}), "Display layout is still wrong after the restart - press Apply Caspar config to re-apply it.", "no mismatch list")
	var src := FileAccess.get_file_as_string("res://features/devices/devices_follow.gd")
	t.ok(src.contains("Store.get_value(\"osLayout\")") and src.contains("p == \"osLayout\""), "the follow node reads state.osLayout and listens for its change")
