extends RefCounted
## WO-628 — operator dock gating, geometry and icon decoding.

const D := preload("res://app/operator_dock_model.gd")
var t


func test_wanted_only_on_the_box() -> void:
	t.eq(D.wanted("http://127.0.0.1:4200", {}), true, "loopback")
	t.eq(D.wanted("http://localhost:4200/", {}), true, "localhost")
	t.eq(D.wanted("http://192.168.1.20:4200", {}), false, "remote client: apps would open on the box's screen")
	t.eq(D.wanted("http://192.168.1.20:4200", {"dock": "1"}), true, "--dock=1 forces")
	t.eq(D.wanted("http://127.0.0.1:4200", {"dock": "0"}), false, "--dock=0 turns it off")


func test_geometry() -> void:
	var sz := D.expanded_size(7, 1)
	t.eq(sz, Vector2i(6 * 2 + 7 * 52 + 9 + 7 * 4, 6 * 2 + 52), "7 buttons + one separator, 7 gaps between the 8 children")
	t.eq(D.place(Rect2i(1920, 0, 1920, 1080), sz), Rect2i(1920 + (1920 - sz.x) / 2, 1080 - sz.y, sz.x, sz.y), "bottom centre of screen 0 at X+1920")
	t.eq(D.place(Rect2i(0, 0, 1920, 1050), D.HANDLE), Rect2i(880, 1046, 160, 4), "collapsed handle above a 30 px panel")
	t.eq(D.REVEAL_S > 0.2, true, "revealing needs a rest on the line, not a sweep past it")


func test_menu_rect() -> void:
	var usable := Rect2i(1920, 0, 1920, 1080)
	var dock := Rect2i(2700, 1016, 400, 64)
	t.eq(D.menu_rect(dock, 500, usable), Rect2i(3100 - 300, 1016 - 512 - 4, 300, 512), "right-aligned, just above the dock")
	t.eq(D.menu_rect(dock, 0, usable).size.y, 12 + 34, "empty: one row high")
	t.eq(D.menu_rect(dock, 5000, usable).position.y >= 0, true, "a long list is capped to the screen (it scrolls)")
	t.eq(D.menu_rect(Rect2i(1930, 1016, 100, 64), 100, usable).position.x, 1920, "never left of the screen")


func test_icons() -> void:
	t.eq(D.icon_path("app:org.gnome.FileRoller"), "/api/system/operator-helper-icon?action=app%3Aorg.gnome.FileRoller", "encoded")
	t.eq(D.decode_icon(PackedByteArray(), 44), null, "empty")
	var svg := '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#fff"/></svg>'.to_utf8_buffer()
	t.eq(D.decode_icon(svg, 44).get_size(), Vector2i(44, 44), "svg → 44 px")
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	t.eq(D.decode_icon(img.save_png_to_buffer(), 44).get_size(), Vector2i(44, 44), "png → 44 px")
	t.eq(D.decode_icon("not an image".to_utf8_buffer(), 44), null, "junk")


func test_running_set() -> void:
	t.eq(D.running_set(null), {"highascg": true}, "self always running")
	t.eq(D.running_set({"running": ["firefox", "file-manager"]}), {"highascg": true, "firefox": true, "file-manager": true}, "pinned")
	t.eq(D.running_set({"running": "junk"}), {"highascg": true}, "bad shape")
