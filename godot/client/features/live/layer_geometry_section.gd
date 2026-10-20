extends VBoxContainer
## WO-621 N2 — the look layer's "Position / size (canvas px)" group (web inspector-fill.js appendSceneLayerFillGroup):
## align row, X / Y / Width / Height in canvas pixels of the VISIBLE (cropped) rect — centre offsets with
## editorDefaults.coordinateOrigin "center" — and the per-layer Aspect lock (`aspectLocked`, default on). The math is
## layer_rect_math.gd; edits come out as `patch` ({fill} or {aspectLocked}), applied by the look editor.

signal patch(p: Dictionary)

const LR := preload("res://features/live/layer_rect_math.gd")
const AlignRow := preload("res://features/live/align_row.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const STICKY_MS := 500  # the web's activeInteractionAr: a ratio taken from the rect holds while the operator steps

var content: Callable = func() -> Vector2: return Vector2.ZERO  # the layer's media size, ZERO when unknown
var _layer: Dictionary = {}
var _canvas := Vector2(1920, 1080)
var _center := false
var _sub: Label
var _f := {}
var _lock: CheckBox
var _sticky := 0.0
var _sticky_at := 0


func _ready() -> void:
	var t := Label.new()
	t.text = "Position / size (canvas px)"
	t.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(t)
	_sub = Label.new()
	_sub.text = "X/Y: layer center offset from screen center (0,0 = centered)"
	_sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_sub.add_theme_font_size_override("font_size", 12)
	_sub.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_sub)
	var row := AlignRow.new()
	row.align.connect(func(mode: String) -> void:
		if not _layer.is_empty():
			patch.emit({"fill": LR.align_fill(_layer, mode)}))
	add_child(row)
	var g := GridContainer.new()
	g.columns = 4
	add_child(g)
	for k in ["x", "y", "w", "h"]:
		var l := Label.new()
		l.text = {"x": "X", "y": "Y", "w": "Width", "h": "Height"}[k]
		g.add_child(l)
		var sb := SpinBox.new()
		sb.min_value = 1 if k in ["w", "h"] else -999999
		sb.max_value = 999999
		sb.step = 1
		sb.rounded = true
		sb.custom_minimum_size.x = 110
		sb.value_changed.connect(func(v: float) -> void: _edit(k, v))
		g.add_child(sb)
		_f[k] = sb
	_lock = CheckBox.new()
	_lock.text = "Aspect lock"
	_lock.tooltip_text = "Width and height keep the content's aspect ratio (Shift-drag in the frame ignores it)"
	_lock.toggled.connect(func(on: bool) -> void:
		if not _layer.is_empty():
			patch.emit({"aspectLocked": on}))
	add_child(_lock)


func show_layer(layer: Dictionary, canvas: Vector2, center: bool) -> void:
	_layer = layer
	_canvas = canvas
	_center = center
	if _sub == null:
		return
	_sub.visible = center
	var has := not layer.is_empty()
	for k in _f:
		(_f[k] as SpinBox).editable = has
	_lock.disabled = not has
	if not has:
		return
	var d := LR.display(layer, canvas, center)
	for k in _f:
		(_f[k] as SpinBox).set_value_no_signal(d[k])
	_lock.set_pressed_no_signal(layer.get("aspectLocked") != false)


func _edit(k: String, v: float) -> void:
	if _layer.is_empty():
		return
	var now := Time.get_ticks_msec()
	var c: Vector2 = content.call()
	var ar := LR.lock_ratio(_layer, _canvas, c, _sticky if now - _sticky_at < STICKY_MS else 0.0)
	if ar > 0 and not (c.x > 0 and c.y > 0):
		_sticky = ar
		_sticky_at = now
	patch.emit({"fill": LR.patch_fill(_layer, {k: v}, _canvas, _center, ar)})
