extends VBoxContainer
## WO-603 slice 6 — "Layer Playback Mode" (web inspector-layer-playlist.js): Single Media / Playlist Workflow; in
## playlist mode the items (drag to reorder, timeless length or clip length, per-item loop, ✕), a drop zone that takes
## one or several media at once (multi-select drag), Advance / Loop List / Transition / Timeless "Apply to all" and
## Next ▶ (manual advance or a held item). Every change is planned by POST /api/playlist/edit — the server also
## pushes it into the running engine when the look is live; this section stores the returned patch (`patch`).
## WO-766: per item ↘ (fade down when done: plays once, fades out over "↘ Fade frames", default half the channel
## rate); a double-click on a row picks that item and Next steps — on program it plays, otherwise the preview moves
## (and a take starts there). ▸ marks the item the server reports as current.
## WO-768: "+ Empty" adds an empty item — playing it transitions the layer to nothing (Next, then Next plays on).

signal patch(p: Dictionary)

const M := preload("res://features/live/playlist_edit_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")

var scene_id := ""
var _layer: Dictionary = {}
var _rows: Array = []
var _described := ""  # the playlist JSON the rows belong to — rows are re-asked only when it changes
var _syncing := false
var _mode: OptionButton
var _list_box: VBoxContainer
var _tree: Tree
var _drop: PanelContainer
var _advance: OptionButton
var _loop: CheckBox
var _tr_type: OptionButton
var _tr_frames: SpinBox
var _fade_frames: SpinBox
var _fade_default := 25
var _secs: SpinBox
var _next: Button
var _status: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	add_child(HSeparator.new())
	var title := Label.new()
	title.text = "Layer Playback Mode"
	title.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(title)
	_mode = OptionButton.new()
	for m in M.MODES:
		_mode.add_item(m[1])
	_mode.item_selected.connect(func(i: int) -> void: _edit("mode", {"mode": M.MODES[i][0]}))
	add_child(_mode)
	_list_box = VBoxContainer.new()
	add_child(_list_box)
	_drop = PanelContainer.new()
	_drop.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_DARK, ThemeBuilder.BORDER, 2))
	var hint := Label.new()
	hint.text = "Drag & Drop Media Here (several at once: select them first)"
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.custom_minimum_size = Vector2(240, 36)
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_drop.add_child(hint)
	_drop.set_drag_forwarding(Callable(), func(_at: Vector2, d: Variant) -> bool: return M.droppable(d), func(_at: Vector2, d: Variant) -> void: _add(d))
	_list_box.add_child(_drop)
	_tree = Tree.new()
	_tree.columns = 4
	_tree.hide_root = true
	_tree.select_mode = Tree.SELECT_ROW
	_tree.custom_minimum_size.y = 150
	_tree.set_column_expand(0, true)
	for c in [[1, 84], [2, 72], [3, 64]]:
		_tree.set_column_expand(c[0], false)
		_tree.set_column_custom_minimum_width(c[0], c[1])
	_tree.item_edited.connect(_on_edited)
	_tree.item_activated.connect(func() -> void: _pick(_tree.get_selected()))
	_tree.button_clicked.connect(func(it: TreeItem, _c: int, _id: int, _b: int) -> void: _edit("remove", {"index": it.get_index()}))
	_tree.set_drag_forwarding(_row_drag, _tree_can_drop, _tree_drop)
	_list_box.add_child(_tree)
	var add_empty := Button.new()
	add_empty.text = "+ Empty"
	add_empty.tooltip_text = "Add an empty item after the selected row (or at the end) — playing it transitions this layer to nothing"
	add_empty.pressed.connect(_on_add_empty)
	_list_box.add_child(add_empty)
	var g := GridContainer.new()
	g.columns = 2
	_list_box.add_child(g)
	_advance = _option(M.ADVANCE, func(i: int) -> void: _edit("settings", {"advance": M.ADVANCE[i][0]}))
	_row(g, "Advance Mode", _advance)
	_loop = CheckBox.new()
	_loop.toggled.connect(func(on: bool) -> void: _edit("settings", {"loop": on}))
	_row(g, "Loop List", _loop)
	_tr_type = _option(M.TRANSITIONS, func(i: int) -> void: _edit("settings", {"transition": {"type": M.TRANSITIONS[i][0]}}))
	_row(g, "Transition Type", _tr_type)
	_tr_frames = _spin(0, 250, func(v: float) -> void: _edit("settings", {"transition": {"duration": int(v)}}))
	_row(g, "Transition Frames", _tr_frames)
	_fade_frames = _spin(1, 250, func(v: float) -> void: _edit("settings", {"fadeFrames": int(v)}))
	_fade_frames.tooltip_text = "Frames a ↘ item fades out over at its end (default: half the channel's frame rate)"
	_row(g, "↘ Fade frames", _fade_frames)
	var tl := HBoxContainer.new()
	_secs = _spin(1, 86400, Callable())
	_secs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tl.add_child(_secs)
	var apply := Button.new()
	apply.text = "Apply to all"
	apply.tooltip_text = "Set the duration of every image / template / shader item in this playlist"
	apply.pressed.connect(func() -> void: _edit("timeless", {"secs": _secs.value}))
	tl.add_child(apply)
	_row(g, "Timeless items (s)", tl)
	_next = Button.new()
	_next.text = "Next"
	_next.icon = Icons.texture("next")
	_next.tooltip_text = "Next item — plays it on program; otherwise moves the preview (a take starts there). Double-click a row to pick one"
	_next.pressed.connect(_on_next)
	_list_box.add_child(_next)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size.x = 240
	_status.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	_status.visible = false
	add_child(_status)


func show_layer(look_id: String, layer: Dictionary) -> void:
	scene_id = look_id
	_layer = layer
	visible = not layer.is_empty()
	if layer.is_empty():
		return
	_syncing = true
	var is_list := str(layer.get("sourceMode", "single")) == "list"
	_mode.select(1 if is_list else 0)
	_list_box.visible = is_list
	_advance.select(M.index_of(M.ADVANCE, str(layer.get("playlistAdvance", "auto"))))
	_loop.button_pressed = layer.get("playlistLoop", true) != false
	var t: Dictionary = layer.get("playlistTransition", {}) if layer.get("playlistTransition") is Dictionary else {}
	_tr_type.select(M.index_of(M.TRANSITIONS, str(t.get("type", "MIX"))))
	_tr_frames.value = float(t.get("duration", 12))
	_fade_frames.value = _fade_set(layer) if _fade_set(layer) > 0 else _fade_default
	_syncing = false
	var key := JSON.stringify(layer.get("playlist", []))
	if is_list and key != _described:
		_edit("describe")


## One planned edit: the server returns the patch (stored through `patch`) and the rows to show.
func _edit(op: String, args := {}) -> void:
	if _syncing or _layer.is_empty():
		return
	var res: Dictionary = await Api.post_json("/api/playlist/edit", M.edit_body(scene_id, _layer, op, args))
	var d: Variant = res.get("data")
	if not (res.get("ok", false) and d is Dictionary):
		_status.text = "Playlist: %s" % (str((d as Dictionary).get("error", res.get("error", "failed"))) if d is Dictionary else str(res.get("error", "failed")))
		_status.visible = true
		if op != "describe":
			show_layer(scene_id, _layer)  # put the controls back to the stored values
		return
	_status.visible = false
	var p: Dictionary = d.get("patch", {})
	var next := _layer.duplicate()
	next.merge(p, true)
	_described = JSON.stringify(next.get("playlist", []))
	_fade_default = int(d.get("fadeFramesDefault", _fade_default))
	if not _fade_frames.get_line_edit().has_focus() and _fade_set(next) <= 0:
		_fade_frames.set_value_no_signal(_fade_default)
	_render(d.get("rows", []), bool(d.get("showsNext", false)), float(d.get("timelessSecs", 20)), int(d.get("currentIndex", -1)))
	if not p.is_empty():
		patch.emit(p)


func _render(rows: Array, shows_next: bool, timeless_secs: float, current := -1) -> void:
	_rows = rows
	_tree.clear()
	var root := _tree.create_item()
	for r in rows:
		var it := _tree.create_item(root)
		it.set_text(0, ("▸ " if it.get_index() == current else "") + M.row_name(r))
		it.set_tooltip_text(0, str(r.get("value", "")))
		if r.get("missing", false):
			it.set_custom_color(0, ThemeBuilder.ERROR)
		elif r.get("empty", false):
			it.set_custom_color(0, ThemeBuilder.TEXT_MUTED)
			it.set_tooltip_text(0, "Empty: the layer transitions to nothing")
		if r.get("timeless", false):
			it.set_cell_mode(1, TreeItem.CELL_MODE_RANGE)
			it.set_range_config(1, 1, 86400, 1)
			it.set_range(1, float(r.get("duration", 20)))
			it.set_editable(1, true)
			it.set_tooltip_text(1, "Seconds this item stays up")
		else:
			it.set_text(1, str(r.get("length", "")))
			it.set_tooltip_text(1, "Clip length")
			it.set_custom_color(1, ThemeBuilder.TEXT_MUTED)
		it.set_cell_mode(2, TreeItem.CELL_MODE_CHECK)
		it.set_text(2, "Loop")
		it.set_checked(2, r.get("loop", false))
		it.set_editable(2, true)
		it.set_tooltip_text(2, "This item repeats and holds the playlist until Next")
		if not r.get("timeless", false):  # a still has no end to fade at
			it.set_cell_mode(3, TreeItem.CELL_MODE_CHECK)
			it.set_text(3, "↘")
			it.set_checked(3, r.get("fadeOut", false))
			it.set_editable(3, true)
			it.set_tooltip_text(3, "Fade down when done: plays once and fades out at its end")
		it.add_button(3, Icons.texture("close", 12), 0, false, "Remove from the playlist")
	_next.visible = shows_next
	if not _secs.get_line_edit().has_focus():
		_secs.set_value_no_signal(timeless_secs)


func _on_edited() -> void:
	var it := _tree.get_edited()
	if it == null:
		return
	match _tree.get_edited_column():
		1: _edit("item", {"index": it.get_index(), "duration": it.get_range(1)})
		2: _edit("item", {"index": it.get_index(), "loop": it.is_checked(2)})
		3: _edit("item", {"index": it.get_index(), "fadeOut": it.is_checked(3)})


func _add(data: Variant) -> void:
	_edit("add", {"items": data})


## WO-768: an empty item after the selected row (else at the end).
func _on_add_empty() -> void:
	var sel := _tree.get_selected()
	_edit("add_empty", {"at": sel.get_index() + 1} if sel != null else {})


func _row_drag(at: Vector2) -> Variant:
	var it := _tree.get_item_at_position(at)
	if it == null:
		return null
	var l := Label.new()
	l.text = "↕ " + it.get_text(0)
	set_drag_preview(l)
	return {"playlist_row": it.get_index()}


func _tree_can_drop(_at: Vector2, d: Variant) -> bool:
	var ok := (d is Dictionary and (d as Dictionary).has("playlist_row")) or M.droppable(d)
	_tree.drop_mode_flags = Tree.DROP_MODE_INBETWEEN if ok else Tree.DROP_MODE_DISABLED
	return ok


func _tree_drop(at: Vector2, d: Variant) -> void:
	_tree.drop_mode_flags = Tree.DROP_MODE_DISABLED
	if not (d is Dictionary and (d as Dictionary).has("playlist_row")):
		_add(d)  # media dropped on the list appends, like the drop zone
		return
	var target := _tree.get_item_at_position(at)
	var to := M.drop_index(int(d.playlist_row), target.get_index() if target != null else -1, _tree.get_drop_section_at_position(at), _rows.size())
	if to >= 0:
		_edit("move", {"from": int(d.playlist_row), "to": to})


func _on_next() -> void:
	_transport("/api/playlist/edit/next", {})


func _pick(it: TreeItem) -> void:
	if it != null:
		_transport("/api/playlist/edit/pick", {"index": it.get_index()})


## Next / pick: the server decides program (play it) or preview (move the start item, re-stage PRV); ▸ follows.
func _transport(path: String, args: Dictionary) -> void:
	var body := {"sceneId": scene_id, "layerNumber": int(_layer.get("layerNumber", 0))}
	body.merge(args)
	var res: Dictionary = await Api.post_json(path, body)
	var d: Variant = res.get("data")
	_status.visible = not res.get("ok", false)
	if _status.visible:
		_status.text = str((d as Dictionary).get("error", res.get("error", "failed"))) if d is Dictionary else str(res.get("error", "failed"))
	else:
		_edit("describe")


## The layer's own ↘ length (0 = not set: the server's default, half the channel rate).
static func _fade_set(l: Dictionary) -> int:
	return int(l.get("playlistFadeFrames")) if l.get("playlistFadeFrames") is float or l.get("playlistFadeFrames") is int else 0


func _row(g: GridContainer, label: String, c: Control) -> void:
	var l := Label.new()
	l.text = label
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)


func _option(table: Array, cb: Callable) -> OptionButton:
	var o := OptionButton.new()
	for t in table:
		o.add_item(t[1])
	o.item_selected.connect(cb)
	return o


func _spin(lo: float, hi: float, cb: Callable) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 1
	if cb.is_valid():
		s.value_changed.connect(func(v: float) -> void:
			if not _syncing:
				cb.call(v))
	return s
