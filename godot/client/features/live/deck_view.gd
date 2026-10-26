extends ScrollContainer
## WO-600 step 1 — looks deck, read-only: one column per main (client/components/scene-list.js),
## cards highlighted red = on PGM, green = on PRV, dashed accent = global look ('all').
## Rebuilds on project / scene / channelMap changes (coalesced to one rebuild per frame).

const DeckModel := preload("res://features/live/deck_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const T := preload("res://features/live/transitions.gd")
const E := preload("res://features/live/look_edits.gd")
const Reorder := preload("res://features/live/deck_reorder.gd")
const TimerView := preload("res://features/live/pgm_timer_view.gd")
const Icons := preload("res://app/ui_icons.gd")
const TransitionRow := preload("res://features/live/transition_row.gd")
const LookThumb := preload("res://features/live/look_thumb.gd")
const LFS := preload("res://features/previs/fixtures/look_fixtures_store.gd")
const BlankClear := preload("res://features/live/deck_blank_clear.gd")
const DeckHead := preload("res://features/live/deck_head.gd")
const Destinations := preload("res://features/live/destinations.gd")
const CARD_W := 200

signal action_result(text: String, ok: bool)
signal edit_requested(scene_id: String, main: int)
signal timers_requested(main: int, label: String)  # WO-601: web per-screen ⏱ → screen-timer inspector
signal border_requested(main: int, label: String)  # WO-601: global border inspector
signal look_deleted(scene_id: String)  # WO-623 B: the live tab closes the editor if it shows this look

var _columns: HBoxContainer
var _dirty := true
var _main_for_card := 0
var _press_id := ""  # the card a left press landed on (WO-762: PRV on release, not on a drag)
var osc_mirror: Node  # WO-600 O: set by the live tab before the first rebuild
var show_looks := true:  # WO-781: deck toolbar "Looks" — the columns keep their header, timer and blank space
	set(v):
		show_looks = v
		_dirty = true


func _ready() -> void:
	horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	_columns = HBoxContainer.new()
	_columns.add_theme_constant_override("separation", 12)
	_columns.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_columns.size_flags_vertical = Control.SIZE_EXPAND_FILL  # columns reach the bottom: all of it is drop space
	add_child(_columns)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _dirty = true)
	Store.changed.connect(_on_store_changed)


func _on_store_changed(path: String, _v: Variant) -> void:
	if path == "*" or path.begins_with("scene") or path == "channelMap" or path == Destinations.PATH:
		_dirty = true


func _process(_delta: float) -> void:
	if _dirty:
		_dirty = false
		rebuild()


func rebuild() -> void:
	for c in _columns.get_children():
		c.queue_free()
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var live: Dictionary = Store.get_value("scene.live", {}) if Store.get_value("scene.live") is Dictionary else {}
	var ps: Dictionary = Store.project.get("scenes", {}) if Store.project.get("scenes") is Dictionary else {}
	var scenes: Array = ps.get("scenes", [])
	var known := {}
	for s in scenes:
		if s is Dictionary:
			known[str((s as Dictionary).get("id", ""))] = true
	Destinations.prune(DeckModel.screen_count(cm))
	for main in DeckModel.screen_count(cm):
		_main_for_card = main
		var bus := DeckModel.resolve_bus_look_ids(main, live, cm, known, ps)
		if main > 0:  # a line between screens: their cards would otherwise run together
			_columns.add_child(ThemeBuilder.vline())
		_columns.add_child(_column(DeckModel.screen_label(cm, main), DeckModel.scenes_for_main(scenes, main), bus, main, cm))


func _column(title: String, looks: Array, bus: Dictionary, main: int, cm: Dictionary) -> Control:
	var col := VBoxContainer.new()
	col.custom_minimum_size.x = 240
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 8)
	col.mouse_filter = Control.MOUSE_FILTER_PASS
	col.set_drag_forwarding(Callable(), _can_drop_new.bind(main), _drop_new.bind(main))  # WO-623 B: blank deck space
	var head_row := DeckHead.build(self, title, looks.size(), bus, main, cm)  # WO-781: title = destination toggle
	col.add_child(head_row)
	var timer := TimerView.new()
	timer.setup(osc_mirror, main)
	col.add_child(timer)
	var grid := HFlowContainer.new()  # web .scenes-deck: auto-fill grid of thumbnail cards, 12 px gap
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	grid.mouse_filter = Control.MOUSE_FILTER_PASS
	grid.set_drag_forwarding(Callable(), _can_drop_new.bind(main), _drop_new.bind(main))
	col.add_child(grid)
	grid.visible = show_looks
	for s in (looks if show_looks else []):
		grid.add_child(_card(s, bus))
	grid.add_child(_add_tile(main))
	BlankClear.wire(col, main, cm, action_result.emit)
	return col


## WO-623 B — web .scenes-deck__add-look: "+" makes an empty look on this screen and opens it; a source dropped on
## it (or anywhere on the column's blank space) becomes the new look's first layer.
func _add_tile(main: int) -> Control:
	var b := Button.new()
	b.text = "+"
	b.add_theme_font_size_override("font_size", 32)
	b.custom_minimum_size = Vector2(CARD_W, CARD_W * 9.0 / 16.0)
	b.focus_mode = Control.FOCUS_NONE
	b.tooltip_text = "New look — or drop a media file here / on empty deck space"
	b.pressed.connect(func() -> void: create_look(main, null))
	b.set_drag_forwarding(Callable(), _can_drop_new.bind(main), _drop_new.bind(main))
	return b


## Same sources the look editor takes (web isDraggableLayerSourcePayload: never an effect); timers never make a look.
func _can_drop_new(_at: Vector2, data: Variant, main: int) -> bool:
	if Reorder.is_reorder(data, main):  # WO-762: a card dropped on blank space / "+" moves to the end
		return true
	if not (data is Dictionary) or str((data as Dictionary).get("value", "")) == "":
		return false
	return not (str((data as Dictionary).get("type", "")) in ["effect", "timer"])


func _drop_new(_at: Vector2, data: Variant, main: int) -> void:
	if Reorder.is_reorder(data, main):
		Reorder.to_end(data, _scenes_root, _commit_looks)
		return
	create_look(main, data)


## The server builds the look (POST /api/scene/new-look — web addScene + the drop's first layer); the deck appends it,
## syncs, and opens it in the editor, which stages it on PRV like the web's setEditingScene + preview push.
func create_look(main: int, src: Variant) -> String:
	var body := {"mainIdx": main, "mainScope": "0" if DeckModel.screen_count(_cm()) < 2 else str(main)}
	if src is Dictionary:
		body["source"] = src
	var res: Dictionary = await Api.post_json("/api/scene/new-look", body)
	if not res.ok or not (res.data is Dictionary) or not ((res.data as Dictionary).get("look") is Dictionary):
		action_result.emit("New look refused: %s" % res.error, false)
		return ""
	var lk: Dictionary = res.data.look
	var root := _scenes_root()
	if not (root.get("scenes") is Array):
		root["scenes"] = []
	(root.scenes as Array).append(lk)
	_commit_looks()
	action_result.emit("New look: %s" % str(lk.get("name", "")), true)
	edit_requested.emit(str(lk.id), main)
	return str(lk.id)


func _card(scene: Dictionary, bus: Dictionary) -> Control:
	var id := str(scene.get("id", ""))
	var on_pgm: bool = id != "" and id == bus.pgm
	var on_prv: bool = id != "" and id == bus.prv
	var border := ThemeBuilder.BORDER
	if on_pgm:
		border = ThemeBuilder.ACCENT_RED
	elif on_prv:
		border = ThemeBuilder.ACCENT_GREEN
	elif str(scene.get("mainScope", "")) == "all":
		border = ThemeBuilder.ACCENT
	var card := PanelContainer.new()
	card.custom_minimum_size.x = CARD_W
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, border, 3 if (on_pgm or on_prv) else 1))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.tooltip_text = "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename / transition"
	card.gui_input.connect(_on_card_input.bind(id, _main_for_card))
	Reorder.wire(card, id, _main_for_card, str(scene.get("name", "")), _scenes_root, _commit_looks)  # WO-762
	var v := VBoxContainer.new()
	card.add_child(v)
	var thumb := LookThumb.new()  # WO-608 R5: looks show as thumbnails
	thumb.setup(scene, _res(_main_for_card), _cm())
	v.add_child(thumb)
	var name_l := Label.new()
	name_l.text = str(scene.get("name", "(unnamed)"))
	name_l.add_theme_font_size_override("font_size", 15)
	name_l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_l.custom_minimum_size.x = 1  # let a long name ellipsize instead of widening the card
	name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var head := HBoxContainer.new()  # WO-656: ⧉ duplicate · ✕ delete (WO-651) right above ▶ · ⚙
	head.add_child(name_l)
	var dup := Icons.button("copy", "Duplicate look", 12)
	dup.pressed.connect(func() -> void: duplicate_look(id))
	head.add_child(dup)
	var del := Icons.button("close", "Delete look", 12)
	del.pressed.connect(func() -> void: _confirm_delete(id))
	head.add_child(del)
	v.add_child(head)
	var meta := Label.new()
	var layers: Array = scene.get("layers", [])
	var tags := PackedStringArray(["%d layers" % layers.size()])
	var tr := E.short_label(scene.get("defaultTransition"), _fps(_main_for_card))
	if tr != "":
		tags.append(tr)
	if on_pgm:
		tags.append("PGM")
	if on_prv:
		tags.append("PRV")
	meta.text = " · ".join(tags)
	meta.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	meta.add_theme_font_size_override("font_size", 12)
	meta.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	meta.custom_minimum_size.x = 1
	meta.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var foot := HBoxContainer.new()  # WO-621 N4: web .scenes-card__footer ▶ take · ⚙ edit (CUT left out)
	foot.add_child(meta)
	var main := _main_for_card
	var play := Icons.button("play", "Take live — this look to the screen (PGM)", 12)
	play.pressed.connect(func() -> void: request_take(id, main, "program"))
	foot.add_child(play)
	var cog := Icons.button("cog", "Edit look", 12)
	cog.pressed.connect(func() -> void: edit_requested.emit(id, main))
	foot.add_child(cog)
	v.add_child(foot)
	return card


## WO-606 — Shader Live's ▶ (web #shl-take clicked the deck's take): the look on `main`'s PRV → PGM.
func take_main(main := 0) -> Dictionary:
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var live: Dictionary = Store.get_value("scene.live", {}) if Store.get_value("scene.live") is Dictionary else {}
	var ps: Dictionary = Store.project.get("scenes", {}) if Store.project.get("scenes") is Dictionary else {}
	var known := {}
	for s in ps.get("scenes", []):
		if s is Dictionary:
			known[str((s as Dictionary).get("id", ""))] = true
	var bus := DeckModel.resolve_bus_look_ids(main, live, cm, known, ps)
	if str(bus.get("prv", "")) == "":
		return {"ok": false, "error": "no look on PRV"}
	return await request_take(str(bus.prv), main, "program")


## WO-598 C1: click = stage on PRV, double-click = take to PGM — server builds the payload
## (POST /api/scene/take-look); the deck re-highlights from the scene.live broadcast that follows.
func _on_card_input(event: InputEvent, scene_id: String, main: int) -> void:
	var mb := event as InputEventMouseButton
	if mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_RIGHT:
		_card_menu(scene_id, main)
		return
	if mb == null or mb.button_index != MOUSE_BUTTON_LEFT:
		return
	if mb.pressed:  # WO-762: stage on release, so dragging a card to reorder it does not put it on PRV
		_press_id = "" if mb.double_click else scene_id
		if mb.double_click:
			await request_take(scene_id, main, "program")
	elif _press_id == scene_id:
		_press_id = ""
		await request_take(scene_id, main, "preview")


func _notification(what: int) -> void:
	if what == NOTIFICATION_DRAG_BEGIN:
		_press_id = ""


func request_take(scene_id: String, main: int, target: String) -> Dictionary:
	var res: Dictionary = await Api.post_json("/api/scene/take-look", {"sceneId": scene_id, "mainIdx": main, "target": target})
	var what := "TAKE" if target == "program" else "PRV"
	var warn := DeckModel.take_warning(res.data) if res.ok else ""
	if warn != "":
		action_result.emit("%s %s" % [what, warn], false)
	elif res.ok:
		action_result.emit("%s ok" % what, true)
	else:
		action_result.emit("%s refused: %s" % [what, res.error], false)
	print("[client] take-look %s %s → %s %s" % [target, scene_id, res.status, res.error])
	return res


## Same body as the web deck (client/components/scene-list-column.js:108-110): 0.5 s at the main's fps.
func request_ftb(main: int, cm: Dictionary) -> Dictionary:
	var res_list: Array = cm.get("programResolutions", [])
	var fps := 50.0
	if main < res_list.size() and res_list[main] is Dictionary:
		fps = float((res_list[main] as Dictionary).get("fps", 50))
	var res: Dictionary = await Api.post_json("/api/ftb", {"screenIdx": main, "durationFrames": int(round(0.5 * fps)), "framerate": fps})
	action_result.emit("FTB %s" % ("ok" if res.ok else "refused: " + str(res.error)), res.ok)
	print("[client] ftb main %d → %s %s" % [main, res.status, res.error])
	return res


## First editing path (WO-598/599): rename a look in the show document, saved through ProjectSync
## (autosave/rev protocol shared with the web client). Returns false when the look is unknown.
func rename_look(scene_id: String, new_name: String) -> bool:
	var root: Variant = Store.project.get("scenes")
	if not (root is Dictionary) or new_name.strip_edges() == "":
		return false
	for s in (root as Dictionary).get("scenes", []):
		if s is Dictionary and str((s as Dictionary).get("id", "")) == scene_id:
			(s as Dictionary)["name"] = new_name.strip_edges()
			Store.project_changed.emit(Store.project)
			ProjectSync.send_deck_sync(true)  # looks change through the live deck (see project_sync.gd)
			ProjectSync.mark_dirty(true)  # then the autosave carries the rest (web flushes immediately too)
			return true
	return false


func _prompt_rename(scene_id: String) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = "Rename look"
	var edit := LineEdit.new()
	edit.custom_minimum_size.x = 320
	for s in (Store.project.get("scenes", {}) as Dictionary).get("scenes", []):
		if str(s.get("id", "")) == scene_id:
			edit.text = str(s.get("name", ""))
	dlg.add_child(edit)
	dlg.confirmed.connect(func() -> void:
		rename_look(scene_id, edit.text)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()
	edit.grab_focus()
	edit.select_all()


## Right-click on a look: Rename… · Transition… · Use default transition · Edit · fixtures (WO-615 T8) · Delete.
func _card_menu(scene_id: String, main: int) -> void:
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
	pm.id_pressed.connect(_on_card_menu.bind(scene_id, main))
	pm.popup_hide.connect(pm.queue_free)
	add_child(pm)
	var at := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:  # embedded popups are placed in window coordinates (adding the window position pushed it off DP-3's right edge)
		at += get_window().position
	pm.popup(Rect2i(at, Vector2i.ZERO))


func _on_card_menu(id: int, scene_id: String, main: int) -> void:
	if id == 0:
		_prompt_rename(scene_id)
	elif id == 1:
		_prompt_transition(scene_id, main)
	elif id == 3:
		edit_requested.emit(scene_id, main)
	elif id == 4:
		_confirm_delete(scene_id)
	elif id == 2:
		set_look_transition(scene_id, _scenes_root().get("globalDefaultTransition", T.default_transition()))
	elif id == 5:
		store_fixtures(scene_id)
	elif id == 6:
		var r: Dictionary = await LFS.recall(scene_id)
		action_result.emit(r.msg, r.ok)
	elif id == 7:
		var r: Dictionary = LFS.clear(scene_id)
		action_result.emit(r.msg, r.ok)


## WO-615 T8: the programmer → this look's fixture state (a PGM TAKE of the look crossfades the rig to it).
func store_fixtures(scene_id: String) -> void:
	var r: Dictionary = await LFS.store(scene_id)
	action_result.emit(r.msg, r.ok)


func _confirm_delete(scene_id: String) -> void:
	var name := ""
	for s in _scenes_root().get("scenes", []):
		if s is Dictionary and str(s.get("id", "")) == scene_id:
			name = str(s.get("name", ""))
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = "Delete look \"%s\"?" % name  # web confirm(`Delete look "${sc.name}"?`)
	dlg.confirmed.connect(func() -> void:
		delete_look(scene_id)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


func duplicate_look(scene_id: String) -> String:
	var dupe := E.duplicate_look(_scenes_root(), scene_id, preload("res://features/live/layer_style_row.gd")._uuid())
	if dupe.is_empty():
		return ""
	_commit_looks()
	action_result.emit("Duplicated: %s" % str(dupe.name), true)
	return str(dupe.id)


func delete_look(scene_id: String) -> bool:
	if not E.remove_look(_scenes_root(), scene_id):
		return false
	if LFS.count(scene_id) > 0:
		LFS.clear(scene_id)
	_commit_looks()
	look_deleted.emit(scene_id)
	action_result.emit("Look deleted", true)
	return true


func _prompt_transition(scene_id: String, main: int) -> void:
	var cur: Variant = null
	for s in _scenes_root().get("scenes", []):
		if str(s.get("id", "")) == scene_id:
			cur = s.get("defaultTransition")
	var dlg := AcceptDialog.new()
	dlg.title = "Look transition"
	var row := TransitionRow.new()
	var pgm_only := not DeckModel.preview_bus_available(_cm(), main)
	row.setup(cur if cur is Dictionary else T.default_transition(_fps(main)), pgm_only)
	row.changed.connect(func(tr: Dictionary) -> void: set_look_transition(scene_id, tr))
	dlg.add_child(row)
	dlg.confirmed.connect(dlg.queue_free)
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


func set_look_transition(scene_id: String, tr: Dictionary) -> bool:
	if not E.set_look_transition(_scenes_root(), scene_id, tr):
		return false
	_commit_looks()
	action_result.emit("Transition: %s" % E.short_label(tr, 50.0), true)
	return true


func set_global_default(tr: Dictionary) -> void:
	E.set_global_default(_scenes_root(), tr)
	Store.project_changed.emit(Store.project)
	ProjectSync.mark_dirty()


func apply_default_to_all() -> int:
	var n := E.apply_default_to_all(_scenes_root(), DeckModel.screen_count(_cm()))
	_commit_looks()
	action_result.emit("Default transition applied to %d look(s)" % n, true)
	return n


## Looks changed: deck sync + autosave (same path as rename).
func _commit_looks() -> void:
	Store.project_changed.emit(Store.project)
	ProjectSync.send_deck_sync(true)
	ProjectSync.mark_dirty(true)


func _scenes_root() -> Dictionary:
	if not (Store.project.get("scenes") is Dictionary):
		Store.project["scenes"] = {"scenes": []}
	return Store.project.scenes


func _cm() -> Dictionary:
	return Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}


func _res(main: int) -> Vector2:
	var res_list: Variant = _cm().get("programResolutions", [])
	if res_list is Array and main < (res_list as Array).size() and res_list[main] is Dictionary:
		return Vector2(float(res_list[main].get("w", 1920)), float(res_list[main].get("h", 1080)))
	return Vector2(1920, 1080)


func _fps(main: int) -> float:
	var res_list: Variant = _cm().get("programResolutions", [])
	if res_list is Array and main < (res_list as Array).size() and res_list[main] is Dictionary:
		return float((res_list[main] as Dictionary).get("fps", 50))
	return 50.0
