extends RefCounted
## WO-806 — the screen-timer settings form (web timer-control-panel-settings-form.js buildTimerSettings), shared by the
## screen-timer Inspector page (WO-601, `extended` = font, colours, border too) and the Timers dock's ⚙ (the short form:
## Duration, Mode, Target, Size, Position, X / Y px — WO-567: "the compact ones should stay as is"). Position and px
## apply at once, the rest on Save. `apply` takes the config patch and writes it to every screen the timer is on.

const T := preload("res://features/live/screen_timer_model.gd")
const C := preload("res://features/live/countdown_model.gd")
const P := preload("res://features/live/pip_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const NumericField := preload("res://core/numeric_field.gd")
const COLOURS := [["timerColor", "Color"], ["amberColor", "Amber"], ["redColor", "Red"], ["timerBorderColor", "Border color"]]


## `g`: a 2-column grid the label / field pairs go into; `box`: where the Save button goes (under the grid).
static func build(g: GridContainer, box: Container, cfg: Dictionary, extended: bool, apply: Callable) -> void:
	var w := {}
	g.add_child(muted("Duration"))
	var hms := HBoxContainer.new()
	var p := C.secs_to_hms(float(cfg.durationSec) if float(cfg.durationSec) > 0 else 300.0)
	for i in 3:
		var sp := SpinBox.new()
		sp.max_value = 99 if i == 0 else 59
		sp.value = p[i]
		sp.suffix = ["h", "m", "s"][i]
		hms.add_child(sp)
		w[["h", "m", "s"][i]] = sp
	g.add_child(hms)
	w["mode"] = choice(g, "Mode", T.MODES.map(func(m: Array) -> String: return m[1]), T.MODES.map(func(m: Array) -> String: return m[0]).find(str(cfg.mode)))
	var tl := muted("Target time")
	g.add_child(tl)
	var target := LineEdit.new()
	target.text = str(cfg.targetTime)
	target.placeholder_text = "HH:MM:SS"
	g.add_child(target)
	var sync_mode := func() -> void:
		var clock: bool = (w.mode as OptionButton).selected == 1
		tl.visible = clock
		target.visible = clock
	(w.mode as OptionButton).item_selected.connect(func(_i: int) -> void: sync_mode.call())
	sync_mode.call()
	w["size"] = number(g, "Size (vw)", 1, 100, float(cfg.timerFontSize))
	if extended:
		w["font"] = choice(g, "Font", T.FONTS.map(func(f: Array) -> String: return f[1]), T.FONTS.map(func(f: Array) -> String: return f[0]).find(str(cfg.timerFontFamily)))
		for c in COLOURS:
			g.add_child(muted(c[1]))
			var cp := ColorPickerButton.new()
			cp.edit_alpha = false
			cp.custom_minimum_size = Vector2(60, 24)
			cp.color = P.parse_css(str(cfg.get(c[0], T.DEFAULTS[c[0]])))
			g.add_child(cp)
			w[c[0]] = cp
		w["border"] = number(g, "Border (px)", 0, 20, float(cfg.timerBorderWidth))
	var pos := choice(g, "Position", T.POSITIONS, maxi(0, T.POSITIONS.find(str(cfg.position))))
	pos.item_selected.connect(func(i: int) -> void: apply.call({"position": T.POSITIONS[i]}))
	g.add_child(muted("Position px X / Y"))
	var pxr := HBoxContainer.new()
	var px: Array[LineEdit] = []
	for k in ["posX", "posY"]:
		var le := NumericField.math_line(LineEdit.new(), true, -INF, INF, Callable(), true)  # px values take + - * / ( ) (RULES.md); blank clears (WO-839: blank_ok)
		le.text = str(cfg.get(k, ""))
		le.placeholder_text = "%s px" % k.right(1)
		le.tooltip_text = "X and Y together override the preset — clear both to go back to it"
		le.custom_minimum_size.x = 70
		pxr.add_child(le)
		px.append(le)
	var apply_px := func(_t: Variant = null) -> void: apply.call({"posX": T.px_value(px[0].text), "posY": T.px_value(px[1].text)})
	for le in px:
		le.text_submitted.connect(apply_px)
		le.focus_exited.connect(apply_px)
	g.add_child(pxr)
	var save := button("Save", ("Duration, mode, target, size, font, colours, border" if extended else "Duration, mode, target, size")
		+ " → every screen this timer is on", func() -> void:
		var out := {"durationSec": C.hms_to_secs(w.h.value, w.m.value, w.s.value), "mode": T.MODES[(w.mode as OptionButton).selected][0],
			"targetTime": target.text, "position": T.POSITIONS[pos.selected], "posX": T.px_value(px[0].text), "posY": T.px_value(px[1].text),
			"timerFontSize": clampi(int((w.size as SpinBox).value), 1, 100)}
		if extended:
			out["timerFontFamily"] = T.FONTS[maxi(0, (w.font as OptionButton).selected)][0]
			out["timerBorderWidth"] = clampi(int((w.border as SpinBox).value), 0, 20)
			for c in COLOURS:
				out[c[0]] = P.to_css((w[c[0]] as ColorPickerButton).color)
		apply.call(out))
	box.add_child(save)


static func choice(g: GridContainer, label: String, items: Array, sel: int) -> OptionButton:
	g.add_child(muted(label))
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it))
	o.select(maxi(0, sel))
	g.add_child(o)
	return o


static func number(g: GridContainer, label: String, lo: float, hi: float, v: float) -> SpinBox:
	g.add_child(muted(label))
	var sp := SpinBox.new()
	sp.min_value = lo
	sp.max_value = hi
	sp.value = v
	g.add_child(sp)
	return sp


static func button(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	return b


static func muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
