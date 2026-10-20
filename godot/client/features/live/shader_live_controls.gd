extends RefCounted
## WO-606 — Shader Live widgets (web shader-controls-panel.js + shader-live-rows.js): key controls, the
## Advanced rows and the Caspar-mixer rides. Each widget calls back into the panel (`ui`), which posts the
## op to the node; a slider applies on release, and a wheel / key burst settles into ONE push after 150 ms
## (every push is a shader recompile on air).

const M := preload("res://features/live/shader_live_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


## A slider that commits on drag end, or 150 ms after the last wheel/key/click step.
static func slider(lo: float, hi: float, step: float, v: float, commit: Callable, readout: Label = null) -> HSlider:
	var s := HSlider.new()
	s.min_value = minf(lo, v)
	s.max_value = maxf(hi, v)
	s.step = step if step > 0.0 else 0.01
	s.value = v
	s.custom_minimum_size.x = 150
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var st := {"drag": false}
	var t := Timer.new()
	t.one_shot = true
	t.wait_time = 0.15
	s.add_child(t)
	t.timeout.connect(func() -> void: commit.call(s.value))
	s.drag_started.connect(func() -> void: st.drag = true)
	s.drag_ended.connect(func(changed: bool) -> void:
		st.drag = false
		if changed:
			commit.call(s.value))
	s.value_changed.connect(func(nv: float) -> void:
		if readout != null:
			readout.text = M.fmt(nv, s.step)
		if not st.drag:
			t.start())
	return s


static func tool_btn(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(cb)
	return b


static func muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


## ↺ ≋ ✎ (+ ✕ hide on key controls, ★ pin on Advanced rows).
static func tools(ui: Object, p: Dictionary, key_control: bool) -> HBoxContainer:
	var row := HBoxContainer.new()
	var key := str(p.key)
	if not key_control:
		row.add_child(tool_btn("★", "Add to the main controls", func() -> void: ui.post_op("pin", {"key": key})))
	row.add_child(tool_btn("↺", "Revert to the library value", func() -> void: ui.post_op("reset", {"key": key})))
	var w := tool_btn("≋", "SHOW me: briefly wiggles this value on the preview output, then restores", func() -> void: pass)
	w.pressed.connect(func() -> void: ui.wiggle(key, w))
	row.add_child(w)
	row.add_child(tool_btn("✎", "Name this parameter (saved to the shader library)", func() -> void: ui.rename(p)))
	if key_control:
		row.add_child(tool_btn("✕", "Move to Advanced", func() -> void: ui.post_op("hide", {"key": key})))
	return row


## The value widget(s) of one param: colour picker (+ alpha for vec4) or one slider per component.
static func value_widgets(ui: Object, p: Dictionary) -> Control:
	var box := VBoxContainer.new()
	var key := str(p.key)
	var vals: Array = p.get("values", [])
	if str(p.get("kind", "")) == "color":
		var pick := ColorPickerButton.new()
		pick.color = M.to_color(vals)
		pick.edit_alpha = int(p.get("vec", 3)) == 4
		pick.custom_minimum_size = Vector2(64, 26)
		var t := Timer.new()
		t.one_shot = true
		t.wait_time = 0.25
		pick.add_child(t)
		t.timeout.connect(func() -> void: ui.post_op("set", {"key": key, "values": M.from_color(pick.color, int(p.get("vec", 3)))}, false))
		pick.color_changed.connect(func(_c: Color) -> void: t.start())
		box.add_child(pick)
		return box
	for ci in vals.size():
		var row := HBoxContainer.new()
		if vals.size() > 1:
			row.add_child(muted("xyzw"[ci]))
		var out := Label.new()
		out.custom_minimum_size.x = 56
		out.text = M.fmt(float(vals[ci]), float(p.get("step", 0.01)))
		var idx: int = ci
		row.add_child(slider(float(p.get("min", 0)), float(p.get("max", 1)), float(p.get("step", 0.01)), float(vals[ci]), func(v: float) -> void:
			var next: Array = (ui.current_values(key) as Array).duplicate()
			if idx < next.size():
				next[idx] = v
				ui.post_op("set", {"key": key, "values": next}, false), out))
		row.add_child(out)
		box.add_child(row)
	return box


## One key control (web controlHtml): macro ride, colour swatch, toggle, or slider.
static func key_control(ui: Object, c: Dictionary, by_key: Dictionary) -> Control:
	var card := VBoxContainer.new()
	card.custom_minimum_size.x = 300
	card.tooltip_text = str(c.get("hint", ""))
	var head := HBoxContainer.new()
	var name := Label.new()
	name.text = str(c.get("label", ""))
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(name)
	card.add_child(head)
	var widget := str(c.get("widget", "slider"))
	if widget == "macro":
		var out := Label.new()
		var k := float(c.get("factor", 1.0))
		out.text = "×%.2f" % k
		head.add_child(out)
		var id := str(c.id)
		head.add_child(tool_btn("↺", "Revert to the library values", func() -> void: ui.post_op("reset", {"control": id})))
		var s := slider(0.0, 3.0, 0.05, k, func(v: float) -> void: ui.post_op("macro", {"control": id, "factor": v}, false))
		s.value_changed.connect(func(nv: float) -> void: out.text = "×%.2f" % nv)
		card.add_child(s)
		return card
	var p: Dictionary = by_key.get(str((c.get("keys", [""]) as Array)[0]), {})
	if p.is_empty():
		return card
	head.add_child(tools(ui, p, true))
	if widget == "toggle":
		var cb := CheckButton.new()
		cb.button_pressed = float((p.values as Array)[0]) != 0.0
		var key := str(p.key)
		cb.toggled.connect(func(on: bool) -> void: ui.post_op("set", {"key": key, "values": [1 if on else 0]}, false))
		head.add_child(cb)
		head.move_child(cb, 0)
		return card
	card.add_child(value_widgets(ui, p))
	return card


## One Advanced row (web paramRowHtml): ★ ↺ ≋ ✎ · name · value widgets · what-it-does line.
static func param_row(ui: Object, p: Dictionary) -> Control:
	var box := VBoxContainer.new()
	var row := HBoxContainer.new()
	row.add_child(tools(ui, p, false))
	var name := Label.new()
	name.text = M.param_name(p)
	name.tooltip_text = M.param_tip(p)
	name.mouse_filter = Control.MOUSE_FILTER_STOP
	name.custom_minimum_size.x = 180
	if str(p.get("label", "")) != "":
		name.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	row.add_child(name)
	var w := value_widgets(ui, p)
	w.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(w)
	box.add_child(row)
	var line := M.param_line(p)
	if line != "":
		var l := muted(line)
		l.tooltip_text = str(p.get("expr", ""))
		l.mouse_filter = Control.MOUSE_FILTER_STOP
		l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		l.custom_minimum_size.x = 200
		box.add_child(l)
	return box


## A bordered group: title + content (web shader-live__group).
static func group(title: String, content: Control) -> PanelContainer:
	var pc := PanelContainer.new()
	pc.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1, 6))
	var v := VBoxContainer.new()
	pc.add_child(v)
	var t := muted(title)
	v.add_child(t)
	v.add_child(content)
	return pc


## Caspar-mixer rides on the selected instance (opacity / brightness / saturation / contrast).
static func mixer_rows(ui: Object) -> Control:
	var g := GridContainer.new()
	g.columns = 3
	for r in M.MIXER_ROWS:
		g.add_child(muted(str(r.label)))
		var out := Label.new()
		out.custom_minimum_size.x = 48
		out.text = M.fmt(float(r.def), float(r.step))
		var cmd := str(r.cmd)
		g.add_child(slider(float(r.min), float(r.max), float(r.step), float(r.def), func(v: float) -> void: ui.mixer(cmd, v), out))
		g.add_child(out)
	return g
