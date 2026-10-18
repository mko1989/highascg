extends VBoxContainer
## WO-602 slice 4 — the clip page's keyframe groups (web inspector-fill-timeline.js appendTimelineClipKeyframes):
## Position keyframes (X / Y in program px — centre offsets in centre-origin mode), Scale, Opacity and Volume rows with
## value, easing and ×, then "Add keyframe" (property, time in clip ms — default the playhead when it is on the clip —
## and value). Keys are edited in place on the clip; `changed` asks the page to sync. Scale keeps the key's own x / y
## ratio (the web forces one value on both axes — see timeline_keyframes.gd add_scale).

signal changed

const K := preload("res://features/timeline/timeline_keyframes.gd")
const P := preload("res://features/live/px_rect_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const ADD_PROPS := [["opacity", "Opacity"], ["volume", "Volume"], ["position", "Position"], ["scale", "Scale"]]

var host  # the clip page: _clip, rect(), canvas, center
var now: Callable  # → the timeline playhead ms (set by the tab)
var _add_prop := 0


func refresh() -> void:
	var fo := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	if fo is LineEdit and is_ancestor_of(fo):
		return  # never rebuild under the operator's typing
	for ch in get_children():
		ch.queue_free()
	var clip: Dictionary = host._clip
	if clip.is_empty():
		return
	var pos := _pairs(clip, "fill_x", "fill_y")
	if not pos.is_empty():
		var g := _group("Position keyframes (center offset px)" if host.center else "Position keyframes")
		for t in pos:
			_pos_row(g, clip, t)
	var sc := _pairs(clip, "scale_x", "scale_y")
	if not sc.is_empty():
		var g := _group("Scale keyframes")
		for t in sc:
			_scale_row(g, clip, t)
	for prop in K.PROPS:
		var ks := K.of(clip, prop)
		if ks.is_empty():
			continue
		var g := _group("%s keyframes" % K.PROPS[prop].label)
		for kf in ks:
			var row := _row(g, float(kf.time))
			row.add_child(_num(float(kf.value), K.PROPS[prop].min, K.PROPS[prop].max, 0.01, func(v: float) -> void:
				kf["value"] = v
				changed.emit()))
			_tail(row, clip, [prop], float(kf.time))
	_add_group(clip)


## Times (rounded) at which either key of a pair exists.
static func _pairs(clip: Dictionary, a: String, b: String) -> Array:
	var ts: Array = []
	for k in K.of(clip, a) + K.of(clip, b):
		if not roundf(float(k.time)) in ts:
			ts.append(roundf(float(k.time)))
	ts.sort()
	return ts


static func _at(clip: Dictionary, prop: String, t: float) -> Variant:
	for k in K.of(clip, prop):
		if absf(float(k.time) - t) < 0.5:
			return k
	return null


func _pos_row(g: VBoxContainer, clip: Dictionary, t: float) -> void:
	var kx: Variant = _at(clip, "fill_x", t)
	var ky: Variant = _at(clip, "fill_y", t)
	var cv: Vector2 = host.canvas
	var ra := K.rect_at(clip, t, host.rect(), cv)
	var d := P.display_from_stored({"x": (float(kx.value) if kx else 0.0) * cv.x, "y": (float(ky.value) if ky else 0.0) * cv.y,
		"w": ra.w, "h": ra.h}, cv, host.center)
	var row := _row(g, t)
	var xs := _num(roundf(d.x), -99999, 99999, 1, func(_v: float) -> void: pass)
	var ys := _num(roundf(d.y), -99999, 99999, 1, func(_v: float) -> void: pass)
	var apply := func(_v: float) -> void:
		var s := P.stored_from_display({"x": xs.value, "y": ys.value, "w": ra.w, "h": ra.h}, cv, host.center)
		_set_pair(clip, t, ["fill_x", "fill_y"], [s.x / cv.x, s.y / cv.y])
		changed.emit()
	xs.value_changed.connect(apply)
	ys.value_changed.connect(apply)
	row.add_child(xs)
	row.add_child(ys)
	_tail(row, clip, ["fill_x", "fill_y"], t)


func _scale_row(g: VBoxContainer, clip: Dictionary, t: float) -> void:
	var kx: Variant = _at(clip, "scale_x", t)
	var ky: Variant = _at(clip, "scale_y", t)
	var vx := float(kx.value) if kx else float(ky.value)
	var ratio := (float(ky.value) / vx) if kx and ky and vx > 0 else 1.0
	var row := _row(g, t)
	row.add_child(_num(vx, 0, K.SCALE_MAX, 0.01, func(v: float) -> void:
		_set_pair(clip, t, ["scale_x", "scale_y"], [v, clampf(v * ratio, 0.0, K.SCALE_MAX)])
		changed.emit()))
	_tail(row, clip, ["scale_x", "scale_y"], t)


## A pair's values, edited in place (the canvas and the easing selector hold the keys); a missing half is added.
static func _set_pair(clip: Dictionary, t: float, props: Array, vals: Array) -> void:
	var e := "linear"
	for p in props:
		if _at(clip, p, t) != null:
			e = str(_at(clip, p, t).get("easing", "linear"))
	for i in props.size():
		var k: Variant = _at(clip, props[i], t)
		if k != null:
			k["value"] = vals[i]
		else:
			K.add(clip, {"time": t, "property": props[i], "value": vals[i], "easing": e})


## easing + × for the keys of `props` at `t` (a pair shares both)
func _tail(row: HBoxContainer, clip: Dictionary, props: Array, t: float) -> void:
	var ob := OptionButton.new()
	ob.fit_to_longest_item = false  # a position row (X, Y, easing, ×) must fit the Inspector
	ob.clip_text = true
	ob.custom_minimum_size.x = 92
	for e in K.EASINGS:
		ob.add_item(e)
	var first: Variant = null
	for p in props:
		first = first if first != null else _at(clip, p, t)
	ob.select(maxi(0, K.EASINGS.find(str(first.get("easing", "linear")) if first != null else "linear")))
	ob.item_selected.connect(func(i: int) -> void:
		for p in props:
			var k: Variant = _at(clip, p, t)
			if k != null:
				k["easing"] = K.EASINGS[i]
		changed.emit())
	row.add_child(ob)
	var x := Button.new()
	x.text = "×"
	x.tooltip_text = "Remove keyframe"
	x.pressed.connect(func() -> void:
		for p in props:
			K.remove(clip, p, t)
		changed.emit()
		refresh.call_deferred())
	row.add_child(x)


func _add_group(clip: Dictionary) -> void:
	var g := _group("Add keyframe")
	var hint := Label.new()
	hint.text = "Double-click a clip on the timeline for opacity at that time. With this clip selected: P position, S scale, V volume, T opacity, I / O fade in / out."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_font_size_override("font_size", 12)
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(hint)
	var dur := float(clip.get("duration", 0))
	var local := roundf((float(now.call()) if now.is_valid() else 0.0) - float(clip.get("startTime", 0)))
	var t0 := local if local >= 0 and local <= dur else 0.0
	var row := HBoxContainer.new()
	var ps := OptionButton.new()
	for p in ADD_PROPS:
		ps.add_item(p[1])
	ps.select(_add_prop)
	row.add_child(ps)
	var ts := _num(t0, 0, dur, 1, func(_v: float) -> void: pass)
	ts.custom_minimum_size.x = 100
	ts.suffix = "ms"
	ts.tooltip_text = "Time inside the clip (ms)"
	row.add_child(ts)
	g.add_child(row)
	var row2 := HBoxContainer.new()  # the values on their own line: a position row is too wide for one
	var vals := HBoxContainer.new()
	row2.add_child(vals)
	var cv: Vector2 = host.canvas
	var fill_vals := func() -> void:
		for ch in vals.get_children():
			ch.queue_free()
		var cur := K.rect_at(clip, ts.value, host.rect(), cv)
		match ADD_PROPS[ps.selected][0]:
			"position":
				var d := P.display_from_stored(cur, cv, host.center)
				vals.add_child(_num(roundf(d.x), -99999, 99999, 1, func(_v: float) -> void: pass))
				vals.add_child(_num(roundf(d.y), -99999, 99999, 1, func(_v: float) -> void: pass))
			"scale":
				vals.add_child(_num(snappedf(cur.w / cv.x, 0.01), 0, K.SCALE_MAX, 0.01, func(_v: float) -> void: pass))
			var p:
				vals.add_child(_num(K.PROPS[p].default, K.PROPS[p].min, K.PROPS[p].max, 0.01, func(_v: float) -> void: pass))
	ps.item_selected.connect(func(i: int) -> void:
		_add_prop = i
		fill_vals.call())
	fill_vals.call()
	var add := Button.new()
	add.text = "Add"
	add.pressed.connect(func() -> void:
		var t := clampf(roundf(ts.value), 0.0, dur)
		var v: Array = vals.get_children().filter(func(c: Node) -> bool: return not c.is_queued_for_deletion()).map(func(c: SpinBox) -> float: return c.value)
		var cur := K.rect_at(clip, t, host.rect(), cv)
		match ADD_PROPS[ps.selected][0]:
			"position":
				var s := P.stored_from_display({"x": v[0], "y": v[1], "w": cur.w, "h": cur.h}, cv, host.center)
				K.add_position(clip, t, s.x / cv.x, s.y / cv.y)
			"scale":
				K.add_scale(clip, t, v[0], v[0] * ((cur.h / cv.y) / (cur.w / cv.x)) if cur.w > 0 else v[0])
			var p:
				K.add(clip, {"time": t, "property": p, "value": v[0], "easing": "linear"})
		changed.emit()
		refresh.call_deferred())
	row2.add_child(add)
	g.add_child(row2)


func _group(title: String) -> VBoxContainer:
	var l := Label.new()
	l.text = title
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(l)
	var g := VBoxContainer.new()
	add_child(g)
	return g


func _row(g: VBoxContainer, t: float) -> HBoxContainer:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = "@ %d ms" % roundi(t)
	l.custom_minimum_size.x = 74
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	row.add_child(l)
	g.add_child(row)
	return row


func _num(v: float, lo: float, hi: float, step: float, cb: Callable) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = v
	s.custom_minimum_size.x = 58
	s.value_changed.connect(cb)
	return s
