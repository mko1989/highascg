extends RefCounted
## WO-1012 stage E — zoom_model.gd: API replies → labels, options, POST bodies.

const M := preload("res://features/devices/zoom_model.gd")
var t

const Z := {"ok": true, "installed": true, "running": true,
	"windows": [{"id": "0x1", "title": "Zoom Meeting", "width": 1920, "height": 1080}, {"id": "0x2", "title": "", "width": 640, "height": 360}],
	"sources": {"gallery": {"window": "0x9", "title": "Old", "hidden": true, "size": "1280x720", "grabbing": true, "published": 50, "error": ""},
		"presenter": {"window": null, "grabbing": false, "published": 0, "error": ""}}}


func test_status_line() -> void:
	t.eq(M.status_line(Z), "Zoom is running · 2 windows")
	t.eq(M.status_line({"installed": true, "running": false}), "Zoom is not running")
	t.eq(M.status_line({"installed": false}), "Zoom is not installed")
	t.eq(M.status_line({"installed": true, "running": true, "windows": [{}]}), "Zoom is running · 1 window")
	t.eq(M.status_line({}), "Zoom: no answer from the server")


func test_window_options() -> void:
	var o := M.window_options(Z)
	t.eq(o[0], ["", "Off"])
	t.eq(o[1], ["0x1", "Zoom Meeting · 1920×1080"])
	t.eq(o[2], ["0x2", "0x2 · 640×360"])


func test_gone_window_stays_listed() -> void:
	var o := M.window_options_for(Z, "gallery")
	t.eq(o.size(), 4)
	t.eq(o[3], ["0x9", "Old (gone)"])
	t.eq(M.window_options_for(Z, "presenter").size(), 3)


func test_live() -> void:
	var g: Dictionary = Z.sources.gallery
	t.ok(M.live(g, 40))
	t.ok(not M.live(g, 50))
	t.ok(not M.live(g, -1))
	t.eq(M.live_text(g, 40), "live")
	t.eq(M.live_text(g, 50), "no picture")
	t.eq(M.live_text(g, -1), "checking…")
	t.eq(M.live_text({"error": "x"}, 1), "no picture · x")
	t.eq(M.live_text(Z.sources.presenter, 0), "no picture")


func test_bodies() -> void:
	t.eq(M.source_body("share", "window", ""), {"source": "share", "window": null})
	t.eq(M.source_body("share", "window", "0x1"), {"source": "share", "window": "0x1"})
	t.eq(M.source_body("gallery", "hidden", true), {"source": "gallery", "hidden": true})
	t.eq(M.source_body("gallery", "size", "1280x720"), {"source": "gallery", "size": "1280x720"})
	t.eq(M.host_body("share", true), {"source": "share", "enabled": true})
	t.eq(M.launch_body("  "), {})
	t.eq(M.launch_body(" 123 "), {"url": "123"})
	t.eq(M.audio_body("enabled", true), {"enabled": true})
	t.eq(M.audio_body("feed", "pgm"), {"feed": "pgm"})


func test_availability() -> void:
	t.ok(M.available({"ok": true, "data": {}}))
	t.ok(not M.available({"ok": false, "status": 404, "data": {}}))
	t.eq(M.body({"ok": false, "data": {"a": 1}}), {})


func test_host() -> void:
	var h := {"needsRestart": true, "entries": [{"source": "share", "route": "route://7-10", "configured": true, "live": false},
		{"source": "gallery", "route": "route://7-11", "configured": true, "live": true}]}
	t.eq(M.host_text(h, "share"), "route://7-10 · needs Apply & restart")
	t.eq(M.host_text(h, "gallery"), "route://7-11")
	t.eq(M.host_text(h, "presenter"), "")
	t.ok(M.host_needs_restart(h))
	# WO-1012 B2: layers on an existing channel — not live without a pending restart is just "not playing".
	var b2 := {"needsRestart": false, "entries": [{"source": "share", "route": "route://5-22", "configured": true, "live": false},
		{"source": "gallery", "route": "route://5-23", "configured": true, "live": true},
		{"source": "presenter", "route": null, "configured": true, "live": false}]}
	t.eq(M.host_text(b2, "share"), "route://5-22 · not playing")
	t.eq(M.host_text(b2, "gallery"), "route://5-23")
	t.eq(M.host_text(b2, "presenter"), "no input channel yet · not playing")
	t.ok(not M.host_needs_restart(b2))


func test_audio_view() -> void:
	var v := M.audio_view({"available": true, "enabled": true, "out": {"feed": "pgm"}, "feeds": [{"id": "pgm", "label": "Program"}], "note": "n", "error": ""})
	t.eq(v.feeds, [["pgm", "Program"]])
	t.eq(v.feed, "pgm")
	t.eq(v.note, "n")
	t.eq(M.audio_view({"error": "boom"}).note, "boom")


func test_ui_status() -> void:
	t.eq(M.ui_status({"inMeeting": true, "sharing": []}), "In the meeting")
	t.eq(M.ui_status({"waiting": true}), "In the waiting room")
	t.eq(M.ui_status({"preview": "Join"}), "Join preview open")
	t.eq(M.ui_status({}), "Not in a meeting")
	t.eq(M.ui_status({"inMeeting": true, "sharing": ["ZOOM"]}), "In the meeting · ZOOM is sharing")
	t.ok(M.join_visible({"preview": "Join"}))
	t.ok(not M.join_visible({"preview": ""}))


func test_toggles() -> void:
	t.eq(M.toggle_view({"muted": false, "video": true}, "mic"), {"enabled": true, "pressed": true})
	t.eq(M.toggle_view({"muted": true, "video": false}, "mic"), {"enabled": true, "pressed": false})
	t.eq(M.toggle_view({"muted": true, "video": false}, "cam"), {"enabled": true, "pressed": false})
	t.eq(M.toggle_view({"muted": null, "video": null}, "cam"), {"enabled": false, "pressed": false})
	t.eq(M.toggle_view({}, "mic").enabled, false)
	t.eq(M.toggle_body("mic", true), {"action": "unmute"})
	t.eq(M.toggle_body("mic", false), {"action": "mute"})
	t.eq(M.toggle_body("cam", true), {"action": "video_on"})
	t.eq(M.toggle_body("cam", false), {"action": "video_off"})


func test_main_window() -> void:
	var sp := {"tabs": [{"name": "Meeting", "checked": true}, {"name": "ZOOM's screen", "checked": false}]}
	var sh := {"tabs": [{"name": "Meeting", "checked": false}, {"name": "ZOOM's screen", "checked": true}]}
	t.eq(M.main_window(sp), "speaker")
	t.eq(M.main_window(sh), "share")
	t.eq(M.main_window({}), "")
	t.ok(M.share_tab_exists(sp))
	t.ok(not M.share_tab_exists({"tabs": [{"name": "Meeting", "checked": true}]}))
	t.eq(M.main_window_body("share"), {"action": "share_tab"})
	t.eq(M.main_window_body("speaker"), {"action": "meeting_tab"})


func test_meeting_bodies() -> void:
	t.eq(M.join_body(), {"action": "join"})
	t.eq(M.participants_body(), {"action": "participants"})
	t.eq(M.settings_body(), {"action": "settings"})
	t.eq(M.pin_body("Ann"), {"action": "pin", "name": "Ann"})
	t.eq(M.pin_body(""), {"action": "pin", "name": ""})
	t.eq(M.source_body("share", "fit", true), {"source": "share", "fit": true})


func test_settings_line() -> void:
	t.eq(M.settings_line({}), "")
	t.eq(M.settings_line({"running": true}), "Applying… Zoom's Settings window is open for about half a minute")
	t.eq(M.settings_line({"error": "x"}), "Not applied: x")
	t.eq(M.settings_line({"changed": [{}, {}, {}], "alreadyRight": 14, "failed": [], "missing": []}), "3 changed, 14 already right")
	t.eq(M.settings_line({"changed": [], "alreadyRight": 2, "failed": [{"setting": "a"}], "missing": [{"setting": "b"}]}), "0 changed, 2 already right · not found: a, b")
	t.eq(M.settings_line({"changed": [], "alreadyRight": 0, "failed": [{"setting": "a"}, {"setting": "b"}], "missing": [{"setting": "c"}, {"setting": "d"}, {"setting": "e"}]}), "0 changed, 0 already right · not found: a, b, c, +2")


func test_pin_rows() -> void:
	var rows := M.pin_rows({"participants": [{"name": "Me", "me": true, "host": false}, {"name": "Ann", "host": true}, {"name": "Bo"}]})
	t.eq(rows.size(), 3)
	t.eq(rows[0], {"name": "Me", "label": "Me (me)", "pin": false})
	t.eq(rows[1], {"name": "Ann", "label": "Ann (host)", "pin": true})
	t.eq(rows[2], {"name": "Bo", "label": "Bo", "pin": true})
	t.eq(M.pin_rows({}), [])


## WO-1012 B2: a Zoom input is a hidden layer (OPACITY 0) on an input channel, so that channel's print shows the input
## under it — the Live tab shows no thumbnail for it rather than the wrong picture.
func test_zoom_input_has_no_channel_thumbnail() -> void:
	var L := preload("res://features/live/live_sources_model.gd")
	t.eq(L.thumb_channel({"routeType": "zoom_host", "value": "route://5-23", "thumbnailChannel": 5}), null)
	t.eq(L.thumb_channel({"routeType": "decklink", "value": "route://5-1"}), 5, "the DeckLink input keeps its thumbnail")
