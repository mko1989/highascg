extends RefCounted
## A look card's right-click menu and its dialogs (split out of deck_view.gd for the 500-line limit, WO-1029).
## `deck` = deck_view.gd (rename_look / set_look_transition / delete_look / store_fixtures and its signals).

const T := preload("res://features/live/transitions.gd")
const LFS := preload("res://features/previs/fixtures/look_fixtures_store.gd")
const TransitionRow := preload("res://features/live/transition_row.gd")
const DeckModel := preload("res://features/live/deck_model.gd")


static func prompt_rename(deck: Node, scene_id: String) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = "Rename look"
	var edit := LineEdit.new()
	edit.custom_minimum_size.x = 320
	for s in (Store.project.get("scenes", {}) as Dictionary).get("scenes", []):
		if str(s.get("id", "")) == scene_id:
			edit.text = str(s.get("name", ""))
	dlg.add_child(edit)
	dlg.confirmed.connect(func() -> void:
		deck.rename_look(scene_id, edit.text)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	deck.add_child(dlg)
	dlg.popup_centered()
	edit.grab_focus()
	edit.select_all()


## Right-click on a look: Rename… · Transition… · Use default transition · Edit · fixtures (WO-615 T8) · Delete.
static func open(deck: Node, scene_id: String, main: int) -> void:
	var pm := PopupMenu.new()
	pm.add_item("Rename…", 0)
	pm.add_item("Transition…", 1)
	pm.add_item("Use default transition", 2)
	pm.add_separator()
	pm.add_item("Edit look…", 3)
	pm.add_separator()
	pm.add_item("Store fixtures from programmer", 5)
	var n := LFS.count(scene_id)
	if n > 0:
		pm.add_item("Recall fixtures (%d)" % n, 6)
		pm.add_item("Clear fixtures", 7)
	pm.add_separator()
	pm.add_item("Delete look…", 4)
	pm.id_pressed.connect(func(id: int) -> void: on_pick(deck, id, scene_id, main))
	pm.popup_hide.connect(pm.queue_free)
	popup_at_mouse(deck, pm)


## Embedded popups are placed in window coordinates (adding the window position pushed it off DP-3's right edge).
static func popup_at_mouse(deck: Node, pm: PopupMenu) -> void:
	deck.add_child(pm)
	var at := Vector2i(deck.get_viewport().get_mouse_position())
	if not deck.get_viewport().gui_embed_subwindows:
		at += deck.get_window().position
	pm.popup(Rect2i(at, Vector2i.ZERO))


static func on_pick(deck: Node, id: int, scene_id: String, main: int) -> void:
	if id == 0:
		prompt_rename(deck, scene_id)
	elif id == 1:
		prompt_transition(deck, scene_id, main)
	elif id == 3:
		deck.edit_requested.emit(scene_id, main)
	elif id == 4:
		confirm_delete(deck, scene_id)
	elif id == 2:
		deck.set_look_transition(scene_id, deck._scenes_root().get("globalDefaultTransition", T.default_transition()))
	elif id == 5:
		deck.store_fixtures(scene_id)
	elif id == 6:
		var r: Dictionary = await LFS.recall(scene_id)
		deck.action_result.emit(r.msg, r.ok)
	elif id == 7:
		var r: Dictionary = LFS.clear(scene_id)
		deck.action_result.emit(r.msg, r.ok)


static func confirm_delete(deck: Node, scene_id: String) -> void:
	var name := ""
	for s in deck._scenes_root().get("scenes", []):
		if s is Dictionary and str(s.get("id", "")) == scene_id:
			name = str(s.get("name", ""))
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = "Delete look \"%s\"?" % name  # web confirm(`Delete look "${sc.name}"?`)
	dlg.confirmed.connect(func() -> void:
		deck.delete_look(scene_id)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	deck.add_child(dlg)
	dlg.popup_centered()


static func prompt_transition(deck: Node, scene_id: String, main: int) -> void:
	var cur: Variant = null
	for s in deck._scenes_root().get("scenes", []):
		if str(s.get("id", "")) == scene_id:
			cur = s.get("defaultTransition")
	var dlg := AcceptDialog.new()
	dlg.title = "Look transition"
	var row := TransitionRow.new()
	var pgm_only := not DeckModel.preview_bus_available(deck._cm(), main)
	row.setup(cur if cur is Dictionary else T.default_transition(deck._fps(main)), pgm_only)
	row.changed.connect(func(tr: Dictionary) -> void: deck.set_look_transition(scene_id, tr))
	dlg.add_child(row)
	dlg.confirmed.connect(dlg.queue_free)
	dlg.canceled.connect(dlg.queue_free)
	deck.add_child(dlg)
	dlg.popup_centered()
