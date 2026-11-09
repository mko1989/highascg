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


func test_audio_view() -> void:
	var v := M.audio_view({"available": true, "enabled": true, "out": {"feed": "pgm"}, "feeds": [{"id": "pgm", "label": "Program"}], "note": "n", "error": ""})
	t.eq(v.feeds, [["pgm", "Program"]])
	t.eq(v.feed, "pgm")
	t.eq(v.note, "n")
	t.eq(M.audio_view({"error": "boom"}).note, "boom")
