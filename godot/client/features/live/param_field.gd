extends RefCounted
## WO-601 — one schema-driven parameter editor (web inspector-effects.js / inspector-pip-overlay.js
## renderParamEditor): select → OptionButton, bool → CheckBox, color → ColorPickerButton (CSS string),
## float/int → slider + spin. `px_dim` > 0 edits a 0–1 fraction as pixels (crop, WO-158).
## on_change(value) gets the STORED value (fraction, int, CSS colour string…).

const E := preload("res://features/live/effects_model.gd")
const P := preload("res://features/live/pip_model.gd")


static func label_for(s: Dictionary, px_dim := 0) -> String:
	return str(s.get("label", s.get("key", ""))) + (" (px)" if px_dim > 0 else "")


static func control(s: Dictionary, v: Variant, on_change: Callable, px_dim := 0) -> Control:
	match str(s.get("type", "float")):
		"select":
			var o := OptionButton.new()
			var opts: Array = s.get("options", [])
			for opt in opts:
				o.add_item(str(opt))
			o.select(maxi(0, opts.map(func(x: Variant) -> String: return str(x)).find(str(v))))
			o.item_selected.connect(func(k: int) -> void: on_change.call(opts[k]))
			return o
		"bool":
			var c := CheckBox.new()
			c.button_pressed = v == true
			c.toggled.connect(func(on: bool) -> void: on_change.call(on))
			return c
		"color":
			var cp := ColorPickerButton.new()
			cp.custom_minimum_size = Vector2(60, 24)
			cp.color = P.parse_css(str(v if v != null else s.get("default", "#ffffff")))
			cp.color_changed.connect(func(c: Color) -> void: on_change.call(P.to_css(c)))
			return cp
		_:
			return _number(s, float(v if v != null else 0.0), on_change, px_dim)


static func _number(s: Dictionary, v: float, on_change: Callable, dim: int) -> Control:
	var is_int := str(s.get("type", "")) == "int"
	var row := HBoxContainer.new()
	var sp := SpinBox.new()
	sp.custom_minimum_size.x = 90
	if dim > 0:
		sp.min_value = float(s.get("min", 0.0)) * dim
		sp.max_value = float(s.get("max", 1.0)) * dim
		sp.step = 1
		sp.value = E.to_px(v, dim)
		if s.has("pxHint"):
			sp.tooltip_text = str(s.pxHint)
	else:
		sp.min_value = float(s.get("min", -100000.0))
		sp.max_value = float(s.get("max", 100000.0))
		sp.step = 1.0 if is_int else float(s.get("step", 0.01))
		sp.value = v
	var sl: HSlider = null
	if s.get("slider", false) == true:
		sl = HSlider.new()
		sl.custom_minimum_size.x = 110
		sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		sl.min_value = sp.min_value
		sl.max_value = sp.max_value
		sl.step = sp.step
		sl.value = sp.value
		sl.value_changed.connect(func(x: float) -> void:
			if not is_equal_approx(sp.value, x):
				sp.value = x)
		row.add_child(sl)
	sp.value_changed.connect(func(x: float) -> void:
		if sl != null and not is_equal_approx(sl.value, x):
			sl.set_value_no_signal(x)
		on_change.call(E.from_px(x, dim, s) if dim > 0 else (int(x) if is_int else x)))
	row.add_child(sp)
	return row
