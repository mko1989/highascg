extends VBoxContainer
## WO-1049 — Live ▸ Visuals routing (owner 12.11: "select from live tab, with a expand, visuals layers routing, so i can play
## for instance first 2 layers on the bg output pgm1 and layers 4 5 on overlay channel pgm2"). Collapsed by default: one
## header line. Expanded: each output's target (screen + Caspar layer) and one row per layer of the Visuals bank on the
## canvas, top layer first like the Visuals layer list, with PGM 1 | PGM 2. Every change goes through the Visuals tab
## (visuals_route.gd set_layer_out / set_output → the tab's own edit paths: autosave, undo, MIDI and the Visuals tab see it).
## The panel only reads the tab's slice; while expanded and shown it re-reads it every POLL_S (rows rebuilt on a change only).

const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const POLL_S := 0.5

var tab: Node  # the Visuals tab (visuals_tab.gd); null → the one in group "visuals_canvas"
var head: Button
var body: VBoxContainer
var rows := []  # by layer index of the bank on air: {name: Label, b1: Button, b2: Button}
var outs := {}  # 1 | 2 → {screen: OptionButton, layer: SpinBox}
var note: Label
var _list: VBoxContainer
var _timer: Timer
var _sig := ""
var _quiet := false


func _init() -> void:
	add_theme_constant_override("separation", 2)
	head = Button.new()
	head.flat = true
	head.toggle_mode = true
	head.focus_mode = Control.FOCUS_NONE
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.tooltip_text = "Which Visuals layers play on PGM 1 (background) and which on PGM 2 (keyed overlay)"
	head.toggled.connect(func(on: bool) -> void: expand(on))
	add_child(head)
	body = VBoxContainer.new()
	body.visible = false
	add_child(body)
	for n in [1, 2]:
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = "PGM %d" % n
		l.custom_minimum_size.x = 56
		row.add_child(l)
		var sc := OptionButton.new()
		sc.tooltip_text = ("Screen of the background output (the Visuals' Send screen)" if n == 1
			else "Screen of the overlay output (transparent: only the layers routed to PGM 2)")
		sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sc.item_selected.connect(func(_i: int) -> void: _target(n))
		row.add_child(sc)
		var ll := Label.new()
		ll.text = "layer"
		row.add_child(ll)
		var sp := SpinBox.new()
		sp.min_value = 1
		sp.max_value = 9999
		sp.tooltip_text = "Caspar layer on that screen's PGM channel"
		sp.value_changed.connect(func(_v: float) -> void: _target(n))
		row.add_child(sp)
		outs[n] = {"screen": sc, "layer": sp}
		body.add_child(row)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 1)
	body.add_child(_list)
	note = Label.new()
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	body.add_child(note)
	_timer = Timer.new()
	_timer.wait_time = POLL_S
	_timer.timeout.connect(refresh)
	add_child(_timer)
	_head_text(0)


func _ready() -> void:
	visibility_changed.connect(func() -> void: _poll())
	refresh.call_deferred()


## Expanded (the targets and the layer rows) or one header line.
func expand(on: bool) -> void:
	head.set_pressed_no_signal(on)
	body.visible = on
	_sig = ""
	refresh()
	_poll()


func _poll() -> void:
	if _timer.is_inside_tree():
		if body.visible and is_visible_in_tree():
			_timer.start()
		else:
			_timer.stop()


func _vt() -> Node:
	if is_instance_valid(tab):
		return tab
	return get_tree().get_first_node_in_group("visuals_canvas") if is_inside_tree() else null


## Re-reads the Visuals tab; rebuilds the rows only when the stack, the routes or the targets changed.
func refresh() -> void:
	var t := _vt()
	if t == null or t.get("route") == null:
		_head_text(0)
		note.text = "No Visuals tab."
		return
	var ls: Array = t.route.air_layers()
	_head_text(ls.filter(func(l: Dictionary) -> bool: return L.out_of(l) == 2).size())
	if not body.visible:
		return
	var cm: Variant = t._cm()
	var sc := M.screens(cm)
	var sig := JSON.stringify([ls.map(func(l: Dictionary) -> Array: return [L.describe(l), L.out_of(l)]), t.slice.output,
		t.slice.get("output2"), sc, t.sending, t.route.sending, t.route.note])
	if sig == _sig:
		return
	_sig = sig
	_quiet = true
	for n in outs:
		var o: Dictionary = t.slice.output if n == 1 else M.output2_of(t.slice.get("output2"), int(t.slice.output.layer))
		var ob: OptionButton = outs[n].screen
		ob.clear()
		for s in sc:
			ob.add_item(s.label)
		if not sc.is_empty():
			ob.select(clampi(int(o.screen), 0, sc.size() - 1))  # output 2's default past the last screen → the first (M)
		var sp: SpinBox = outs[n].layer
		if not sp.get_line_edit().has_focus():
			sp.set_value_no_signal(int(o.layer))
	_quiet = false
	_rows(ls)
	note.text = _note(t, cm)


func _rows(ls: Array) -> void:
	for c in _list.get_children():
		_list.remove_child(c)
		c.queue_free()
	rows.clear()
	for i in ls.size():
		var r := {}
		var row := HBoxContainer.new()
		r.name = Label.new()
		r.name.text = "%d  %s" % [i + 1, L.describe(ls[i])]
		r.name.clip_text = true
		r.name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.name.modulate = Color(1, 1, 1, 1.0 if ls[i].get("visible", true) else 0.5)
		row.add_child(r.name)
		var g := ButtonGroup.new()
		for n in [1, 2]:
			var b := Button.new()
			b.text = "PGM %d" % n
			b.toggle_mode = true
			b.button_group = g
			b.focus_mode = Control.FOCUS_NONE
			b.set_pressed_no_signal(L.out_of(ls[i]) == n)
			b.tooltip_text = "Play layer %d on PGM %d" % [i + 1, n]
			b.pressed.connect(func() -> void: set_out(i, n))
			row.add_child(b)
			r["b%d" % n] = b
		rows.append(r)
	for i in range(rows.size() - 1, -1, -1):  # top layer first, like the Visuals layer list
		_list.add_child(rows[i].name.get_parent())
	if ls.is_empty():
		var e := Label.new()
		e.text = "No Visuals layers on the canvas."
		e.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_list.add_child(e)


## Layer `i` (of the bank on air) to PGM `n`, through the Visuals tab.
func set_out(i: int, n: int) -> void:
	var t := _vt()
	if t == null or t.get("route") == null:
		return
	t.route.set_layer_out(i, n)
	_sig = ""
	refresh()


func _target(n: int) -> void:
	var t := _vt()
	if _quiet or t == null or t.get("route") == null:
		return
	t.route.set_output(n, maxi(0, outs[n].screen.selected), int(outs[n].layer.value))
	_sig = ""
	refresh()


func _head_text(n2: int) -> void:
	head.text = ("▾ " if body != null and body.visible else "▸ ") + "Visuals routing" + (
		"  ·  %d layer%s on PGM 2" % [n2, "" if n2 == 1 else "s"] if n2 > 0 else "")


func _note(t: Node, cm: Variant) -> String:
	if str(t.route.note) != "":
		return str(t.route.note)
	if t.sending.is_empty():
		return "Send is off (Visuals ▸ Send to screen): the routes apply when the Visuals are sent."
	var s := "On air: PGM 1 → ch %d-%d" % [int(t.sending.channel), int(t.sending.layer)]
	if not t.route.sending.is_empty():
		s += "  ·  PGM 2 → ch %d-%d (shm://%s)" % [int(t.route.sending.channel), int(t.route.sending.layer), t.route.ring()]
	elif L.uses_out2(t.route.air_layers()):
		var tg: Dictionary = M.output2_target(cm, t.slice)
		s += "  ·  PGM 2 → ch %d-%d starting…" % [int(tg.channel), int(tg.layer)]
	return s
