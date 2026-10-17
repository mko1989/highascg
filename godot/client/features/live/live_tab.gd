extends VSplitContainer
## WO-600 step 1 — read-only live view: the operator channel (shm surface "opgui", canvas mode) on top,
## the looks deck below with PGM/PRV state from the server. No editing, no takes yet (WO-598 first).

const DeckView := preload("res://features/live/deck_view.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _video: TextureRect
var _no_signal: Label
var deck: DeckView
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
	_video.texture = VideoSurfaces.texture(str(Config.args.get("surface", "opgui")))
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
	deck = DeckView.new()
	deck.size_flags_vertical = Control.SIZE_EXPAND_FILL
	deck.custom_minimum_size.y = 260  # a ScrollContainer has no content minimum — without this it collapses
	bottom.add_child(deck)
	deck.action_result.connect(func(text: String, ok: bool) -> void:
		_action.text = text
		_action.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR))


func _process(_delta: float) -> void:
	var r: Variant = VideoSurfaces.reader(str(Config.args.get("surface", "opgui")))
	var lost: bool = r.signal_lost
	_no_signal.visible = lost
	_video.modulate = Color(0.35, 0.35, 0.35) if lost else Color.WHITE
