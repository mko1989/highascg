extends RefCounted
## WO-838 — core/lock_model.gd: chord parse / format / match, the capture verdicts, prefs defaults and the ui.cfg
## round-trip (other keys survive), the custom-logo import.

const L := preload("res://core/lock_model.gd")
var t


func test_defaults() -> void:
	var d := L.defaults()
	t.eq(d.text, "LOCKED", "default text")
	t.eq(d.key, "Ctrl+Shift+L", "default chord")
	t.ok(d.enabled, "enabled by default")
	t.ok(d.bg.a > 0.0 and d.bg.a < 1.0, "semi-transparent background")
	t.eq(d.logo, "", "empty logo = the HighAsCG logo")
	t.ok(L.logo_image(d) != null, "the default logo decodes")


func test_chord_parse_format() -> void:
	var c := L.parse_chord("Ctrl+Shift+L")
	t.eq(c.keycode, KEY_L, "key")
	t.ok(c.ctrl and c.shift and not c.alt and not c.meta, "modifiers")
	t.eq(L.chord_string(c), "Ctrl+Shift+L", "round trip")
	t.eq(L.chord_string(L.parse_chord("shift+control+l")), "Ctrl+Shift+L", "case and order are free")
	t.eq(L.chord_string(L.parse_chord("alt+F12")), "Alt+F12", "function key")
	t.eq(L.parse_chord("L"), {}, "no modifier is refused")
	t.eq(L.parse_chord("Ctrl+Shift"), {}, "modifiers only")
	t.eq(L.parse_chord("Ctrl+L+K"), {}, "two keys")
	t.eq(L.parse_chord(""), {}, "empty")
	t.eq(L.parse_chord("Ctrl+NoSuchKey"), {}, "unknown key")


func test_matches_exactly() -> void:
	var c := L.parse_chord("Ctrl+Shift+L")
	t.ok(L.matches(c, KEY_L, true, true, false, false), "the chord")
	t.ok(not L.matches(c, KEY_L, true, false, false, false), "missing shift")
	t.ok(not L.matches(c, KEY_L, true, true, true, false), "an extra modifier is another chord")
	t.ok(not L.matches(c, KEY_K, true, true, false, false), "other key")
	t.ok(not L.matches({}, KEY_L, true, true, false, false), "no chord matches nothing")
	var e := InputEventKey.new()
	e.keycode = KEY_L
	e.ctrl_pressed = true
	e.shift_pressed = true
	t.ok(L.event_matches(c, e), "an InputEventKey")
	t.eq(L.chord_string(L.chord_from_event(e)), "Ctrl+Shift+L", "chord from an event")


func test_capture_verdicts() -> void:
	t.eq(L.capture_verdict(KEY_CTRL, true, false, false, false), "wait", "a modifier alone keeps recording")
	t.eq(L.capture_verdict(KEY_SHIFT, false, true, false, false), "wait", "shift alone")
	t.eq(L.capture_verdict(KEY_ESCAPE, false, false, false, false), "cancel", "plain Escape cancels")
	t.eq(L.capture_verdict(KEY_L, false, false, false, false), "reject", "a bare key is refused")
	t.eq(L.capture_verdict(KEY_ESCAPE, true, false, false, false), "ok", "Ctrl+Escape is a chord")
	t.eq(L.capture_verdict(KEY_L, true, true, false, false), "ok", "Ctrl+Shift+L")


func test_prefs_round_trip_keeps_other_keys() -> void:
	var path := "user://test_wo838_ui.cfg"
	DirAccess.remove_absolute(path)
	t.eq(L.load_prefs(path).text, "LOCKED", "nothing stored → defaults")
	var cfg := ConfigFile.new()
	cfg.set_value("window", "ui_scale", 1.5)
	cfg.save(path)
	L.save_pref("text", "ON AIR", path)
	L.save_pref("bg", Color(0.2, 0.4, 0.6, 0.8), path)
	L.save_pref("key", "Shift+Alt+K", path)
	L.save_pref("enabled", false, path)
	var p := L.load_prefs(path)
	t.eq(p.text, "ON AIR", "text")
	t.ok(p.bg.is_equal_approx(Color(0.2, 0.4, 0.6, 0.8)), "colour with alpha")
	t.eq(p.key, "Shift+Alt+K", "chord")
	t.ok(not p.enabled, "disabled")
	var after := ConfigFile.new()
	after.load(path)
	t.eq(after.get_value("window", "ui_scale"), 1.5, "another section's key survives")
	t.ok(not after.has_section_key(L.SECTION, "locked"), "the locked state is never stored")
	L.save_pref("key", "L", path)
	L.save_pref("bg", "garbage", path)
	p = L.load_prefs(path)
	t.eq(p.key, "Ctrl+Shift+L", "an invalid stored chord falls back")
	t.eq(p.bg, L.DEFAULT_BG, "an invalid stored colour falls back")
	DirAccess.remove_absolute(path)


func test_logo_import() -> void:
	var dir := "user://test_wo838_logo"
	DirAccess.make_dir_recursive_absolute(dir)
	var src := dir.path_join("pick.png")
	var img := Image.create(8, 4, false, Image.FORMAT_RGBA8)
	img.fill(Color.RED)
	img.save_png(src)
	var r := L.import_logo(src, dir)
	t.ok(r.ok, "png imported")
	t.eq(r.path, dir.path_join("lockscreen_logo.png"), "copied under the fixed name")
	t.ok(L.load_image(r.path) != null, "the copy decodes")
	t.ok(not L.import_logo(dir.path_join("nope.png"), dir).ok, "a missing file is refused")
	t.ok(not L.import_logo(dir.path_join("x.gif"), dir).ok, "an unsupported type is refused")
	var tex := L.fit_texture(img, 40, 600)
	t.eq(tex.get_height(), 40, "resampled height")
	t.eq(tex.get_width(), 80, "aspect kept")
	t.eq(L.fit_texture(img, 40, 50).get_width(), 50, "max width wins")
	L.clear_logos(dir)
	t.ok(not FileAccess.file_exists(r.path), "reset removes the copy")
	DirAccess.remove_absolute(src)
	DirAccess.remove_absolute(dir)
