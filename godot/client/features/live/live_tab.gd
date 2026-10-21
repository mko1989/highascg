extends VSplitContainer
## WO-600 step 1 — read-only live view: the operator channel (shm surface "opgui", canvas mode) on top,
## the looks deck below with PGM/PRV state from the server. No editing, no takes yet (WO-598 first).

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
const LiveStage3D := preload("res://features/live/live_stage_3d.gd")
const ComposeTiles := preload("res://features/live/compose_tiles.gd")
const ShaderLivePanel := preload("res://features/live/shader_live_panel.gd")
const UI_CFG := "user://ui.cfg"

var _video: TextureRect
var _no_signal: Label
var deck: DeckView
var editor: LookEditor
var timers: ScreenTimerPanel
var border: GlobalBorderPanel
var presets: LookPresetPage
var _action: Label
var osc: Node  # the shell's OscMirror (set before _ready)
var stage3d: LiveStage3D
var tiles: ComposeTiles  # WO-621 N1: destination window outlines, labels, move / resize
var shader_live: ShaderLivePanel  # WO-606: replaces the deck while open (web shader-live-overlay)
var view := "standard"  # WO-621 N6: "standard" (operator picture) | "3d" (the Previs stage)
var _view_btns := {}


func _ready() -> void:
	split_offset = 0
	var video_panel := PanelContainer.new()
	video_panel.add_theme_stylebox_override("panel", ThemeBuilder.box(Color.BLACK, ThemeBuilder.BORDER, 0, 0))
	video_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(video_panel)
	var stack := Control.new()
	stack.clip_contents = true  # WO-648: the width-filled canvas overflows top / bottom
	video_panel.add_child(stack)
	_video = TextureRect.new()
	_video.texture = VideoSurfaces.texture(_role())
	visibility_changed.connect(_hold_surface)  # WO-617: read the operator surface only while shown
	_hold_surface.call_deferred()
	_video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_video.stretch_mode = TextureRect.STRETCH_SCALE  # placed on tiles.image_rect() (_process)
	_video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var premult := CanvasItemMaterial.new()
	premult.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	_video.material = premult
	stack.add_child(_video)
	_no_signal = Label.new()
	_no_signal.text = "OPERATOR CHANNEL — NO SIGNAL"
	_no_signal.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_no_signal.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	stack.add_child(_no_signal)
	tiles = ComposeTiles.new()
	tiles.role = _role()
	tiles.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.add_child(tiles)
	tiles.atlas_changed.connect(func(_on: bool) -> void: _video.visible = _show_whole())  # WO-597 §D: windows crop
	stage3d = LiveStage3D.new()
	stage3d.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stage3d.visible = false
	stack.add_child(stage3d)
	stack.add_child(_view_switch())
	stack.gui_input.connect(func(e: InputEvent) -> void:  # a wheel off the windows pans too
		if view == "standard" and tiles.wheel(e as InputEventMouseButton):
			stack.accept_event())
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
	presets = LookPresetPage.new()
	presets.visible = false
	presets.editing_cb = func() -> String: return editor.scene_id if editor.visible else ""
	add_child(presets)
	deck.edit_requested.connect(func(id: String, m: int) -> void: editor.open(id, m))
	deck.look_deleted.connect(func(id: String) -> void:
		if editor.visible and editor.scene_id == id:
			editor.close_editor())
	deck.timers_requested.connect(func(m: int, label: String) -> void:
		InspectorPanel.current.present(timers)
		timers.open(m, label))
	deck.border_requested.connect(func(m: int, label: String) -> void:
		InspectorPanel.current.present(border)
		border.open(m, label))
	deck.presets_requested.connect(func(m: int, label: String) -> void:
		InspectorPanel.current.present(presets)
		presets.open(m, label))
	deck.action_result.connect(func(text: String, ok: bool) -> void:
		_action.text = text
		_action.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR))
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	set_view(str(Config.args.get("live-view", cfg.get_value("live", "view", "standard"))), false)


## WO-606 — Shader Live on / off (header logo, deck toolbar). `on` null = toggle.
func toggle_shader_live(on: Variant = null) -> void:
	shader_live.visible = (not shader_live.visible) if on == null else bool(on)


## WO-621 N6 — Standard / 3D switch over the preview (web previs-pgm-3d.js toggle). Remembered in ui.cfg.
func _view_switch() -> Control:
	var row := HBoxContainer.new()
	row.position = Vector2(8, 8)
	var group := ButtonGroup.new()
	for spec in [["standard", "Standard", "The operator channel's picture"], ["3d", "3D", "The Previs stage with the live pictures on its walls (drag: orbit, wheel: zoom)"]]:
		var b := Button.new()
		b.text = spec[1]
		b.tooltip_text = spec[2]
		b.toggle_mode = true
		b.button_group = group
		var v: String = spec[0]
		b.pressed.connect(func() -> void: set_view(v))
		row.add_child(b)
		_view_btns[v] = b
	var fit := Button.new()
	fit.text = "Fit"
	fit.tooltip_text = "Frame the whole stage"
	fit.pressed.connect(func() -> void: stage3d.fit())
	row.add_child(fit)
	_view_btns["fit"] = fit
	return row


func set_view(v: String, save := true) -> void:
	view = "3d" if v == "3d" else "standard"
	var is3d := view == "3d"
	for k in ["standard", "3d"]:
		(_view_btns[k] as Button).set_pressed_no_signal(k == view)
	(_view_btns["fit"] as Button).visible = is3d
	stage3d.visible = is3d
	_video.visible = _show_whole()
	tiles.visible = not is3d
	_hold_surface()
	if save:
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		cfg.set_value("live", "view", view)
		cfg.save(UI_CFG)


## The whole operator surface is drawn only in the standard view and outside atlas mode.
func _show_whole() -> bool:
	return view != "3d" and tiles.atlas.is_empty()


func _role() -> String:
	return str(Config.args.get("surface", "opgui"))


func _hold_surface() -> void:
	if is_visible_in_tree() and view == "standard":
		VideoSurfaces.acquire(_role(), self)
	else:
		VideoSurfaces.release(_role(), self)


func _process(_delta: float) -> void:
	if not is_visible_in_tree():
		return
	var ir := tiles.image_rect()
	if _video.position != ir.position or _video.size != ir.size:
		_video.position = ir.position
		_video.size = ir.size
	var r: Variant = VideoSurfaces.reader(_role())
	var lost: bool = r.signal_lost
	_no_signal.visible = lost and view == "standard"
	_video.modulate = Color(0.35, 0.35, 0.35) if lost else Color.WHITE


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
	Store.project_changed.connect(func(_p: Dictionary) -> void: _sync_default_row())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "channelMap":
			_sync_default_row())
	_sync_default_row.call_deferred()
	return bar


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
