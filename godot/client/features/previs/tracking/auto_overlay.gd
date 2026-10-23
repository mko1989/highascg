extends PanelContainer
## WO-710 — Auto tracking overlay for the Live tab and the Previs main tab (owner: "in live and previs main tab there
## should be a tracking overlay, smallish where i can do quick adjustments to each detected person"). Docked top-right
## of the view (the Inspector is the column to its right), semi-transparent, collapsible to one chip. One row per
## detected person: label, pin 1–9 (click the active pin to unpin), and once pinned the quick sets — head count
## (− N +, 0 = share) and one chip per PTZ camera. Footer: home state, Home now, after_s. Fed by WS `tracking:auto`
## (≤ 5 Hz); the first look comes from GET /api/tracking/auto. Rows are rebuilt only when the person set changes.

const M := preload("res://features/previs/tracking/auto_overlay_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

const FONT := 11
const BTN_W := 17

static var collapsed := false  # shared by the Live and the Previs instance

var data: Dictionary = {}
var _chip: Button
var _status: Label
var _body: VBoxContainer
var _rows_box: VBoxContainer
var _empty: Label
var _rows := {}  # person key → { box, name, follow, pins[], sets, minus, count, plus, chips{cam key → Button} }
var _sig := "\u0000"
var _home_lbl: Label
var _after_lbl: Label
var _status_until := 0


func _init() -> void:
	anchor_left = 1.0
	anchor_right = 1.0
	offset_right = -8
	offset_top = 8
	grow_horizontal = Control.GROW_DIRECTION_BEGIN
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	var sb := ThemeBuilder.box(Color(ThemeBuilder.BG_DARK, 0.78), Color(ThemeBuilder.BORDER, 0.8), 1, 4)
	sb.set_content_margin_all(4)
	add_theme_stylebox_override("panel", sb)


func _ready() -> void:
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 3)
	add_child(col)
	var head := HBoxContainer.new()
	col.add_child(head)
	_chip = _btn("", 0)
	_chip.toggle_mode = true
	_chip.tooltip_text = "Auto tracking: pin people 1–9, set how many heads follow, PTZ cameras, home"
	_chip.toggled.connect(func(on: bool) -> void:
		collapsed = not on
		_apply())
	head.add_child(_chip)
	_status = _label("")
	_status.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.clip_text = true
	head.add_child(_status)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 3)
	col.add_child(_body)
	_rows_box = VBoxContainer.new()
	_rows_box.add_theme_constant_override("separation", 4)
	_body.add_child(_rows_box)
	_empty = _label("no one detected")
	_empty.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_body.add_child(_empty)
	_body.add_child(_footer())
	Ws.message.connect(func(type: String, d: Variant) -> void:
		if type == "tracking:auto" and d is Dictionary:
			adopt(d))
	Ws.connected.connect(_fetch)  # the broadcast is on-change only: ask again after a reconnect
	_fetch.call_deferred()


func adopt(d: Dictionary) -> void:
	data = d
	_apply()


## First look (404 until the server has WO-708 — then silently nothing).
func _fetch() -> void:
	var r: Dictionary = await Api.get_json("/api/tracking/auto")
	if r.ok and r.data is Dictionary:
		adopt(r.data)


func _home() -> Dictionary:
	return data.get("home") if data.get("home") is Dictionary else {}


func _process(_d: float) -> void:
	if _status_until > 0 and Time.get_ticks_msec() > _status_until:
		_status.text = ""
		_status_until = 0


func _apply() -> void:
	visible = M.has_content(data)
	if not visible:
		return
	var rows := M.rows(data)
	var sig := M.signature(data)
	if sig != _sig:
		_sig = sig
		_rebuild(rows)
	var pool := M.pool_size(data)
	for r in rows:
		_update_row(r, pool)
	_empty.visible = rows.is_empty()
	_chip.set_pressed_no_signal(not collapsed)
	var chip := "%s Track %d" % ["▸" if collapsed else "▾", rows.size()]
	if collapsed and _home().get("active") == true:
		chip += " · home"
	_chip.text = chip
	_body.visible = not collapsed
	_home_lbl.text = M.home_text(_home())
	_after_lbl.text = "%ds" % int(_home().get("after_s", 0))


func _rebuild(rows: Array) -> void:
	for c in _rows_box.get_children():
		_rows_box.remove_child(c)
		c.queue_free()
	_rows.clear()
	var cams := M.ptz_cams(data)
	for r in rows:
		_rows[r.key] = _build_row(r, cams)


func _build_row(r: Dictionary, cams: Array) -> Dictionary:
	var key: String = r.key
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 1)
	_rows_box.add_child(box)
	var l1 := HBoxContainer.new()
	l1.add_theme_constant_override("separation", 1)
	box.add_child(l1)
	var ent := {"box": box, "chips": {}, "pins": []}
	ent.name = _label("")
	(ent.name as Label).custom_minimum_size.x = 86
	(ent.name as Label).clip_text = true
	l1.add_child(ent.name)
	ent.follow = _label("")
	(ent.follow as Label).custom_minimum_size.x = 24
	(ent.follow as Label).tooltip_text = "heads following this person now"
	l1.add_child(ent.follow)
	for s in range(1, M.SLOTS + 1):
		var b := _btn(str(s), BTN_W)
		b.toggle_mode = true
		b.tooltip_text = "Pin %d (click again to unpin)" % s
		b.pressed.connect(func() -> void: _pin(key, s))
		l1.add_child(b)
		(ent.pins as Array).append(b)
	var sets := HBoxContainer.new()
	sets.add_theme_constant_override("separation", 1)
	box.add_child(sets)
	ent.sets = sets
	var lead := Control.new()
	lead.custom_minimum_size.x = 14
	sets.add_child(lead)
	ent.minus = _btn("−", BTN_W)
	ent.minus.tooltip_text = "Fewer heads (share = an even split with the others)"
	ent.minus.pressed.connect(func() -> void: _step_heads(key, -1))
	sets.add_child(ent.minus)
	ent.count = _label("share")
	(ent.count as Label).custom_minimum_size.x = 38
	(ent.count as Label).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sets.add_child(ent.count)
	ent.plus = _btn("+", BTN_W)
	ent.plus.tooltip_text = "More heads on this person"
	ent.plus.pressed.connect(func() -> void: _step_heads(key, 1))
	sets.add_child(ent.plus)
	for c in cams:
		var cb := _btn(str(c.name), 0)
		cb.toggle_mode = true
		cb.tooltip_text = "PTZ camera follows this person"
		var cam: Variant = c.id
		cb.pressed.connect(func() -> void: _toggle_ptz(key, cam))
		sets.add_child(cb)
		(ent.chips as Dictionary)[c.key] = cb
	return ent


func _update_row(r: Dictionary, pool: int) -> void:
	var ent: Dictionary = _rows.get(r.key, {})
	if ent.is_empty():
		return
	var nm := ent.name as Label
	nm.text = r.label
	nm.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if r.lost else ThemeBuilder.TEXT)
	(ent.follow as Label).text = "→%d" % r.following
	var pins: Array = ent.pins
	for i in pins.size():
		(pins[i] as Button).set_pressed_no_signal(r.slot == i + 1)
	(ent.sets as Control).visible = r.pinned
	(ent.count as Label).text = M.count_text(r.count)
	(ent.minus as Button).disabled = r.count <= 0
	(ent.plus as Button).disabled = r.count >= pool
	for ck in ent.chips:
		(ent.chips[ck] as Button).set_pressed_no_signal(ck in r.ptz)


func _row(key: String) -> Dictionary:
	for r in M.rows(data):
		if r.key == key:
			return r
	return {}


func _pin(key: String, clicked: int) -> void:
	var r := _row(key)
	if r.is_empty():
		return
	await _post("/api/tracking/auto/pin", {"key": key, "slot": M.pin_target(int(r.slot), clicked)})


func _step_heads(key: String, dir: int) -> void:
	var r := _row(key)
	if r.is_empty() or not r.pinned:
		return
	var n := M.step_count(int(r.count), dir, M.pool_size(data))
	var s := M.slot_of(data, int(r.slot))
	if not s.is_empty():
		s["heads"] = n  # optimistic: a fast second click steps from here, the next broadcast confirms
		_apply()
	await _post("/api/tracking/auto/slot", {"slot": int(r.slot), "heads": n})


func _toggle_ptz(key: String, cam: Variant) -> void:
	var r := _row(key)
	if r.is_empty() or not r.pinned:
		return
	var s := M.slot_of(data, int(r.slot))
	var cur: Array = s.get("ptz", []) if s.get("ptz") is Array else []
	var next := M.toggle_ptz(cur, cam)
	if not s.is_empty():
		s["ptz"] = next
		_apply()
	await _post("/api/tracking/auto/slot", {"slot": int(r.slot), "ptz": next})


func _footer() -> Control:
	var f := HBoxContainer.new()
	f.add_theme_constant_override("separation", 2)
	_home_lbl = _label("")
	_home_lbl.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_home_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	f.add_child(_home_lbl)
	var now := _btn("Home now", 0)
	now.tooltip_text = "Send the fronts home (an even spread over the stage) until the next person appears"
	now.pressed.connect(func() -> void: await _post("/api/tracking/auto/home", {"now": true}))
	f.add_child(now)
	var ap := _label("after")
	ap.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	f.add_child(ap)
	for dir in [-1, 1]:
		if dir == 1:
			_after_lbl = _label("")
			_after_lbl.custom_minimum_size.x = 30
			_after_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			_after_lbl.tooltip_text = "Seconds with nobody detected before the fronts go home"
			f.add_child(_after_lbl)
		var b := _btn("−" if dir < 0 else "+", BTN_W)
		b.pressed.connect(func() -> void: await _step_after(dir))
		f.add_child(b)
	return f


func _step_after(dir: int) -> void:
	var cur := float(_home().get("after_s", 10.0))
	await _post("/api/tracking/auto/home", {"after_s": M.step_after(cur, dir)})


func _post(path: String, body: Dictionary) -> void:
	var r: Dictionary = await Api.post_json(path, body)
	if r.ok:
		return
	_status.text = str(r.get("reason", "")) if str(r.get("reason", "")) != "" else str(r.get("error", "failed"))
	_status.tooltip_text = _status.text
	_status_until = Time.get_ticks_msec() + 5000


func _label(t: String) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_font_size_override("font_size", FONT)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


## A tiny button: never takes focus (arrow keys stay with the view), flat boxes, small font. w 0 = fit the text.
func _btn(t: String, w: int) -> Button:
	var b := Button.new()
	b.text = t
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", FONT)
	if w > 0:
		b.custom_minimum_size.x = w
	for st in ["normal", "hover", "pressed", "disabled", "hover_pressed"]:
		var bg := ThemeBuilder.BG_ELEVATED
		if st in ["pressed", "hover_pressed"]:
			bg = ThemeBuilder.ACCENT.darkened(0.35)
		elif st == "hover":
			bg = ThemeBuilder.BG_PANEL.lightened(0.15)
		var sb := ThemeBuilder.box(Color(bg, 0.9), Color(ThemeBuilder.BORDER, 0.9), 1, 3)
		sb.content_margin_left = 3
		sb.content_margin_right = 3
		sb.content_margin_top = 0
		sb.content_margin_bottom = 0
		b.add_theme_stylebox_override(st, sb)
	return b
