extends HBoxContainer
## WO-1039 — PixelHue ▸ Screens: create / delete screens, freeze / blackout, map outputs onto a screen with the
## draggable canvas (screens_canvas.gd), test pattern / colour / format (screens_extras.gd). Studio resource `screens`.
## Layout edits are a draft per screen until "Apply screen layout"; everything else applies at once.

signal status(text: String)

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const M := preload("res://features/pixelhue/screens_model.gd")
const Canvas := preload("res://features/pixelhue/screens_canvas.gd")
const Extras := preload("res://features/pixelhue/screens_extras.gd")
const NF := preload("res://core/numeric_field.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _state: Dictionary = {}
var _drafts: Dictionary = {}  # screen id → draft
var _selected := -1
var _busy := false
var _extras_open := false
var _new_name := ""
var _new_type := M.TYPE_MAIN
var _cols := 0
var _left: VBoxContainer
var _main: VBoxContainer
var _canvas: Canvas
var _pending: Label


func _ready() -> void:
	add_theme_constant_override("separation", 12)
	_left = VBoxContainer.new()
	_left.custom_minimum_size.x = 230
	add_child(_left)
	var sc := ScrollContainer.new()
	sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(sc)
	_main = VBoxContainer.new()
	_main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_main.add_theme_constant_override("separation", 8)
	sc.add_child(_main)
	_render()


func _screens() -> Array:
	return _state.get("screens", [])


func _selected_screen() -> Dictionary:
	for s in _screens():
		if int(s.id) == _selected:
			return s
	return {}


func _dirty() -> bool:
	for s in _screens():
		if _drafts.has(int(s.id)) and M.draft_changed(_drafts[int(s.id)], s):
			return true
	return false


## Re-read from the switcher; pending layout drafts of screens that still exist are kept.
func refresh() -> void:
	if _busy:
		return
	_busy = true
	var r: Dictionary = await StudioApi.read(Api, "screens")
	_busy = false
	if not r.ok:
		status.emit(str(r.error))
		return
	_adopt(r.data, true)
	status.emit("Screens: pending layout changes kept" if _dirty() else "")


func _adopt(next: Dictionary, preserve: bool) -> void:
	var old := _drafts
	_state = next
	var found := false
	for s in _screens():
		if int(s.id) == _selected:
			found = true
	if not found:
		_selected = int(_screens()[0].id) if not _screens().is_empty() else -1
	_drafts = {}
	for s in _screens():
		var id := int(s.id)
		_drafts[id] = old[id] if preserve and old.has(id) else M.draft_for(s)
	_render()


func _command(req: Dictionary) -> void:
	if _busy:
		return
	_busy = true
	var old_ids: Array = []
	for s in _screens():
		old_ids.append(int(s.id))
	var r: Dictionary = await StudioApi.write(Api, "screens", req)
	_busy = false
	if not r.ok:
		status.emit(str(r.error))
		return
	var id := int(req.get("id", -1))
	if req.action == "update":
		_drafts.erase(id)
	_state = r.data
	if req.action == "create":
		for s in _screens():
			if not old_ids.has(int(s.id)):
				_selected = int(s.id)
	_adopt(r.data, true)
	status.emit("Screen settings saved.")


func _lbl(parent: Node, text: String, muted := false) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if muted:
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	parent.add_child(l)
	return l


func _clear(n: Node) -> void:
	for c in n.get_children():
		n.remove_child(c)
		c.queue_free()


func _render() -> void:
	if not is_inside_tree():
		return
	_clear(_left)
	_clear(_main)
	_canvas = null
	_pending = null
	_build_left()
	var screen := _selected_screen()
	if _state.is_empty():
		_lbl(_main, "Reading the screens from the switcher…", true)
		return
	if screen.is_empty():
		_lbl(_main, "Create a screen to start mapping outputs.", true)
		return
	_build_main(screen)


func _build_left() -> void:
	Kit.heading(_left, "Screens")
	if _new_name == "":
		_new_name = M.next_name(_screens())
	var name_le := LineEdit.new()
	name_le.text = _new_name
	name_le.placeholder_text = "New screen name"
	name_le.text_changed.connect(func(t: String) -> void: _new_name = t)
	_left.add_child(name_le)
	var row := Kit.row(_left)
	var ty := OptionButton.new()
	ty.add_item("Main screen", 0)
	ty.add_item("AUX screen", 1)
	ty.selected = 1 if _new_type == M.TYPE_AUX else 0
	ty.item_selected.connect(func(i: int) -> void: _new_type = M.TYPE_AUX if i == 1 else M.TYPE_MAIN)
	row.add_child(ty)
	Kit.button(row, "Create screen", func() -> void:
		var n := _new_name.strip_edges()
		if n == "":
			status.emit("Screen name is required.")
			return
		_new_name = ""
		_command(M.create_body(n, _new_type)))
	for s in _screens():
		var b := Button.new()
		b.text = M.screen_label(s)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.toggle_mode = true
		b.button_pressed = int(s.id) == _selected
		b.clip_text = true
		var id := int(s.id)
		b.pressed.connect(func() -> void:
			_selected = id
			_render())
		_left.add_child(b)


func _build_main(screen: Dictionary) -> void:
	var id := int(screen.id)
	var draft: Dictionary = _drafts[id]
	var head := Kit.row(_main)
	var title := Label.new()
	title.text = str(screen.name)
	title.add_theme_font_size_override("font_size", 18)
	head.add_child(title)
	_lbl(head, M.type_label(int(screen.type)), true)
	if screen.get("enabled", true) == false:
		var off := _lbl(head, "Disabled on device", true)
		off.tooltip_text = "The device reports enable 0 for this screen. Presets and Take/Cut skip it."
	var frz := int(screen.get("freeze", 0))
	var ftb := int(screen.get("ftb", 0))
	Kit.button(head, "Unfreeze" if frz != 0 else "Freeze", func() -> void: _command(M.toggle_body("freeze", id, frz)))
	Kit.button(head, "Clear blackout" if ftb != 0 else "Blackout", func() -> void: _command(M.toggle_body("ftb", id, ftb)))
	Kit.button(head, "Delete screen", func() -> void:
		Kit.confirm(self, "Delete %s and its layers?" % str(screen.name), func() -> void: _command(M.delete_body(id))))
	var limits := M.limits_for(_state.get("options", {}), int(screen.type))
	if M.has_extras(limits):
		var ex: Extras = Extras.new()
		_main.add_child(ex)
		ex.setup(screen, limits, _extras_open)
		ex.toggled.connect(func(v: bool) -> void: _extras_open = v)
		ex.command.connect(_command)
	if int(screen.type) == M.TYPE_LED:
		_lbl(_main, "This screen uses LED topology. Its current dimensions are shown; LCD output mapping is unavailable.", true)
		return
	_build_dims(draft)
	_canvas = Canvas.new()
	_canvas.custom_minimum_size.y = 280
	_canvas.set_data(draft, _output_names())
	_canvas.changed.connect(_update_pending)
	_canvas.dropped.connect(func() -> void:
		M.grow(draft)
		_render())
	_main.add_child(_canvas)
	_lbl(_main, "Drag output tiles to arrange them; they snap to each other and the screen edges (hold Alt to place freely).", true)
	_build_tiling(draft)
	_build_outputs(screen, draft)
	var foot := Kit.row(_main)
	_pending = _lbl(foot, "", true)
	_pending.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	Kit.button(foot, "Discard changes", func() -> void:
		_drafts[id] = M.draft_for(screen)
		_render())
	var apply := Kit.button(foot, "Apply screen layout", func() -> void:
		var e := M.draft_error(draft)
		if e != "":
			status.emit(e)
			return
		_command(M.update_body(id, draft)))
	apply.disabled = _busy
	_update_pending()


func _update_pending() -> void:
	if _pending != null:
		_pending.text = "Pending screen changes" if _dirty() else "No pending changes"


func _output_names() -> Dictionary:
	var r := {}
	for o in _state.get("outputs", []):
		r[int(o.id)] = str(o.name)
	return r


func _field(row: Node, label: String, value: int, lo: int, hi: int, apply: Callable) -> void:
	_lbl(row, label)
	var le := LineEdit.new()
	NF.math_line(le, true, lo, hi)
	le.text = str(value)
	le.custom_minimum_size.x = 80
	var last := [value]
	var commit := func() -> void:
		var v := int(le.text)
		if v != last[0]:
			last[0] = v
			apply.call(v)
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	row.add_child(le)


func _build_dims(draft: Dictionary) -> void:
	var row := Kit.row(_main)
	for k in [["x", "Origin X", -100000, 100000], ["y", "Origin Y", -100000, 100000], ["width", "Width", M.MIN_SIZE, M.MAX_SIZE], ["height", "Height", M.MIN_SIZE, M.MAX_SIZE]]:
		var key: String = k[0]
		_field(row, k[1], int(draft.window[key]), k[2], k[3], func(v: int) -> void:
			draft.window[key] = v
			_render.call_deferred())


func _build_tiling(draft: Dictionary) -> void:
	var row := Kit.row(_main)
	if _cols <= 0:
		_cols = maxi(1, (draft.outputs as Array).size())
	_field(row, "Columns", _cols, 1, 32, func(v: int) -> void: _cols = v)
	Kit.button(row, "Tile outputs", func() -> void:
		M.tile_grid(draft, _cols)
		_render())
	Kit.button(row, "Fit screen to outputs", func() -> void:
		M.fit_window(draft)
		_render())


func _build_outputs(screen: Dictionary, draft: Dictionary) -> void:
	var sid := int(screen.id)
	var avail: Array = M.available_outputs(screen, _state.get("outputs", []))
	var mapped := VBoxContainer.new()
	_main.add_child(mapped)
	var free := VBoxContainer.new()
	_main.add_child(free)
	Kit.heading(free, "Available outputs")
	if (draft.outputs as Array).is_empty():
		_lbl(mapped, "No outputs on this screen yet. Add one from Available outputs.", true)
	for o in avail:
		var oid := int(o.id)
		var mi := M.find_mapping(draft, oid)
		var owner := M.owner_name(_screens(), sid, oid)
		var info := "%s · %s" % [str(o.get("connector", "")), M.output_size(o)]
		if mi < 0:
			var r := Kit.row(free)
			var add := Kit.button(r, "+ %s" % str(o.name), func() -> void:
				M.add_output(draft, o)
				_render())
			add.tooltip_text = "Used by %s" % owner if owner != "" else info
			_lbl(r, "Used by %s" % owner if owner != "" else info, true)
			continue
		var mp: Dictionary = draft.outputs[mi].pos
		var row := Kit.row(mapped)
		var nm := Label.new()
		nm.text = str(o.name)
		nm.custom_minimum_size.x = 110
		row.add_child(nm)
		_lbl(row, info, true)
		for k in ["x", "y", "width", "height"]:
			var key: String = k
			_field(row, key.to_upper(), int(mp[key]), -100000 if key in ["x", "y"] else M.MIN_SIZE, M.MAX_SIZE if key in ["width", "height"] else 100000, func(v: int) -> void:
				var i := M.find_mapping(draft, oid)
				if i >= 0:
					draft.outputs[i].pos[key] = v
				M.grow(draft)
				_render.call_deferred())
		Kit.button(row, "Remove", func() -> void:
			M.remove_output(draft, oid)
			_render())
