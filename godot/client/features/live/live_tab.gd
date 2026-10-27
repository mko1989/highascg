extends VSplitContainer
## WO-600 step 1 — read-only live view: the operator channel (shm surface "opgui", canvas mode) on top,
## the looks deck below with PGM/PRV state from the server. No editing, no takes yet (WO-598 first).
## WO-789: the preview on top is live_preview.gd — this tab makes it and takes it back from the Timeline tab when shown.

const DeckView := preload("res://features/live/deck_view.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const OscMirror := preload("res://features/live/osc_mirror.gd")
const TransitionRow := preload("res://features/live/transition_row.gd")
const T := preload("res://features/live/transitions.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const LookEditor := preload("res://features/live/look_editor.gd")
const ScreenTimerPanel := preload("res://features/live/screen_timer_panel.gd")
const GlobalBorderPanel := preload("res://features/live/global_border_panel.gd")
const LookPresetPage := preload("res://features/live/look_preset_page.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const ShaderLivePanel := preload("res://features/live/shader_live_panel.gd")
const LivePreview := preload("res://features/live/live_preview.gd")
const UI_CFG := "user://ui.cfg"

var preview: LivePreview  # WO-789: the 2D / 3D preview, shared with the Timeline tab
var _video_panel: PanelContainer
var deck: DeckView
var editor: LookEditor
var timers: ScreenTimerPanel
var border: GlobalBorderPanel
var presets: LookPresetPage
var _show_btns := {}  # WO-781: deck toolbar "Looks" toggle (WO-783: presets moved to the right column's tab)
var _action: Label
var osc: Node  # the shell's OscMirror (set before _ready)
var shader_live: ShaderLivePanel  # WO-606: replaces the deck while open (web shader-live-overlay)


func _ready() -> void:
	split_offset = 0
	_video_panel = PanelContainer.new()
	_video_panel.add_theme_stylebox_override("panel", ThemeBuilder.box(Color.BLACK, ThemeBuilder.BORDER, 0, 0))
	_video_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_video_panel)
	preview = LivePreview.new()
	preview.host(_video_panel)
	visibility_changed.connect(func() -> void:  # WO-789: take the preview back from the Timeline tab
		if is_visible_in_tree():
			preview.host(_video_panel))
	var bottom := VBoxContainer.new()
	bottom.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(bottom)
	_action = Label.new()
	_action.text = "Click a look: stage on PRV · double-click: TAKE"
	_action.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	bottom.add_child(_action)
	if osc == null:
		osc = OscMirror.new()
		add_child(osc)
	var bar := _transition_toolbar()
	bottom.add_child(bar)
	preview.set_osc(osc)
	deck = DeckView.new()
	deck.osc_mirror = osc
	deck.size_flags_vertical = Control.SIZE_EXPAND_FILL
	deck.custom_minimum_size.y = 260  # a ScrollContainer has no content minimum — without this it collapses
	var inner := HSplitContainer.new()
	inner.size_flags_vertical = Control.SIZE_EXPAND_FILL
	bottom.add_child(inner)
	deck.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	inner.add_child(deck)
	editor = LookEditor.new()  # the compose frame + layer list stay in the workspace; the layer page goes to the Inspector
	editor.custom_minimum_size.x = 560
	editor.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	editor.visible = false
	inner.add_child(editor)
	editor.visibility_changed.connect(func() -> void:  # WO-621 N5: an open editor is the only thing at the bottom
		for c in [_action, bar, deck]:
			c.visible = not editor.visible)
	shader_live = ShaderLivePanel.new()
	shader_live.visible = false
	shader_live.size_flags_vertical = Control.SIZE_EXPAND_FILL
	shader_live.take_cb = func() -> Dictionary: return await deck.take_main(0)
	shader_live.transition_cb = resolved_default_transition
	shader_live.close_requested.connect(func() -> void: toggle_shader_live(false))
	bottom.add_child(shader_live)
	shader_live.visibility_changed.connect(func() -> void:
		inner.visible = not shader_live.visible
		for c in [_action, bar]:
			c.visible = not shader_live.visible and not editor.visible)
	timers = ScreenTimerPanel.new()  # R2: screen timers / border are Inspector pages, not tab panels
	timers.visible = false
	add_child(timers)
	border = GlobalBorderPanel.new()
	border.visible = false
	add_child(border)
	presets = LookPresetPage.new()  # WO-783: the right column's "Look presets" tab, beside the Inspector
	presets.editing_cb = func() -> String: return editor.scene_id if editor.visible else ""
	if is_instance_valid(InspectorPanel.current):
		InspectorPanel.current.add_tab("Look presets", presets)
	else:
		add_child(presets)
	presets.said.connect(func(text: String, ok: bool) -> void: deck.action_result.emit(text, ok))
	deck.edit_requested.connect(func(id: String, m: int) -> void: editor.open(id, m))
	editor.take_requested.connect(func(id: String, m: int) -> void: deck.request_take(id, m, "program"))
	deck.look_deleted.connect(func(id: String) -> void:
		if editor.visible and editor.scene_id == id:
			editor.close_editor())
	deck.timers_requested.connect(func(m: int, label: String) -> void:
		InspectorPanel.current.present(timers)
		timers.open(m, label))
	deck.border_requested.connect(func(m: int, label: String) -> void:
		InspectorPanel.current.present(border)
		border.open(m, label))
	deck.action_result.connect(func(text: String, ok: bool) -> void:
		_action.text = text
		_action.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)
		if editor.visible:  # the action line hides with the deck (WO-621 N5); the editor TAKE answers in its own status
			editor.show_status(text))
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	for k in _show_btns:  # WO-781: which cards the card section shows (this client's view)
		_set_shown(k, bool(cfg.get_value("live", "show_" + k, true)), false)


## WO-606 — Shader Live on / off (header logo, deck toolbar). `on` null = toggle.
func toggle_shader_live(on: Variant = null) -> void:
	shader_live.visible = (not shader_live.visible) if on == null else bool(on)


## WO-600 I — deck toolbar (web scene-list.js): default transition for new looks + "Apply to all looks".
var _default_row: Node


func _transition_toolbar() -> Control:
	var bar := HBoxContainer.new()
	var l := Label.new()
	l.text = "Default transition"
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	bar.add_child(l)
	_default_row = TransitionRow.new()
	bar.add_child(_default_row)
	_default_row.changed.connect(func(tr: Dictionary) -> void: deck.set_global_default(tr))
	var all := Button.new()
	all.text = "Apply to all looks"
	all.tooltip_text = "Set the default transition on every look (with 2+ mains: the active main's deck)"
	all.pressed.connect(func() -> void: deck.apply_default_to_all())
	bar.add_child(all)
	var shl := Button.new()
	shl.text = "Shader Live"
	shl.tooltip_text = "Edit the shaders on air live — every value rides onto the running output (also: click the logo)"
	shl.pressed.connect(func() -> void: toggle_shader_live(true))
	bar.add_child(shl)
	for k in ["looks"]:  # WO-781: show / hide the look cards in the card section (presets: the right column's tab)
		var b := Button.new()
		b.text = "Looks"
		b.toggle_mode = true
		b.button_pressed = true
		b.tooltip_text = "Show the look cards in each screen's column"
		b.toggled.connect(func(on: bool) -> void: _set_shown(k, on, true))
		bar.add_child(b)
		_show_btns[k] = b
	Store.project_changed.connect(func(_p: Dictionary) -> void: _sync_default_row())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "channelMap":
			_sync_default_row())
	_sync_default_row.call_deferred()
	return bar


func _set_shown(kind: String, on: bool, persist: bool) -> void:
	(_show_btns[kind] as Button).set_pressed_no_signal(on)
	if kind == "looks":
		deck.show_looks = on
	if persist:
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		cfg.set_value("live", "show_" + kind, on)
		cfg.save(UI_CFG)


## The project's default transition with the auto sentinel resolved to frames at screen 0's fps
## (web getResolvedGlobalDefaultTransition) — the toolbar row and Shader Live's stack both use it.
func resolved_default_transition() -> Dictionary:
	var root: Dictionary = Store.project.get("scenes", {}) if Store.project.get("scenes") is Dictionary else {}
	var g: Dictionary = T.default_transition()
	if root.get("globalDefaultTransition") is Dictionary:
		g.merge(root.globalDefaultTransition, true)
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var fps := 50.0
	var rl: Variant = cm.get("programResolutions", [])
	if rl is Array and not (rl as Array).is_empty() and rl[0] is Dictionary:
		fps = float(rl[0].get("fps", 50))
	g["duration"] = T.resolve_duration(g.get("duration"), fps)
	return g


func _sync_default_row() -> void:
	if _default_row == null:
		return
	var g := resolved_default_transition()
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var any_pgm_only := false
	for i in DeckModel.screen_count(cm):
		if not DeckModel.preview_bus_available(cm, i):
			any_pgm_only = true
	_default_row.setup(g, false)
	_default_row.tooltip_text = "MIX/WIPE/Slide/Push use +Animate on PGM-only screens at take." if any_pgm_only else ""
