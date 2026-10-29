extends AcceptDialog
## WO-807 automatic edge proposal — the review modal (Previs → Lighting → DMX output → "Pixel map…" while a proposal
## is pending, or "Auto proposal…" in the Pixel map window). The server (src/fixtures/pixel-map-proposal.js) maps every
## linear pixel fixture to its nearest LED-wall edge; this shows it per wall: a small picture of the wall with the
## proposed strips and one row per fixture (name, universe @ address, edge, distance, pixel spacing, pixels mapped,
## warning), the inset / depth it used (read-only), and Accept (POST …/proposal/accept) / Dismiss (…/dismiss) / Close.
## refresh() also feeds the Pixel map button's tooltip (`state_changed`). Pure logic: pixel_map_proposal_model.gd.

const PM := preload("res://features/previs/fixtures/pixel_map_proposal_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const URL := "/api/fixtures/pixelmap/proposal"
const COLS := ["Fixture", "Address", "Edge", "Distance", "Spacing", "Pixels", "Warning"]

signal state_changed(p: Dictionary)  # every refresh (the button's tooltip)
signal saved  # Accept stored the mappings (an open, unedited Pixel map window reloads)
signal edit_requested  # "Pixel map…": open the hand editor

var proposal := {}  # pixel_map_proposal_model.gd parse()
var _addr := {}  # fixture id → "U18 @ 421"
var _summary: Label
var _params: Label
var _list: VBoxContainer
var _note: Label
var _replace: CheckBox
var _accept: Button
var _dismiss: Button
var _busy := false
var _button: Button
var _tip := ""
var _key := "-"  # PM.watch_key of the last read
var _at := -100000


func _init() -> void:
	title = "Pixel map — automatic proposal"
	ok_button_text = "Close"
	exclusive = true
	size = Vector2i(1280, 820)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	add_child(body)
	_summary = Label.new()
	_summary.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_summary.custom_minimum_size.x = 1200  # a width, so the first layout does not wrap it at 1 px (pixel_map_window.gd)
	body.add_child(_summary)
	_params = _muted(body)
	_params.tooltip_text = "The server's settings for this proposal (read-only): strips start this far inside the wall's edge and are this deep"
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 14)
	scroll.add_child(_list)
	body.add_child(scroll)
	var foot := HBoxContainer.new()
	_replace = CheckBox.new()
	_replace.text = "Drop other fixtures' mappings"
	_replace.tooltip_text = "Off: mappings of fixtures the proposal does not cover are kept. On: the pixel map becomes exactly this proposal."
	foot.add_child(_replace)
	_note = Label.new()
	_note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	foot.add_child(_note)
	body.add_child(foot)
	_accept = add_button("Accept", true)
	_accept.tooltip_text = "Save these mappings to the pixel map (the fixtures follow their strips once the DMX output is on)"
	_accept.pressed.connect(_on_accept)
	_dismiss = add_button("Dismiss", true)
	_dismiss.tooltip_text = "Drop the pending proposal; it is not proposed again for this rig"
	_dismiss.pressed.connect(_on_dismiss)
	var edit := add_button("Pixel map…", true)
	edit.tooltip_text = "Open the hand editor (the saved mappings, region by region)"
	edit.pressed.connect(func() -> void:
		hide()
		edit_requested.emit())


func _muted(parent: Control) -> Label:
	var l := Label.new()
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	parent.add_child(l)
	return l


func pending() -> bool:
	return PM.state(proposal) == "pending"


## The "Pixel map…" button this proposal annotates: its tooltip gets the proposal line (PM.button_tooltip) and its
## text a dot while one is pending. Read on start, on hover (at most every 3 s) and when the project's proposal,
## mapping count or MVR changes (the server broadcasts its writes) — not on every project change.
func attach(b: Button, tip: String) -> void:
	_button = b
	_tip = tip
	b.mouse_entered.connect(watch.bind(true))
	Store.project_changed.connect(func(_p: Dictionary) -> void: watch(false))
	state_changed.connect(func(p: Dictionary) -> void:
		if is_instance_valid(_button):
			_button.tooltip_text = PM.button_tooltip(_tip, p)
			_button.text = "Pixel map… •" if PM.state(p) == "pending" else "Pixel map…")
	watch(true)


func watch(hover: bool) -> void:
	var key := PM.watch_key(Store.project)
	var now := Time.get_ticks_msec()
	if key == _key and (not hover or now - _at < 3000):
		return
	_key = key
	_at = now
	refresh()


## GET the proposal (the pending one, else what the server would propose now); no side effects on the server.
func refresh() -> void:
	if _busy:
		return
	_busy = true
	var res: Dictionary = await Api.get_json(URL)
	_busy = false
	proposal = PM.parse(res.data if res.data is Dictionary else {"error": res.error})
	if not res.ok and proposal.error == "":
		proposal.error = res.error
	state_changed.emit(proposal)
	if visible:
		_fill()


func open() -> void:
	_note.text = ""
	popup_centered_clamped(Vector2i(1280, 820), 0.9)
	var px: Dictionary = await Api.get_json("/api/fixtures/pixelmap/pixels")
	_addr = PM.addresses(px.data if px.ok else null)
	await refresh()
	_fill()


func _fill() -> void:
	var st := PM.state(proposal)
	_summary.text = PM.summary(proposal)
	_summary.add_theme_color_override("font_color", ThemeBuilder.WARN if st == "pending" else
		(ThemeBuilder.SUCCESS if st == "applied" else ThemeBuilder.TEXT))
	_params.text = PM.params_line(proposal) if st != "none" else ""
	_accept.disabled = st == "none" or st == "applied"
	_dismiss.disabled = st != "pending"
	_replace.disabled = _accept.disabled
	for c in _list.get_children():
		c.queue_free()
	for line in PM.skipped_lines(proposal):
		_muted(_list).text = line
	for g in PM.groups(proposal):
		_list.add_child(_wall_block(g))


func _wall_block(g: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var w: Dictionary = g.wall
	if not w.is_empty():
		var pic := WallPreview.new()
		pic.wall = w
		pic.rects = PM.strips(w, g.fixtures)
		pic.custom_minimum_size = Vector2(150, 190)
		pic.size_flags_vertical = Control.SIZE_SHRINK_BEGIN  # beside the wall's title, not centred on a long list
		pic.tooltip_text = "%s with the proposed strips (%d)" % [str(w.get("name", "")), pic.rects.size()]
		row.add_child(pic)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var head := Label.new()
	head.text = str(g.title)
	head.add_theme_color_override("font_color", ThemeBuilder.ACCENT_HOVER if not w.is_empty() else ThemeBuilder.WARN)
	col.add_child(head)
	var grid := GridContainer.new()
	grid.columns = COLS.size()
	grid.add_theme_constant_override("h_separation", 18)
	for h in COLS:
		var l := Label.new()
		l.text = h
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		grid.add_child(l)
	for f in g.fixtures:
		var cells := PM.row_cells(f, _addr)
		for i in cells.size():
			var l := Label.new()
			l.text = str(cells[i])
			if i == cells.size() - 1 and l.text != "":
				l.add_theme_color_override("font_color", ThemeBuilder.WARN)
			grid.add_child(l)
	col.add_child(grid)
	row.add_child(col)
	return row


func _on_accept() -> void:
	_accept.disabled = true
	var res: Dictionary = await Api.post_json(URL + "/accept", {"replace": true} if _replace.button_pressed else {})
	var n := PM.accept_note(res)
	await refresh()
	_set_note(n)
	if res.ok:
		saved.emit()


func _on_dismiss() -> void:
	_dismiss.disabled = true
	var res: Dictionary = await Api.post_json(URL + "/dismiss", {})
	var n := PM.dismiss_note(res)
	await refresh()
	_set_note(n)


func _set_note(n: Dictionary) -> void:
	_note.text = str(n.text)
	_note.add_theme_color_override("font_color", ThemeBuilder.ERROR if n.bad else ThemeBuilder.SUCCESS)


## A wall letterboxed into the control with its proposed strips (wall-local pixels, pixel_map_proposal_model.gd).
class WallPreview extends Control:
	var wall := {}
	var rects: Array = []

	func _draw() -> void:
		var r: Dictionary = wall.get("rect", {})
		var px := Vector2(float(r.get("w", 0)), float(r.get("h", 0)))
		var fit := PM.fit(px, size)
		var s: float = fit.scale
		if s <= 0.0:
			return
		var o: Vector2 = fit.offset
		draw_rect(Rect2(o, px * s), ThemeBuilder.BG_ELEVATED)
		for q in rects:
			var rr: Rect2 = q
			draw_rect(Rect2(o + rr.position * s, (rr.size * s).max(Vector2(1, 1))), ThemeBuilder.WARN)
		draw_rect(Rect2(o, px * s), ThemeBuilder.BORDER, false, 1.0)
