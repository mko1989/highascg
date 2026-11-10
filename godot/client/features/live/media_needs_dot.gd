extends Label
## WO-1029 plan 07 C10 — the amber dot on a look card whose media is missing on the box that outputs its screen.
## Hidden when the look is clean, nothing is linked, or the node is older. Listens to the needs bus, so a spread
## clears it without the deck rebuilding. The tooltip names the clip and the box (media_needs_model.look_tips).

const Flow := preload("res://features/live/media_needs_flow.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _scene := {}


static func make(scene: Dictionary) -> Label:
	var d := new()
	d._scene = scene
	return d


func _ready() -> void:
	text = "●"
	add_theme_color_override("font_color", ThemeBuilder.WARN)
	add_theme_font_size_override("font_size", 12)
	mouse_filter = Control.MOUSE_FILTER_STOP
	Flow.bus.changed.connect(_sync)
	_sync()


func _sync() -> void:
	var tip: String = Flow.current.look_tip(_scene) if Flow.current != null else ""
	visible = tip != ""
	tooltip_text = tip
