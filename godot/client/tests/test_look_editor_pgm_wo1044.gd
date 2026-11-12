extends RefCounted
## WO-1044 — the look editor's per-screen PGM edit lock: locked by default; unlocked, only the look that IS on that
## screen's PGM is edited on air; the lock is per screen.

const Pgm := preload("res://features/live/look_editor_pgm.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
var t


func test_rule_only_the_look_on_air_and_only_unlocked() -> void:
	t.ok(Pgm.goes_to_pgm("L1", true, "L1"), "unlocked + the look on PGM → air")
	t.ok(not Pgm.goes_to_pgm("L1", false, "L1"), "locked → PRV")
	t.ok(not Pgm.goes_to_pgm("L2", true, "L1"), "another look on PGM → PRV")
	t.ok(not Pgm.goes_to_pgm("", true, ""), "nothing on PGM, no look → PRV")


func test_lock_is_per_screen_and_locked_by_default() -> void:
	t.ok(not Pgm.is_unlocked(0) and not Pgm.is_unlocked(3), "every screen starts locked")
	Pgm.set_unlocked(1, true)
	t.ok(Pgm.is_unlocked(1) and not Pgm.is_unlocked(0), "unlocking screen 2 leaves screen 1 locked")
	var b := Button.new()
	b.toggle_mode = true  # as look_editor.gd's _lock
	Pgm.style_button(b, 1, true)
	t.eq(b.text, "PGM unlocked")
	t.ok(b.button_pressed and b.get_theme_color("font_color") == ThemeBuilder.ERROR, "pressed and red while unlocked")
	Pgm.style_button(b, 1, false)
	t.ok(b.tooltip_text.contains("not on PGM"), "unlocked on a look that is not on air says its edits still go to PRV")
	Pgm.set_unlocked(1, false)
	Pgm.style_button(b, 1, true)
	t.eq(b.text, "PGM locked")
	t.ok(not b.button_pressed and not b.has_theme_color_override("font_color"), "locked: plain")
	b.free()
	t.ok(not Pgm.live("L1", 1), "locked → never live, whatever is on air")
