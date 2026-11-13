extends Node
## WO-908 — A/B banks for the Visuals (owner: "dj style dual screen… bank a/b. one is on screen while the other is in prv
## for preparation, or mixed together when wanted"). The mixer's two decks (visuals_mixer.gd `dj`) both stay on stage;
## the crossfader (`x`: 0 = A, 1 = B) mixes them, AUTO / CUT take the other side over the fade. The tab's slice keeps the
## picture of the bank being edited (so the layer list, parameters, Flow, Shader and MIDI edit it unchanged) and
## `slice.dj.other` the other bank's — switching the edited bank swaps the two, the decks already hold both. A look picked
## by hand (button, key, MIDI, playlist double-click) loads into the bank off the canvas; the autopilot and a running
## playlist load it there and take it. When a take lands, editing moves to the new PRV bank (prepare the next one).
## Lives under the tab (visuals_tab.gd): the PRV view left of the canvas and the bar under it.

const M := preload("res://features/visuals/visuals_model.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const Cam := preload("res://features/visuals/visuals_camera.gd")
const Catalog := preload("res://features/visuals/visuals_catalog.gd")
const NAMES := ["A", "B"]
const PGM := Color(0.9, 0.25, 0.2)
const PRV := Color(0.3, 0.8, 0.35)

var tab: Node
var on := false
var bar: HBoxContainer
var _env_other := {}  # the other bank's Flow state (smoothing, envelopes), swapped with the tab's on a bank switch
var _settled := -1  # the bank the crossfader last came to rest on
var _seq := 0
var _prv: TextureRect
var _prv_tag: Label
var _pgm_tag: Label
var _toggle: Button
var _edit: Array[Button] = []
var _fader: HSlider
var _take: Button
var _cut: Button
var _quiet := false


func _init(t: Node) -> void:
	tab = t


static func _view_rect() -> TextureRect:
	var r := TextureRect.new()
	r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	r.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	r.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.size_flags_vertical = Control.SIZE_EXPAND_FILL
	r.custom_minimum_size.y = 240
	return r


static func _tag(parent: Control) -> Label:
	var l := Label.new()
	l.position = Vector2(6, 4)
	l.add_theme_font_size_override("font_size", 13)
	l.add_theme_constant_override("outline_size", 4)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(l)
	return l


## The tab's canvas inside the top area: the PRV view (DJ only) left of it, the A/B bar under both.
func wrap(canvas: TextureRect) -> Control:
	var top := VBoxContainer.new()
	var views := HBoxContainer.new()
	views.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_prv = _view_rect()
	_prv.visible = false
	_prv.tooltip_text = "PRV: the bank off the canvas — drop a visual here to add it to this bank; AUTO / CUT / the crossfader put it on air"
	_prv.set_drag_forwarding(Callable(), func(_at: Vector2, data: Variant) -> bool: return Catalog.parse(data) != null,
		func(_at: Vector2, data: Variant) -> void: _drop(_prv_bank(), data))
	views.add_child(_prv)
	canvas.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	canvas.size_flags_vertical = Control.SIZE_EXPAND_FILL
	canvas.set_drag_forwarding(Callable(), func(_at: Vector2, data: Variant) -> bool: return Catalog.parse(data) != null,
		func(_at: Vector2, data: Variant) -> void: _drop(tab.mixer.air() if on else -1, data))
	views.add_child(canvas)
	_prv_tag = _tag(_prv)
	_prv_tag.add_theme_color_override("font_color", PRV)
	_pgm_tag = _tag(canvas)
	_pgm_tag.add_theme_color_override("font_color", PGM)
	top.add_child(views)
	bar = HBoxContainer.new()
	_toggle = _btn("A/B", "A/B banks: two decks — one on air, the other in PRV to prepare (or both mixed with the crossfader)", true)
	_toggle.toggled.connect(func(v: bool) -> void:
		if not _quiet:
			set_on(v))
	for i in 2:
		var b := _btn("Edit " + NAMES[i], "The layer list, parameters, Flow and MIDI edit bank %s" % NAMES[i], true)
		b.pressed.connect(func() -> void: focus(i))
		_edit.append(b)
	var a := Label.new()
	a.text = "A"
	bar.add_child(a)
	_fader = HSlider.new()
	_fader.max_value = 1.0
	_fader.step = 0.001
	_fader.custom_minimum_size.x = 180
	_fader.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_fader.tooltip_text = "Crossfader: A ← → B (both mixed in between)"
	_fader.value_changed.connect(func(v: float) -> void:
		if not _quiet:
			tab.mixer.set_x(v))
	_fader.drag_ended.connect(func(_c: bool) -> void: _save())
	bar.add_child(_fader)
	var b2 := Label.new()
	b2.text = "B"
	bar.add_child(b2)
	_take = _btn("AUTO", "Crossfade to the PRV bank over the fade time", false)
	_take.pressed.connect(take)
	_cut = _btn("CUT", "Cut to the PRV bank", false)
	_cut.pressed.connect(func() -> void: take(true))
	top.add_child(bar)
	_show()
	return top


func _btn(text: String, tip: String, toggle: bool) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.toggle_mode = toggle
	b.focus_mode = Control.FOCUS_NONE
	bar.add_child(b)
	return b


## WO-900 MIDI targets: "xfade" (the crossfader), "take" (AUTO), "cut".
func control(id: String) -> Control:
	return {"xfade": _fader, "take": _take, "cut": _cut, "edit:1": _edit[0] if _edit.size() > 0 else null,
		"edit:2": _edit[1] if _edit.size() > 1 else null}.get(id) if on else null


## The bank off the canvas (the smaller share while mixed).
func _prv_bank() -> int:
	return 1 - tab.mixer.air()


## The slice was (re)loaded: its banks onto the decks. Already in DJ mode the crossfader stays where it is (a remote
## sync or an undo must not jump the canvas); the client starting up takes the stored position.
func from_slice() -> void:
	var d: Dictionary = tab.slice.dj if tab.slice.get("dj") is Dictionary else {}
	var want: bool = d.get("on") == true and d.get("other") is Dictionary
	if not want:
		tab.slice.erase("dj")
		if on:
			on = false
			tab.mixer.set_dj(false)
		_show()
		return
	var other: Array = Looks.normalize([d.other])
	tab.slice.dj = {"on": true, "edit": clampi(int(d.get("edit", 0)), 0, 1), "x": clampf(float(d.get("x", 0.0)), 0.0, 1.0),
		"other": other[0] if not other.is_empty() else Looks.capture(tab.slice)}
	if not on or tab.mixer.live != tab.slice.dj.edit:
		tab.mixer.set_dj(true, tab.slice.dj.edit, tab.mixer.x if on else tab.slice.dj.x)
		_env_other = tab._env.duplicate(true)
	on = true
	_settled = tab.mixer.air()
	_load_other()
	_show()


## A/B on: the picture on air stays on its deck as one bank; the other deck (PRV) starts as a copy of it, to edit.
## Off: the bank on the canvas becomes the Visuals' picture, the other one fades out.
func set_on(v: bool) -> void:
	if v == on:
		return
	if v:
		var air: int = tab.mixer.air()
		tab.slice.dj = {"on": true, "edit": 1 - air, "x": float(air), "other": Looks.capture(tab.slice)}
		tab.mixer.set_dj(true, 1 - air, float(air))
		_env_other = tab._env
		tab._env = _env_other.duplicate(true)
		on = true
		_settled = air
		tab._go(false)  # the copy into the PRV deck (cut: nobody sees it)
	else:
		focus(tab.mixer.air())
		on = false
		tab.mixer.fade_s = float(tab.slice.fade)
		tab.mixer.set_dj(false)
		tab.slice.erase("dj")
	_show()
	tab._store()


## Edit bank `i`: the slice and the other bank swap pictures (the decks already run both, nothing restarts).
func focus(i: int) -> void:
	if not on or i == tab.mixer.live:
		_show()
		return
	var cur := Looks.capture(tab.slice)
	var dj: Dictionary = tab.slice.dj
	tab.slice = Looks.apply(tab.slice, dj.other)
	tab.slice.dj = {"on": true, "edit": i, "x": tab.mixer.x, "other": cur}
	tab.mixer.live = i
	var e: Dictionary = tab._env
	tab._env = _env_other
	_env_other = e
	tab.sel = -1
	tab.flow.set_graph(tab.slice.graph)
	tab.page.set_state(tab.slice, tab._cm())
	tab.show_ctl.showing = Looks.showing(tab.show_ctl.looks, tab.slice)
	tab.page.show_panel.set_looks(tab.show_ctl.looks, tab.show_ctl.showing)
	tab.cam_ctl.from_slice()
	tab._orbit_world()
	_show()
	tab._store()


## Before a look lands: editing moves to the bank off the canvas (no-op without A/B).
func to_prv() -> void:
	if on:
		focus(_prv_bank())


## AUTO (or CUT): the PRV bank onto the canvas.
func take(cut := false) -> void:
	if not on:
		return
	tab.mixer.fade_s = float(tab.slice.fade)
	tab.mixer.take(cut)
	_show()


## One frame (after the tab evaluated its bank): the other bank's parameters from its own Flow, the crossfader's state.
func step(buses: Dictionary, delta: float) -> void:
	if not on:
		return
	var o: Dictionary = tab.slice.dj.other
	tab.mixer.deck_of(1 - tab.mixer.live).params = M.evaluate(o.graph, buses, o.params, _env_other, delta)
	var x: float = tab.mixer.x
	if tab.mixer.goal < 0.0 and (x == 0.0 or x == 1.0) and int(x) != _settled:
		_settled = int(x)
		focus(1 - _settled)  # a take landed: prepare the next one
		_save()
	_show_x()


func _drop(bank: int, data: Variant) -> void:
	if bank >= 0:
		focus(bank)
	tab.drop_visual(data, tab._target() if Input.is_key_pressed(KEY_SHIFT) else -1)


## The other bank's layers onto its deck (in place: unchanged layers keep running).
func _load_other() -> void:
	_seq += 1
	var seq := _seq
	var o: Dictionary = tab.slice.dj.other
	var cfgs := {}
	for l in o.layers:
		if l.scene == "shader" and str(l.get("shader", "")) != "" and not cfgs.has(l.shader):
			cfgs[l.shader] = await tab._shader_config(str(l.shader))
			if seq != _seq:
				return
	if not on:
		return
	var d: Node = tab.mixer.deck_of(1 - tab.mixer.live)
	d.cam = Cam.pose_of(o.camera)
	d.apply(o.layers, cfgs, 0.0 if tab.mixer.weight(1 - tab.mixer.live) <= 0.0 else float(tab.slice.fade))


func _save() -> void:
	if on:
		tab.slice.dj.x = tab.mixer.x
		tab._store()


func _show() -> void:
	if bar == null:
		return
	_quiet = true
	_toggle.set_pressed_no_signal(on)
	for c in bar.get_children():
		if c != _toggle:
			c.visible = on
	_prv.visible = on
	_pgm_tag.visible = on
	_quiet = false
	_show_x()


func _show_x() -> void:
	if tab.get("solo") != null:
		tab.solo.previews()  # WO-1053: the PRV bank's / the mix's picked layers over the views
	if not on or _prv == null:
		return
	var m: Node = tab.mixer
	var p := _prv_bank()
	_prv.texture = m.deck_of(p).out.get_texture()
	_quiet = true
	_fader.set_value_no_signal(m.x)
	_quiet = false
	var mixed: bool = m.x > 0.0 and m.x < 1.0
	_pgm_tag.text = ("PGM  A %d %% + B %d %%" % [roundi(m.weight(0) * 100.0), roundi(m.weight(1) * 100.0)] if mixed
		else "PGM  " + NAMES[1 - p]) + ("  ✎" if m.live != p else "")
	_prv_tag.text = "PRV  " + NAMES[p] + ("  ✎" if m.live == p else "")
	_take.disabled = m.goal >= 0.0
	for i in 2:
		_edit[i].set_pressed_no_signal(i == m.live)
	_place(_prv_tag, _prv)
	_place(_pgm_tag, _pgm_tag.get_parent())


## A view's tag at the picture's top-left corner (the view letterboxes it).
static func _place(tag: Label, view: TextureRect) -> void:
	var ts: Vector2 = view.texture.get_size() if view.texture != null else Vector2.ZERO
	if ts.x <= 0.0 or ts.y <= 0.0:
		return
	var k := minf(view.size.x / ts.x, view.size.y / ts.y)
	tag.position = (view.size - ts * k) / 2.0 + Vector2(6, 4)
