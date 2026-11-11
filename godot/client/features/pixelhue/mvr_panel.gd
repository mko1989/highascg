extends VBoxContainer
## WO-1039 — the PixelHue tab's MVR sub-tab: PixelHue Studio's multiviewer window editor (public/app.js MVR parts,
## editor.js, mvr-*.js) over the Studio engine the server runs. Windows never overlap (the UMD strip is part of the
## rectangle); edits — drag, corner resize, typed X / Y / Width / Height, arrow nudges, Center X / Y, Keep aspect
## ratio, Fix aspect ratios, Undo / Redo — save automatically, one request in flight (mvr_sync.gd), newer edits kept
## through the readback (mvr_model.gd reconcile). Add / replace / delete windows and device layouts go through
## mvr-layers / mvr-templates. Pure logic: mvr_model.gd, mvr_geometry.gd, mvr_view.gd, mvr_sync.gd (tested).
## Left out (contract rule 10): Save layout / Load layout to a file.

signal status(text: String)
signal _flushed

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const M := preload("res://features/pixelhue/mvr_model.gd")
const G := preload("res://features/pixelhue/mvr_geometry.gd")
const Sync := preload("res://features/pixelhue/mvr_sync.gd")
const MvrCanvas := preload("res://features/pixelhue/mvr_canvas.gd")
const MvrInspector := preload("res://features/pixelhue/mvr_inspector.gd")
const MvrSide := preload("res://features/pixelhue/mvr_side.gd")
const MvrToolbar := preload("res://features/pixelhue/mvr_toolbar.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _state: Dictionary = {}
var _base: Dictionary = {}
var _screen_id := -1
var _selected_id := -1
var _busy := false
var _drag: Dictionary = {}  # {id, window, before, handle, blocked}
var _stack: Dictionary = M.new_stack()
var _sync := Sync.new()
var _save_failed := false
var _templates_session := ""
## The HTTP client (the Api autoload unless a test sets a fake with get_json / post_json before adding the panel).
var api: Object = null

var _side: MvrSide
var _canvas: MvrCanvas
var _inspector: MvrInspector
var _toolbar: MvrToolbar
var _dirty: Label
var _retry: Button


func _ready() -> void:
	if api == null:
		api = get_node_or_null("/root/Api")
	add_theme_constant_override("separation", 6)
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 10)
	add_child(body)
	_side = MvrSide.new()
	_side.screen_chosen.connect(_on_screen)
	_side.window_picked.connect(_on_pick)
	_side.source_added.connect(func(key: String) -> void: _add_source(key, null))
	body.add_child(_side)
	var mid := VBoxContainer.new()
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(mid)
	_toolbar = MvrToolbar.new()
	_toolbar.template_chosen.connect(_on_template)
	_toolbar.fix_requested.connect(_fix_aspect)
	_toolbar.undo_requested.connect(_undo_redo)
	mid.add_child(_toolbar)
	_canvas = MvrCanvas.new()
	_canvas.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_canvas.picked.connect(_on_pick)
	_canvas.drag_started.connect(_on_drag_start)
	_canvas.drag_moved.connect(_on_drag_move)
	_canvas.drag_ended.connect(_on_drag_end)
	_canvas.nudged.connect(func(dir: Vector2i, shift: bool) -> void:
		var layer := _selected()
		if not layer.is_empty():
			_edit(M.nudge(layer.window, dir, shift)))
	_canvas.undo_requested.connect(_undo_redo)
	_canvas.source_dropped.connect(_on_drop)
	mid.add_child(_canvas)
	var foot := Label.new()
	foot.text = "Drag to move · corner handles resize · arrows move 1 px, Shift 10 px · Ctrl+Z undo, Ctrl+Shift+Z redo"
	foot.clip_text = true
	foot.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	foot.add_theme_font_size_override("font_size", 12)
	mid.add_child(foot)
	_inspector = MvrInspector.new()
	_inspector.field_committed.connect(_on_field)
	_inspector.center_requested.connect(func(axis: String) -> void:
		var layer := _selected()
		if not layer.is_empty():
			_edit(M.center_x(layer.window, _screen()) if axis == "x" else M.center_y(layer.window, _screen())))
	_inspector.aspect_toggled.connect(_on_aspect)
	_inspector.source_chosen.connect(func(key: String) -> void:
		if not _selected().is_empty():
			_structure(M.source_body(_screen_id, _selected_id, key), "Window source changed."))
	_inspector.delete_requested.connect(_on_delete)
	body.add_child(_inspector)
	var bar := HBoxContainer.new()
	_dirty = Label.new()
	_dirty.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_dirty.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	bar.add_child(_dirty)
	_retry = Kit.button(bar, "Retry save", func() -> void:
		_sync.retry()
		_flush())
	add_child(bar)
	_render()


# ---- reading --------------------------------------------------------------------------------------------------------

## The tab calls this when MVR is shown and on Refresh: waits for a running save, asks before dropping unsaved edits.
func refresh() -> void:
	if _busy:
		return
	await _finish_save()
	if not M.changes(_state, _base).is_empty():
		Kit.confirm(self, "Discard your pending window changes?", func() -> void: _reload())
		return
	await _reload()


func _reload() -> void:
	await _operation(func() -> String:
		status.emit("Reading layout…")
		var r: Dictionary = await StudioApi.read(api, "state")
		if not r.ok:
			return str(r.error)
		_adopt(r.data)
		status.emit("Layout refreshed.")
		await _load_templates()
		return "")


func _load_templates() -> void:
	var session := str(_state.get("session", ""))
	if _state.get("capabilities", {}).get("mvr") != true or session == _templates_session:
		return
	_templates_session = session
	var r: Dictionary = await StudioApi.read(api, "mvr-templates")
	_toolbar.set_templates(M.template_items(r.data) if r.ok else [])


func _adopt(data: Dictionary) -> void:
	_state = M.normalize_state(data)
	_base = _state.duplicate(true)
	_sync.reset()
	_save_failed = false
	var screens: Array = _state.screens
	if M.screen_of(_state, _screen_id).is_empty():
		_screen_id = int(screens[0].id) if not screens.is_empty() else -1
	var wins := M.windows_of(_state, _screen_id)
	if not wins.any(func(l: Dictionary) -> bool: return int(l.id) == _selected_id):
		_selected_id = int(wins[0].id) if not wins.is_empty() else -1
	_stack = M.new_stack()
	_render()


func _operation(action: Callable) -> void:
	if _busy:
		return
	_busy = true
	_render_controls()
	var err: Variant = await action.call()
	if err is String and err != "":
		status.emit(err)
	_busy = false
	_render()
	_sync.schedule(_now(), 0)


# ---- autosave ---------------------------------------------------------------------------------------------------------

func _now() -> int:
	return Time.get_ticks_msec()


func _process(_delta: float) -> void:
	if _sync.is_due(_now()):
		_flush()


func _can_send() -> bool:
	return _state.get("capabilities", {}).get("mvr") == true and not _busy and _drag.is_empty()


## One PUT /api/windows with every pending change → true when a request was sent.
func _flush() -> bool:
	var sent := M.changes(_state, _base)
	var epoch := _sync.begin(sent, _can_send())
	if epoch < 0:
		_render_controls()
		return false
	_render_controls()
	var r: Dictionary = await StudioApi.write(api, "windows", M.windows_body(sent))
	if _sync.finish(epoch, "" if r.ok else str(r.error)):
		if r.ok:
			_state = M.reconcile(_state, _base, M.normalize_state(r.data), sent)
			_base = M.normalize_state(r.data)
			if _save_failed:
				_save_failed = false
				status.emit("MVR saved.")
		else:
			_save_failed = true
			var snap: Variant = (r.data as Dictionary).get("snapshot") if r.data is Dictionary else null
			if snap is Dictionary and (snap as Dictionary).get("layers") is Array and not _state.is_empty():
				var actual := M.normalize_state(snap)
				_state = M.reconcile(_state, _base, actual, [])
				_base = actual
			status.emit("MVR not saved: %s" % str(r.error))
		_render(true)
	else:
		_render_controls()
	if _sync.follow_up(not M.changes(_state, _base).is_empty(), _can_send()):
		_sync.schedule(_now(), 0)
	_flushed.emit()
	return true


## Waits for the running save, then sends what is left → true when everything is saved.
func _finish_save() -> bool:
	while _sync.running:
		await _flushed
	while not M.changes(_state, _base).is_empty() and not _sync.has_error() and not _busy and _drag.is_empty():
		if not await _flush():
			break
		while _sync.running:
			await _flushed
	return not _sync.has_error() and M.changes(_state, _base).is_empty()


# ---- editing ----------------------------------------------------------------------------------------------------------

func _screen() -> Dictionary:
	return M.screen_of(_state, _screen_id)


func _selected() -> Dictionary:
	var l := M.layer_of(_state, _selected_id)
	return l if not l.is_empty() and int(l.screenId) == _screen_id else {}


func _edit(window: Dictionary) -> void:
	if _busy:
		return
	var layer := _selected()
	var res := M.edit(_state, layer, _screen(), window)
	if res.is_empty():
		return
	if res.has("notice"):
		status.emit(str(res.notice))
	if res.has("error"):
		status.emit(str(res.error))
		_render()
		return
	M.remember(_stack, M.geometry(_state))
	layer.window = res.window
	_render()
	_sync.schedule(_now())


func _on_field(key: String, text: String) -> void:
	var layer := _selected()
	if layer.is_empty() or _busy:
		return
	var res := M.numeric(_state, layer, _screen(), key, text)
	if res.has("error"):
		status.emit(str(res.error))
		_render()
		return
	_edit(res.window)


func _on_aspect(on: bool) -> void:
	var layer := _selected()
	if layer.is_empty() or _busy:
		return
	var res := M.aspect_toggle(layer, on)
	if res.has("error"):
		status.emit(str(res.error))
		_render()
		return
	M.remember(_stack, M.geometry(_state))
	layer.aspectLock = res.aspectLock
	layer.aspectMode = res.aspectMode
	_render()
	_sync.schedule(_now(), 0)


func _undo_redo(redo: bool) -> void:
	if _busy or _state.is_empty():
		return
	var layout := M.step(_stack, M.geometry(_state), redo)
	if layout.is_empty():
		return
	M.restore(_state, layout)
	_render()
	_sync.schedule(_now(), 0)


func _on_pick(id: int) -> void:
	if _busy:
		return
	_selected_id = id
	_render()


func _on_screen(id: int) -> void:
	_screen_id = id
	var wins := M.windows_of(_state, id)
	_selected_id = int(wins[0].id) if not wins.is_empty() else -1
	_render()


func _on_drag_start(id: int, handle: String) -> void:
	if _busy or _state.is_empty():
		return
	_selected_id = id
	var layer := _selected()
	if layer.is_empty():
		return
	_drag = {"id": id, "window": (layer.window as Dictionary).duplicate(), "before": M.geometry(_state), "handle": handle, "blocked": false}
	_render()


func _on_drag_move(dx: float, dy: float) -> void:
	var layer := _selected()
	if _drag.is_empty() or _busy or layer.is_empty():
		return
	var limit := M.drag_limit(G.window_limit(_state.get("device", {}).get("model"), layer.get("sourceType")), _drag.window)
	var next := G.drag_window(_drag.window, dx, dy, _screen(), str(_drag.handle), _toolbar.snap(),
		M.lock_of(layer), layer.get("umdHeight"), limit)
	_drag.blocked = not G.can_place(layer, next, _state.layers)
	if not _drag.blocked:
		layer.window = next
	_canvas.blocked = _drag.blocked
	_canvas.show_layout(_screen(), M.windows_of(_state, _screen_id), _selected_id, _busy)
	_inspector.show_layer(layer, M.aspect_info(layer, _state.get("signals", [])), M.source_options(_state.get("sources", []), layer), _busy)


func _on_drag_end(cancelled: bool) -> void:
	if _drag.is_empty():
		return
	var layer := _selected()
	if cancelled:
		M.restore(_state, _drag.before)
	elif not layer.is_empty() and not M.same_window(_drag.window, layer.window):
		M.remember(_stack, _drag.before)
	if _drag.blocked:
		status.emit("Movement or resizing was limited to avoid overlapping another MVR window.")
	_drag = {}
	_canvas.blocked = false
	_sync.schedule(_now(), 0)
	_render()


# ---- structure: add / replace / delete windows, device layouts, Fix aspect ratios --------------------------------------

## PUT /api/mvr-layers after the pending geometry is saved; the answer is the new device state.
func _structure(body: Dictionary, success: String) -> void:
	if _busy or _state.is_empty():
		return
	if not await _finish_save():
		status.emit("Save or retry pending MVR edits before adding or removing windows.")
		return
	await _operation(func() -> String:
		var r: Dictionary = await StudioApi.write(api, "mvr-layers", body)
		if not r.ok:
			return str(r.error)
		var changed: Variant = r.data.get("changedId")
		_adopt(r.data)
		if changed is int or changed is float:
			_selected_id = int(changed)
		status.emit(success)
		return "")


func _add_source(key: String, point: Variant) -> void:
	if _busy or _state.is_empty():
		return
	var source := M.find_source(_state, key)
	if source.is_empty():
		return
	var res := M.add_source(_state, _screen_id, source, point)
	if res.has("error"):
		status.emit(str(res.error))
		return
	_structure(res.body, str(res.success))


func _on_drop(key: String, layer_id: int, at: Vector2) -> void:
	var source := M.find_source(_state, key)
	if _busy or source.is_empty() or _screen().is_empty():
		return
	if layer_id >= 0:
		_structure(M.source_body(_screen_id, layer_id, key), "Window source changed to %s." % str(source.name))
	else:
		_add_source(key, at)


func _on_delete() -> void:
	var layer := _selected()
	if layer.is_empty() or _busy:
		return
	var label := str(layer.source) if str(layer.source) != "" else str(layer.name)
	var id := int(layer.id)
	Kit.confirm(self, "Delete MVR window %s?" % label, func() -> void: _structure(M.delete_body(_screen_id, id), "MVR window deleted."))


func _on_template(key: String) -> void:
	if key == "" or _busy or _state.is_empty():
		return
	if not M.changes(_state, _base).is_empty() or _sync.running:
		status.emit("Wait for the pending MVR edits to save before applying a device layout.")
		return
	var screen_id := _screen_id
	Kit.confirm(self, "Apply this device layout? It replaces every window on this MVR output.", func() -> void:
		_operation(func() -> String:
			var r: Dictionary = await StudioApi.write(api, "mvr-templates", M.template_body(screen_id, key))
			if not r.ok:
				return str(r.error)
			_adopt(r.data)
			status.emit("MVR layout applied.")
			return ""))


func _fix_aspect() -> void:
	if _busy or _state.is_empty():
		return
	if not await _finish_save():
		status.emit("Retry the pending MVR save before fixing aspect ratios.")
		return
	await _operation(func() -> String:
		status.emit("Reading input and screen resolutions…")
		var r: Dictionary = await StudioApi.read(api, "state")
		if not r.ok:
			return str(r.error)
		var fresh := M.normalize_state(r.data)
		if M.fix_stale(fresh, _state, _base, _screen_id):
			return "The device layout or connection changed. Refresh before fixing aspect ratios."
		var result := G.fix_aspect_ratios(M.windows_of(_state, _screen_id), fresh.signals, _screen())
		if result.has("error"):
			return str(result.error)
		var changed := false
		for l in result.layers:
			if not M.same_edit(l, M.layer_of(_state, int(l.id))):
				changed = true
		if changed:
			M.remember(_stack, M.geometry(_state))
			M.restore(_state, result.layers)
		_state.signals = fresh.signals
		status.emit(M.fix_notice(result))
		return "")


# ---- rendering ----------------------------------------------------------------------------------------------------------

func _render_controls() -> void:
	var has := not M.windows_of(_state, _screen_id).is_empty()
	var dirty := M.changes(_state, _base).size()
	_toolbar.set_enabled(_busy, has, not (_stack.undo as Array).is_empty(), not (_stack.redo as Array).is_empty())
	_retry.visible = _sync.has_error()
	_retry.disabled = _busy or _sync.running or dirty == 0
	_dirty.text = M.dirty_label(_sync.has_error(), _sync.running, dirty)
	_dirty.add_theme_color_override("font_color", ThemeBuilder.WARN if dirty > 0 else ThemeBuilder.TEXT_MUTED)


func _render(keep_editing := false) -> void:
	_render_controls()
	var screen := _screen()
	var wins := M.windows_of(_state, _screen_id)
	var res := "Layout %s" % ("%d × %d" % [int(screen.width), int(screen.height)] if not screen.is_empty() else "—")
	if not screen.is_empty() and screen.get("dimensionsAssumed") == true:
		res += "  (output size unavailable; 1920 × 1080 assumed)"
	_toolbar.set_resolution(res)
	_side.show_screens(_state.get("screens", []), _screen_id, _busy)
	var dirty_ids: Array = M.changes(_state, _base).map(func(c: Dictionary) -> int: return int(c.id))
	_side.show_windows(wins, _selected_id, dirty_ids, _busy)
	var sources: Array = _state.get("sources", [])
	_side.show_sources(sources, _busy)
	_canvas.show_layout(screen, wins, _selected_id, _busy)
	var layer := _selected()
	_inspector.show_layer(layer, M.aspect_info(layer, _state.get("signals", [])) if not layer.is_empty() else "",
		M.source_options(sources, layer) if not layer.is_empty() else {}, _busy, keep_editing)
