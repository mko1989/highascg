extends VBoxContainer
## WO-608 — the Settings tab (web client/components/settings-modal.js — a modal there, a workspace tab here since the
## Godot client replaces the kiosk): sub-tabs over settings_form.gd panes, autosaved through the Settings mirror (600 ms,
## no Save button, web parity) with the save result in the status line. Slice 1: Defaults, Companion, Media / USB;
## About (WO-616 attribution, GET /api/about).

const Form := preload("res://features/settings/settings_form.gd")
const Panes := preload("res://features/settings/settings_panes.gd")
const M := preload("res://features/settings/settings_model.gd")
const SendTo := preload("res://features/timeline/timeline_send_to.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _tabs: TabContainer
var _forms: Array[Form] = []
var _status: Label
var _comp_status: Label
var _comp_check: Button
var _about: Form


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_status = Label.new()
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_status.clip_text = true
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_tabs)
	Panes.defaults(_pane("Defaults"), func() -> float:
		var cm: Variant = Store.get_value("channelMap", {})
		return SendTo.project_fps({}, cm if cm is Dictionary else {}))
	_comp_status = Label.new()
	_comp_check = Button.new()
	_comp_check.text = "Check"
	_comp_check.pressed.connect(_check_companion)
	Panes.companion(_pane("Companion"), _comp_status, _comp_check)
	Panes.media(_pane("Media / USB"))
	_about = _pane("About")
	Panes.about(_about, {})
	_tabs.tab_changed.connect(func(i: int) -> void:
		if _tabs.get_tab_title(i) == "Companion":
			_check_companion()
		elif _tabs.get_tab_title(i) == "About":
			_load_about())
	Settings.changed.connect(_hydrate)
	Settings.saved.connect(_on_saved)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			_hydrate())
	_hydrate()


func _pane(title: String) -> Form:
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 16)
	scroll.add_child(pad)
	var f := Form.new()
	f.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pad.add_child(f)
	_tabs.add_child(scroll)
	_tabs.set_tab_title(_tabs.get_tab_count() - 1, title)  # a node name cannot hold "/"
	_forms.append(f)
	return f


func _hydrate() -> void:
	for f in _forms:
		f.hydrate()


## web settings-modal.js: "Saved" / the server's side effects and warnings / the error.
func _on_saved(ok: bool, info: Dictionary) -> void:
	if not ok:
		_status.text = "Save failed: %s" % str(info.get("error", ""))
		_status.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	else:
		var extra: Array = []
		for k in ["sideEffects", "warnings"]:
			if info.get(k) is Array:
				extra.append_array(info[k])
		_status.text = "Saved" + (" — " + " · ".join(extra.map(func(x: Variant) -> String: return str(x))) if not extra.is_empty() else "")
		_status.add_theme_color_override("font_color", ThemeBuilder.WARN if info.get("warnings") is Array else ThemeBuilder.TEXT_MUTED)
	_status.tooltip_text = _status.text


func _check_companion() -> void:
	_comp_check.disabled = true
	_comp_status.text = "Checking…"
	var c: Variant = Settings.get_setting("companion", {})
	var r: Dictionary = await Api.get_json("/api/companion/connection-status?" + M.companion_query(c if c is Dictionary else {}))
	_comp_check.disabled = false
	if not r.ok:
		_comp_status.text = "Check failed: %s" % str(r.error)
		_comp_status.add_theme_color_override("font_color", ThemeBuilder.ERROR)
		return
	var on := r.data is Dictionary and M.is_on((r.data as Dictionary).get("connected"), false)
	_comp_status.text = ("Connected — " if on else "Not connected — ") + M.companion_status_text(r.data)
	_comp_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if on else ThemeBuilder.ERROR)


func _load_about() -> void:
	var r: Dictionary = await Api.get_json("/api/about")
	Panes.about(_about, r.data if r.ok and r.data is Dictionary else {}, "" if r.ok else str(r.error))
