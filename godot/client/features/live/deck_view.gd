extends ScrollContainer
## WO-600 step 1 — looks deck, read-only: one column per main (client/components/scene-list.js),
## cards highlighted red = on PGM, green = on PRV, dashed accent = global look ('all').
## Rebuilds on project / scene / channelMap changes (coalesced to one rebuild per frame).

const DeckModel := preload("res://features/live/deck_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal action_result(text: String, ok: bool)

var _columns: HBoxContainer
var _dirty := true
var _main_for_card := 0


func _ready() -> void:
	horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	_columns = HBoxContainer.new()
	_columns.add_theme_constant_override("separation", 12)
	_columns.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(_columns)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _dirty = true)
	Store.changed.connect(_on_store_changed)


func _on_store_changed(path: String, _v: Variant) -> void:
	if path == "*" or path.begins_with("scene") or path == "channelMap":
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
	for main in DeckModel.screen_count(cm):
		_main_for_card = main
		var bus := DeckModel.resolve_bus_look_ids(main, live, cm, known, ps)
		_columns.add_child(_column(DeckModel.screen_label(cm, main), DeckModel.scenes_for_main(scenes, main), bus, main, cm))


func _column(title: String, looks: Array, bus: Dictionary, main: int, cm: Dictionary) -> Control:
	var col := VBoxContainer.new()
	col.custom_minimum_size.x = 240
	col.add_theme_constant_override("separation", 8)
	var head_row := HBoxContainer.new()
	var head := Label.new()
	head.text = "%s  ·  %d looks" % [title, looks.size()]
	head.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head_row.add_child(head)
	var take := Button.new()
	take.text = "TAKE"
	take.tooltip_text = "Take the look on PRV to PGM"
	take.disabled = str(bus.prv) == ""
	take.pressed.connect(func() -> void: request_take(str(bus.prv), main, "program"))
	head_row.add_child(take)
	var ftb := Button.new()
	ftb.text = "FTB"
	ftb.tooltip_text = "Fade to black (PGM + PRV), then clear"
	ftb.pressed.connect(func() -> void: request_ftb(main, cm))
	head_row.add_child(ftb)
	col.add_child(head_row)
	for s in looks:
		col.add_child(_card(s, bus))
	return col


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
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, border, 3 if (on_pgm or on_prv) else 1))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.tooltip_text = "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename"
	card.gui_input.connect(_on_card_input.bind(id, _main_for_card))
	var v := VBoxContainer.new()
	card.add_child(v)
	var name_l := Label.new()
	name_l.text = str(scene.get("name", "(unnamed)"))
	name_l.add_theme_font_size_override("font_size", 17)
	v.add_child(name_l)
	var meta := Label.new()
	var layers: Array = scene.get("layers", [])
	var tags := PackedStringArray(["%d layers" % layers.size()])
	if on_pgm:
		tags.append("PGM")
	if on_prv:
		tags.append("PRV")
	meta.text = " · ".join(tags)
	meta.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(meta)
	return card


## WO-598 C1: click = stage on PRV, double-click = take to PGM — server builds the payload
## (POST /api/scene/take-look); the deck re-highlights from the scene.live broadcast that follows.
func _on_card_input(event: InputEvent, scene_id: String, main: int) -> void:
	var mb := event as InputEventMouseButton
	if mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_RIGHT:
		_prompt_rename(scene_id)
		return
	if mb == null or not mb.pressed or mb.button_index != MOUSE_BUTTON_LEFT:
		return
	await request_take(scene_id, main, "program" if mb.double_click else "preview")


func request_take(scene_id: String, main: int, target: String) -> Dictionary:
	var res: Dictionary = await Api.post_json("/api/scene/take-look", {"sceneId": scene_id, "mainIdx": main, "target": target})
	var what := "TAKE" if target == "program" else "PRV"
	if res.ok:
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
