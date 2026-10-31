extends Control
## WO-900 — the pickup marker: a thin amber tick on a slider at the physical fader's or knob's position while that control
## waits to pick the slider up (midi_pickup.gd). Child of the slider, drawn over it, never takes the mouse.

const COLOR := Color(1.0, 0.72, 0.25, 0.95)

var at := 0.0:  ## 0..1, where the physical control is
	set(v):
		at = clampf(v, 0.0, 1.0)
		queue_redraw()


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	tooltip_text = ""


## x of value `ratio` on the parent slider: its grabber's centre travels from half a grabber in to half a grabber short.
func x_of(ratio: float) -> float:
	var r := get_parent() as Range
	var gw := 0.0
	if r != null and r.has_theme_icon("grabber"):
		gw = float(r.get_theme_icon("grabber").get_width())
	return gw * 0.5 + (size.x - gw) * ratio


func _draw() -> void:
	var x := x_of(at)
	draw_line(Vector2(x, 1.0), Vector2(x, size.y - 1.0), COLOR, 2.0)
	draw_colored_polygon(PackedVector2Array([Vector2(x - 4.0, 0.0), Vector2(x + 4.0, 0.0), Vector2(x, 5.0)]), COLOR)
