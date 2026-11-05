extends RefCounted
## WO-953 — screens hidden from this client's deck: persisted in the ui config, "Show all" brings every column back.
## WO-959: a hidden screen keeps its look-preset destination highlight (the toolbar's "Screens" still selects it).

const H := preload("res://features/live/deck_hidden.gd")
const Destinations := preload("res://features/live/destinations.gd")
const CFG := "user://test_deck_hidden.cfg"
var t


func test_hide_show_persist() -> void:
	var was: String = H.cfg_path
	H.cfg_path = CFG
	DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
	H.reset()
	t.eq(H.visible_mains(3), [0, 1, 2], "nothing hidden by default")
	Destinations.set_only([1, 2])
	H.set_hidden(1, true)
	t.eq(H.visible_mains(3), [0, 2], "screen 2's column hidden")
	t.eq(Destinations.selected(), [1, 2], "WO-959: a hidden screen stays a highlighted destination")
	H.reset()
	t.eq(H.hidden(), [1], "read back from the config")
	H.set_hidden(0, true)
	H.set_hidden(2, true)
	t.eq(H.visible_mains(3), [], "every column hidden")
	var note := H.note(3)
	t.ok(note.text.contains("All 3 screens"), "the deck says so instead of going blank")
	note.free()
	H.show_all()
	t.eq(H.visible_mains(3), [0, 1, 2], "Show all")
	H.reset()
	t.eq(H.hidden(), [], "and that is saved too")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
	Destinations.set_only([])
	H.cfg_path = was
	H.reset()
