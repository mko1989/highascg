extends VBoxContainer
## WO-1039 — PixelHue ▸ Programming: Studio's Programming tab (public/programming-ui.js) as a native panel. Shown
## screens' PGM band above PVW (programming_bands.gd / _stage.gd): drop sources to add layers, drag / resize live
## to the switcher with snapping; Take / Cut every shown screen with duration and swap / copy; PGM lock per screen.
## Sources left (programming_sources.gd), position / size tools under the screens (programming_tools.gd), layer,
## effects, layer presets and the preset bank right (programming_inspector.gd). Geometry goes through
## programming_queue.gd (40 ms, one in flight, newest only, Retry on failure); other commands wait for it.

signal status(text: String)

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
const Sync := preload("res://features/pixelhue/programming_sync.gd")
const Queue := preload("res://features/pixelhue/programming_queue.gd")
const Gallery := preload("res://features/pixelhue/programming_gallery.gd")
const Bands := preload("res://features/pixelhue/programming_bands.gd")
const Sources := preload("res://features/pixelhue/programming_sources.gd")
const Tools := preload("res://features/pixelhue/programming_tools.gd")
const Inspector := preload("res://features/pixelhue/programming_inspector.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const CFG := "user://pixelhue_programming.cfg"
const COMMAND_TIMEOUT_S := 120.0  # layer create / preset auto-take wait on the device (Studio allows 80 s)
const POLL_S := 2.0

## The HTTP client: the Api autoload, or a fake with get_json / post_json / get_bytes (tests).
var api: Object = null
var state: Dictionary = {}
var shown: Array = []
var selected_id: Variant = null
var busy := false
var duration_ms := 500
var swap := true
var sync: Sync
var _queue: Queue
var _gallery: Gallery
var _loading := false
var _source_polling := false
var _source_version := 0
var _geometry_revision := 0
var _geometry_failed := false
var _geometry_success := ""
var _refresh_epoch := 0
var _chips: HBoxContainer
var _duration: LineEdit
var _take: Button
var _cut: Button
var _save_label: Label
var _retry: Button
var _empty: Label
var _work: HSplitContainer
var _bands: Bands
var _sources: Sources
var _tools: Tools
var _inspector: Inspector


func _init() -> void:
	_queue = Queue.new()
	_queue.api_fn = _api
	_queue.can_send = _can_send
	_queue.result.connect(_geometry_result)
	_queue.failed.connect(func(error: String) -> void:
		_geometry_failed = true
		status.emit("Layer position not saved: %s" % error))
	_queue.changed.connect(_status_line)
	add_child(_queue)
	sync = _queue.sync
	_gallery = Gallery.new()
	_gallery.api_fn = _api
	_gallery.notice.connect(func(text: String) -> void: status.emit(text))
	_gallery.changed.connect(func() -> void:
		if _sources != null:
			_sources.render(state, _gallery.gallery))
	add_child(_gallery)


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	add_child(bar)
	var chip_scroll := ScrollContainer.new()
	chip_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	chip_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_chips = HBoxContainer.new()
	chip_scroll.add_child(_chips)
	bar.add_child(chip_scroll)
	bar.add_child(_label("ms"))
	_duration = LineEdit.new()
	NF.math_line(_duration, true, 0, 10000)
	_duration.text = str(duration_ms)
	_duration.custom_minimum_size.x = 64
	_duration.tooltip_text = "Transition duration (ms) for Take and preset loads"
	_duration.text_changed.connect(func(t: String) -> void:
		if t.strip_edges().is_valid_int():
			duration_ms = clampi(int(t), 0, 10000))
	_duration.focus_exited.connect(func() -> void: duration_ms = clampi(int(_duration.text), 0, 10000))
	bar.add_child(_duration)
	var sw := OptionButton.new()
	sw.add_item("Swap", 1)
	sw.add_item("Copy", 0)
	sw.tooltip_text = "Swap: PVW and PGM exchange on Take / Cut. Copy: PVW is copied to PGM."
	sw.item_selected.connect(func(i: int) -> void: swap = i == 0)
	bar.add_child(sw)
	_cut = _button(bar, "Cut", func() -> void: command(M.cut_body(shown, swap), "Cut sent."))
	_take = _button(bar, "Take", func() -> void: command(M.take_body(shown, duration_ms, swap), "Take sent."))
	_take.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	_save_label = _label("")
	bar.add_child(_save_label)
	_retry = _button(bar, "Retry save", func() -> void: _queue.retry())
	_retry.visible = false
	_empty = Label.new()
	_empty.text = "Loading programming from the switcher…"
	_empty.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_empty)
	_work = HSplitContainer.new()
	_work.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_work)
	_sources = Sources.new()
	_sources.host = self
	_work.add_child(_sources)
	var right := HSplitContainer.new()
	_work.add_child(right)
	var center := VBoxContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(center)
	_bands = Bands.new()
	_bands.host = self
	center.add_child(_bands)
	_tools = Tools.new()
	_tools.host = self
	center.add_child(_tools)
	_inspector = Inspector.new()
	_inspector.host = self
	preload("res://features/pixelhue/inspector_dock.gd").dock(self, _inspector, right, 320)  # the app's main Inspector
	_work.visible = false
	shown = Bands.saved_shown(CFG)
	var t := Timer.new()
	t.wait_time = POLL_S
	t.autostart = true
	t.timeout.connect(_poll_sources)
	add_child(t)
	_status_line()


## The tab calls this when Programming is shown and on Refresh.
func refresh() -> void:
	if busy:
		return
	if (sync.dirty or sync.saving) and not await _queue.drain():
		Kit.confirm(self, "Discard the unsaved layer position changes and refresh?", func() -> void:
			_queue.reset()
			_load())
		return
	_load()


func _load() -> void:
	if _loading:
		return
	_loading = true
	var r: Dictionary = await StudioApi.read(_api(), "programming")
	_loading = false
	if not r.ok:
		status.emit(r.error)
		if state.is_empty():
			_empty.text = r.error
		return
	_adopt(r.data)
	_gallery.load_once()


func _adopt(data: Dictionary) -> void:
	_source_version += 1
	state = M.ints(data)
	shown = M.default_shown(state, shown)
	if M.layer_by_id(state, selected_id).is_empty():
		selected_id = null
	_render()


func _api() -> Object:
	return api if api != null else get_node_or_null("/root/Api")


# ---- drawing ----

func _render() -> void:
	var has := not state.is_empty() and not M.arr(state, "screens").is_empty()
	_empty.visible = not has
	_work.visible = has
	if state.is_empty():
		return
	if not has:
		_empty.text = "Create or map a screen in Screens first."
	for c in _chips.get_children():
		c.queue_free()
	for s in M.arr(state, "screens"):
		var b := Button.new()
		var on: bool = int(s.id) in shown
		b.text = str(s.get("name", "")) + ("" if s.get("enabled") == true else " · off")
		b.toggle_mode = true
		b.button_pressed = on
		if s.get("enabled") != true:
			b.tooltip_text = "Disabled on the device: shown for editing, but presets and Take/Cut skip it."
		var id := int(s.id)
		b.pressed.connect(func() -> void:
			shown = M.toggle_shown(state, shown, id)
			Bands.save_shown(CFG, shown)
			_render())
		_chips.add_child(b)
	_bands.render(state, shown, selected_id)
	_sources.render(state, _gallery.gallery)
	render_inspector()
	_set_busy()


func _repaint() -> void:
	_bands.repaint(selected_id, busy)


func render_inspector() -> void:
	var l := M.layer_by_id(state, selected_id)
	_tools.render(state, l, not l.is_empty() and M.locked(state, l))
	_inspector.render(state, l, active_screen(), selected_id)


func _status_line() -> void:
	_save_label.text = sync.status_text()
	_save_label.add_theme_color_override("font_color", ThemeBuilder.ERROR if sync.failure != "" else ThemeBuilder.TEXT_MUTED)
	_retry.visible = sync.failure != ""


func _set_busy() -> void:
	_take.disabled = busy
	_cut.disabled = busy
	_bands.repaint(selected_id, busy)


# ---- host API (stage, tools, sources, inspector) ----

func select(id: int) -> void:
	selected_id = id
	_repaint()
	render_inspector()


func active_screen() -> Dictionary:
	return M.active_screen(state, shown, selected_id)


func active_screen_id() -> Variant:
	return active_screen().get("id")


func shown_ids() -> Array:
	return shown.duplicate()


func transition() -> Dictionary:
	return {"time": duration_ms, "swap": swap}


func notice(text: String) -> void:
	status.emit(text)


func confirm(text: String, then: Callable) -> void:
	Kit.confirm(self, text, then)


func prompt(title: String, initial: String, then: Callable) -> void:
	Kit.prompt(self, title, initial, then)


func add_to_pvw(key: String) -> void:
	var r := M.drop_request(state, key, active_screen(), M.PVW)
	if r.has("error"):
		status.emit(r.error)
	else:
		command(r.body, r.message)


func clear_selected() -> void:
	clear_layer(M.layer_by_id(state, selected_id))


func clear_layer(layer: Dictionary) -> void:
	if layer.is_empty() or M.locked(state, layer) or busy:
		return
	Kit.confirm(self, M.clear_question(state, layer), func() -> void:
		var r := M.clear_request(state, layer)
		command(r.body, r.message))


func live_geometry(change: Dictionary) -> void:
	edit_geometry(change, false)


func finish_geometry() -> void:
	_queue.flush()


func drop(key: String, scr: Dictionary, scene: int, point: Dictionary, layer: Dictionary) -> void:
	var r := M.drop_request(state, key, scr, scene, point) if layer.is_empty() else M.replace_request(state, key, layer)
	if r.has("error"):
		status.emit(r.error)
		return
	if not layer.is_empty() and str(r.body.action) == "source":
		select(int(layer.id))
	command(r.body, r.message)


func nudge_selected(dx: int, dy: int, step: int) -> void:
	var l := M.layer_by_id(state, selected_id)
	if l.is_empty() or busy or M.locked(state, l):
		return
	var w := G.nudge(G.target_window(M.arr(state, "layers"), l), dx, dy, step)
	command(M.window_change(state, l, w), "Layer position saved.")


# ---- commands ----

func command(body: Dictionary, success := "Programming updated.") -> void:
	if str(body.get("action")) in ["window", "group-window"]:
		_geometry_success = success
		edit_geometry(body, true)
		return
	if busy or state.is_empty():
		return
	if not await _queue.drain():
		status.emit("Retry the unsaved layer positions before this action.")
		return
	busy = true
	_set_busy()
	status.emit("Working…")
	var before: Array = M.arr(state, "layers").map(func(l: Dictionary) -> Variant: return l.get("id"))
	var r := StudioApi.shape(await _api().post_json(StudioApi.BASE + "programming", body, COMMAND_TIMEOUT_S))
	busy = false
	if not r.ok:
		_set_busy()
		status.emit(r.error)
		_queue.pump()
		return
	var next: Dictionary = M.ints(r.data)
	if str(body.action) in ["create", "copy", "group-create"]:
		var nid: Variant = M.new_layer_id(before, next)
		if nid != null:
			selected_id = nid
	_adopt(next)
	status.emit(M.success_text(next, success))
	var delay := M.refresh_delay(body)
	if delay >= 0:
		_schedule_refresh(delay)
	_queue.pump()


## Local edit + live queue (Studio editGeometry): a group member's window moves both members.
func edit_geometry(change: Dictionary, immediate := true) -> void:
	if state.is_empty() or busy:
		return
	var l := M.layer_by_id(state, change.get("id"))
	if l.is_empty() or l.get("screenId") != change.get("screenId") or M.locked(state, l):
		return
	var w: Variant = change.get("window")
	if not G.window_ok(w):
		return
	var c := change.duplicate(true)
	if str(c.action) == "group-window":
		var g := G.group_of(M.arr(state, "layers"), l)
		if g.is_empty():
			return
		var parts := G.split_window(w, str(g.orient), G.group_share(g))
		g.a.window = parts[0]
		g.b.window = parts[1]
		c.id = int(g.a.id)
	else:
		l.window = G.copy(w)
	_geometry_revision += 1
	_repaint()
	_tools.update_fields()
	_queue.put(c, immediate)


func _can_send() -> bool:
	return not state.is_empty() and not busy


func _dragging() -> bool:
	return _bands.dragging()


func _geometry_result(data: Dictionary, accepted: Array) -> void:
	var next: Dictionary = M.ints(data)
	var ids := M.accepted_ids(state, accepted)
	if not _dragging():
		for actual in M.arr(next, "layers"):
			var local := M.layer_by_id(state, actual.get("id"))
			if not local.is_empty() and actual.get("id") in ids and actual.get("window") is Dictionary:
				local.window = G.copy(actual.window)
	_repaint()
	_tools.update_fields()
	if _geometry_failed or (not accepted.is_empty() and not sync.dirty and not _dragging()):
		_geometry_failed = false
		status.emit(_geometry_success if _geometry_success != "" else "Layer position saved.")
		_geometry_success = ""


func _schedule_refresh(delay_ms: int) -> void:
	_refresh_epoch += 1
	var ep := _refresh_epoch
	await get_tree().create_timer(delay_ms / 1000.0).timeout
	for attempt in 31:
		if ep != _refresh_epoch or not is_inside_tree():
			return
		if busy or sync.dirty or sync.saving or _dragging() or _editing():
			await get_tree().create_timer(0.15).timeout
			continue
		var rev := _geometry_revision
		var r: Dictionary = await StudioApi.read(_api(), "programming")
		if ep != _refresh_epoch:
			return
		if r.ok and rev == _geometry_revision and not (busy or sync.dirty or sync.saving or _dragging() or _editing()):
			_adopt(r.data)
		elif not r.ok and is_visible_in_tree():
			status.emit(r.error)
		return


func _editing() -> bool:
	var f := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	return f != null and is_ancestor_of(f) and (f is LineEdit or f is OptionButton)


# ---- inputs poll, gallery ----

func _source_poll_safe() -> bool:
	return not state.is_empty() and is_visible_in_tree() and not busy and not sync.dirty and not sync.saving and not _dragging() \
		and not get_viewport().gui_is_dragging() and not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)


func _poll_sources() -> void:
	if _source_polling or not _source_poll_safe():
		return
	_source_polling = true
	var ver := _source_version
	var r: Dictionary = await StudioApi.read(_api(), "programming/sources")
	_source_polling = false
	if ver != _source_version or not _source_poll_safe():
		return
	var current := M.arr(state, "sources")
	var polled: Array = M.ints(M.arr(r.data, "sources")) if r.ok else []
	var next := M.merge_sources(current, polled) if r.ok else M.sources_unavailable(current)
	if next == current:
		return
	state.sources = next
	if _sources.tab in ["inputs", "screens"]:
		_sources.render(state, _gallery.gallery)


func load_gallery() -> void:
	_gallery.load_once()


func manage_gallery(body: Dictionary, done: String) -> void:
	if busy:
		return
	busy = true
	_set_busy()
	await _gallery.manage(body, done)
	busy = false
	_set_busy()


func thumb(id: int, cb: Callable) -> void:
	_gallery.thumb(id, cb)


func _button(parent: Node, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


static func _label(text: String, col := ThemeBuilder.TEXT_MUTED) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", col)
	return l
