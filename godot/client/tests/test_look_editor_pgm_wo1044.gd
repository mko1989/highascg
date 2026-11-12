extends RefCounted
## WO-1044 — "PGM edit" (deck column, between FTB and the timer) opens the look editor on the look on PGM; its edits go to
## air only in that session and only while the look is still the one on that PGM.

const Pgm := preload("res://features/live/look_editor_pgm.gd")
var t


func test_rule_only_in_a_pgm_session_and_only_the_look_on_air() -> void:
	t.ok(Pgm.goes_to_pgm("L1", true, "L1"), "PGM edit session + the look on PGM → air")
	t.ok(not Pgm.goes_to_pgm("L1", false, "L1"), "the editor opened from a card (no session) → PRV")
	t.ok(not Pgm.goes_to_pgm("L1", true, "L2"), "another look taken meanwhile → PRV")
	t.ok(not Pgm.goes_to_pgm("", true, ""), "nothing on PGM → PRV")


func test_button_sits_between_ftb_and_timer() -> void:
	var src := FileAccess.get_file_as_string("res://features/live/deck_head.gd")
	var ftb := src.find("head_row.add_child(ftb)")
	var pe := src.find("head_row.add_child(pe)")
	var tmr := src.find("head_row.add_child(tmr)")
	t.ok(ftb > 0 and ftb < pe and pe < tmr, "FTB · PGM edit · timer")
	t.ok(src.contains("deck.pgm_edit_requested.emit(str(bus.pgm), main)"), "opens the look on that column's PGM")
	t.ok(FileAccess.get_file_as_string("res://features/live/live_tab.gd").contains("editor.open(id, m, true)"), "in a PGM session")
