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
const MediaPanel := preload("res://features/live/media_panel.gd")

var _video: TextureRect
var _no_signal: Label
var deck: DeckView
var editor: LookEditor
var timers: ScreenTimerPanel
var _action: Label


func _ready() -> void:
	split_offset = 0
	var video_panel := PanelContainer.new()
	video_panel.add_theme_stylebox_override("panel", ThemeBuilder.box(Color.BLACK, ThemeBuilder.BORDER, 0, 0))
	video_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(video_panel)
	var stack := Control.new()
	video_panel.add_child(stack)
	_video = TextureRect.new()
	_video.texture = VideoSurfaces.texture(_role())
	visibility_changed.connect(_hold_surface)  # WO-617: read the operator surface only while shown
	_hold_surface.call_deferred()
	_video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_video.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	var premult := CanvasItemMaterial.new()
	premult.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	_video.material = premult
	_video.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.add_child(_video)
	_no_signal = Label.new()
	_no_signal.text = "OPERATOR CHANNEL — NO SIGNAL"
	_no_signal.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_no_signal.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	stack.add_child(_no_signal)
	var bottom := VBoxContainer.new()
	bottom.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(bottom)
	_action = Label.new()
	_action.text = "Click a look: stage on PRV · double-click: TAKE"
	_action.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	bottom.add_child(_action)
	var osc := OscMirror.new()
	add_child(osc)
	bottom.add_child(_transition_toolbar())
	deck = DeckView.new()
	deck.osc_mirror = osc
	deck.size_flags_vertical = Control.SIZE_EXPAND_FILL
	deck.custom_minimum_size.y = 260  # a ScrollContainer has no content minimum — without this it collapses
	var split := HSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	bottom.add_child(split)
	var sources := MediaPanel.new()
	sources.custom_minimum_size.x = 260
	split.add_child(sources)
	var inner := HSplitContainer.new()
	inner.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	split.add_child(inner)
	deck.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	inner.add_child(deck)
	editor = LookEditor.new()
	editor.custom_minimum_size.x = 560
	editor.visible = false
	inner.add_child(editor)
	timers = ScreenTimerPanel.new()
	timers.custom_minimum_size.x = 380
	timers.visible = false
	inner.add_child(timers)
	deck.edit_requested.connect(func(id: String, m: int) -> void:
		timers.visible = false
		editor.open(id, m))
	deck.timers_requested.connect(func(m: int, label: String) -> void:
		editor.visible = false
		timers.open(m, label))
	deck.action_result.connect(func(text: String, ok: bool) -> void:
		_action.text = text
		_action.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR))


func _role() -> String:
	return str(Config.args.get("surface", "opgui"))


func _hold_surface() -> void:
	if is_visible_in_tree():
		VideoSurfaces.acquire(_role(), self)
	else:
		VideoSurfaces.release(_role(), self)


func _process(_delta: float) -> void:
	if not is_visible_in_tree():
		return
	var r: Variant = VideoSurfaces.reader(_role())
	var lost: bool = r.signal_lost
	_no_signal.visible = lost
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
	Store.project_changed.connect(func(_p: Dictionary) -> void: _sync_default_row())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "channelMap":
			_sync_default_row())
	_sync_default_row.call_deferred()
	return bar


## Shows the resolved default (auto sentinel → frames at screen 0's fps), like getResolvedGlobalDefaultTransition.
func _sync_default_row() -> void:
	if _default_row == null:
		return
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
	var any_pgm_only := false
	for i in DeckModel.screen_count(cm):
		if not DeckModel.preview_bus_available(cm, i):
			any_pgm_only = true
	_default_row.setup(g, false)
	_default_row.tooltip_text = "MIX/WIPE/Slide/Push use +Animate on PGM-only screens at take." if any_pgm_only else ""
