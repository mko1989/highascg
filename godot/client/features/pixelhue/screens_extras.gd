extends VBoxContainer
## WO-1039 — Screens: test pattern, colour and output format of the selected screen (Studio's screen-extras-ui.js).
## Every change applies at once: `command(request)` carries the body for the `screens` write.

signal command(request: Dictionary)
signal toggled(is_open: bool)

const M := preload("res://features/pixelhue/screens_model.gd")
const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _screen: Dictionary = {}
var _limits: Dictionary = {}
var _body: VBoxContainer


func setup(screen: Dictionary, limits: Dictionary, is_open: bool) -> void:
	_screen = screen
	_limits = limits
	var pat: Variant = screen.get("pattern")
	var on: bool = pat is Dictionary and pat.get("enable") == true
	var head := Button.new()
	head.toggle_mode = true
	head.flat = true
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.text = "Test pattern, colour and format" + ("   (pattern on)" if on else "")
	head.button_pressed = is_open or on
	add_child(head)
	_body = VBoxContainer.new()
	_body.visible = head.button_pressed
	add_child(_body)
	head.toggled.connect(func(v: bool) -> void:
		_body.visible = v
		toggled.emit(v))
	if _limits.get("pattern") is Dictionary and pat is Dictionary:
		_build_pattern(pat)
	var q: Variant = screen.get("quality")
	if not (_limits.get("quality", []) as Array).is_empty() and q is Dictionary:
		_build_quality(q)
	var f: Variant = screen.get("format")
	if _limits.get("format") is Dictionary and f is Dictionary:
		_build_format(f)
	var note := Label.new()
	note.text = "Applies to the whole screen output, on top of layer and output settings."
	note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_body.add_child(note)


func _row() -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", 10)
	_body.add_child(r)
	return r


func _pick(row: HBoxContainer, label: String, items: Array, current: Variant, apply: Callable) -> void:
	var l := Label.new()
	l.text = label
	row.add_child(l)
	var ob := OptionButton.new()
	var sel := 0
	for i in items.size():
		ob.add_item(str(items[i][1]), i)
		ob.set_item_metadata(i, items[i][0])
		if str(items[i][0]) == str(current):
			sel = i
	ob.selected = sel
	ob.item_selected.connect(func(i: int) -> void: apply.call(ob.get_item_metadata(i)))
	row.add_child(ob)


func _num(row: HBoxContainer, label: String, value: int, lo: int, hi: int, apply: Callable) -> void:
	var l := Label.new()
	l.text = label
	row.add_child(l)
	var le := LineEdit.new()
	NF.math_line(le, true, lo, hi)
	le.text = str(value)
	le.custom_minimum_size.x = 70
	var last := [value]
	var commit := func() -> void:
		var v := int(le.text)
		if v != last[0]:
			last[0] = v
			apply.call(v)
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	row.add_child(le)


func _build_pattern(p: Dictionary) -> void:
	var lim: Dictionary = _limits.pattern
	var id: int = int(_screen.id)
	var row := _row()
	var send := func(change: Dictionary) -> void: command.emit(M.pattern_body(id, change))
	var types: Array = [["off", "Off"]]
	types.append_array(lim.get("types", []))
	_pick(row, "Pattern", types, p.get("type") if p.get("enable") == true else "off", func(v: Variant) -> void: send.call(M.pattern_choice_change(v)))
	var br: Array = []
	for v in lim.get("bright", []):
		br.append([int(v), M.bright_label(int(v))])
	_pick(row, "Brightness", br, p.get("bright"), func(v: Variant) -> void: send.call({"bright": int(v)}))
	var t := int(p.get("type", 0))
	if M.is_grid_pattern(t):
		var gears: Array = []
		for v in lim.get("gear", []):
			gears.append([int(v), M.gear_label(int(v))])
		_pick(row, "Spacing", gears, p.get("grid"), func(v: Variant) -> void: send.call({"grid": int(v)}))
	if M.is_line_pattern(t):
		var pix: Dictionary = lim.get("pixel", {})
		var ln: Dictionary = lim.get("line", {})
		_num(row, "Spacing px", int(p.get("grid", 1)), int(pix.get("min", 1)), int(pix.get("max", 1024)), func(v: int) -> void: send.call({"grid": v}))
		_num(row, "Line px", int(p.get("lineWidth", 1)), int(ln.get("min", 1)), int(ln.get("max", 64)), func(v: int) -> void: send.call({"lineWidth": v}))
		var sp: Array = []
		for v in lim.get("speed", []):
			sp.append([int(v), M.speed_label(int(v))])
		_pick(row, "Motion", sp, p.get("speed"), func(v: Variant) -> void: send.call({"speed": int(v)}))


func _build_quality(q: Dictionary) -> void:
	var id: int = int(_screen.id)
	var row := _row()
	var allowed: Array = _limits.quality
	var defaults := {}
	for k in M.QUALITY:
		if not allowed.has(k[0]):
			continue
		defaults[k[0]] = k[4]
		var key: String = k[0]
		_num(row, k[1], int(q.get(key, k[4])), k[2], k[3], func(v: int) -> void: command.emit(M.quality_body(id, {key: v})))
	var reset := Button.new()
	reset.text = "Reset colour"
	reset.flat = true
	reset.pressed.connect(func() -> void: command.emit(M.quality_body(id, defaults)))
	row.add_child(reset)


func _build_format(f: Dictionary) -> void:
	var lim: Dictionary = _limits.format
	var id: int = int(_screen.id)
	var rule := M.format_rule(lim, int(f.get("dynamicRange", 0)))
	var row := _row()
	var send := func(c: Dictionary) -> void: command.emit(M.format_body(id, c))
	var ranges: Array = []
	for v in lim.get("ranges", []):
		ranges.append([int(v), M.RANGE_NAMES[clampi(int(v), 0, 2)]])
	_pick(row, "Dynamic range", ranges, f.get("dynamicRange"), func(v: Variant) -> void: send.call(M.range_change(lim, f, int(v))))
	var spaces: Array = []
	for s in M.SAMPLING:
		for allowed in lim.get("spaces", []):
			if int(allowed) == s[0]:
				spaces.append(s)
	_pick(row, "Sampling", spaces, f.get("colorSpace"), func(v: Variant) -> void: send.call({"colorSpace": int(v)}))
	var depths: Array = []
	for d in M.depth_choices(rule, int(f.get("colorSpace", 0))):
		depths.append([int(d), "%d bit" % int(d)])
	_pick(row, "Bit depth", depths, f.get("colorDepth"), func(v: Variant) -> void: send.call({"colorDepth": int(v)}))
	var gamuts: Array = []
	for g in rule.get("gamuts", []):
		gamuts.append([int(g), M.GAMUT_NAMES[clampi(int(g), 0, 3)]])
	_pick(row, "Gamut", gamuts, f.get("colorGamut"), func(v: Variant) -> void: send.call({"colorGamut": int(v)}))
	if (_screen.get("outputs", []) as Array).is_empty():
		for c in row.get_children():
			if c is OptionButton:
				(c as OptionButton).disabled = true
