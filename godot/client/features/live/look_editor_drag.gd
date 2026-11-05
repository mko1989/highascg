extends RefCounted
## WO-960 — the look editor's left-drag on the frame (armed by look_editor._begin_drag): move and edge resize snap
## through layer_snap_math.gd and leave guide lines for the overlay; crop drags stay unsnapped. Holding Ctrl (⌘ on
## macOS) while dragging turns snapping off — Shift is already the resize's aspect unlock. Guides go on release.

const C := preload("res://features/live/compose_math.gd")
const S := preload("res://features/live/layer_snap_math.gd")
const Audio := preload("res://features/live/look_layer_audio.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const GUIDE := ThemeBuilder.ACCENT

var guides := {"x": [], "y": []}  # canvas fractions the dragged layer snapped onto (vertical lines / horizontal lines)


func clear() -> void:
	guides = {"x": [], "y": []}


static func snap_off(e: InputEventWithModifiers) -> bool: return e.ctrl_pressed or e.meta_pressed


## The pointer moved while a drag is armed: patch the selected layer (ed._apply_layer / ed._set_crop).
func motion(ed: Variant, mm: InputEventMouseMotion) -> void:
	var drag: Dictionary = ed._drag
	var b: Rect2 = ed._box()
	var size := b.size.max(Vector2.ONE)
	var from: Vector2 = drag.start
	var deg := float(drag.get("deg", 0.0))
	var local: Vector2 = (mm.position - from).rotated(-deg_to_rad(deg))  # a turned layer's own axes
	if drag.get("is_crop", false):
		clear()
		var lp: Vector2 = drag.layer_px
		var cd: Vector2 = local / Vector2(maxf(1.0, lp.x), maxf(1.0, lp.y))
		ed._set_crop(C.crop_delta(drag.edge, drag.crop, cd.x, cd.y))
		return
	var layers: Array = ed._layers()
	if ed._sel < 0 or ed._sel >= layers.size():
		return
	var layer: Dictionary = layers[ed._sel]
	var thr := Vector2(S.THRESHOLD_PX, S.THRESHOLD_PX) / size  # screen px → canvas fractions at this zoom
	var others := _others(ed)
	var off := snap_off(mm)
	var res: Dictionary
	if drag.edge == "":
		var d: Vector2 = (mm.position - from) / size
		var box := S.bounds(drag.fill, ed._crop_of(layer), ed._deg(layer), ed._canvas())
		res = S.move(drag.fill, box, d.x, d.y, others, thr, off)
	else:
		var d: Vector2 = local / size
		var locked: bool = layer.get("aspectLocked") != false and not mm.shift_pressed  # web: layer lock && !Shift
		res = S.resize(drag.edge, drag.fill, d.x, d.y, locked, others, thr, off or absf(deg) > 1e-4)
	guides = res.guides
	ed._apply_layer({"fill": res.fill})


## The other layers the frame shows (no empty or audio-only box: nothing to see, nothing to snap to), as snap boxes.
func _others(ed: Variant) -> Array:
	var out := []
	var layers: Array = ed._layers()
	var lk: Dictionary = ed.look()
	for i in layers.size():
		var l: Variant = layers[i]
		if i == ed._sel or not (l is Dictionary) or not (l.get("source") is Dictionary) or str(l.source.get("value", "")) == "":
			continue
		if Audio.is_audio_only(l, lk):
			continue
		out.append(S.bounds(ed._shown(l), ed._crop_of(l), ed._deg(l), ed._canvas()))
	return out


## Overlay pass: one thin line per guide across the whole frame, only while a drag is armed.
func draw(ed: Variant, overlay: Control) -> void:
	if ed._drag.is_empty():
		return
	var b: Rect2 = ed._box()
	var area := Rect2(Vector2.ZERO, overlay.size)
	for ax in ["x", "y"]:
		for v in guides[ax]:
			var ln := S.guide_line(float(v), ax == "x", b, area)
			overlay.draw_line(ln[0], ln[1], GUIDE, 1.0)
