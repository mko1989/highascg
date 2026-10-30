extends VBoxContainer
## WO-601 / WO-783 — the right column's "Look presets" tab (web inspector-panel-presets-modes.js
## renderLookPresetsMode): destinations, save, and the preset cards (look_preset_strip.gd). Save / Overwrite / Remove
## edit `project.scenes.lookPresets` and travel with the deck sync (the web does the same); a card click / ▶ / Auto /
## Cut ask the server to recall (POST /api/scene/look-preset/recall), which takes every screen of the preset at once
## (one PLAY batch, WO-782). WO-781 (E2): a save covers exactly the highlighted destinations (destinations.gd), empty
## ones included; a recall re-highlights the preset's screens.

signal said(text: String, ok: bool)  # WO-781: the deck's action line shows it

const M := preload("res://features/live/look_preset_model.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const LayerStyleRow := preload("res://features/live/layer_style_row.gd")
const Destinations := preload("res://features/live/destinations.gd")
const LookPresetStrip := preload("res://features/live/look_preset_strip.gd")

var editing_cb: Callable = func() -> String: return ""  # the look open in the editor ("" = none)
var _dests: Label
var _save_btns := {}
var _list: LookPresetStrip
var _status: Label
var _dirty := false
var _timers: Array = []  # WO-840: the server's timer records (/api/timers/list), refreshed before every save


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var hint := Label.new()
	hint.text = "Highlight destinations (click a screen's title in the deck), then save what is on their PRV or PGM. Recall loads exactly those screens — an empty one is cleared."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(hint)
	_dests = Label.new()
	_dests.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_dests)
	var save := HBoxContainer.new()
	for k in ["prv", "pgm", "editing"]:
		var b := Button.new()
		b.text = {"prv": "From PRV", "pgm": "From PGM", "editing": "From open look"}[k]
		b.pressed.connect(ask_name.bind(k))
		save.add_child(b)
		_save_btns[k] = b
	add_child(save)
	_list = LookPresetStrip.new()
	_list.page = self
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(_list)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _queue())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "scene.live" or path == "channelMap" or path == Destinations.PATH:
			_queue())
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			_render())


func _queue() -> void:
	if is_visible_in_tree() and not _dirty:
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


## What is really on each bus: the deck's buses with a PRV that shows the PGM look not blanked (WO-781) — what a
## save captures and what a card's PRV / PGM mark compares against.
func true_buses() -> Dictionary:
	var live: Dictionary = Store.get_value("scene.live", {}) if Store.get_value("scene.live") is Dictionary else {}
	var prv_chs: Array = _cm().get("previewChannels", [])
	var raw := {}
	for m in DeckModel.screen_count(_cm()):
		var ch: int = int(prv_chs[m]) if m < prv_chs.size() and prv_chs[m] != null else 0
		var sid := DeckModel._live_scene_id(live, ch) if ch > 0 else ""
		if _looks().has(sid):
			raw[m] = sid
	return M.capture_buses(buses(), raw)


func capture(source: String) -> Array:
	var ed := str(editing_cb.call())
	return M.with_timers(M.capture_items(source, Destinations.selected(), true_buses(), ed if _looks().has(ed) else "", true), _timers)


## WO-840: re-read the live timers so a save stores each screen's CURRENT visibility (offline / failed: keep the cache).
func refresh_timers() -> void:
	var res: Dictionary = await Api.get_json("/api/timers/list")
	if res.get("ok", false) and res.get("data") is Dictionary and (res.data as Dictionary).get("timers") is Array:
		_timers = (res.data as Dictionary).timers


func _render() -> void:
	_dirty = false
	if _list == null:
		return
	var sel := Destinations.selected()
	_dests.text = "Destinations: %s" % (", ".join(sel.map(func(m: int) -> String: return str(m + 1))) if not sel.is_empty() else "none highlighted")
	_dests.add_theme_color_override("font_color", ThemeBuilder.ACCENT if not sel.is_empty() else ThemeBuilder.WARN)
	for k in _save_btns:
		var none := capture(k).is_empty()
		_save_btns[k].disabled = none
		_save_btns[k].tooltip_text = ("Highlight destinations first: click a screen's title in the deck" if sel.is_empty() else "Open a look in the editor first") if none else ""


## ⋯ Remove on a card.
func confirm_remove(p: Dictionary) -> void:
	_confirm("Remove look preset \"%s\"? (The look itself stays on the deck.)" % p.get("name", ""), func() -> void:
		if M.remove(presets(), str(p.get("id", ""))):
			_commit("Look preset removed."))


func ask_name(source: String) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = "Look preset name (from %s)" % M.source_label(source)
	var edit := LineEdit.new()
	edit.custom_minimum_size.x = 320
	dlg.add_child(edit)
	dlg.register_text_enter(edit)
	dlg.confirmed.connect(func() -> void:
		await refresh_timers()
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
		await refresh_timers()
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
	for p in presets():  # E2: recalling a preset makes its screens the highlighted destinations
		if p is Dictionary and str(p.get("id", "")) == id:
			Destinations.set_only(M.mains_of(p))
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
	said.emit(text, ok)
	_status.text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)
