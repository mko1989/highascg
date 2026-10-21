extends VBoxContainer
## WO-601 — look presets Inspector page (web inspector-panel-presets-modes.js renderLookPresetsMode), opened from a
## deck column's "Presets". Save / Overwrite / Remove edit `project.scenes.lookPresets` and travel with the deck sync
## (the web does the same); Preview / ▶ / Auto / Cut ask the server to recall (POST /api/scene/look-preset/recall),
## which takes every screen of the preset at once.

signal closed

const M := preload("res://features/live/look_preset_model.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const Icons := preload("res://app/ui_icons.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const LayerStyleRow := preload("res://features/live/layer_style_row.gd")

var screen_idx := 0
var editing_cb: Callable = func() -> String: return ""  # the look open in the editor ("" = none)
var _title: Label
var _all: CheckBox
var _save_btns := {}
var _list: VBoxContainer
var _status: Label
var _dirty := false


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	_title = Label.new()
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	var x := Button.new()
	x.text = "✕"
	x.pressed.connect(func() -> void:
		visible = false
		closed.emit())
	head.add_child(x)
	add_child(head)
	var hint := Label.new()
	hint.text = "Bookmarks of which look is on preview, program or open in the editor. Recall puts them back on PRV or takes them live."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(hint)
	var save := HBoxContainer.new()
	for k in ["prv", "pgm", "editing"]:
		var b := Button.new()
		b.text = {"prv": "From PRV", "pgm": "From PGM", "editing": "From open look"}[k]
		b.pressed.connect(_ask_name.bind(k))
		save.add_child(b)
		_save_btns[k] = b
	add_child(save)
	_all = CheckBox.new()
	_all.text = "All screens"
	_all.tooltip_text = "Save every screen's look in one preset (recall takes them together)"
	_all.toggled.connect(func(_on: bool) -> void: _render())
	add_child(_all)
	var lib := Label.new()
	lib.text = "Library"
	lib.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(lib)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(_list)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _queue())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "scene.live" or path == "channelMap":
			_queue())
	visibility_changed.connect(func() -> void:
		if visible:
			_render())


func open(main: int, label: String) -> void:
	screen_idx = main
	_title.text = "Look presets — %s" % label
	visible = true
	_render()


func _queue() -> void:
	if visible and not _dirty:
		_dirty = true
		_render.call_deferred()


func _cm() -> Dictionary:
	return Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}


func _scenes_root() -> Dictionary:
	if not (Store.project.get("scenes") is Dictionary):
		Store.project["scenes"] = {"scenes": []}
	return Store.project.scenes


func presets() -> Array:
	var root := _scenes_root()
	if not (root.get("lookPresets") is Array):
		root["lookPresets"] = []
	return root.lookPresets


func _looks() -> Dictionary:
	var out := {}
	for s in _scenes_root().get("scenes", []):
		if s is Dictionary:
			out[str(s.get("id", ""))] = str(s.get("name", ""))
	return out


## main → {prv, pgm} look ids, as the deck columns show them.
func buses() -> Dictionary:
	var live: Dictionary = Store.get_value("scene.live", {}) if Store.get_value("scene.live") is Dictionary else {}
	var known := _looks()
	var out := {}
	for m in DeckModel.screen_count(_cm()):
		out[m] = DeckModel.resolve_bus_look_ids(m, live, _cm(), known, _scenes_root())
	return out


func _mains() -> Array:
	if _all.visible and _all.button_pressed:
		return range(DeckModel.screen_count(_cm()))
	return [screen_idx]


func capture(source: String) -> Array:
	var ed := str(editing_cb.call())
	return M.capture_items(source, _mains(), buses(), ed if _looks().has(ed) else "")


func _render() -> void:
	_dirty = false
	if _list == null:
		return
	_all.visible = DeckModel.screen_count(_cm()) > 1
	for k in _save_btns:
		var none := capture(k).is_empty()
		_save_btns[k].disabled = none
		_save_btns[k].tooltip_text = ({"prv": "No look on preview", "pgm": "No look on program", "editing": "Open a look in the editor first"}[k]) if none else ""
	for c in _list.get_children():
		c.queue_free()
	var list := presets()
	if list.is_empty():
		var e := Label.new()
		e.text = "No look presets yet."
		e.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_list.add_child(e)
		return
	var looks := _looks()
	var bus := buses()
	for p in list:
		if p is Dictionary:
			_list.add_child(_card(p, looks, bus))


func _card(p: Dictionary, looks: Dictionary, bus: Dictionary) -> Control:
	var exists := looks.has(str(p.get("sceneId", "")))
	for it in p.get("items", []):
		exists = exists or (it is Dictionary and looks.has(str(it.get("sceneId", ""))))
	var box := VBoxContainer.new()
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = str(p.get("name", ""))
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.clip_text = true
	if M.loaded_on_prv(p, bus):
		label.add_theme_color_override("font_color", ThemeBuilder.SUCCESS)
		label.tooltip_text = "On PRV now"
	row.add_child(label)
	var play := Icons.button("play", "Play: take to PGM with each look's own transition", 14)
	play.disabled = not exists
	play.pressed.connect(func() -> void: recall(str(p.id), "program"))
	row.add_child(play)
	box.add_child(row)
	var meta := Label.new()
	var first := str(p.get("sceneId", ""))
	meta.text = M.meta_line(p, exists) + (("  → “%s”" % looks[first]) if looks.has(first) else "")
	meta.clip_text = true
	meta.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	box.add_child(meta)
	var acts := HFlowContainer.new()
	var pid := str(p.get("id", ""))
	for spec in [["Preview", "Load every screen's look onto its PRV", func() -> void: recall(pid, "preview")],
			["Auto", "Take to PGM with the deck's default transition", func() -> void: recall(pid, "program", false, true)],
			["Cut", "Cut to PGM", func() -> void: recall(pid, "program", true)],
			["Overwrite", "Replace with what is on %s now" % M.source_label(str(p.get("sourceKind", ""))), func() -> void: _confirm_overwrite(p)]]:
		var b := Button.new()
		b.text = spec[0]
		b.tooltip_text = spec[1]
		b.disabled = not exists
		b.pressed.connect(spec[2])
		acts.add_child(b)
	var rm := Button.new()
	rm.text = "Remove"
	rm.tooltip_text = "Remove the preset (the look stays on the deck)"
	rm.pressed.connect(func() -> void: _confirm("Remove look preset \"%s\"? (The look itself stays on the deck.)" % p.get("name", ""), func() -> void:
		if M.remove(presets(), pid):
			_commit("Look preset removed.")))
	acts.add_child(rm)
	box.add_child(acts)
	box.add_child(HSeparator.new())
	return box


func _ask_name(source: String) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = "Look preset name (from %s)" % M.source_label(source)
	var edit := LineEdit.new()
	edit.custom_minimum_size.x = 320
	dlg.add_child(edit)
	dlg.register_text_enter(edit)
	dlg.confirmed.connect(func() -> void:
		save(source, edit.text)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()
	edit.grab_focus()


## Returns the new preset's id ("" = nothing saved).
func save(source: String, preset_name: String) -> String:
	var p := M.make_preset(presets(), preset_name, capture(source), LayerStyleRow._uuid(), int(Time.get_unix_time_from_system() * 1000))
	if p.is_empty():
		_say("Nothing valid on %s to save." % M.source_label(source) if preset_name.strip_edges() != "" else "Give the preset a name.", false)
		return ""
	presets().append(p)
	_commit("Look preset “%s” saved." % p.name)
	return str(p.id)


func _confirm_overwrite(p: Dictionary) -> void:
	var src := str(p.get("sourceKind", "prv"))
	_confirm("Overwrite \"%s\" with the current %s?" % [p.get("name", ""), M.source_label(src)], func() -> void:
		if M.overwrite(p, capture(src), int(Time.get_unix_time_from_system() * 1000)):
			_commit("Look preset overwritten.")
		else:
			_say("Nothing valid on %s to save." % M.source_label(src), false))


func _confirm(text: String, ok: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = text
	dlg.confirmed.connect(func() -> void:
		ok.call()
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


## Deck edit: broadcast locally, deck sync (the server's live deck is what recall reads), autosave.
func _commit(msg: String) -> void:
	Store.project_changed.emit(Store.project)
	ProjectSync.send_deck_sync(true)
	ProjectSync.mark_dirty(true)
	_say(msg, true)
	_render()


func recall(id: String, target: String, cut := false, global_transition := false) -> Dictionary:
	ProjectSync.send_deck_sync(false)  # an unsent preset edit must reach the server's deck first
	var res: Dictionary = await Api.post_json("/api/scene/look-preset/recall", {"id": id, "target": target, "forceCut": cut, "useGlobalTransition": global_transition})
	var what := "PRV" if target == "preview" else ("CUT" if cut else "TAKE")
	var bad := []
	if res.data is Dictionary:
		for it in (res.data as Dictionary).get("items", []):
			if it is Dictionary and it.get("error") != null:
				bad.append("screen %d: %s" % [int(it.get("mainIdx", 0)) + 1, it.error])
	if res.ok and bad.is_empty():
		_say("Preset %s ok" % what, true)
	else:
		_say("Preset %s: %s" % [what, "; ".join(bad) if not bad.is_empty() else str(res.error)], false)
	return res


func _say(text: String, ok: bool) -> void:
	_status.text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)
